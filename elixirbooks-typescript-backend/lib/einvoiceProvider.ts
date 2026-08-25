export interface EInvoicePayload {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  sellerGstin: string;
  buyerGstin: string | null;
  totalAmount: number;
  taxableAmount: number;
  totalTax: number;
  items: Array<{ name: string; qty: number; rate: number; amount: number; tax?: number }>;
}

export interface EInvoiceGenerateResult {
  irn: string;
  ackNo: string;
  ackDate: Date;
  signedInvoice: string;
  signedQRCode: string;
  metadata?: Record<string, unknown>;
}

export interface EInvoiceProvider {
  name: string;
  generate(payload: EInvoicePayload, config: unknown): Promise<EInvoiceGenerateResult>;
  cancel(irn: string, reason: string, config: unknown): Promise<{ cancelledAt: Date }>;
  getStatus(irn: string, config: unknown): Promise<{ status: 'GENERATED' | 'CANCELLED' | 'PENDING' | 'FAILED' }>;
}
