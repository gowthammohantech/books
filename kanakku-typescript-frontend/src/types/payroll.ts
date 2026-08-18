export interface DeductionLine { label: string; amount: number }

export interface PayrollProfile {
  id: string;
  employeeUserId: string;
  employee?: { id: string; firstName?: string; lastName?: string; email?: string };
  defaultGross: number | null;
  payFrequency: 'MONTHLY';
  isActive: boolean;
}

export interface PayRunLine {
  id?: string;
  employeeUserId: string;
  employee?: { id: string; firstName?: string; lastName?: string };
  gross: number;
  deductions: number;
  net: number;
  deductionLines: DeductionLine[];
  note?: string | null;
}

export interface PayRun {
  id: string;
  taxYearLabel: string;
  taxMonth: number;
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'FINALIZED' | 'VOID';
  lines: PayRunLine[];
}
