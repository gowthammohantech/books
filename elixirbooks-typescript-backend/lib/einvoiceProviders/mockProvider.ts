import { randomBytes } from 'crypto';

import type { EInvoiceGenerateResult, EInvoicePayload, EInvoiceProvider } from '../einvoiceProvider';

export class MockEInvoiceProvider implements EInvoiceProvider {
  readonly name = 'mock';

  async generate(payload: EInvoicePayload, _config: unknown): Promise<EInvoiceGenerateResult> {
    // Real IRN is 64-char hex. Mock = random 64-char hex.
    const irn = randomBytes(32).toString('hex');
    const ackNo = String(Math.floor(Math.random() * 1e15)).padStart(15, '0');
    return {
      irn,
      ackNo,
      ackDate: new Date(),
      signedInvoice: `MOCK_SIGNED_INV_${payload.invoiceNumber}`,
      signedQRCode: `MOCK_QR_${irn.slice(0, 16)}`,
      metadata: { provider: 'mock', payloadInvoiceNumber: payload.invoiceNumber },
    };
  }

  async cancel(_irn: string, _reason: string, _config: unknown): Promise<{ cancelledAt: Date }> {
    return { cancelledAt: new Date() };
  }

  async getStatus(_irn: string, _config: unknown): Promise<{ status: 'GENERATED' }> {
    return { status: 'GENERATED' };
  }
}

export const mockEInvoiceProvider = new MockEInvoiceProvider();
