import Razorpay from 'razorpay';
import { createHmac } from 'crypto';

import type {
  CreateOrderInput, CreateOrderResult,
  PaymentGateway, RefundInput, RefundResult,
  VerifyPaymentInput, WebhookEvent,
} from '../paymentGateway';

interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

function asConfig(c: unknown): RazorpayConfig {
  const obj = (c ?? {}) as Record<string, unknown>;
  return {
    keyId: (obj.keyId as string) ?? '',
    keySecret: (obj.keySecret as string) ?? '',
    webhookSecret: (obj.webhookSecret as string) ?? undefined,
  };
}

export class RazorpayGateway implements PaymentGateway {
  readonly kind = 'RAZORPAY' as const;

  private client(config: RazorpayConfig): Razorpay {
    if (!config.keyId || !config.keySecret) throw new Error('Razorpay keyId + keySecret required');
    return new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const cfg = asConfig(input.config);
    const rp = this.client(cfg);
    const order = await rp.orders.create({
      amount: Math.round(input.amount * 100), // paise
      currency: input.currency || 'INR',
      receipt: input.receipt ?? `inv_${Date.now()}`,
      notes: input.notes,
    });
    return {
      gatewayOrderId: order.id,
      metadata: { keyId: cfg.keyId, currency: order.currency, amount: order.amount },
    };
  }

  verifyPayment(input: VerifyPaymentInput): boolean {
    const cfg = asConfig(input.config);
    if (!cfg.keySecret) return false;
    const expected = createHmac('sha256', cfg.keySecret)
      .update(`${input.gatewayOrderId}|${input.gatewayPaymentId}`)
      .digest('hex');
    return expected === input.gatewaySignature;
  }

  verifyWebhook(headers: Record<string, string>, rawBody: string, config: unknown): WebhookEvent | null {
    const cfg = asConfig(config);
    if (!cfg.webhookSecret) return null;
    const signature = headers['x-razorpay-signature'] ?? headers['X-Razorpay-Signature'];
    if (!signature) return null;
    const expected = createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
    if (expected !== signature) return null;

    try {
      const parsed = JSON.parse(rawBody) as {
        event: string;
        payload?: {
          payment?: { entity?: { id: string; order_id: string } };
          refund?: { entity?: { id: string } };
        };
      };
      const paymentEntity = parsed.payload?.payment?.entity;
      const refundEntity = parsed.payload?.refund?.entity;
      return {
        type: parsed.event,
        paymentId: paymentEntity?.id,
        orderId: paymentEntity?.order_id,
        refundId: refundEntity?.id,
        raw: parsed,
      };
    } catch {
      return null;
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const cfg = asConfig(input.config);
    const rp = this.client(cfg);
    const refund = await rp.payments.refund(input.gatewayPaymentId, {
      amount: Math.round(input.amount * 100),
      notes: input.reason ? { reason: input.reason } : undefined,
    });
    return {
      gatewayRefundId: refund.id,
      status: refund.status === 'processed' ? 'CAPTURED' : refund.status === 'failed' ? 'FAILED' : 'PENDING',
    };
  }
}

export const razorpayGateway = new RazorpayGateway();
