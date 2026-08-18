/**
 * Streaming hook for the financial co-pilot chat (Cluster H, slice H.3).
 *
 * EventSource is GET-only and cannot carry a POST body, so we use `fetch`
 * with `response.body.getReader()` and parse the SSE frames by hand. The
 * hook exposes the in-flight assistant text + tool events for the current
 * turn; the panel is responsible for committing finished turns into its
 * message list (via the `onDone` callback).
 */
import { useCallback, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import Constants from '@constants/api';
import type { RootState } from '@store/index';

export interface ToolEvent {
  kind: 'call' | 'result';
  name: string;
  input?: Record<string, unknown>;
  result?: unknown;
}

export interface ChatDoneInfo {
  sessionId: string;
  assistantMessageId: string;
  text: string;
  toolEvents: ToolEvent[];
  totalCostUsd: number;
}

interface SendOptions {
  sessionId?: string;
  onMeta?: (info: { sessionId: string; messageId: string }) => void;
  onDone?: (info: ChatDoneInfo) => void;
}

interface UseAiChatStream {
  /** Text streamed so far for the current/last assistant turn. */
  streamingText: string;
  /** Tool call/result events surfaced during the current/last turn. */
  toolEvents: ToolEvent[];
  isStreaming: boolean;
  error: string | null;
  send: (message: string, opts?: SendOptions) => Promise<void>;
  reset: () => void;
}

interface SseFrame {
  event: string;
  data: string;
}

/** Splits a raw SSE buffer into complete frames; returns leftover tail. */
function parseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join('\n') });
  }
  return { frames, rest };
}

export function useAiChatStream(): UseAiChatStream {
  const token = useSelector((s: RootState) => s.auth.token);
  const [streamingText, setStreamingText] = useState('');
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setStreamingText('');
    setToolEvents([]);
    setError(null);
  }, []);

  const send = useCallback(
    async (message: string, opts: SendOptions = {}) => {
      if (!token) {
        setError('Not authenticated');
        return;
      }
      // Local accumulators (state updates are async / batched).
      let text = '';
      const tools: ToolEvent[] = [];
      let resolvedSessionId = opts.sessionId ?? '';
      let assistantMessageId = '';
      let totalCostUsd = 0;

      reset();
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(Constants.AI_CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message, sessionId: opts.sessionId }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let msg = `Request failed (${res.status})`;
          try {
            const j = await res.json();
            msg = j.message || j.error || msg;
          } catch {
            /* non-JSON body */
          }
          throw new Error(msg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const handleFrame = (frame: SseFrame) => {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(frame.data) as Record<string, unknown>;
          } catch {
            return;
          }
          switch (frame.event) {
            case 'meta': {
              resolvedSessionId = String(payload.sessionId ?? resolvedSessionId);
              opts.onMeta?.({
                sessionId: resolvedSessionId,
                messageId: String(payload.messageId ?? ''),
              });
              break;
            }
            case 'token': {
              text += String(payload.delta ?? '');
              setStreamingText(text);
              break;
            }
            case 'tool_call': {
              tools.push({
                kind: 'call',
                name: String(payload.name ?? ''),
                input: (payload.input as Record<string, unknown>) ?? {},
              });
              setToolEvents([...tools]);
              break;
            }
            case 'tool_result': {
              tools.push({
                kind: 'result',
                name: String(payload.name ?? ''),
                result: payload.result,
              });
              setToolEvents([...tools]);
              break;
            }
            case 'done': {
              assistantMessageId = String(payload.messageId ?? '');
              totalCostUsd = Number(payload.totalCostUsd ?? 0);
              break;
            }
            case 'error': {
              throw new Error(String(payload.message ?? 'Chat failed'));
            }
            default:
              break;
          }
        };

        // Read loop.
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseFrames(buffer);
          buffer = rest;
          for (const frame of frames) handleFrame(frame);
        }
        // Flush any trailing frame.
        if (buffer.trim()) {
          const { frames } = parseFrames(`${buffer}\n\n`);
          for (const frame of frames) handleFrame(frame);
        }

        opts.onDone?.({
          sessionId: resolvedSessionId,
          assistantMessageId,
          text,
          toolEvents: tools,
          totalCostUsd,
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          // Cancelled by the user — not an error worth surfacing.
        } else {
          setError(err instanceof Error ? err.message : 'Chat failed');
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [token, reset],
  );

  return { streamingText, toolEvents, isStreaming, error, send, reset };
}
