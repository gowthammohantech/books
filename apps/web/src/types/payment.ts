import type { GatewayKind, PaymentTransactionStatus } from '@elixirbooks/enums';

// Generated from apps/api/prisma/schema.prisma. Re-exported so the existing
// import sites for these names keep working.
export type { GatewayKind, PaymentTransactionStatus };

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
