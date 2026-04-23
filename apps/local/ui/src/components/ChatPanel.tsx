import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat, api } from "../api.ts";
import type { CodocListItem, ImageAttachment } from "../api.ts";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTools,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  usePromptInputAttachments,
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
  | { role: "user"; text: string; images?: ImageAttachment[] | undefined }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "error"; text: string };

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

interface SlashCommand {
  name: string;
  description: string;
  prompt: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "list", description: "List all codocs", prompt: "List all codocs in this workspace." },
  { name: "create", description: "Create a new codoc", prompt: "Help me create a new codoc." },
  { name: "search", description: "Search codoc contents", prompt: "Search across all codocs for: " },
  { name: "diagnose", description: "Run diagnostics", prompt: "Run diagnose_codoc on all codocs and report issues." },
  { name: "dag", description: "Show dependency graph", prompt: "Show the DAG status and report any cycles or issues." },
];

// ---------------------------------------------------------------------------
// ChatPanel — persistent right sidebar
// ---------------------------------------------------------------------------

export interface ChatPanelProps {
  codocs: CodocListItem[];
  activeCodoc: string | null;
  onClose: () => void;
  resumeSession?: { sessionId: string; title: string };
}

export function ChatPanel({ codocs, activeCodoc, onClose, resumeSession }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(resumeSession?.sessionId);
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

  // --- Slash command state -------------------------------------------------
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    const q = slashQuery.toLowerCase();
    return SLASH_COMMANDS.filter(
      (c) => c.name.includes(q) || c.description.toLowerCase().includes(q),
    );
  }, [slashQuery]);

  // --- Auto-fill @path when activeCodoc changes (incl. on mount) -----------
  const prevActiveCodoc = useRef<string | null>(null);
  useEffect(() => {
    if (
      activeCodoc &&
      activeCodoc !== prevActiveCodoc.current &&
      input === "" &&
      messages.length === 0 &&
      !resumeSession
    ) {
      const prefill = `@${activeCodoc} `;
      setInput(prefill);
      // Place cursor after the pre-filled mention
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.selectionStart = prefill.length;
          ta.selectionEnd = prefill.length;
          ta.focus();
        }
      });
    }
    prevActiveCodoc.current = activeCodoc;
  }, [activeCodoc, input, messages.length]);

  // --- Load history when resuming a session ----------------------------------
  useEffect(() => {
    if (!resumeSession) return;
    let cancelled = false;
    api.chatMessages(resumeSession.sessionId).then((history) => {
      if (cancelled || history.length === 0) return;
      const restored: ChatMessage[] = history.map((m) =>
        m.role === "user"
          ? { role: "user" as const, text: m.text }
          : { role: "assistant" as const, text: m.text, toolCalls: (m.toolCalls ?? []).map((tc) => ({ name: tc.name, status: tc.status as "done" })) },
      );
      setMessages(restored);
    }).catch(() => { /* session file missing — keep empty */ });
    return () => { cancelled = true; };
  }, [resumeSession]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionItems]);

  useEffect(() => {
    setSlashIndex(0);
  }, [filteredCommands]);

  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionIndex(0);
    setMentionTriggerPos(null);
  }, []);

  const closeSlash = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery("");
    setSlashIndex(0);
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
    async (text?: string, images?: ImageAttachment[]) => {
      const prompt = (text ?? input).trim();
      if (!prompt || loading) return;

      const mentions = parseMentionedCodocs(prompt, codocs);

      setInput("");
      closeSlash();
      setMessages((prev) => [
        ...prev,
        { role: "user", text: prompt, images: images?.length ? images : undefined },
      ]);
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
          images,
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
    [input, loading, sessionId, codocs, closeSlash],
  );

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleNewSession = () => {
    setMessages([]);
    setSessionId(undefined);
  };

  // --- Keyboard navigation (mentions + slash commands) ---------------------
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Mention popover navigation
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

      // Slash command popover navigation
      if (slashOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashIndex((i) => (i + 1) % Math.max(filteredCommands.length, 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashIndex((i) =>
            i <= 0 ? Math.max(filteredCommands.length - 1, 0) : i - 1,
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          if (filteredCommands.length > 0) {
            e.preventDefault();
            const cmd = filteredCommands[slashIndex]!;
            closeSlash();
            setInput("");
            void send(cmd.prompt);
            return;
          }
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeSlash();
          return;
        }
      }
    },
    [
      mentionOpen, mentionItems, mentionIndex, insertMention, closeMention,
      slashOpen, filteredCommands, slashIndex, closeSlash, send,
    ],
  );

  // --- Trigger detection (@mentions + /commands) ---------------------------
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const pos = ta.selectionStart;
      const text = ta.value;
      setInput(text);

      // Slash command: `/` at the very start of input
      if (text.startsWith("/")) {
        const q = text.slice(1, pos);
        if (!/\s/.test(q)) {
          setSlashOpen(true);
          setSlashQuery(q);
          closeMention();
          return;
        }
      }
      if (slashOpen) closeSlash();

      // @mention: `@` preceded by whitespace or at start
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
    [mentionOpen, closeMention, slashOpen, closeSlash],
  );

  const textareaRefCallback = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
    },
    [],
  );

  const isEmpty = messages.length === 0 && !loading;

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

  const chatStatus = loading ? ("streaming" as const) : ("ready" as const);

  return (
    <div className="flex h-full flex-col border-l border-neutral-200 bg-white">
      {/* Header */}
      <header className="shrink-0 border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AgentIcon />
            <span className="text-sm font-semibold text-neutral-800 truncate max-w-[180px]">
              {resumeSession ? resumeSession.title : "Codoc agent"}
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

      {/* Quick action chips */}
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
        {isEmpty && (resumeSession ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-400">
            <HistoryIcon className="mb-3 opacity-20" />
            <p className="text-sm font-medium">Continuing conversation</p>
            <p className="mt-1 text-xs opacity-60 text-center px-4">
              Previous messages are stored in Claude Code.
              <br />
              Send a message to continue where you left off.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-neutral-400">
            <AgentIcon size={40} className="mb-3 opacity-20" />
            <p className="text-sm font-medium">
              Ask anything about your codocs
            </p>
            <p className="mt-1 text-xs opacity-60">
              Type{" "}
              <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 text-[10px]">
                @
              </kbd>{" "}
              to mention &middot;{" "}
              <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1 py-0.5 text-[10px]">
                /
              </kbd>{" "}
              for commands
            </p>
          </div>
        ))}

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

      {/* Input area */}
      <div className="shrink-0 border-t border-neutral-200 bg-neutral-50/50 p-3 relative">
        {/* Mention popover */}
        <MentionPopover
          open={mentionOpen}
          items={mentionItems}
          activeIndex={mentionIndex}
          onSelect={insertMention}
        />

        {/* Slash command popover */}
        <SlashCommandPopover
          open={slashOpen}
          commands={filteredCommands}
          activeIndex={slashIndex}
          onSelect={(cmd) => {
            closeSlash();
            setInput("");
            void send(cmd.prompt);
          }}
        />

        <PromptInput
          onSubmit={({ text, files }) => {
            // Convert file data URLs to ImageAttachment[] for the API
            const images: ImageAttachment[] = files
              .filter((f) => f.mediaType?.startsWith("image/"))
              .map((f) => ({ dataUrl: f.url, name: f.filename ?? "image" }));
            void send(text, images.length > 0 ? images : undefined);
          }}
          accept="image/*"
          className="rounded-xl border border-neutral-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400"
        >
          <AttachmentPreview />
          <PromptInputTextarea
            ref={textareaRefCallback}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleTextareaKeyDown}
            onBlur={() => {
              closeMention();
              closeSlash();
            }}
            placeholder={
              activeCodoc
                ? `Ask about ${activeCodoc.replace(/\.codoc$/, "")}, @ to mention, / for commands...`
                : "Ask the agent, @ to mention, / for commands..."
            }
            className="min-h-10 border-none shadow-none focus-visible:ring-0"
          />
          <PromptInputFooter className="justify-between border-none px-2 py-1">
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="Attach" />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments label="Add image" />
                  <PromptInputActionAddScreenshot label="Take screenshot" />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            </PromptInputTools>
            <PromptInputSubmit status={chatStatus} onStop={handleStop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttachmentPreview — shows image thumbnails above textarea
// ---------------------------------------------------------------------------

function AttachmentPreview() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;

  return (
    <PromptInputHeader className="gap-2 border-none px-3 pt-2">
      {attachments.files.map((file) => (
        <div key={file.id} className="group relative">
          {file.mediaType?.startsWith("image/") && file.url ? (
            <img
              src={file.url}
              alt={file.filename ?? "attachment"}
              className="h-16 w-16 rounded-lg border border-neutral-200 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-[10px] text-neutral-400">
              {file.filename?.split(".").pop() ?? "file"}
            </div>
          )}
          <button
            type="button"
            onClick={() => attachments.remove(file.id)}
            className="absolute -right-1 -top-1 hidden rounded-full bg-neutral-800 p-0.5 text-white group-hover:block"
          >
            <XIcon size={10} />
          </button>
        </div>
      ))}
    </PromptInputHeader>
  );
}

// ---------------------------------------------------------------------------
// SlashCommandPopover
// ---------------------------------------------------------------------------

function SlashCommandPopover({
  open,
  commands,
  activeIndex,
  onSelect,
}: {
  open: boolean;
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  if (!open || commands.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-72 z-50 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        Commands
      </div>
      <div ref={listRef} className="max-h-56 overflow-y-auto">
        {commands.map((cmd, i) => (
          <button
            key={cmd.name}
            data-active={i === activeIndex}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(cmd);
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              i === activeIndex
                ? "bg-blue-50 text-blue-700"
                : "text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            <SlashIcon />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs">/{cmd.name}</div>
              <div className="text-xs text-neutral-400">{cmd.description}</div>
            </div>
          </button>
        ))}
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
          <div className="max-w-[85%] space-y-2">
            {message.images && message.images.length > 0 && (
              <div className="flex justify-end gap-1">
                {message.images.map((img, i) => (
                  <img
                    key={i}
                    src={img.dataUrl}
                    alt={img.name}
                    className="h-20 rounded-lg border border-blue-400/30 object-cover"
                  />
                ))}
              </div>
            )}
            <div className="rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
              {renderMentions(message.text, codocs)}
            </div>
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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className ?? "text-amber-500"}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ToolIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" />
    </svg>
  );
}

function SlashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-neutral-400">
      <line x1="7" y1="22" x2="17" y2="2" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
