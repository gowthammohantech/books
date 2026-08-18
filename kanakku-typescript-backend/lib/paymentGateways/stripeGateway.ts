import Stripe from 'stripe';

import type {
  CreateOrderInput, CreateOrderResult,
  PaymentGateway, RefundInput, RefundResult,
  VerifyPaymentInput, WebhookEvent,
} from '../paymentGateway';

interface StripeConfig {
  secretKey: string;
  publishableKey?: string;
  webhookSecret?: string;
  successUrl?: string;
  cancelUrl?: string;
}

function asConfig(c: unknown): StripeConfig {
  const obj = (c ?? {}) as Record<string, unknown>;
  return {
    secretKey: (obj.secretKey as string) ?? '',
    publishableKey: (obj.publishableKey as string) ?? undefined,
    webhookSecret: (obj.webhookSecret as string) ?? undefined,
    successUrl: (obj.successUrl as string) ?? undefined,
    cancelUrl: (obj.cancelUrl as string) ?? undefined,
  };
}

export class StripeGateway implements PaymentGateway {
  readonly kind = 'STRIPE' as const;

  private client(config: StripeConfig): Stripe.Stripe {
    if (!config.secretKey) throw new Error('Stripe secretKey required');
    // Omit apiVersion to use the SDK's pinned default; avoids drift with literal type LatestApiVersion.
    return new Stripe(config.secretKey);
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const cfg = asConfig(input.config);
    const stripe = this.client(cfg);
    const successUrl = cfg.successUrl ?? `${process.env.BASE_URL ?? 'http://localhost:8080'}/admin/invoices`;
    const cancelUrl = cfg.cancelUrl ?? `${process.env.BASE_URL ?? 'http://localhost:8080'}/admin/invoices`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: (input.currency || 'usd').toLowerCase(),
            product_data: { name: input.receipt ?? 'Invoice payment' },
            unit_amount: Math.round(input.amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: input.notes ?? {},
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    return {
      gatewayOrderId: session.id,
      metadata: {
        publishableKey: cfg.publishableKey ?? '',
        sessionUrl: session.url ?? '',
        currency: input.currency,
        amount: input.amount,
      },
    };
  }

  verifyPayment(_: VerifyPaymentInput): boolean {
    // Stripe's checkout completion is server-verified via webhook + session.retrieve, not client signature.
    // The verify call here is a no-op; trust the webhook path.
    return true;
  }

  verifyWebhook(headers: Record<string, string>, rawBody: string, config: unknown): WebhookEvent | null {
    const cfg = asConfig(config);
    if (!cfg.webhookSecret) return null;
    const signature = headers['stripe-signature'];
    if (!signature) return null;
    try {
      const stripe = this.client(cfg);
      const event = stripe.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret);
      const obj = event.data.object as unknown as Record<string, unknown>;
      return {
        type: event.type,
        paymentId: (obj.payment_intent as string) ?? (obj.id as string),
        orderId: (obj.id as string),
        refundId: (obj.id as string),
        raw: event,
      };
    } catch {
      return null;
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const cfg = asConfig(input.config);
    const stripe = this.client(cfg);
    const refund = await stripe.refunds.create({
      payment_intent: input.gatewayPaymentId,
      amount: Math.round(input.amount * 100),
      reason: input.reason as 'duplicate' | 'fraudulent' | 'requested_by_customer' | undefined,
    });
    return {
      gatewayRefundId: refund.id,
      status: refund.status === 'succeeded' ? 'CAPTURED' : refund.status === 'failed' ? 'FAILED' : 'PENDING',
    };
  }
}

export const stripeGateway = new StripeGateway();
