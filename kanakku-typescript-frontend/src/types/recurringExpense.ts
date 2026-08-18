export type { RecurrenceFrequency, RecurrenceCustomIntervalType } from './recurringInvoice';

export interface RecurringExpenseSummary {
  id: string;
  referenceNo: string | null;
  amount: string | number;
  supplier: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  repeatEvery: 'day' | 'week' | 'month' | 'year' | 'custom' | null;
  customIntervalNumber: number | null;
  customIntervalType: 'day' | 'week' | 'month' | 'year' | null;
  startOn: string | null;
  endsOn: string | null;
  neverExpire: boolean;
  stopped: boolean;
  lastRecurringDate: string | null;
  nextRecurringDate: string | null;
  childrenCount: number;
}

export interface ChildExpenseSummary {
  id: string;
  referenceNo: string | null;
  amount: string | number;
  expenseDate: string;
  paymentStatus: string;
}
