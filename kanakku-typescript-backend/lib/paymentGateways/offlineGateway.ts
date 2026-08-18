import { randomBytes } from 'crypto';
import type {
  CreateOrderInput, CreateOrderResult,
  PaymentGateway, RefundInput, RefundResult,
  VerifyPaymentInput, WebhookEvent,
} from '../paymentGateway';

export class OfflineGateway implements PaymentGateway {
  readonly kind = 'OFFLINE' as const;

  async createOrder(_input: CreateOrderInput): Promise<CreateOrderResult> {
    return {
      gatewayOrderId: `offline_${randomBytes(8).toString('hex')}`,
      metadata: { mode: 'offline' },
    };
  }

  verifyPayment(_: VerifyPaymentInput): boolean {
    return true;
  }

  verifyWebhook(_: Record<string, string>, __: string, ___: unknown): WebhookEvent | null {
    return null;
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    return {
      gatewayRefundId: `offline_refund_${randomBytes(8).toString('hex')}`,
      status: 'CAPTURED',
    };
  }
}

export const offlineGateway = new OfflineGateway();
