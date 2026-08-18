// lib/agentsGatewayClient.ts
//
// Thin client for the Dreams Agents gateway (Ship 2: bank-transaction
// auto-explain). The gateway is a stateless suggestion brain — we send a
// transaction plus the tenant's candidate categories and get back a chosen
// category + confidence. Kanakku owns the write and the FOR_APPROVAL flow.
//
// Config is read from process.env at call time (matching the rest of the
// backend — dotenv is loaded once in server.js, no central config loader):
//   GATEWAY_URL          default http://gateway:3002
//   GATEWAY_PUBLIC_KEY   pk-drm-...  (per-tenant gateway key)
//   GATEWAY_SECRET_KEY   sk-drm-...
//
// FAIL-SOFT: any missing config, timeout, or non-2xx returns null so the
// caller degrades gracefully (the bank transaction just stays UNEXPLAINED).

export type ExplainDirection = 'MONEY_IN' | 'MONEY_OUT';

export interface ExplainCandidate {
  code: string;
  name: string;
  group?: string;
  accountCode?: string;
}

export interface ExplainRequest {
  txnId: string;
  transaction: {
    description: string;
    amount: string; // fixed-precision decimal string, never a float
    currency: string;
    direction: ExplainDirection;
  };
  candidates: ExplainCandidate[];
}

export interface ExplainResult {
  runId: string;
  match: { categoryCode: string; name: string } | null;
  confidence: number;
  needsReview: boolean;
  decision: 'auto-explain' | 'for-approval';
}

const TIMEOUT_MS = 8000;

export async function explainBankTransaction(
  input: ExplainRequest,
): Promise<ExplainResult | null> {
  const base = process.env.GATEWAY_URL ?? 'http://gateway:3002';
  const publicKey = process.env.GATEWAY_PUBLIC_KEY;
  const secretKey = process.env.GATEWAY_SECRET_KEY;
  if (!publicKey || !secretKey) return null; // not configured → skip silently

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/v1/explain/bank-transaction`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publicKey}:${secretKey}`,
        // Stable per transaction: a retry replays the same gateway run and is
        // not re-charged. Append :updatedAt if you want a deliberate re-analyse
        // to produce a fresh suggestion.
        'Idempotency-Key': `bank-txn-${input.txnId}`,
      },
      body: JSON.stringify({
        transaction: input.transaction,
        candidates: input.candidates,
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ExplainResult;
  } catch {
    return null; // timeout / gateway down / network error → fail soft
  } finally {
    clearTimeout(timer);
  }
}
