export interface CountryPack {
  countryCode: string;
  name: string;
  defaultFunctionalCurrency: string;
  fiscalYearStartMonth: number;
  taxRegime: string;
  accountCount: number;
}

export interface LedgerStatus {
  configured: boolean;
  ledgerInitialized: boolean;
  countryCode: string | null;
  functionalCurrency: string | null;
  fiscalYearStartMonth: number | null;
  goLiveDate: string | null;
}

export interface CutoverLine {
  roleKey: string;
  side: 'debit' | 'credit';
  amount: string;
}

export interface CutoverPreview {
  summary: { bank: string; cash: string; ar: string; inventory: string; ap: string };
  lines: CutoverLine[];
  balanced: boolean;
  asOf: string;
}
