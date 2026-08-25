import OpenAI from 'openai';

import {
  BILL_EXTRACTION_SYSTEM_PROMPT,
  parseBillExtractionResponse,
} from '../aiPrompts/billExtraction';
import { buildChatSystemPrompt } from '../aiPrompts/chatSystemPrompt';

import type {
  AiProvider,
  ChatMessage,
  ChatStreamEvent,
  ExtractResult,
  ToolDef,
} from './types';

export const OPENAI_DEFAULT_EXTRACTION_MODEL = 'gpt-4o-mini';
export const OPENAI_DEFAULT_CHAT_MODEL = 'gpt-4o';

export interface OpenAIProviderOptions {
  apiKey: string;
  extractionModel?: string;
  chatModel?: string;
}

/**
 * OpenAI provider. H.1 only implements `ping()` (a 1-token completion
 * against gpt-4o-mini). `extractDocument` and `chatStream` land in
 * H.2/H.3.
 */
export class OpenAIProvider implements AiProvider {
  private client: OpenAI;
  private extractionModel: string;
  private chatModel: string;

  constructor(opts: OpenAIProviderOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.extractionModel = opts.extractionModel || OPENAI_DEFAULT_EXTRACTION_MODEL;
    this.chatModel = opts.chatModel || OPENAI_DEFAULT_CHAT_MODEL;
  }

  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.chat.completions.create({
        model: this.extractionModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Unknown OpenAI API error';
      return { ok: false, error: message };
    }
  }

  async extractDocument(file: Buffer, mimeType: string): Promise<ExtractResult> {
    // OpenAI vision models don't accept PDFs directly — convert page 1 to
    // PNG first. For native image types we pass through with the original
    // mime (jpeg/png/webp all work).
    let imageBuffer: Buffer = file;
    let imageMime = mimeType;
    if (mimeType === 'application/pdf') {
      // Lazy import — `pdf-to-png-converter` pulls in pdfjs at module load
      // and we only want that cost on the PDF path.
      const { pdfToPng } = await import('pdf-to-png-converter');
      const pages = await pdfToPng(file, { pagesToProcess: [1] });
      const firstPage = pages?.[0];
      if (!firstPage || !firstPage.content) {
        throw new Error('Could not convert PDF page 1 to image');
      }
      imageBuffer = firstPage.content;
      imageMime = 'image/png';
    }

    const dataUri = `data:${imageMime};base64,${imageBuffer.toString('base64')}`;

    const response = await this.client.chat.completions.create({
      model: this.extractionModel,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: BILL_EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract the bill data and return JSON only.',
            },
            {
              type: 'image_url',
              image_url: { url: dataUri },
            },
          ],
        },
      ],
    });

    const rawText = response.choices?.[0]?.message?.content ?? '';
    const fields = parseBillExtractionResponse(rawText);

    // GPT-4o-mini pricing (May 2024 → 2026): $0.15 / Mtok in, $0.60 / Mtok out.
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const costUsd = (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.6;

    return {
      fields: fields as unknown as Record<string, unknown>,
      rawResponse: rawText,
      confidence: fields._confidence,
      costUsd,
    };
  }

  /**
   * Streams a single assistant turn. OpenAI delivers tool calls as deltas
   * that arrive across many chunks, so we accumulate them by index and emit
   * one `tool_call` event per finalised call once the stream finishes.
   * Yields `token` events for content deltas and a terminal `done`.
   */
  async *chatStream(
    messages: ChatMessage[],
    tools: ToolDef[],
    _ctx: { userId: string },
  ): AsyncIterable<ChatStreamEvent> {
    const openaiMessages = toOpenAiMessages(messages);
    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.chatModel,
      max_tokens: 1536,
      stream: true,
      stream_options: { include_usage: true },
      messages: openaiMessages,
      ...(openaiTools.length ? { tools: openaiTools } : {}),
    });

    // Accumulate tool-call deltas by their position index.
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let stopReason = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (choice) {
        const delta = choice.delta;
        if (delta?.content) {
          yield { type: 'token', data: { delta: delta.content } };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            toolAcc.set(idx, existing);
          }
        }
        if (choice.finish_reason) stopReason = choice.finish_reason;
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    // Emit accumulated tool calls in index order.
    for (const [, tc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      if (!tc.name) continue;
      let input: Record<string, unknown> = {};
      try {
        input = tc.args ? (JSON.parse(tc.args) as Record<string, unknown>) : {};
      } catch {
        input = {};
      }
      yield { type: 'tool_call', data: { name: tc.name, input, toolUseId: tc.id } };
    }

    yield {
      type: 'done',
      data: { stopReason, usage: { inputTokens, outputTokens } },
    };
  }

  /** Alias kept for plan-compatibility — see ClaudeProvider.chatStreamContinue. */
  chatStreamContinue(
    messages: ChatMessage[],
    tools: ToolDef[],
    ctx: { userId: string },
  ): AsyncIterable<ChatStreamEvent> {
    return this.chatStream(messages, tools, ctx);
  }
}

/**
 * Maps the provider-agnostic `ChatMessage[]` into OpenAI chat messages.
 *
 * Encoding contract (set by the chat controller), mirrors the Claude map:
 *  - role 'user'      → { role: 'user', content }
 *  - role 'assistant' WITH toolName/toolCallId → an assistant message with a
 *                       single `tool_calls` entry (content holds the
 *                       JSON-stringified arguments)
 *  - role 'assistant' WITHOUT a tool         → { role: 'assistant', content }
 *  - role 'tool'      → { role: 'tool', tool_call_id, content }
 */
function toOpenAiMessages(
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildChatSystemPrompt() },
  ];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (m.toolName && m.toolCallId) {
        out.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: m.toolCallId,
              type: 'function',
              function: { name: m.toolName, arguments: m.content || '{}' },
            },
          ],
        });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content });
    }
  }
  return out;
}
