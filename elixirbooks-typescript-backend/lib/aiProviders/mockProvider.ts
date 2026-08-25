import { normalizeBillExtraction } from '../aiPrompts/billExtraction';

import type {
  AiProvider,
  ChatMessage,
  ChatStreamEvent,
  ExtractResult,
  ToolDef,
} from './types';

/**
 * Deterministic AI provider used for marketing demos, end-to-end tests,
 * and to keep the BYOK flow degradable when the user has no key. All
 * responses are canned; no external calls are made.
 *
 * H.1 fully fleshes out `ping()`. `extractDocument()` and `chatStream()`
 * return realistic-looking canned data that exists primarily so the
 * frontend can be wired now and refined in H.2/H.3.
 */
export class MockProvider implements AiProvider {
  async ping(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async extractDocument(_file: Buffer, _mimeType: string): Promise<ExtractResult> {
    // Canned response shaped like a real Indian GST bill, normalized
    // through the same parser used by the Claude/OpenAI implementations
    // so the frontend sees a consistent shape regardless of provider.
    const fields = normalizeBillExtraction({
      vendorName: 'Acme Office Supplies',
      vendorGstin: '33ABCDE1234F1Z5',
      invoiceNumber: 'AOS-2026-0042',
      invoiceDate: '2026-05-20',
      dueDate: '2026-06-19',
      currency: 'INR',
      lineItems: [
        { description: 'Printer Paper A4 ream', quantity: 10, unitPrice: 400, amount: 4000 },
        { description: 'HP 805 Ink Cartridge', quantity: 4, unitPrice: 1500, amount: 6000 },
        { description: 'A4 File Folders', quantity: 20, unitPrice: 100, amount: 2000 },
      ],
      taxBreakdown: [
        { label: 'CGST 9%', rate: 9, amount: 1080 },
        { label: 'SGST 9%', rate: 9, amount: 1080 },
      ],
      subtotal: 12000,
      total: 14160,
      notes: 'Mock extraction — Acme Office Supplies sample bill.',
      _confidence: 0.95,
    });
    return {
      fields: fields as unknown as Record<string, unknown>,
      rawResponse: JSON.stringify(fields),
      confidence: fields._confidence,
      costUsd: 0,
    };
  }

  async *chatStream(
    _messages: ChatMessage[],
    _tools: ToolDef[],
    _ctx: { userId: string },
  ): AsyncIterable<ChatStreamEvent> {
    // Deterministic sequence matching plan H.3 step 6: a tool_call, the
    // tool_result it would produce, a streamed token answer, then done.
    // The controller does NOT need to run the handler for the mock — the
    // result is emitted inline here so demos work with zero real data —
    // but the controller still records the events for history.
    yield {
      type: 'tool_call',
      data: { name: 'get_dashboard_overview', input: {}, toolUseId: 'mock-tool-1' },
    };
    yield {
      type: 'tool_result',
      data: {
        name: 'get_dashboard_overview',
        toolUseId: 'mock-tool-1',
        result: { receivables: 245000, payables: 89000, revenueMTD: 312000, expensesMTD: 178000 },
      },
    };

    const sentence =
      'Based on your data, you have ₹2,45,000 in outstanding invoices and ₹89,000 in payables. ' +
      'Revenue month-to-date is ₹3,12,000 against ₹1,78,000 expenses — a healthy ₹1,34,000 net.';
    // Split into rough word-level tokens so the frontend can render a
    // realistic streaming effect.
    for (const token of sentence.split(/(\s+)/)) {
      if (!token) continue;
      yield { type: 'token', data: { delta: token } };
    }
    yield { type: 'done', data: { stopReason: 'end_turn' } };
  }
}
