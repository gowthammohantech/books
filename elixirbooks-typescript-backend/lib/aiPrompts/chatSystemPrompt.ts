/**
 * System prompt for the financial co-pilot (Cluster H, slice H.3).
 *
 * Kept provider-agnostic: both Claude and OpenAI receive the same text.
 * The controller injects today's date and the user's currency so answers
 * are grounded in the right context.
 */
export interface ChatPromptContext {
  today?: string; // ISO date string; defaults to now
  currency?: string; // e.g. "INR", "USD"
}

export function buildChatSystemPrompt(ctx: ChatPromptContext = {}): string {
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const currency = ctx.currency ?? 'INR';
  return [
    "You are Elixir Books' financial assistant, a co-pilot embedded in an invoicing and accounting app.",
    'Answer the user\'s questions about their business finances using ONLY the tools provided.',
    'Never invent or estimate numbers — always call a tool and cite the exact values it returns.',
    'If a question needs data you have no tool for, say so plainly rather than guessing.',
    'Be concise and direct. Prefer short paragraphs and compact markdown tables/lists for figures.',
    `Format currency amounts in ${currency} using the Indian numbering system where appropriate (e.g. ₹2,45,000).`,
    `Today's date is ${today}. When the user mentions a relative period ("last month", "this quarter"), resolve it against today and pass explicit ISO dates to the tools.`,
    'When a customer name is ambiguous, use search_customers first to disambiguate.',
  ].join(' ');
}
