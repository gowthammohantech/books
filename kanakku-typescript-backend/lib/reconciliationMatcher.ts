// =============================================================================
// reconciliationMatcher
// -----------------------------------------------------------------------------
// Pure scoring function used by the bank-transaction reconciliation flow
// (slice E.2). Given a bank transaction (amount/date/reference) and a list of
// payment candidates (InvoicePayment or SupplierPayment rows), score each
// candidate and return the ranked matches that clear the threshold.
//
// Score components:
//   exact amount         → +60
//   amount within 1%     → +40
//   date proximity       → 0..30 (linear within tolerance window)
//   reference substring  → +10
// Threshold: 50.
// =============================================================================

export interface MatchCandidate {
  id: string;
  kind: 'INVOICE_PAYMENT' | 'SUPPLIER_PAYMENT';
  amount: number;
  date: Date;
  reference: string;
  parentLabel: string;
}

export interface MatchScore {
  candidate: MatchCandidate;
  score: number;
  reasons: string[];
}

interface MatcherInput {
  txnAmount: number;
  txnDate: Date;
  txnReference: string;
  candidates: MatchCandidate[];
  dateToleranceDays?: number;
}

export function matchBankTransaction(input: MatcherInput): MatchScore[] {
  const tolerance = input.dateToleranceDays ?? 5;
  const oneDay = 24 * 60 * 60 * 1000;
  const txnDateMs = input.txnDate.getTime();
  const ref = input.txnReference.toLowerCase().trim();

  const scored: MatchScore[] = input.candidates.map((c) => {
    const reasons: string[] = [];
    let score = 0;

    if (Math.abs(c.amount - input.txnAmount) < 0.01) {
      score += 60;
      reasons.push('exact amount');
    } else {
      // amount mismatch — heavily penalize unless within rounding tolerance
      const diff = Math.abs(c.amount - input.txnAmount);
      if (input.txnAmount !== 0 && diff / Math.abs(input.txnAmount) < 0.01) {
        score += 40;
        reasons.push('amount within 1%');
      }
    }

    const dayDiff = Math.abs((c.date.getTime() - txnDateMs) / oneDay);
    if (dayDiff <= tolerance) {
      const closeness = Math.max(0, tolerance - dayDiff) / tolerance;
      score += Math.round(closeness * 30);
      reasons.push(`date within ${Math.round(dayDiff)}d`);
    }

    if (ref && c.reference && c.reference.toLowerCase().includes(ref)) {
      score += 10;
      reasons.push('reference match');
    }

    return { candidate: c, score, reasons };
  });

  return scored
    .filter((s) => s.score >= 50)
    .sort((a, b) => b.score - a.score);
}
