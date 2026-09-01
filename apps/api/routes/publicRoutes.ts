import express, { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

import { prisma, prismaUnscoped } from '../lib/prisma';
import { runAsTenant } from '../lib/tenantContext';
import { razorpayGateway } from '../lib/paymentGateways/razorpayGateway';
import { stripeGateway } from '../lib/paymentGateways/stripeGateway';
import { decryptConfigSecrets, gatewaySecretKeys } from '../lib/configSecret';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';

const router = Router();

// 60 requests per minute per IP — token enumeration defense
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
});

function buildBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

// Resolves the same siteLogo the authenticated app shows (CompanySettingsController's
// decorateImageUrls): a stored relative path becomes an absolute URL off this request's
// host; empty/absent stays null. Public pages have no redux/settings fetch of their own,
// so the logo must ride along in this payload.
function resolveSiteLogo(siteLogo: string | null | undefined, baseUrl: string): string | null {
  if (!siteLogo) return null;
  const cleanedPath = siteLogo.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  return `${baseUrl}/${cleanedPath}`;
}

interface PublicStoredItem {
  name?: string;
  productName?: string;
  unit?: string;
  qty?: number;
  rate?: number;
  discount?: number;
  discount_type?: string;
  discount_value?: number;
  tax?: number;
  totalTax?: number;
  taxes?: unknown;
  amount?: number;
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Explicit allowlist per line item — never spread the stored JSON blob as-is.
// Drops internal ids (id/productId) and surfaces the STORED amount (already
// discount/tax-aware) rather than a naive qty*rate recompute; the qty*rate
// fallback only applies to legacy rows saved before `amount` was persisted.
function mapPublicItems(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return (raw as PublicStoredItem[]).map((item) => ({
    name: item.name || item.productName || '',
    unit: item.unit || '',
    qty: asNumber(item.qty, 0),
    rate: asNumber(item.rate, 0),
    discount: asNumber(item.discount, 0),
    discount_type: item.discount_type ?? null,
    discount_value: asNumber(item.discount_value, 0),
    tax: asNumber(item.tax ?? item.totalTax, 0),
    taxes: Array.isArray(item.taxes) ? item.taxes : undefined,
    amount: asNumber(item.amount, asNumber(item.rate, 0) * asNumber(item.qty, 0)),
  }));
}

/**
 * Public read-only invoice payload — token-gated, no auth header.
 * Returns 404 for any of: token not found, publicViewEnabled=false, isDeleted=true.
 */
router.get('/invoices/:token', limiter, async (req: Request, res: Response) => {
  try {
    const { token } = req.params as { token: string };
    if (!token || token.length < 32) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }

    // CROSS-TENANT BY DESIGN: the token IS the credential, and which workspace
    // it belongs to is exactly what we are trying to find out. Invoice
    // .publicViewToken stays globally unique for this reason.
    const invoice = await prismaUnscoped.invoice.findUnique({
      where: { publicViewToken: token },
      include: {
        billToCustomer: { select: { name: true, email: true, phone: true, billingAddress: true } },
        billFromUser: { select: { firstName: true, lastName: true } },
        bank: { select: { accountHoldername: true, bankName: true, branchName: true, accountNumber: true, IFSCCode: true } },
      },
    });

    if (!invoice || !invoice.publicViewEnabled || invoice.isDeleted) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }

    // From here on we act AS the invoice's workspace, which is what makes the
    // logo, company details and payment config resolve to the right company.
    const company = await runAsTenant(invoice.tenantId, () => prisma.companySettings.findFirst({
      where: { tenantId: invoice.tenantId },
      select: { companyName: true, email: true, phone: true, address: true, publicBaseUrl: true, merchantUpiId: true, merchantName: true, gstin: true, vatNumber: true, abn: true, nzGstNumber: true, taxRegime: true, siteLogo: true },
    }));

    // SANITIZE — drop audit timestamps, signature blobs, custom field IDs.
    // Notes, terms & conditions, and bank details are merchant-authored fields meant for the
    // recipient (e.g. bank account for payment), so they are surfaced when present.
    const sanitized = {
      invoiceNumber: invoice.invoiceNumber,
      invoiceType: invoice.invoiceType,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      currency: invoice.currencyCode ?? null,
      items: mapPublicItems(invoice.items),
      taxableAmount: invoice.taxableAmount,
      totalDiscount: invoice.totalDiscount,
      vat: invoice.vat,
      TotalAmount: invoice.TotalAmount,
      // Per-invoice "Pay with" links → rendered as buttons on the public page.
      paymentOptions: invoice.paymentOptions ?? [],
      customer: invoice.billToCustomer
        ? {
            name: invoice.billToCustomer.name,
            email: invoice.billToCustomer.email,
            phone: invoice.billToCustomer.phone,
            billingAddress: invoice.billToCustomer.billingAddress,
          }
        : null,
      billFrom: invoice.billFromUser
        ? { firstName: invoice.billFromUser.firstName, lastName: invoice.billFromUser.lastName }
        : null,
      notes: invoice.notes || null,
      termsAndCondition: invoice.termsAndCondition || null,
      bank: invoice.bank
        ? {
            accountHoldername: invoice.bank.accountHoldername || '',
            bankName: invoice.bank.bankName || '',
            branchName: invoice.bank.branchName || '',
            accountNumber: invoice.bank.accountNumber || '',
            IFSCCode: invoice.bank.IFSCCode || '',
          }
        : null,
      company: company
        ? { ...company, siteLogo: resolveSiteLogo(company.siteLogo, buildBaseUrl(req)) }
        : null,
    };

    res.json({ success: true, data: { invoice: sanitized } });
  } catch (err) {
    console.error('public invoice fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to load invoice' });
  }
});

/**
 * Public read-only quotation payload — token-gated, no auth header.
 * Returns 404 for any of: token not found, publicViewEnabled=false, isDeleted=true.
 * Mirrors GET /invoices/:token above; a quotation has no payment/paid concept
 * (it's an unaccepted quote), so no UPI QR / bank details / amount-paid fields.
 */
router.get('/quotations/:token', limiter, async (req: Request, res: Response) => {
  try {
    const { token } = req.params as { token: string };
    if (!token || token.length < 32) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }

    // CROSS-TENANT BY DESIGN — see the invoice route above.
    const quotation = await prismaUnscoped.quotation.findUnique({
      where: { publicViewToken: token },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } },
        billToContact: { select: { id: true, firstName: true, lastName: true, organisation: true, email: true, mobile: true } },
        billToCustomer: { select: { name: true, email: true, phone: true, billingAddress: true } },
        customer: { select: { name: true, email: true, phone: true, billingAddress: true } },
        billFromUser: { select: { firstName: true, lastName: true } },
      },
    });

    if (!quotation || !quotation.publicViewEnabled || quotation.isDeleted) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }

    const company = await runAsTenant(quotation.tenantId, () => prisma.companySettings.findFirst({
      where: { tenantId: quotation.tenantId },
      select: { companyName: true, email: true, phone: true, address: true, publicBaseUrl: true, gstin: true, vatNumber: true, abn: true, nzGstNumber: true, taxRegime: true, siteLogo: true },
    }));

    // Contact-first party resolution (matches buildQuotationMap in emailTeamplateController.ts):
    // prefer the unified Contact, then the bill-to Contact, then the legacy Customer.
    const party = quotation.contact ?? quotation.billToContact ?? null;
    const legacy = quotation.billToCustomer ?? quotation.customer;
    const customer = party || legacy
      ? {
          name: (party ? resolveDisplayName(party) : '') || legacy?.name || '',
          email: party?.email ?? legacy?.email ?? null,
          phone: party?.mobile ?? legacy?.phone ?? null,
          billingAddress: legacy?.billingAddress ?? null,
        }
      : null;

    // SANITIZE — drop audit timestamps, signature blobs, internal ids beyond what's needed.
    const sanitized = {
      quotationNumber: quotation.quotationId,
      quotationDate: quotation.quotationDate,
      expiryDate: quotation.expiryDate,
      status: quotation.status,
      currency: quotation.currencyCode ?? null,
      items: mapPublicItems(quotation.items),
      taxableAmount: quotation.taxableAmount,
      totalDiscount: quotation.totalDiscount,
      vat: quotation.vat,
      TotalAmount: quotation.TotalAmount,
      paymentTerms: quotation.paymentTerms || null,
      customer,
      billFrom: quotation.billFromUser
        ? { firstName: quotation.billFromUser.firstName, lastName: quotation.billFromUser.lastName }
        : null,
      notes: quotation.notes || null,
      termsAndCondition: quotation.termsAndCondition || null,
      company: company
        ? { ...company, siteLogo: resolveSiteLogo(company.siteLogo, buildBaseUrl(req)) }
        : null,
    };

    // Outer key stays `invoice` for structural consistency with GET /invoices/:token —
    // PublicQuotationViewer.tsx reads response.data.data.invoice the same way
    // PublicInvoiceViewer.tsx does.
    res.json({ success: true, data: { invoice: sanitized } });
  } catch (err) {
    console.error('public quotation fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to load quotation' });
  }
});

/**
 * Razorpay webhook — public, signature-verified via per-user webhookSecret.
 * Uses express.raw() so we receive the exact bytes Razorpay signed.
 */
router.post('/razorpay/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : JSON.stringify(req.body);

    // Parse without verifying to extract the order_id so we can locate the tenant + config.
    let preview: { payload?: { payment?: { entity?: { order_id: string } } } } | null = null;
    try { preview = JSON.parse(rawBody); } catch { /* ignore */ }
    const orderId = preview?.payload?.payment?.entity?.order_id;
    if (!orderId) {
      res.status(400).json({ success: false, message: 'Missing order_id' });
      return;
    }

    // CROSS-TENANT BY DESIGN: a gateway webhook arrives with the gateway's own
    // order id and nothing else — resolving the workspace from it is the whole
    // job. The id is issued by the gateway, not by the caller.
    const txn = await prismaUnscoped.paymentTransaction.findFirst({
      where: { gatewayOrderId: orderId, kind: 'RAZORPAY' },
    });
    if (!txn) {
      // Unknown order: ack with 200 so Razorpay stops retrying.
      res.status(200).json({ success: true, message: 'Unknown order, ignoring' });
      return;
    }
    const cfg = await runAsTenant(txn.tenantId, () => prisma.gatewayConfig.findFirst({
      where: { tenantId: txn.tenantId, kind: 'RAZORPAY' },
    }));
    if (!cfg) {
      res.status(200).json({ success: true, message: 'No config, ignoring' });
      return;
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
    const decryptedConfig = decryptConfigSecrets(cfg.config, gatewaySecretKeys('RAZORPAY'));
    const event = razorpayGateway.verifyWebhook(headers, rawBody, decryptedConfig);
    if (!event) {
      res.status(400).json({ success: false, message: 'Invalid webhook signature' });
      return;
    }

    // Idempotency: do not regress already-CAPTURED transactions.
    if (event.type === 'payment.captured' && event.paymentId) {
      if (txn.status !== 'CAPTURED') {
        await prisma.paymentTransaction.update({
          where: { id: txn.id },
          data: { status: 'CAPTURED', gatewayPaymentId: event.paymentId },
        });
      }
    } else if (event.type === 'payment.failed') {
      if (txn.status === 'CREATED' || txn.status === 'PENDING') {
        await prisma.paymentTransaction.update({ where: { id: txn.id }, data: { status: 'FAILED' } });
      }
    } else if (event.type === 'refund.processed' && event.refundId) {
      await prisma.refund.updateMany({
        where: { paymentTransactionId: txn.id, gatewayRefundId: event.refundId },
        data: { status: 'CAPTURED' },
      });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('razorpay webhook error:', err);
    res.status(500).json({ success: false, message: 'Webhook processing error' });
  }
});

/**
 * Stripe webhook — public, signature-verified via per-user webhookSecret.
 * Uses express.raw() so we receive the exact bytes Stripe signed.
 */
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf-8') : JSON.stringify(req.body);

    // Parse without verifying to extract the session id so we can locate the tenant + config.
    let preview: { data?: { object?: { id?: string; payment_intent?: string } } } | null = null;
    try { preview = JSON.parse(rawBody); } catch { /* ignore */ }
    const sessionId = preview?.data?.object?.id;
    if (!sessionId) {
      res.status(400).json({ success: false, message: 'Missing session id' });
      return;
    }
    // CROSS-TENANT BY DESIGN — see the Razorpay webhook above.
    const txn = await prismaUnscoped.paymentTransaction.findFirst({
      where: { gatewayOrderId: sessionId, kind: 'STRIPE' },
    });
    if (!txn) {
      // Unknown session: ack with 200 so Stripe stops retrying.
      res.status(200).json({ success: true, message: 'Unknown session, ignoring' });
      return;
    }
    const cfg = await runAsTenant(txn.tenantId, () => prisma.gatewayConfig.findFirst({
      where: { tenantId: txn.tenantId, kind: 'STRIPE' },
    }));
    if (!cfg) {
      res.status(200).json({ success: true, message: 'No config, ignoring' });
      return;
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    }
    const decryptedConfig = decryptConfigSecrets(cfg.config, gatewaySecretKeys('STRIPE'));
    const event = stripeGateway.verifyWebhook(headers, rawBody, decryptedConfig);
    if (!event) {
      res.status(400).json({ success: false, message: 'Invalid webhook signature' });
      return;
    }

    // Idempotency: do not regress already-CAPTURED transactions.
    if (event.type === 'checkout.session.completed' && event.paymentId) {
      if (txn.status !== 'CAPTURED') {
        await prisma.paymentTransaction.update({
          where: { id: txn.id },
          data: { status: 'CAPTURED', gatewayPaymentId: event.paymentId },
        });
      }
    } else if (event.type === 'charge.refunded' && event.refundId) {
      await prisma.refund.updateMany({
        where: { paymentTransactionId: txn.id, gatewayRefundId: event.refundId },
        data: { status: 'CAPTURED' },
      });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('stripe webhook error:', err);
    res.status(500).json({ success: false, message: 'Webhook processing error' });
  }
});

export default router;
