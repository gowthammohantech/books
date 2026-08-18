/**
 * Shared types for the BYOK AI provider abstraction (Cluster H).
 *
 * Every implementation (Claude, OpenAI, Mock) satisfies `AiProvider`. The
 * registry resolves the right one for the current user. Slice H.1 only
 * uses `ping()`; `extractDocument()` lands in H.2 and `chatStream()` in
 * H.3.
 */

export interface ExtractResult {
  fields: Record<string, unknown>;
  rawResponse: string;
  confidence?: number;
  costUsd?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  handler: (args: Record<string, unknown>, ctx: { userId: string }) => Promise<unknown>;
}

export interface ChatStreamEvent {
  type: 'meta' | 'token' | 'tool_call' | 'tool_result' | 'done' | 'error';
  data: Record<string, unknown>;
}

export interface AiProvider {
  ping(): Promise<{ ok: boolean; error?: string }>;
  extractDocument(file: Buffer, mimeType: string): Promise<ExtractResult>;
  chatStream(
    messages: ChatMessage[],
    tools: ToolDef[],
    ctx: { userId: string },
  ): AsyncIterable<ChatStreamEvent>;
}

/**
 * Thrown when an AI feature is invoked while the user has not enabled it
 * or has not configured a key. The middleware and registry both throw
 * this; the request layer maps it to HTTP 412.
 */
export class AiDisabledError extends Error {
  status = 412;
  constructor(message = 'AI features are disabled. Configure in Settings → AI.') {
    super(message);
    this.name = 'AiDisabledError';
  }
}
