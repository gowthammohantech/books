import type { GatewayKind } from '@prisma/client';

export interface CreateOrderInput {
  amount: number;
  currency: string;
  invoiceId?: string;
  receipt?: string;
  notes?: Record<string, string>;
  config: unknown;
}

export interface CreateOrderResult {
  gatewayOrderId: string;
  metadata?: Record<string, unknown>;
}

export interface VerifyPaymentInput {
  gatewayOrderId: string;
  gatewayPaymentId: string;
  gatewaySignature: string;
  config: unknown;
}

export interface RefundInput {
  gatewayPaymentId: string;
  amount: number;
  reason?: string;
  config: unknown;
}

export interface RefundResult {
  gatewayRefundId: string;
  status: 'CREATED' | 'PENDING' | 'CAPTURED' | 'FAILED';
}

export interface WebhookEvent {
  type: string;
  paymentId?: string;
  orderId?: string;
  refundId?: string;
  raw: unknown;
}

export interface PaymentGateway {
  kind: GatewayKind;
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  verifyPayment(input: VerifyPaymentInput): boolean;
  verifyWebhook(headers: Record<string, string>, rawBody: string, config: unknown): WebhookEvent | null;
  refund(input: RefundInput): Promise<RefundResult>;
}
