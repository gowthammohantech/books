import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { getProviderForUser } from '../lib/aiProviders/registry';
import { financialTools, financialToolRegistry } from '../lib/aiTools/financialTools';
import { logAiUsage } from '../lib/aiUsage';
import type { ChatMessage, ChatStreamEvent } from '../lib/aiProviders/types';

/**
 * Financial co-pilot chat controller (Cluster H, slice H.3).
 *
 * `streamChat` is an SSE endpoint that drives the provider's tool-use loop:
 * it streams tokens to the client, dispatches grounded tool calls against
 * `lib/financialQueries`, and persists the conversation. The remaining
 * handlers are plain JSON session CRUD.
 */

const MAX_TOOL_HOPS = 4;

function toDecimal(n: number): Prisma.Decimal {
  return n as unknown as Prisma.Decimal;
}

function autoTitle(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, ' ');
  return trimmed.length > 60 ? `${trimmed.slice(0, 60).trimEnd()}…` : trimmed || 'New chat';
}

// -----------------------------------------------------------------------------
// SSE streaming endpoint
// -----------------------------------------------------------------------------

export async function streamChat(req: Request, res: Response): Promise<void> {
  let userId: string;
  try {
    userId = requireUserId(req);
  } catch {
    res.status(401).json({ success: false, message: 'Not authorized' });
    return;
  }

  const body = (req.body ?? {}) as { sessionId?: string; message?: string };
  const message = (body.message ?? '').trim();
  if (!message) {
    res.status(400).json({ success: false, message: 'A non-empty "message" is required' });
    return;
  }

  // Resolve or create the session BEFORE opening the stream so any
  // ownership / not-found error returns a clean HTTP status.
  let session;
  try {
    if (body.sessionId) {
      session = await prisma.aiChatSession.findFirst({
        where: { id: body.sessionId, userId, isDeleted: false },
      });
      if (!session) {
        res.status(404).json({ success: false, message: 'Chat session not found' });
        return;
      }
    } else {
      session = await prisma.aiChatSession.create({
        data: { userId, title: autoTitle(message) },
      });
    }
  } catch (err) {
    console.error('aiChat.streamChat session error:', err);
    res.status(500).json({ success: false, message: 'Failed to open chat session' });
    return;
  }

  // Persist the USER message up front.
  const userMessageRow = await prisma.aiChatMessage.create({
    data: { sessionId: session.id, role: 'USER', content: message },
  });

  // Open the SSE stream.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx)
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const sse = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sse('meta', { sessionId: session.id, messageId: userMessageRow.id });

  try {
    const provider = req.aiProvider ?? (await getProviderForUser(userId, { requireEnabled: true }));

    // Seed the conversation with prior history (chronological) + the new
    // user message. Prior tool calls/results are replayed so the model has
    // full context across turns.
    const history = await prisma.aiChatMessage.findMany({
      where: { sessionId: session.id, id: { not: userMessageRow.id } },
      orderBy: { createdAt: 'asc' },
    });
    const conversation: ChatMessage[] = [];
    // Tracks the id of the most-recent assistant tool_use row so the TOOL
    // row that follows can be paired to it (Anthropic + OpenAI both require
    // the tool_result to reference the originating tool call id).
    let lastToolUseId: string | undefined;
    for (const row of history) {
      if (row.role === 'USER') {
        conversation.push({ role: 'user', content: row.content });
      } else if (row.role === 'ASSISTANT') {
        if (row.toolName) {
          lastToolUseId = row.id;
          conversation.push({
            role: 'assistant',
            content: JSON.stringify(row.toolInput ?? {}),
            toolName: row.toolName,
            toolCallId: row.id,
          });
        } else {
          conversation.push({ role: 'assistant', content: row.content });
        }
      } else if (row.role === 'TOOL') {
        conversation.push({
          role: 'tool',
          content: JSON.stringify(row.toolResult ?? {}),
          toolName: row.toolName ?? undefined,
          toolCallId: lastToolUseId,
        });
      }
    }
    conversation.push({ role: 'user', content: message });

    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalAssistantText = '';

    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      let turnText = '';
      const turnToolCalls: Array<{ name: string; input: Record<string, unknown>; toolUseId: string }> = [];
      // Inline tool results emitted by a self-contained provider turn (e.g.
      // the MockProvider, which resolves its own canned tool data).
      const inlineToolResults: Array<{ name: string; result: unknown }> = [];
      let stopReason = 'end_turn';

      const iter = provider.chatStream(conversation, financialTools, { userId });
      for await (const evt of iter as AsyncIterable<ChatStreamEvent>) {
        if (evt.type === 'token') {
          const delta = String(evt.data.delta ?? '');
          turnText += delta;
          sse('token', { delta });
        } else if (evt.type === 'tool_call') {
          turnToolCalls.push({
            name: String(evt.data.name ?? ''),
            input: (evt.data.input as Record<string, unknown>) ?? {},
            toolUseId: String(evt.data.toolUseId ?? `tool-${hop}-${turnToolCalls.length}`),
          });
        } else if (evt.type === 'tool_result') {
          // A provider that resolves its own tool data inline (mock). Record
          // it for history + forward to the UI; we will NOT re-run it.
          inlineToolResults.push({
            name: String(evt.data.name ?? ''),
            result: evt.data.result,
          });
          sse('tool_result', evt.data);
        } else if (evt.type === 'done') {
          stopReason = String(evt.data.stopReason ?? 'end_turn');
          const usage = evt.data.usage as { inputTokens?: number; outputTokens?: number } | undefined;
          if (usage) {
            // Rough advisory cost (Claude Sonnet-ish pricing): $3/Mtok in,
            // $15/Mtok out. Best-effort only; H.4 owns precise accounting.
            totalInputTokens += usage.inputTokens ?? 0;
            totalOutputTokens += usage.outputTokens ?? 0;
            totalCostUsd +=
              ((usage.inputTokens ?? 0) / 1_000_000) * 3 +
              ((usage.outputTokens ?? 0) / 1_000_000) * 15;
          }
        } else if (evt.type === 'error') {
          throw new Error(String(evt.data.message ?? 'Provider stream error'));
        }
      }

      // The turn is final unless the provider explicitly stopped to call a
      // tool (`stopReason === 'tool_use'`). A self-contained turn (mock, or
      // any model that answered without needing another hop) ends here even
      // if it surfaced inline tool calls/results.
      if (stopReason !== 'tool_use' || turnToolCalls.length === 0) {
        finalAssistantText = turnText;
        // Persist any inline tool interaction for accurate history.
        for (let i = 0; i < turnToolCalls.length; i++) {
          const call = turnToolCalls[i];
          const inline = inlineToolResults[i] ?? inlineToolResults.find((r) => r.name === call.name);
          await prisma.aiChatMessage.create({
            data: {
              sessionId: session.id,
              role: 'ASSISTANT',
              content: '',
              toolName: call.name,
              toolInput: call.input as Prisma.InputJsonValue,
            },
          });
          await prisma.aiChatMessage.create({
            data: {
              sessionId: session.id,
              role: 'TOOL',
              content: '',
              toolName: call.name,
              toolResult: ((inline?.result ?? {}) as Prisma.InputJsonValue),
            },
          });
        }
        break;
      }

      // Run each tool call, emit events, persist TOOL messages, and extend
      // the conversation with the tool_use + tool_result pair so the next
      // hop has the grounded data.
      for (const call of turnToolCalls) {
        sse('tool_call', { name: call.name, input: call.input });

        const tool = financialToolRegistry[call.name];
        let result: unknown;
        if (!tool) {
          result = { error: `Unknown tool: ${call.name}` };
        } else {
          try {
            result = await tool.handler(call.input, { userId });
          } catch (toolErr) {
            console.error(`aiChat tool "${call.name}" error:`, toolErr);
            result = { error: toolErr instanceof Error ? toolErr.message : 'Tool failed' };
          }
        }

        sse('tool_result', { name: call.name, result });

        // Persist the assistant tool_use and the tool result as two rows.
        const assistantToolRow = await prisma.aiChatMessage.create({
          data: {
            sessionId: session.id,
            role: 'ASSISTANT',
            content: '',
            toolName: call.name,
            toolInput: call.input as Prisma.InputJsonValue,
          },
        });
        await prisma.aiChatMessage.create({
          data: {
            sessionId: session.id,
            role: 'TOOL',
            content: '',
            toolName: call.name,
            toolResult: (result ?? {}) as Prisma.InputJsonValue,
          },
        });

        conversation.push({
          role: 'assistant',
          content: JSON.stringify(call.input),
          toolName: call.name,
          toolCallId: assistantToolRow.id,
        });
        conversation.push({
          role: 'tool',
          content: JSON.stringify(result ?? {}),
          toolName: call.name,
          toolCallId: assistantToolRow.id,
        });
      }

      // If the model also produced text alongside tool calls, keep it as a
      // fallback final answer in case the next hop yields nothing.
      if (turnText) finalAssistantText = turnText;

      // Safety: if we've hit the last allowed hop and the model still wants
      // tools, stop and let the last text stand.
      if (hop === MAX_TOOL_HOPS - 1 && stopReason === 'tool_use') {
        break;
      }
    }

    // Persist the final ASSISTANT message.
    const assistantRow = await prisma.aiChatMessage.create({
      data: {
        sessionId: session.id,
        role: 'ASSISTANT',
        content: finalAssistantText,
        costUsd: totalCostUsd > 0 ? toDecimal(totalCostUsd) : null,
      },
    });

    // Auto-title from the first user message if still untitled, and bump
    // updatedAt so the session sorts to the top of the history list.
    await prisma.aiChatSession.update({
      where: { id: session.id },
      data: {
        ...(session.title ? {} : { title: autoTitle(message) }),
        updatedAt: new Date(),
      },
    });

    // Best-effort per-turn usage log (Cluster H, slice H.4) at the `done`
    // hook point H.3 flagged. Never fails the request.
    await logAiUsage({
      userId,
      feature: 'chat',
      provider: req.aiConfig?.provider ?? 'MOCK',
      model: req.aiConfig?.chatModel ?? null,
      inputTokens: totalInputTokens || null,
      outputTokens: totalOutputTokens || null,
      costUsd: totalCostUsd,
    });

    sse('done', { messageId: assistantRow.id, totalCostUsd });
    res.end();
  } catch (err) {
    console.error('aiChat.streamChat error:', err);
    // The stream is already open, so surface the failure as an SSE error
    // event rather than an HTTP status (headers are already sent).
    sse('error', { message: err instanceof Error ? err.message : 'Chat failed' });
    res.end();
  }
}

// -----------------------------------------------------------------------------
// Session CRUD
// -----------------------------------------------------------------------------

export async function listSessions(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));

    const sessions = await prisma.aiChatSession.findMany({
      where: { userId, isDeleted: false },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    res.json({
      success: true,
      data: {
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          messageCount: s._count.messages,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiChat.listSessions error:', err);
    res.status(500).json({ success: false, message: 'Failed to list chat sessions' });
  }
}

export async function getSession(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const session = await prisma.aiChatSession.findFirst({
      where: { id, userId, isDeleted: false },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) {
      res.status(404).json({ success: false, message: 'Chat session not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        session: {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messages: session.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolName: m.toolName,
            toolInput: m.toolInput,
            toolResult: m.toolResult,
            createdAt: m.createdAt,
          })),
        },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiChat.getSession error:', err);
    res.status(500).json({ success: false, message: 'Failed to load chat session' });
  }
}

export async function renameSession(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const title = ((req.body ?? {}) as { title?: string }).title?.trim();
    if (!title) {
      res.status(400).json({ success: false, message: 'A non-empty "title" is required' });
      return;
    }

    const existing = await prisma.aiChatSession.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Chat session not found' });
      return;
    }

    const updated = await prisma.aiChatSession.update({
      where: { id },
      data: { title: title.slice(0, 200) },
      select: { id: true, title: true, updatedAt: true },
    });

    res.json({ success: true, message: 'Session renamed', data: { session: updated } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiChat.renameSession error:', err);
    res.status(500).json({ success: false, message: 'Failed to rename chat session' });
  }
}

export async function deleteSession(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.aiChatSession.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Chat session not found' });
      return;
    }

    await prisma.aiChatSession.update({ where: { id }, data: { isDeleted: true } });
    res.json({ success: true, message: 'Chat session deleted', data: { id } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('aiChat.deleteSession error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete chat session' });
  }
}

const handlers = { streamChat, listSessions, getSession, renameSession, deleteSession };
module.exports = handlers;
module.exports.default = handlers;
