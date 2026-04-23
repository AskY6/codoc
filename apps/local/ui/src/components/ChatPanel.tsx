import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat } from "../api.ts";
import type { CodocListItem } from "../api.ts";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "./ai-elements/prompt-input";
import {
  MentionPopover,
  useMentionItems,
  parseMentionedCodocs,
  renderMentions,
} from "./MentionPopover.tsx";
import type { MentionItem } from "./MentionPopover.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolCall {
  name: string;
  status: "running" | "done";
  input?: Record<string, unknown>;
}

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "error"; text: string };

// ---------------------------------------------------------------------------
// ChatPanel — persistent right sidebar
// ---------------------------------------------------------------------------

export interface ChatPanelProps {
  codocs: CodocListItem[];
  activeCodoc: string | null;
  onClose: () => void;
}

export function ChatPanel({ codocs, activeCodoc, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // --- Mention state -------------------------------------------------------
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionTriggerPos, setMentionTriggerPos] = useState<number | null>(
    null,
  );

  const mentionItems = useMentionItems(codocs, mentionQuery);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionItems]);

  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionIndex(0);
    setMentionTriggerPos(null);
  }, []);

  const insertMention = useCallback(
    (item: MentionItem) => {
      const ta = textareaRef.current;
      if (!ta || mentionTriggerPos == null) return;

      const before = ta.value.slice(0, mentionTriggerPos);
      const after = ta.value.slice(ta.selectionStart);
      const mentionText = `@${item.path} `;
      const newValue = before + mentionText + after;
      const cursorPos = before.length + mentionText.length;

      // Use native setter to trigger React's onChange
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(ta, newValue);
      ta.dispatchEvent(new Event("input", { bubbles: true }));

      requestAnimationFrame(() => {
        ta.selectionStart = cursorPos;
        ta.selectionEnd = cursorPos;
        ta.focus();
      });

      closeMention();
    },
    [mentionTriggerPos, closeMention],
  );

  // --- Scroll to bottom ----------------------------------------------------
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // --- Send ----------------------------------------------------------------
  const send = useCallback(
    async (text?: string) => {
      const prompt = (text ?? input).trim();
      if (!prompt || loading) return;

      // Parse @mentions from the message text
      const mentions = parseMentionedCodocs(prompt, codocs);

      setInput("");
      setMessages((prev) => [...prev, { role: "user", text: prompt }]);
      setLoading(true);

      const abort = new AbortController();
      abortRef.current = abort;

      let assistantText = "";
      let toolCalls: ToolCall[] = [];

      try {
        for await (const evt of streamChat(
          prompt,
          sessionId,
          mentions.length > 0 ? mentions : undefined,
          abort.signal,
        )) {
          switch (evt.kind) {
            case "init":
              setSessionId(evt.sessionId);
              break;

            case "text": {
              assistantText += evt.text;
              toolCalls = toolCalls.map((tc) =>
                tc.status === "running"
                  ? { ...tc, status: "done" as const }
                  : tc,
              );
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [
                    ...prev.slice(0, -1),
                    { role: "assistant", text: assistantText, toolCalls },
                  ];
                }
                return [
                  ...prev,
                  { role: "assistant", text: assistantText, toolCalls },
                ];
              });
              break;
            }

            case "tool_use": {
              toolCalls = [
                ...toolCalls,
                { name: evt.name, status: "running", input: evt.input },
              ];
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [
                    ...prev.slice(0, -1),
                    { role: "assistant", text: assistantText, toolCalls },
                  ];
                }
                return [
                  ...prev,
                  { role: "assistant", text: assistantText, toolCalls },
                ];
              });
              break;
            }

            case "tool_result": {
              toolCalls = toolCalls.map((tc) =>
                tc.name === evt.name && tc.status === "running"
                  ? { ...tc, status: "done" as const }
                  : tc,
              );
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return [
                    ...prev.slice(0, -1),
                    { role: "assistant", text: assistantText, toolCalls },
                  ];
                }
                return prev;
              });
              break;
            }

            case "done":
              if (evt.result && !assistantText) {
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", text: evt.result!, toolCalls },
                ]);
              }
              break;

            case "error":
              setMessages((prev) => [
                ...prev,
                { role: "error", text: evt.message },
              ]);
              break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            {
              role: "error",
              text: err instanceof Error ? err.message : String(err),
            },
          ]);
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [input, loading, sessionId, codocs],
  );

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleNewSession = () => {
    setMessages([]);
    setSessionId(undefined);
  };

  // --- Mention keyboard navigation -----------------------------------------
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % Math.max(mentionItems.length, 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex((i) =>
            i <= 0 ? Math.max(mentionItems.length - 1, 0) : i - 1,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          if (mentionItems.length > 0) {
            e.preventDefault();
            insertMention(mentionItems[mentionIndex]!);
            return;
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeMention();
          return;
        }
      }
    },
    [mentionOpen, mentionItems, mentionIndex, insertMention, closeMention],
  );

  // --- Mention trigger detection -------------------------------------------
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const pos = ta.selectionStart;
      const text = ta.value;
      setInput(text);

      // Find the last `@` before cursor preceded by whitespace or at start
      let triggerIdx = -1;
      for (let i = pos - 1; i >= 0; i--) {
        if (text[i] === "@") {
          if (i === 0 || /\s/.test(text[i - 1]!)) {
            triggerIdx = i;
          }
          break;
        }
        if (/\s/.test(text[i]!)) break;
      }

      if (triggerIdx >= 0) {
        const q = text.slice(triggerIdx + 1, pos);
        setMentionOpen(true);
        setMentionQuery(q);
        setMentionTriggerPos(triggerIdx);
      } else if (mentionOpen) {
        closeMention();
      }
    },
    [mentionOpen, closeMention],
  );

  // --- Ref callback for textarea -------------------------------------------
  const textareaRefCallback = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
    },
    [],
  );

  const isEmpty = messages.length === 0 && !loading;

  // Quick actions — inject @mention for codoc-scoped actions
  const quickActions = activeCodoc
    ? [
        {
          label: "Summarize",
          prompt: `@${activeCodoc} Summarize this codoc concisely.`,
        },
        {
          label: "Suggest fields",
          prompt: `@${activeCodoc} What data fields should this codoc define?`,
        },
        {
          label: "Improve view",
          prompt: `@${activeCodoc} Suggest improvements to this codoc's MDX view section.`,
        },
      ]
    : [
        { label: "List codocs", prompt: "List all codocs in this workspace." },
        { label: "Create codoc", prompt: "Help me create a new codoc." },
      ];

  const chatStatus = loading
    ? ("streaming" as const)
    : ("ready" as const);

  return (
    <div className="flex h-full flex-col border-l border-neutral-200 bg-white">
      {/* Header */}
      <header className="shrink-0 border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AgentIcon />
            <span className="text-sm font-semibold text-neutral-800">
              Codoc agent
            </span>
          </div>
          <div className="flex items-center gap-1">
            {sessionId && (
              <button
                type="button"
                onClick={handleNewSession}
                className="rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                New
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            >
              <XIcon />
            </button>
          </div>
        </div>
      </header>

      {/* Quick action chips — shown when empty */}
      {isEmpty && (
        <div className="shrink-0 border-b border-neutral-100 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => void send(action.prompt)}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full text-neutral-400">
            <AgentIcon size={40} className="mb-3 opacity-20" />
            <p className="text-sm font-medium">Ask anything about your codocs</p>
            <p className="mt-1 text-xs opacity-60">
              Type <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 text-[10px]">@</kbd> to mention a codoc
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} codocs={codocs} />
        ))}

        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-neutral-100 px-4 py-2.5 text-sm text-neutral-500 animate-pulse">
              Thinking...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area with mention popover */}
      <div className="shrink-0 border-t border-neutral-200 bg-neutral-50/50 p-3 relative">
        <MentionPopover
          open={mentionOpen}
          items={mentionItems}
          activeIndex={mentionIndex}
          onSelect={insertMention}
        />
        <PromptInput
          onSubmit={({ text }) => void send(text)}
          className="rounded-xl border border-neutral-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400"
        >
          <PromptInputTextarea
            ref={textareaRefCallback}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleTextareaKeyDown}
            onBlur={closeMention}
            placeholder={
              activeCodoc
                ? `Ask about ${activeCodoc.replace(/\.codoc$/, "")}, type @ to mention...`
                : "Ask the agent, type @ to mention codocs..."
            }
            className="min-h-10 border-none shadow-none focus-visible:ring-0"
          />
          <PromptInputFooter className="justify-end border-none px-2 py-1">
            <PromptInputSubmit
              status={chatStatus}
              onStop={handleStop}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  codocs,
}: {
  message: ChatMessage;
  codocs: CodocListItem[];
}) {
  switch (message.role) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
            {renderMentions(message.text, codocs)}
          </div>
        </div>
      );

    case "assistant":
      return (
        <div className="flex justify-start">
          <div className="max-w-[90%] space-y-2">
            {message.toolCalls.length > 0 && (
              <div className="space-y-1">
                {message.toolCalls.map((tc, i) => (
                  <ToolCallChip key={i} tc={tc} />
                ))}
              </div>
            )}
            {message.text && (
              <div className="rounded-2xl rounded-bl-sm bg-neutral-100 px-4 py-2.5 text-sm prose prose-sm prose-neutral max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-pre:bg-neutral-800 prose-pre:text-neutral-100 prose-ul:my-1 prose-ol:my-1 prose-code:before:content-none prose-code:after:content-none">
                <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
              </div>
            )}
          </div>
        </div>
      );

    case "error":
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {message.text}
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// ToolCallChip
// ---------------------------------------------------------------------------

function ToolCallChip({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
      >
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <ToolIcon />
        <span className="font-mono">{tc.name}</span>
        {tc.status === "done" ? (
          <span className="text-green-600">done</span>
        ) : (
          <span className="text-neutral-400 animate-pulse">running</span>
        )}
      </button>
      {expanded && tc.input && (
        <pre className="mt-1 ml-4 rounded bg-neutral-100 p-2 text-xs text-neutral-500 overflow-x-auto">
          {JSON.stringify(tc.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function AgentIcon({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "text-amber-500"}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
