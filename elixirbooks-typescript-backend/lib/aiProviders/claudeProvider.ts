import Anthropic from '@anthropic-ai/sdk';

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

export const CLAUDE_DEFAULT_EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';
export const CLAUDE_DEFAULT_CHAT_MODEL = 'claude-sonnet-4-6';

export interface ClaudeProviderOptions {
  apiKey: string;
  extractionModel?: string;
  chatModel?: string;
}

/**
 * Anthropic Claude provider. H.1 only implements `ping()` — it calls the
 * cheapest possible endpoint (1-token Haiku message) to confirm the key
 * is valid. `extractDocument` and `chatStream` land in H.2/H.3.
 */
export class ClaudeProvider implements AiProvider {
  private client: Anthropic;
  private extractionModel: string;
  private chatModel: string;

  constructor(opts: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.extractionModel = opts.extractionModel || CLAUDE_DEFAULT_EXTRACTION_MODEL;
    this.chatModel = opts.chatModel || CLAUDE_DEFAULT_CHAT_MODEL;
  }

  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.messages.create({
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
            : 'Unknown Claude API error';
      return { ok: false, error: message };
    }
  }

  async extractDocument(file: Buffer, mimeType: string): Promise<ExtractResult> {
    const base64 = file.toString('base64');
    // PDFs go in as native `document` blocks (Claude reads them natively);
    // images use the standard `image` block. WEBP isn't part of the
    // Claude vision input mime allowlist, so fall back to JPEG-as-WEBP via
    // the same content type — most images upload as PNG/JPEG in practice.
    const isPdf = mimeType === 'application/pdf';
    const imageMime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' =
      mimeType === 'image/png'
        ? 'image/png'
        : mimeType === 'image/webp'
          ? 'image/webp'
          : mimeType === 'image/gif'
            ? 'image/gif'
            : 'image/jpeg';

    const contentBlock = isPdf
      ? ({
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: base64,
          },
        })
      : ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: imageMime,
            data: base64,
          },
        });

    const response = await this.client.messages.create({
      model: this.extractionModel,
      max_tokens: 2048,
      system: BILL_EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            // Anthropic SDK types are mildly strict on the union; a single
            // narrowing cast keeps the call site readable.
            contentBlock as unknown as Anthropic.ContentBlockParam,
            {
              type: 'text',
              text: 'Extract the bill data and return JSON only.',
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const fields = parseBillExtractionResponse(rawText);

    // Claude Haiku 4.5 pricing (Oct 2025): $1 / Mtok in, $5 / Mtok out.
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costUsd = (inputTokens / 1_000_000) * 1 + (outputTokens / 1_000_000) * 5;

    return {
      fields: fields as unknown as Record<string, unknown>,
      rawResponse: rawText,
      confidence: fields._confidence,
      costUsd,
    };
  }

  /**
   * Streams a single assistant turn. The controller drives the tool-use
   * loop: it passes the full conversation (including prior tool results
   * encoded as `tool` messages), and on a `tool_use` stop it runs the
   * handlers, appends results, and calls this again.
   *
   * Yields `token` events for text deltas, a `tool_call` event per
   * finalised tool_use block, and a terminal `done` event carrying the
   * stop reason + usage. The controller is responsible for `meta`.
   */
  async *chatStream(
    messages: ChatMessage[],
    tools: ToolDef[],
    _ctx: { userId: string },
  ): AsyncIterable<ChatStreamEvent> {
    const anthropicMessages = toAnthropicMessages(messages);
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const stream = this.client.messages.stream({
      model: this.chatModel,
      max_tokens: 1536,
      system: buildChatSystemPrompt(),
      messages: anthropicMessages,
      ...(anthropicTools.length ? { tools: anthropicTools } : {}),
    });

    // Track in-flight tool_use blocks by content-block index so we can
    // accumulate their streamed JSON input before emitting tool_call.
    const toolBlocks = new Map<number, { id: string; name: string; partialJson: string }>();

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          toolBlocks.set(event.index, { id: block.id, name: block.name, partialJson: '' });
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'token', data: { delta: delta.text } };
        } else if (delta.type === 'input_json_delta') {
          const tb = toolBlocks.get(event.index);
          if (tb) tb.partialJson += delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        const tb = toolBlocks.get(event.index);
        if (tb) {
          let input: Record<string, unknown> = {};
          try {
            input = tb.partialJson ? (JSON.parse(tb.partialJson) as Record<string, unknown>) : {};
          } catch {
            input = {};
          }
          yield {
            type: 'tool_call',
            data: { name: tb.name, input, toolUseId: tb.id },
          };
          toolBlocks.delete(event.index);
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: 'done',
      data: {
        stopReason: finalMessage.stop_reason ?? 'end_turn',
        usage: {
          inputTokens: finalMessage.usage?.input_tokens ?? 0,
          outputTokens: finalMessage.usage?.output_tokens ?? 0,
        },
      },
    };
  }

  /**
   * Alias kept for plan-compatibility — continuation is just another
   * `chatStream` call with the tool results appended to `messages`.
   */
  chatStreamContinue(
    messages: ChatMessage[],
    tools: ToolDef[],
    ctx: { userId: string },
  ): AsyncIterable<ChatStreamEvent> {
    return this.chatStream(messages, tools, ctx);
  }
}

/**
 * Maps the provider-agnostic `ChatMessage[]` into Anthropic `MessageParam[]`.
 *
 * Encoding contract (set by the chat controller):
 *  - role 'user'      → a user text block
 *  - role 'assistant' WITH toolName/toolCallId → an assistant tool_use block
 *                       (content holds the JSON-stringified tool input)
 *  - role 'assistant' WITHOUT a tool         → an assistant text block
 *  - role 'tool'      → a user tool_result block (content holds the
 *                       JSON-stringified result, toolCallId pairs it to the
 *                       tool_use above)
 *
 * Anthropic requires tool_use (assistant) and tool_result (user) to be
 * adjacent; the controller emits them in that order so the linear map below
 * is correct.
 */
function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (m.toolName && m.toolCallId) {
        let input: unknown = {};
        try {
          input = m.content ? JSON.parse(m.content) : {};
        } catch {
          input = {};
        }
        out.push({
          role: 'assistant',
          content: [
            { type: 'tool_use', id: m.toolCallId, name: m.toolName, input: input as object },
          ],
        });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          },
        ],
      });
    }
  }
  return out;
}
