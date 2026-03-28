"use client";

import {
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
  useCallback,
} from "react";
import type { ChatStore, ChatMessage, WritePreview } from "@/lib/chat-store";
import type { CommandDef } from "@/lib/commands";
import type { DocMeta } from "@/lib/types";
import { BUILTIN_COMMANDS } from "@/lib/commands";
import { ChatInput } from "./ChatInput";
import { CodocCard } from "./CodocCard";
import { chatStream, fieldAction } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, User, MessageSquareQuote, Copy, Check, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------

interface ChatPanelProps {
  store: ChatStore;
  references: string[];
  docs: DocMeta[];
  onAddReference: (docId: string) => void;
  onRemoveReference: (docId: string) => void;
  onInvokeAgent: (agentId: string) => void;
}

export function ChatPanel({
  store,
  references,
  docs,
  onAddReference,
  onRemoveReference,
  onInvokeAgent,
}: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [draftQuotedIds, setDraftQuotedIds] = useState<string[]>([]);

  const messages = useSyncExternalStore(
    useCallback((cb) => store.subscribe(cb), [store]),
    useCallback(() => store.getActiveBranch(), [store]),
    useCallback(() => [] as ChatMessage[], []),
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // --- Quote handlers --------------------------------------------------------

  const handleQuote = useCallback((messageId: string) => {
    setDraftQuotedIds((prev) =>
      prev.includes(messageId) ? prev : [...prev, messageId],
    );
  }, []);

  const handleRemoveQuote = useCallback((messageId: string) => {
    setDraftQuotedIds((prev) => prev.filter((id) => id !== messageId));
  }, []);

  const quotedMessages = draftQuotedIds
    .map((id) => store.getMessageById(id))
    .filter(Boolean) as ChatMessage[];

  // --- Write-back ------------------------------------------------------------

  const handleConfirmWrite = useCallback(
    async (messageId: string, index: number, preview: WritePreview) => {
      try {
        await fieldAction(preview.targetDocId, {
          path: preview.targetField,
          action: "update",
          value: preview.value,
        });
        store.confirmPreview(messageId, index);
      } catch (err) {
        store.addMessage(
          "assistant",
          `**Write failed:** ${err instanceof Error ? err.message : String(err)}`,
          [],
        );
      }
    },
    [store],
  );

  // --- Submit ----------------------------------------------------------------

  const handleSubmit = useCallback(
    (text: string, mentions: string[], quotedIds: string[]) => {
      for (const docId of mentions) {
        onAddReference(docId);
      }

      store.addMessage(
        "user",
        text,
        [...references],
        undefined,
        quotedIds.length > 0 ? quotedIds : undefined,
      );

      setDraftQuotedIds([]);

      const placeholder = store.addMessage(
        "assistant",
        "Thinking…",
        [...references],
      );

      // Build messages from the current branch for context.
      const branch = store.getActiveBranch();
      const apiMessages = branch.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      chatStream(apiMessages, store, placeholder.id, undefined, references).catch((err) => {
        store.updateMessageContent(
          placeholder.id,
          `**Error:** ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },
    [store, references, onAddReference],
  );

  // --- Command ---------------------------------------------------------------

  const handleCommand = useCallback(
    (cmd: CommandDef) => {
      if (cmd.action === "agent" && cmd.agentId) {
        onInvokeAgent(cmd.agentId);
      } else if (cmd.id === "clear") {
        store.clear();
        setDraftQuotedIds([]);
      } else if (cmd.id === "help") {
        const lines = BUILTIN_COMMANDS.map(
          (c) => `  /${c.id} — ${c.description}`,
        ).join("\n");
        store.addMessage(
          "assistant",
          `Available commands:\n${lines}\n\nTip: Use @docId to reference a codoc inline.`,
          [],
        );
      }
    },
    [store, onInvokeAgent],
  );

  // --- Render ----------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground">
              <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <div className="text-center max-w-sm">
                <p className="text-base font-medium text-foreground">
                  Start a conversation
                </p>
                <p className="text-sm mt-1.5 leading-relaxed">
                  Reference codocs from the left panel or type{" "}
                  <kbd className="rounded border px-1 py-0.5 text-[11px] font-mono bg-muted">
                    @
                  </kbd>{" "}
                  to mention. Use{" "}
                  <kbd className="rounded border px-1 py-0.5 text-[11px] font-mono bg-muted">
                    /
                  </kbd>{" "}
                  for commands.
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-6">
              {messages.map((msg) => (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  store={store}
                  isQuoted={draftQuotedIds.includes(msg.id)}
                  onQuote={handleQuote}
                  onConfirmWrite={handleConfirmWrite}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t bg-background px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <ChatInput
            docs={docs}
            quotedMessages={quotedMessages}
            attachedDocs={references}
            onSubmit={handleSubmit}
            onCommand={handleCommand}
            onMentionAdded={onAddReference}
            onRemoveQuote={handleRemoveQuote}
            onRemoveAttachment={onRemoveReference}
          />
        </div>
      </div>
    </div>
  );
}

// --- Message rendering -------------------------------------------------------

function renderMentions(
  content: string,
  references: string[],
): React.ReactNode {
  if (references.length === 0) return content;
  const refSet = new Set(references);
  const parts = content.split(/(@[\w./-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      const docId = part.slice(1);
      if (refSet.has(docId)) {
        return (
          <span
            key={i}
            className="inline-flex items-center rounded bg-primary/10 text-primary px-1 text-[13px] font-medium"
          >
            {part}
          </span>
        );
      }
    }
    return part;
  });
}

// ---------------------------------------------------------------------------

function MessageRow({
  message,
  store,
  isQuoted,
  onQuote,
  onConfirmWrite,
}: {
  message: ChatMessage;
  store: ChatStore;
  isQuoted: boolean;
  onQuote: (id: string) => void;
  onConfirmWrite: (messageId: string, index: number, preview: WritePreview) => void;
}) {
  const isUser = message.role === "user";

  // Resolve quoted messages for display
  const quotedMsgs = message.quotedIds
    ?.map((id) => store.getMessageById(id))
    .filter(Boolean) as ChatMessage[] | undefined;

  return (
    <div
      className={cn(
        "group relative rounded-lg transition-colors",
        isQuoted && "ring-1 ring-primary/20 bg-primary/[0.02]",
      )}
    >
      {/* Hover action bar */}
      <div className="absolute -top-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <div className="flex items-center rounded-md border bg-background shadow-sm">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-1.5 hover:bg-muted rounded-l-md transition-colors"
                onClick={() => onQuote(message.id)}
              >
                <MessageSquareQuote className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Quote</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-1.5 hover:bg-muted rounded-r-md transition-colors"
                onClick={() => {
                  navigator.clipboard.writeText(message.content);
                }}
              >
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Copy</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="px-2 py-1">
        {/* Quoted message previews */}
        {quotedMsgs && quotedMsgs.length > 0 && (
          <div className="mb-2 space-y-1">
            {quotedMsgs.map((q) => (
              <div
                key={q.id}
                className="border-l-2 border-muted-foreground/20 pl-3 py-0.5"
              >
                <span className="text-[11px] font-medium text-muted-foreground">
                  {q.role === "user" ? "You" : "Assistant"}
                </span>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {q.content}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Message content */}
        <div className="flex gap-3 items-start">
          <Avatar className="h-7 w-7 mt-0.5 flex-shrink-0">
            <AvatarFallback
              className={cn(
                "text-xs font-medium",
                isUser
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {isUser ? (
                <User className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {isUser ? "You" : "Assistant"}
            </p>
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {renderMentions(message.content, message.references)}
            </div>

            {/* Per-message codoc references */}
            {message.references.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {message.references.map((docId) => (
                  <CodocCard key={docId} docId={docId} />
                ))}
              </div>
            )}

            {/* Write previews */}
            {message.previews && message.previews.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {message.previews.map((preview, i) => (
                  <WritePreviewCard
                    key={i}
                    preview={preview}
                    onConfirm={() => onConfirmWrite(message.id, i, preview)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function WritePreviewCard({
  preview,
  onConfirm,
}: {
  preview: WritePreview;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs min-w-0">
          <PenLine className="h-3 w-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <span className="font-medium truncate">{preview.targetDocId}</span>
          <span className="text-muted-foreground">&rarr;</span>
          <span className="font-mono truncate">{preview.targetField}</span>
        </div>
        {preview.confirmed ? (
          <Badge
            variant="secondary"
            className="gap-1 text-[11px] flex-shrink-0"
          >
            <Check className="h-3 w-3" />
            Written
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs flex-shrink-0"
            onClick={onConfirm}
          >
            Confirm write
          </Button>
        )}
      </div>
      <pre className="mt-1.5 text-xs text-foreground whitespace-pre-wrap break-words leading-relaxed bg-background/60 rounded px-2 py-1.5">
        {typeof preview.value === "string"
          ? preview.value
          : JSON.stringify(preview.value, null, 2)}
      </pre>
    </div>
  );
}
