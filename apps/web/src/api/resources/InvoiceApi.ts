/**
 * The Invoices API as one class.
 *
 * `/admin/invoices` appears in `constants/api.ts` under thirteen different keys
 * — the worst case in the file — because there is one per verb and one per
 * sub-resource. They resolve to five real URLs, which is what this declares.
 *
 * The sub-resources (payments, activity) are methods rather than their own
 * classes: they have no independent identity, only ever appear beneath an
 * invoice, and `qk.invoicePayments(id)` nests their cache key under the
 * invoice's so invalidating the invoice refreshes them too.
 *
 * `constants/api.ts` keeps every one of those thirteen keys until their callers
 * move.
 */
import Constants from '@constants/api';

import { ResourceApi, type ListParams, type Pagination } from '../core/ResourceApi';

export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceType: string;
  invoiceDate: string;
  dueDate: string | null;
  status: string;
  TotalAmount: string | number;
  vat: string | number | null;
  totalDiscount: string | number | null;
  currencyCode: string | null;
  billToCustomer?: { id: string; name: string; email: string | null } | null;
}

export interface InvoicePaymentRow {
  id: string;
  amount: string | number;
  received_on: string;
  reference: string | null;
  paymentMode: string | null;
}

export interface ActivityEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  summary: string | null;
  userName: string | null;
  createdAt: string;
}

export interface InvoiceListParams extends ListParams {
  status?: string;
  invoiceType?: string;
}

export class InvoiceApi extends ResourceApi<InvoiceRow> {
  protected readonly path = `${Constants.API_BASE_URL}/admin/invoices`;
  protected readonly listKey = 'invoices';

  async list(params?: InvoiceListParams): Promise<{ rows: InvoiceRow[]; pagination: Pagination }> {
    return await super.list(params);
  }

  /**
   * The read used by the public/print paths.
   *
   * A distinct URL (`/admin/invoices/details/:id`), not `byId` — it returns a
   * different projection and is reachable without the usual permission gate.
   */
  detailsForPrint(id: string): Promise<InvoiceRow> {
    return this.get<InvoiceRow>(`${this.path}/details/${id}`);
  }

  payments(id: string): Promise<{ payments: InvoicePaymentRow[]; summary: unknown }> {
    return this.get(`${this.path}/${id}/payments`);
  }

  activity(id: string): Promise<{ items: ActivityEntryDto[] }> {
    return this.get(`${this.path}/${id}/activity`);
  }

  recordPayment(id: string, dto: Record<string, unknown>): Promise<InvoicePaymentRow> {
    return this.post<InvoicePaymentRow>(`${this.path}/${id}/payments`, dto);
  }

  updateStatus(id: string, status: string): Promise<InvoiceRow> {
    return this.put<InvoiceRow>(`${this.path}/update-status/${id}`, { status });
  }

  /** Invoices are written as multipart: they carry a signature image. */
  createWithFiles(form: FormData): Promise<InvoiceRow> {
    return this.upload<InvoiceRow>(this.path, form, 'post');
  }

  updateWithFiles(id: string, form: FormData): Promise<InvoiceRow> {
    return this.upload<InvoiceRow>(`${this.path}/${id}`, form, 'put');
  }
}

export const invoiceApi = new InvoiceApi();
