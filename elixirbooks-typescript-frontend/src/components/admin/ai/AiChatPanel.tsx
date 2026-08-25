/**
 * Slide-in financial co-pilot chat panel (Cluster H, slice H.3).
 *
 * Anchored to the right edge (420px). Streams assistant replies token by
 * token via `useAiChatStream`, renders assistant text as markdown, shows
 * tool calls inline as subtle "🔧 …" lines, and persists/loads sessions
 * through the chat-session API. Empty state offers three suggested prompts.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type KeyboardEvent,
} from 'react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import ReactMarkdown from 'react-markdown';
import {
  ChevronDown,
  History,
  Loader2,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import Constants from '@constants/api';
import type { RootState } from '@store/index';
import { useAiChatStream, type ToolEvent } from '@hooks/useAiChatStream';

interface AiChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Role = 'USER' | 'ASSISTANT' | 'TOOL';

interface DisplayMessage {
  id: string;
  role: Role;
  content: string;
  toolName?: string | null;
}

interface SessionListItem {
  id: string;
  title: string | null;
  messageCount: number;
  updatedAt: string;
}

const SUGGESTED_PROMPTS = [
  'How much GST do I owe this quarter?',
  'Who are my top 5 debtors?',
  'Show last month’s expenses',
];

/** Turns a snake_case tool name into a friendly "Looked up …" label. */
function toolLabel(name: string): string {
  const pretty = name.replace(/^get_/, '').replace(/_/g, ' ');
  if (name.startsWith('search')) return `Searching ${pretty.replace(/^search /, '')}`;
  return `Looked up ${pretty}`;
}

const AiChatPanel: FC<AiChatPanelProps> = ({ isOpen, onClose }) => {
  const token = useSelector((s: RootState) => s.auth.token);
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const { streamingText, toolEvents, isStreaming, error, send } = useAiChatStream();
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${Constants.AI_CHAT_SESSIONS_URL}?limit=30`, {
        headers: authHeaders,
      });
      setSessions(res.data?.data?.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }, [token, authHeaders]);

  // Load session list whenever the panel opens.
  useEffect(() => {
    if (isOpen) void refreshSessions();
  }, [isOpen, refreshSessions]);

  // Auto-scroll to the newest content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText, toolEvents]);

  const startNewChat = useCallback(() => {
    setSessionId(null);
    setTitle(null);
    setMessages([]);
    setHistoryOpen(false);
  }, []);

  const loadSession = useCallback(
    async (id: string) => {
      if (!token) return;
      setHistoryOpen(false);
      try {
        const res = await axios.get(`${Constants.AI_CHAT_SESSIONS_URL}/${id}`, {
          headers: authHeaders,
        });
        const s = res.data?.data?.session;
        if (!s) return;
        setSessionId(s.id);
        setTitle(s.title ?? null);
        setMessages(
          (s.messages ?? []).map((m: DisplayMessage) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolName: m.toolName,
          })),
        );
      } catch {
        /* ignore */
      }
    },
    [token, authHeaders],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      setInput('');

      const userMsgId = `local-user-${Date.now()}`;
      setMessages((prev) => [...prev, { id: userMsgId, role: 'USER', content: trimmed }]);

      await send(trimmed, {
        sessionId: sessionId ?? undefined,
        onMeta: ({ sessionId: sid }) => {
          if (!sessionId) {
            setSessionId(sid);
            if (!title) setTitle(trimmed.slice(0, 60));
          }
        },
        onDone: ({ text: finalText, toolEvents: finalTools, assistantMessageId }) => {
          setMessages((prev) => {
            const next = [...prev];
            // Persist tool-call breadcrumbs followed by the assistant text.
            for (const ev of finalTools) {
              if (ev.kind === 'call') {
                next.push({
                  id: `local-tool-${assistantMessageId}-${ev.name}-${next.length}`,
                  role: 'TOOL',
                  content: '',
                  toolName: ev.name,
                });
              }
            }
            next.push({
              id: assistantMessageId || `local-assistant-${Date.now()}`,
              role: 'ASSISTANT',
              content: finalText,
            });
            return next;
          });
          void refreshSessions();
        },
      });
    },
    [isStreaming, send, sessionId, title, refreshSessions],
  );

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend(input);
    }
  };

  const saveTitle = useCallback(async () => {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || !sessionId || next === title) return;
    setTitle(next);
    try {
      await axios.patch(
        `${Constants.AI_CHAT_SESSIONS_URL}/${sessionId}`,
        { title: next },
        { headers: authHeaders },
      );
      void refreshSessions();
    } catch {
      /* ignore */
    }
  }, [titleDraft, sessionId, title, authHeaders, refreshSessions]);

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await axios.delete(`${Constants.AI_CHAT_SESSIONS_URL}/${id}`, { headers: authHeaders });
      } catch {
        /* ignore */
      }
      if (id === sessionId) startNewChat();
      void refreshSessions();
    },
    [authHeaders, sessionId, startNewChat, refreshSessions],
  );

  const hasContent = messages.length > 0 || isStreaming;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-black/30 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className={`fixed right-0 top-0 z-[61] flex h-screen w-full max-w-[420px] flex-col bg-white shadow-2xl transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Financial co-pilot chat"
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
            <Sparkles size={16} />
          </span>

          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
                className="w-full rounded border border-gray-300 px-2 py-0.5 text-sm focus:border-violet-500 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!sessionId) return;
                  setTitleDraft(title ?? '');
                  setEditingTitle(true);
                }}
                className="group flex items-center gap-1 truncate text-sm font-semibold text-gray-800"
                title={sessionId ? 'Rename chat' : undefined}
              >
                <span className="truncate">{title ?? 'Financial co-pilot'}</span>
                {sessionId && (
                  <Pencil size={12} className="opacity-0 group-hover:opacity-60" />
                )}
              </button>
            )}
          </div>

          {/* History dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setHistoryOpen((o) => !o)}
              className="flex items-center gap-0.5 rounded p-1.5 text-gray-500 hover:bg-gray-100"
              title="Chat history"
            >
              <History size={16} />
              <ChevronDown size={12} />
            </button>
            {historyOpen && (
              <div className="absolute right-0 top-9 z-10 max-h-80 w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {sessions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">No previous chats</p>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 ${
                        s.id === sessionId ? 'bg-violet-50' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void loadSession(s.id)}
                        className="min-w-0 flex-1 truncate text-left text-gray-700"
                      >
                        {s.title || 'Untitled chat'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSession(s.id)}
                        className="opacity-0 group-hover:opacity-100"
                        title="Delete chat"
                      >
                        <Trash2 size={13} className="text-gray-400 hover:text-red-500" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={startNewChat}
            className="flex items-center gap-1 rounded p-1.5 text-gray-500 hover:bg-gray-100"
            title="New chat"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Message list */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {!hasContent && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
                <Sparkles size={22} />
              </span>
              <h3 className="text-sm font-semibold text-gray-800">Ask about your finances</h3>
              <p className="mb-4 mt-1 max-w-xs text-xs text-gray-500">
                Grounded in your real ledger data — never made-up numbers.
              </p>
              <div className="flex w-full flex-col gap-2">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void handleSend(p)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-700 transition hover:border-violet-300 hover:bg-violet-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {/* In-flight streaming turn */}
          {isStreaming && (
            <div className="space-y-1.5">
              {toolEvents
                .filter((t) => t.kind === 'call')
                .map((t, i) => (
                  <ToolLine key={`live-${i}`} event={t} />
                ))}
              {streamingText ? (
                <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-gray-100 px-3 py-2 text-sm text-gray-800">
                  <div className="prose prose-sm max-w-none prose-p:my-1">
                    <ReactMarkdown>{streamingText}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Loader2 size={13} className="animate-spin" />
                  Thinking…
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-gray-200 p-3">
          <div className="flex items-end gap-2 rounded-xl border border-gray-200 px-3 py-2 focus-within:border-violet-400">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKeyDown}
              rows={1}
              placeholder="Ask about invoices, GST, debtors…"
              className="max-h-32 flex-1 resize-none bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSend(input)}
              disabled={isStreaming || !input.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white disabled:opacity-40"
              title="Send (Enter)"
            >
              {isStreaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-400">
            Enter to send · Shift+Enter for a new line · ≈ $0.005 / reply
          </p>
        </div>
      </aside>
    </>
  );
};

const MessageBubble: FC<{ message: DisplayMessage }> = ({ message }) => {
  if (message.role === 'TOOL') {
    return <ToolLine event={{ kind: 'call', name: message.toolName ?? '' }} />;
  }
  if (message.role === 'USER') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-violet-600 px-3 py-2 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }
  // ASSISTANT
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-gray-100 px-3 py-2 text-sm text-gray-800">
        <div className="prose prose-sm max-w-none prose-p:my-1 prose-table:my-1">
          <ReactMarkdown>{message.content || '…'}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

const ToolLine: FC<{ event: ToolEvent }> = ({ event }) => (
  <div className="flex items-center gap-1.5 pl-1 text-xs italic text-gray-400">
    <span aria-hidden>🔧</span>
    <span>{toolLabel(event.name)}</span>
  </div>
);

export default AiChatPanel;
