import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { razorpayGateway } from '../lib/paymentGateways/razorpayGateway';
import { decryptConfigSecrets, gatewaySecretKeys } from '../lib/configSecret';

async function loadConfig(userId: string): Promise<unknown | null> {
  const row = await prisma.gatewayConfig.findUnique({
    where: { userId_kind: { userId, kind: 'RAZORPAY' } },
  });
  if (!row || !row.enabled) return null;
  // Decrypt secrets only here, at point-of-use, before calling the gateway.
  return decryptConfigSecrets(row.config, gatewaySecretKeys('RAZORPAY'));
}

export async function createOrder(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { invoiceId } = req.params as { invoiceId: string };

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, userId, isDeleted: false },
      select: {
        id: true, invoiceNumber: true, TotalAmount: true, vat: true,
      },
    });
    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    const config = await loadConfig(userId);
    if (!config) {
      res.status(400).json({ success: false, message: 'Razorpay not configured' });
      return;
    }

    const amount = Number(invoice.TotalAmount ?? 0);
    if (amount <= 0) {
      res.status(400).json({ success: false, message: 'Invoice amount must be > 0' });
      return;
    }

    const order = await razorpayGateway.createOrder({
      amount,
      currency: 'INR',
      invoiceId: invoice.id,
      receipt: invoice.invoiceNumber ?? `inv_${invoice.id.slice(0, 8)}`,
      notes: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber ?? '' },
      config,
    });

    const txn = await prisma.paymentTransaction.create({
      data: {
        userId,
        invoiceId: invoice.id,
        kind: 'RAZORPAY',
        status: 'CREATED',
        amount: new Prisma.Decimal(amount),
        currency: 'INR',
        gatewayOrderId: order.gatewayOrderId,
        metadata: order.metadata as Prisma.InputJsonValue,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        paymentTransactionId: txn.id,
        gatewayOrderId: order.gatewayOrderId,
        amount: amount,
        currency: 'INR',
        keyId: (order.metadata as { keyId?: string })?.keyId ?? '',
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('razorpay createOrder error:', err);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
}

export async function verifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      res.status(400).json({ success: false, message: 'Missing required fields' });
      return;
    }

    const config = await loadConfig(userId);
    if (!config) {
      res.status(400).json({ success: false, message: 'Razorpay not configured' });
      return;
    }

    const ok = razorpayGateway.verifyPayment({
      gatewayOrderId: razorpay_order_id,
      gatewayPaymentId: razorpay_payment_id,
      gatewaySignature: razorpay_signature,
      config,
    });

    if (!ok) {
      res.status(400).json({ success: false, message: 'Signature verification failed' });
      return;
    }

    const txn = await prisma.paymentTransaction.findFirst({
      where: { userId, gatewayOrderId: razorpay_order_id },
    });
    if (!txn) {
      res.status(404).json({ success: false, message: 'Transaction not found' });
      return;
    }

    await prisma.paymentTransaction.update({
      where: { id: txn.id },
      data: {
        status: 'CAPTURED',
        gatewayPaymentId: razorpay_payment_id,
        gatewaySignature: razorpay_signature,
      },
    });

    res.json({ success: true, message: 'Payment verified', data: { paymentTransactionId: txn.id } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('razorpay verifyPayment error:', err);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
}

export async function refund(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { paymentTransactionId } = req.params as { paymentTransactionId: string };
    const body = req.body as { amount?: number; reason?: string };

    const txn = await prisma.paymentTransaction.findFirst({
      where: { id: paymentTransactionId, userId, kind: 'RAZORPAY' },
    });
    if (!txn || !txn.gatewayPaymentId) {
      res.status(404).json({ success: false, message: 'Razorpay transaction not found' });
      return;
    }
    if (txn.status !== 'CAPTURED' && txn.status !== 'PARTIALLY_REFUNDED') {
      res.status(400).json({ success: false, message: 'Only CAPTURED transactions can be refunded' });
      return;
    }

    const config = await loadConfig(userId);
    if (!config) {
      res.status(400).json({ success: false, message: 'Razorpay not configured' });
      return;
    }

    const amount = Number(body.amount ?? txn.amount);
    if (amount <= 0) {
      res.status(400).json({ success: false, message: 'Refund amount must be > 0' });
      return;
    }

    const result = await razorpayGateway.refund({
      gatewayPaymentId: txn.gatewayPaymentId,
      amount,
      reason: body.reason,
      config,
    });

    const refundRow = await prisma.refund.create({
      data: {
        userId,
        paymentTransactionId: txn.id,
        amount: new Prisma.Decimal(amount),
        status: result.status === 'CAPTURED' ? 'CAPTURED' : 'PENDING',
        gatewayRefundId: result.gatewayRefundId,
        reason: body.reason ?? null,
      },
    });

    // Update parent txn status
    await prisma.paymentTransaction.update({
      where: { id: txn.id },
      data: { status: amount >= Number(txn.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });

    res.status(201).json({ success: true, message: 'Refund initiated', data: { refundId: refundRow.id, gatewayRefundId: result.gatewayRefundId } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('razorpay refund error:', err);
    res.status(500).json({ success: false, message: 'Failed to refund' });
  }
}

const handlers = { createOrder, verifyPayment, refund };
module.exports = handlers;
module.exports.default = handlers;
