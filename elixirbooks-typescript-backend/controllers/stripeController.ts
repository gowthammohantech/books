import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { stripeGateway } from '../lib/paymentGateways/stripeGateway';
import { decryptConfigSecrets, gatewaySecretKeys } from '../lib/configSecret';

async function loadConfig(userId: string): Promise<unknown | null> {
  const row = await prisma.gatewayConfig.findUnique({
    where: { userId_kind: { userId, kind: 'STRIPE' } },
  });
  if (!row || !row.enabled) return null;
  // Decrypt secrets only here, at point-of-use, before calling the gateway.
  return decryptConfigSecrets(row.config, gatewaySecretKeys('STRIPE'));
}

export async function createCheckoutSession(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { invoiceId } = req.params as { invoiceId: string };

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, userId, isDeleted: false },
      select: { id: true, invoiceNumber: true, TotalAmount: true },
    });
    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found' });
      return;
    }

    const config = await loadConfig(userId);
    if (!config) {
      res.status(400).json({ success: false, message: 'Stripe not configured' });
      return;
    }

    const amount = Number(invoice.TotalAmount ?? 0);
    if (amount <= 0) {
      res.status(400).json({ success: false, message: 'Invoice amount must be > 0' });
      return;
    }

    const session = await stripeGateway.createOrder({
      amount,
      currency: 'USD',
      invoiceId: invoice.id,
      receipt: invoice.invoiceNumber ?? `inv_${invoice.id.slice(0, 8)}`,
      notes: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber ?? '' },
      config,
    });

    const txn = await prisma.paymentTransaction.create({
      data: {
        userId,
        invoiceId: invoice.id,
        kind: 'STRIPE',
        status: 'CREATED',
        amount: new Prisma.Decimal(amount),
        currency: 'USD',
        gatewayOrderId: session.gatewayOrderId,
        metadata: session.metadata as Prisma.InputJsonValue,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        paymentTransactionId: txn.id,
        sessionId: session.gatewayOrderId,
        sessionUrl: (session.metadata as { sessionUrl?: string })?.sessionUrl ?? '',
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('stripe createCheckoutSession error:', err);
    res.status(500).json({ success: false, message: 'Failed to create checkout session' });
  }
}

export async function refund(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { paymentTransactionId } = req.params as { paymentTransactionId: string };
    const body = req.body as { amount?: number; reason?: string };

    const txn = await prisma.paymentTransaction.findFirst({
      where: { id: paymentTransactionId, userId, kind: 'STRIPE' },
    });
    if (!txn || !txn.gatewayPaymentId) {
      res.status(404).json({ success: false, message: 'Stripe transaction not found' });
      return;
    }
    if (txn.status !== 'CAPTURED' && txn.status !== 'PARTIALLY_REFUNDED') {
      res.status(400).json({ success: false, message: 'Only CAPTURED transactions can be refunded' });
      return;
    }

    const config = await loadConfig(userId);
    if (!config) {
      res.status(400).json({ success: false, message: 'Stripe not configured' });
      return;
    }

    const amount = Number(body.amount ?? txn.amount);
    if (amount <= 0) {
      res.status(400).json({ success: false, message: 'Refund amount must be > 0' });
      return;
    }

    const result = await stripeGateway.refund({
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

    await prisma.paymentTransaction.update({
      where: { id: txn.id },
      data: { status: amount >= Number(txn.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    });

    res.status(201).json({
      success: true,
      message: 'Refund initiated',
      data: { refundId: refundRow.id, gatewayRefundId: result.gatewayRefundId },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('stripe refund error:', err);
    res.status(500).json({ success: false, message: 'Failed to refund' });
  }
}

const handlers = { createCheckoutSession, refund };
module.exports = handlers;
module.exports.default = handlers;
