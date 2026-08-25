export type GatewayKind = 'RAZORPAY' | 'STRIPE' | 'OFFLINE';
export type PaymentTransactionStatus = 'CREATED' | 'PENDING' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

export interface PaymentTransactionSummary {
  id: string;
  kind: GatewayKind;
  status: PaymentTransactionStatus;
  amount: string | number;
  currency: string;
  invoiceId: string | null;
  invoice: { id: string; invoiceNumber: string | null } | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  createdAt: string;
}

export interface RefundSummary {
  id: string;
  amount: string | number;
  status: PaymentTransactionStatus;
  reason: string | null;
  gatewayRefundId: string | null;
  paymentTransactionId: string;
  createdAt: string;
}

export interface GatewayConfigSummary {
  id?: string;
  kind: GatewayKind;
  enabled: boolean;
  livemode: boolean;
  config?: Record<string, unknown>;
}
