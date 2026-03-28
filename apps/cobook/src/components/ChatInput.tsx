"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type ClipboardEvent,
} from "react";
import { type CommandDef, filterCommands } from "@/lib/commands";
import type { DocMeta } from "@/lib/types";
import type { ChatMessage } from "@/lib/chat-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowUp,
  FileText,
  ShieldCheck,
  Sparkles,
  Trash2,
  CircleHelp,
  Bot,
  X,
  Reply,
} from "lucide-react";
import { cn } from "@/lib/utils";

const cmdIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  ShieldCheck,
  Sparkles,
  Trash2,
  CircleHelp,
};

// ---------------------------------------------------------------------------

interface ChatInputProps {
  docs: DocMeta[];
  quotedMessages: ChatMessage[];
  attachedDocs: string[];
  onSubmit: (
    text: string,
    mentionedDocIds: string[],
    quotedIds: string[],
  ) => void;
  onCommand: (command: CommandDef) => void;
  onMentionAdded: (docId: string) => void;
  onRemoveQuote: (messageId: string) => void;
  onRemoveAttachment: (docId: string) => void;
  disabled?: boolean;
}

interface AcState {
  type: "command" | "mention";
  query: string;
}

// ---------------------------------------------------------------------------

export function ChatInput({
  docs,
  quotedMessages,
  attachedDocs,
  onSubmit,
  onCommand,
  onMentionAdded,
  onRemoveQuote,
  onRemoveAttachment,
  disabled,
}: ChatInputProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [ac, setAc] = useState<AcState | null>(null);
  const [selIdx, setSelIdx] = useState(0);
  const [hasContent, setHasContent] = useState(false);
  const composingRef = useRef(false);

  const hasContext = quotedMessages.length > 0 || attachedDocs.length > 0;

  // Filtered autocomplete items
  const items: Array<CommandDef | DocMeta> = ac
    ? ac.type === "command"
      ? filterCommands(ac.query)
      : docs
          .filter((d) =>
            d.docId.toLowerCase().includes(ac.query.toLowerCase()),
          )
          .slice(0, 8)
    : [];

  useEffect(() => {
    setSelIdx((prev) => Math.min(prev, Math.max(items.length - 1, 0)));
  }, [items.length]);

  const closeAc = useCallback(() => {
    setAc(null);
    setSelIdx(0);
  }, []);

  // --- Helpers ---------------------------------------------------------------

  function getTextBeforeCursor(): string {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return "";
    const { startContainer, startOffset } = sel.getRangeAt(0);
    if (startContainer.nodeType !== Node.TEXT_NODE) return "";
    return (startContainer.textContent ?? "").slice(0, startOffset);
  }

  function extractContent(el: HTMLDivElement): {
    text: string;
    mentions: string[];
  } {
    const mentions: string[] = [];
    let text = "";

    function walk(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? "";
      } else if (node instanceof HTMLElement) {
        const mid = node.dataset.mention;
        if (mid) {
          mentions.push(mid);
          text += `@${mid}`;
        } else if (node.tagName === "BR") {
          text += "\n";
        } else {
          if (
            node.tagName === "DIV" &&
            text.length > 0 &&
            !text.endsWith("\n")
          )
            text += "\n";
          node.childNodes.forEach(walk);
        }
      }
    }

    el.childNodes.forEach(walk);
    return { text: text.trim(), mentions: [...new Set(mentions)] };
  }

  // --- Event handlers --------------------------------------------------------

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    const el = editorRef.current;
    if (!el) return;

    const fullText = el.textContent ?? "";
    setHasContent(!!fullText.trim());

    if (!el.querySelector("[data-mention]") && fullText.startsWith("/")) {
      setAc({ type: "command", query: fullText.slice(1).trim() });
      setSelIdx(0);
      return;
    }

    const before = getTextBeforeCursor();
    const m = before.match(/@([^\s@]*)$/);
    if (m) {
      setAc({ type: "mention", query: m[1] });
      setSelIdx(0);
      return;
    }

    closeAc();
  }, [closeAc]);

  const insertMention = useCallback(
    (docId: string) => {
      const el = editorRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      const textNode = range.startContainer;
      if (textNode.nodeType !== Node.TEXT_NODE || !textNode.parentNode) return;

      const raw = textNode.textContent ?? "";
      const pos = range.startOffset;
      const beforeCursor = raw.slice(0, pos);
      const atIdx = beforeCursor.lastIndexOf("@");
      if (atIdx === -1) return;

      const pre = raw.slice(0, atIdx);
      const post = raw.slice(pos);

      const frag = document.createDocumentFragment();
      if (pre) frag.appendChild(document.createTextNode(pre));

      const chip = document.createElement("span");
      chip.dataset.mention = docId;
      chip.contentEditable = "false";
      chip.className = "mention-chip";
      chip.textContent = `@${docId}`;
      frag.appendChild(chip);

      const tail = document.createTextNode(`\u00A0${post}`);
      frag.appendChild(tail);

      textNode.parentNode.replaceChild(frag, textNode);

      const nr = document.createRange();
      nr.setStart(tail, 1);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);

      setHasContent(true);
      closeAc();
      onMentionAdded(docId);
      el.focus();
    },
    [closeAc, onMentionAdded],
  );

  const execCmd = useCallback(
    (cmd: CommandDef) => {
      const el = editorRef.current;
      if (el) {
        el.innerHTML = "";
        setHasContent(false);
      }
      closeAc();
      onCommand(cmd);
      el?.focus();
    },
    [closeAc, onCommand],
  );

  const handleSelect = useCallback(
    (idx: number) => {
      if (!ac || !items[idx]) return;
      if (ac.type === "command") execCmd(items[idx] as CommandDef);
      else insertMention((items[idx] as DocMeta).docId);
    },
    [ac, items, execCmd, insertMention],
  );

  const handleSubmit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const { text, mentions } = extractContent(el);
    if (!text) return;
    el.innerHTML = "";
    setHasContent(false);
    onSubmit(
      text,
      mentions,
      quotedMessages.map((m) => m.id),
    );
  }, [onSubmit, quotedMessages]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (composingRef.current) return;

      if (ac && items.length > 0) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelIdx((i) => (i <= 0 ? items.length - 1 : i - 1));
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelIdx((i) => (i >= items.length - 1 ? 0 : i + 1));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          handleSelect(selIdx);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeAc();
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [ac, items.length, selIdx, handleSelect, closeAc, handleSubmit],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, text);
      setTimeout(handleInput, 0);
    },
    [handleInput],
  );

  // --- Render ----------------------------------------------------------------

  return (
    <div className="relative">
      {/* Autocomplete popover */}
      {ac && items.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
          <div className="rounded-xl border bg-popover text-popover-foreground shadow-lg overflow-hidden">
            <ScrollArea className="max-h-72">
              <div className="p-1">
                {ac.type === "command"
                  ? (items as CommandDef[]).map((cmd, i) => {
                      const Icon = cmdIconMap[cmd.icon] ?? Bot;
                      return (
                        <button
                          key={cmd.id}
                          className={cn(
                            "w-full text-left rounded-lg px-3 py-2 flex items-center gap-3 transition-colors",
                            i === selIdx
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-accent/50",
                          )}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleSelect(i);
                          }}
                        >
                          <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">/{cmd.id}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {cmd.description}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  : (items as DocMeta[]).map((doc, i) => (
                      <button
                        key={doc.docId}
                        className={cn(
                          "w-full text-left rounded-lg px-3 py-2 flex items-center gap-2.5 transition-colors",
                          i === selIdx
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50",
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelect(i);
                        }}
                      >
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{doc.docId}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {doc.fields.map((f) => f.path).join(", ")}
                          </div>
                        </div>
                      </button>
                    ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}

      {/* Editor container */}
      <div className="relative rounded-xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/20 focus-within:border-ring/40 transition-shadow">
        {/* Context section: quotes + attachments */}
        {hasContext && (
          <div className="px-3 pt-3 space-y-2">
            {/* Quoted messages */}
            {quotedMessages.map((msg) => (
              <div
                key={msg.id}
                className="flex items-start gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5"
              >
                <Reply className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0 scale-x-[-1]" />
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {msg.role === "user" ? "You" : "Assistant"}
                  </span>
                  <p className="text-xs text-foreground line-clamp-2">
                    {msg.content}
                  </p>
                </div>
                <button
                  onClick={() => onRemoveQuote(msg.id)}
                  className="p-0.5 rounded-sm hover:bg-foreground/10 text-muted-foreground flex-shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            {/* Attached codocs */}
            {attachedDocs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachedDocs.map((docId) => (
                  <Badge
                    key={docId}
                    variant="secondary"
                    className="gap-1 pl-1.5 pr-1 py-0.5 font-normal"
                  >
                    <FileText className="h-3 w-3" />
                    <span className="text-xs">{docId}</span>
                    <button
                      onClick={() => onRemoveAttachment(docId)}
                      className="ml-0.5 rounded-sm hover:bg-foreground/10 p-0.5 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Placeholder */}
        {!hasContent && !hasContext && (
          <div className="absolute inset-0 px-4 pt-3 text-sm text-muted-foreground/60 pointer-events-none select-none overflow-hidden">
            Ask about your codocs&hellip; Type{" "}
            <kbd className="rounded border px-1 py-0.5 text-[11px] font-mono bg-muted">
              /
            </kbd>{" "}
            for commands,{" "}
            <kbd className="rounded border px-1 py-0.5 text-[11px] font-mono bg-muted">
              @
            </kbd>{" "}
            to mention
          </div>
        )}

        <div
          ref={editorRef}
          contentEditable={!disabled}
          role="textbox"
          aria-multiline="true"
          suppressContentEditableWarning
          className={cn(
            "relative w-full bg-transparent text-sm outline-none min-h-[44px] max-h-[160px] overflow-y-auto px-4 pb-12 whitespace-pre-wrap break-words",
            hasContext ? "pt-2" : "pt-3",
          )}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            handleInput();
          }}
          onBlur={() => {
            setTimeout(closeAc, 200);
          }}
        />

        <div className="absolute bottom-2.5 right-2.5">
          <Button
            type="button"
            size="icon"
            disabled={!hasContent || disabled}
            className="h-8 w-8 rounded-lg"
            onClick={handleSubmit}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
