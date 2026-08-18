/**
 * lib/reminderMailer.ts
 *
 * Wave-1 Task 3: shared "pure send" helper for invoice reminder emails.
 * Used by both:
 *   - controllers/reminderController.ts#sendManualReminder (single reminder,
 *     fired by a user click)
 *   - invoiceReminderCron.ts (automatic reminders, one call per matching
 *     invoice — pass `invoiceId` to override the reminder's own target)
 *
 * This module never marks anything "sent" itself — callers own the
 * bookkeeping (Reminder.status / lastSent / manualReminderData) and must only
 * write it when `{ sent: true }` comes back. That keeps the "never claim
 * success without a real send" invariant enforceable in exactly one place
 * per caller, right next to the write.
 *
 * Transport: reuses utils/mailer.js's `sendMail`, the same single send path
 * `sendInvoiceEmail` uses (Resend / SMTP / Node Mail from EmailSettings, or
 * env fallback; throws a typed `EMAIL_NOT_CONFIGURED` error when nothing is
 * configured). We import it via ESM `import` (not `require`) specifically so
 * `vi.mock('../utils/mailer', ...)` can intercept it in tests — a plain
 * top-level CJS `require()` is NOT interceptable by vi.mock in this project
 * (see tests/sendInvoiceEmail.guards.test.ts's mocking note).
 *
 * Public link: mirrors emailTeamplateController.ts's buildInvoiceMap /
 * invoiceController.ts's enablePublicLink — a 64-char hex publicViewToken,
 * auto-generated + enabled on first use, resolved against the tenant's
 * CompanySettings.publicBaseUrl (falling back to FRONTEND_URL). The link is
 * always `${base}/invoice/:token` — the public, token-gated viewer — never
 * the staff-only `/admin/...` route, which 404s/redirects to login for an
 * external recipient with no account.
 *
 * Placeholders: reminders use `%Tag%` tokens (NOT the `{Tag}` curly-brace
 * convention used by the separate notification-type EmailTemplate system in
 * emailTeamplateController.ts). This is the reminder feature's own documented
 * convention — see reminderController.ts#getInvoicePlaceholders /
 * getQuotationPlaceholders ("Use %PlaceholderName% in email templates") and
 * the frontend's manual-reminder default body. The key set mirrors the now-
 * dead Mongoose utils/placeholderHelper.js (%CustomerName%, %InvoiceNumber%,
 * %InvoiceUrl%, etc.) reimplemented against Prisma so it works without
 * MONGO_URI.
 */
import { randomBytes } from 'crypto';
import { prisma } from './prisma';
// utils/mailer.js has no type declarations (allowJs is off, so TS can't infer
// from the .js source). An ESM `import` (not `require`) is intentional here —
// it's what lets tests intercept the transport with `vi.mock('../utils/mailer',
// ...)`; a top-level `require()` is NOT mockable in this project's vitest setup
// (see tests/sendInvoiceEmail.guards.test.ts's mocking note).
// @ts-expect-error TS7016 — untyped CJS module, see note above.
import { sendMail } from '../utils/mailer';
import { resolveDisplayName } from './contacts/contactIdentity';

export interface SendReminderResult {
  sent: boolean;
  error?: string;
}

export interface SendReminderParams {
  reminderId: string;
  /**
   * Overrides the reminder's own target invoice. Automatic reminders have no
   * fixed target (they're a standing rule applied across a tenant's
   * outstanding invoices), so the cron passes the specific invoice matched
   * for this run; manual reminders omit it and fall back to
   * `reminder.targetInvoice`.
   */
  invoiceId?: string;
}

type PartyContact = {
  firstName: string | null;
  lastName: string | null;
  organisation: string | null;
  email: string | null;
} | null;

type LegacyCustomer = { name: string | null; email: string | null } | null;

interface InvoiceForReminder {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  TotalAmount: unknown;
  publicViewToken: string | null;
  publicViewEnabled: boolean;
  contact: PartyContact;
  billToContact: PartyContact;
  customer: LegacyCustomer;
  billToCustomer: LegacyCustomer;
  payments: { amount: unknown }[];
}

const invoiceSelectForReminder = {
  id: true,
  invoiceNumber: true,
  invoiceDate: true,
  dueDate: true,
  TotalAmount: true,
  publicViewToken: true,
  publicViewEnabled: true,
  contact: { select: { firstName: true, lastName: true, organisation: true, email: true } },
  billToContact: { select: { firstName: true, lastName: true, organisation: true, email: true } },
  customer: { select: { name: true, email: true } },
  billToCustomer: { select: { name: true, email: true } },
  payments: { where: { isVoided: false }, select: { amount: true } },
} as const;

function generatePublicToken(): string {
  return randomBytes(32).toString('hex');
}

function appBaseUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/+$/, '');
}

// Prefer the tenant's own configured public base URL (CompanySettings.publicBaseUrl)
// over the server-wide FRONTEND_URL fallback — mirrors
// emailTeamplateController.ts#resolvePublicBaseUrl exactly.
function resolvePublicBaseUrl(companyPublicBaseUrl?: string | null): string {
  return (companyPublicBaseUrl || appBaseUrl()).replace(/\/+$/, '');
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtMoney(n: unknown): string {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toFixed(2) : '0.00';
}

function applyPercentPlaceholders(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(map)) {
    out = out.split(`%${key}%`).join(value);
  }
  return out;
}

/** Ensures the invoice has a live public-view token and returns the public link. */
async function resolveInvoicePublicLink(
  invoice: Pick<InvoiceForReminder, 'id' | 'publicViewToken' | 'publicViewEnabled'>,
  companyPublicBaseUrl?: string | null,
): Promise<string> {
  let token = invoice.publicViewToken;
  if (!token) {
    token = generatePublicToken();
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { publicViewToken: token, publicViewEnabled: true },
    });
  } else if (!invoice.publicViewEnabled) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { publicViewEnabled: true } });
  }
  return `${resolvePublicBaseUrl(companyPublicBaseUrl)}/invoice/${token}`;
}

function partyName(party: PartyContact, legacy: LegacyCustomer): string {
  if (party) {
    const name = resolveDisplayName({
      organisation: party.organisation ?? undefined,
      firstName: party.firstName ?? undefined,
      lastName: party.lastName ?? undefined,
    });
    if (name) return name;
  }
  return legacy?.name ?? '';
}

function partyEmail(party: PartyContact, legacy: LegacyCustomer): string {
  return party?.email || legacy?.email || '';
}

/**
 * Sends a single reminder email. Pure send helper: resolves recipient +
 * body, sends via the shared transport, and reports whether it actually
 * went out. Never writes to the Reminder or Invoice rows to mark "sent" —
 * callers do that bookkeeping only after seeing `{ sent: true }`.
 */
export async function sendReminderEmail(params: SendReminderParams): Promise<SendReminderResult> {
  const { reminderId } = params;
  try {
    const reminder = await prisma.reminder.findUnique({
      where: { id: reminderId },
      include: {
        targetInvoiceRel: { select: invoiceSelectForReminder },
        targetCustomerRel: { select: { name: true, email: true } },
        targetContactRel: {
          select: { firstName: true, lastName: true, organisation: true, email: true },
        },
        company: { select: { publicBaseUrl: true } },
      },
    });

    if (!reminder) {
      return { sent: false, error: 'Reminder not found' };
    }

    // Resolve the target invoice: explicit override (cron, per-invoice) wins,
    // otherwise fall back to the reminder's own target (manual reminders).
    let invoice: InvoiceForReminder | null =
      (reminder.targetInvoiceRel as InvoiceForReminder | null) ?? null;
    const overrideId = params.invoiceId;
    if (overrideId && overrideId !== reminder.targetInvoice) {
      invoice = (await prisma.invoice.findUnique({
        where: { id: overrideId },
        select: invoiceSelectForReminder,
      })) as InvoiceForReminder | null;
    }

    // Recipient resolution: an explicit target contact/customer on the
    // reminder wins (manual reminders can be pointed at either); otherwise
    // fall back to the invoice's own party — contact-first, mirroring
    // emailTeamplateController.ts#buildInvoiceMap's precedence.
    const invoiceParty = invoice?.contact ?? invoice?.billToContact ?? null;
    const invoiceLegacy = invoice?.billToCustomer ?? invoice?.customer ?? null;
    const targetContact = reminder.targetContactRel as PartyContact;
    const targetCustomer = reminder.targetCustomerRel as LegacyCustomer;

    const to =
      targetContact?.email ||
      targetCustomer?.email ||
      partyEmail(invoiceParty, invoiceLegacy);

    if (!to) {
      return { sent: false, error: 'No customer email on file for this reminder' };
    }

    const customerName =
      (targetContact ? partyName(targetContact, null) : '') ||
      targetCustomer?.name ||
      partyName(invoiceParty, invoiceLegacy);

    let viewLink = '';
    if (invoice) {
      viewLink = await resolveInvoicePublicLink(invoice, reminder.company?.publicBaseUrl);
    }

    const totalPaid = (invoice?.payments ?? []).reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const total = Number(invoice?.TotalAmount ?? 0);
    const balance = total - totalPaid;
    const overdueDays = invoice?.dueDate
      ? Math.max(0, Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    const placeholderMap: Record<string, string> = {
      CustomerName: customerName,
      CustomerEmail: to,
      InvoiceNumber: invoice?.invoiceNumber ?? '',
      InvoiceDate: fmtDate(invoice?.invoiceDate),
      DueDate: fmtDate(invoice?.dueDate),
      OverdueDays: String(overdueDays),
      Balance: fmtMoney(balance),
      Total: fmtMoney(total),
      InvoiceUrl: viewLink,
      InvoicePaymentLink: viewLink,
    };

    const emailConfig = (reminder.emailConfig ?? {}) as {
      subject?: string;
      body?: string;
      fromEmail?: string;
      cc?: string[];
      bcc?: string[];
    };

    const subject = emailConfig.subject
      ? applyPercentPlaceholders(emailConfig.subject, placeholderMap)
      : `Payment reminder${invoice?.invoiceNumber ? ` for ${invoice.invoiceNumber}` : ''}`;

    const fallbackBody =
      `<p>Dear ${customerName || 'Customer'},</p>` +
      `<p>This is a reminder regarding your invoice${
        invoice?.invoiceNumber ? ` <strong>${invoice.invoiceNumber}</strong>` : ''
      }${balance ? `, balance due ${fmtMoney(balance)}` : ''}.</p>` +
      (viewLink ? `<p><a href="${viewLink}">View Invoice</a></p>` : '');

    const body = emailConfig.body
      ? applyPercentPlaceholders(emailConfig.body, placeholderMap)
      : fallbackBody;

    await sendMail({
      to,
      cc: emailConfig.cc && emailConfig.cc.length ? emailConfig.cc.join(',') : undefined,
      bcc: emailConfig.bcc && emailConfig.bcc.length ? emailConfig.bcc.join(',') : undefined,
      from: emailConfig.fromEmail || undefined,
      subject,
      html: body,
    });

    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
