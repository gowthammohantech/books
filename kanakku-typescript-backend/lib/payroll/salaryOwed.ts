export interface SalaryRow { date: Date; description: string; amount: number }
export interface SalaryOwedResult {
  entries: { date: Date; description: string; owed: number; paid: number }[];
  owed: number;
  paid: number;
  outstanding: number;
}

/** Build per-user salary owed/paid/outstanding from in-window finalized
 *  pay-run line nets (owed) and in-window payroll_settlement bank payments
 *  (paid). Pure — no I/O. */
export function buildSalaryOwed(runLines: SalaryRow[], settlements: SalaryRow[]): SalaryOwedResult {
  const entries = [
    ...runLines.map((r) => ({ date: r.date, description: r.description, owed: r.amount, paid: 0 })),
    ...settlements.map((s) => ({ date: s.date, description: s.description, owed: 0, paid: s.amount })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  const owed = runLines.reduce((s, r) => s + r.amount, 0);
  const paid = settlements.reduce((s, r) => s + r.amount, 0);
  return { entries, owed, paid, outstanding: owed - paid };
}
