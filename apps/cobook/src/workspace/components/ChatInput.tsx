"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { sendChatMessage, addReference } from "@/workspace/api-client";
import {
  useChatParticipants,
  getChatStore,
} from "@/workspace/hooks/use-session";
import { useWorkspaceDocs } from "@/workspace/hooks/use-workspace";
import { cn } from "@/shared/utils";
import { Send, Loader2, AtSign } from "lucide-react";

interface MentionOption {
  id: string;
  label: string;
  type: "participant" | "resource";
}

interface ChatInputProps {
  suggestedPrompt?: string;
  onSuggestionConsumed?: () => void;
}

export function ChatInput({ suggestedPrompt, onSuggestionConsumed }: ChatInputProps = {}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const participants = useChatParticipants();
  const docs = useWorkspaceDocs();

  // Apply suggested prompt from guide cards
  useEffect(() => {
    if (suggestedPrompt) {
      setValue(suggestedPrompt);
      onSuggestionConsumed?.();
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [suggestedPrompt, onSuggestionConsumed]);

  // Build mention options
  const allOptions: MentionOption[] = [
    ...participants
      .filter((p) => p.kind === "agent")
      .map((p) => ({
        id: p.id,
        label: p.name,
        type: "participant" as const,
      })),
    ...docs.map((d) => ({
      id: d.docId,
      label: d.docId,
      type: "resource" as const,
    })),
  ];

  const filteredOptions = mentionQuery
    ? allOptions.filter(
        (o) =>
          o.id.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          o.label.toLowerCase().includes(mentionQuery.toLowerCase()),
      )
    : allOptions;

  // Reset selection when options change
  useEffect(() => {
    setSelectedIdx(0);
  }, [mentionQuery]);

  const extractMentions = useCallback(
    (text: string) => {
      const mentioned: string[] = [];
      const resourceRefs: Array<{ kind: string; id: string; label?: string }> =
        [];

      for (const opt of allOptions) {
        if (text.includes(`@${opt.id}`)) {
          if (opt.type === "participant") {
            mentioned.push(opt.id);
          } else {
            resourceRefs.push({
              kind: "codoc",
              id: opt.id,
              label: opt.label,
            });
          }
        }
      }

      // Also handle /command → @mention mapping
      for (const opt of allOptions) {
        if (opt.type === "participant" && text.includes(`/${opt.id}`)) {
          if (!mentioned.includes(opt.id)) {
            mentioned.push(opt.id);
          }
        }
      }

      return { mentioned, resourceRefs };
    },
    [allOptions],
  );

  const handleSend = async () => {
    const text = value.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const { mentioned, resourceRefs: mentionRefs } = extractMentions(text);

      // Register any new resource refs from @mentions in session
      for (const ref of mentionRefs) {
        getChatStore().addReference(ref);
        addReference(ref);
      }

      // Merge active session refs with newly-mentioned refs
      const activeRefs = getChatStore().getReferences();
      const allRefs = [...activeRefs];
      for (const ref of mentionRefs) {
        if (!allRefs.some((r) => r.id === ref.id)) {
          allRefs.push(ref);
        }
      }

      await sendChatMessage(text, {
        mentionedParticipants: mentioned.length > 0 ? mentioned : undefined,
        resourceRefs: allRefs.length > 0 ? allRefs : undefined,
      });

      setValue("");
    } finally {
      setSending(false);
    }
  };

  const insertMention = (option: MentionOption) => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = value.slice(0, cursorPos);
    const textAfter = value.slice(cursorPos);

    // Find the @ that started this mention
    const atIdx = textBefore.lastIndexOf("@");
    if (atIdx === -1) return;

    const newText = textBefore.slice(0, atIdx) + `@${option.id} ` + textAfter;
    setValue(newText);
    setShowMentions(false);
    setMentionQuery("");

    // Focus back
    setTimeout(() => {
      textarea.focus();
      const newCursor = atIdx + option.id.length + 2;
      textarea.setSelectionRange(newCursor, newCursor);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions && filteredOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filteredOptions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredOptions[selectedIdx]);
        return;
      }
      if (e.key === "Escape") {
        setShowMentions(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setValue(text);

    // Detect @mention trigger
    const cursorPos = e.target.selectionStart;
    const textUpToCursor = text.slice(0, cursorPos);
    const atMatch = textUpToCursor.match(/@([^\s]*)$/);

    if (atMatch) {
      setShowMentions(true);
      setMentionQuery(atMatch[1]);
    } else {
      setShowMentions(false);
      setMentionQuery("");
    }
  };

  return (
    <div className="relative">
      {/* Mention dropdown */}
      {showMentions && filteredOptions.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border bg-popover shadow-md max-h-48 overflow-auto z-10">
          {filteredOptions.map((opt, i) => (
            <button
              key={`${opt.type}-${opt.id}`}
              className={cn(
                "w-full text-left px-3 py-2 flex items-center gap-2 text-sm",
                i === selectedIdx
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(opt);
              }}
            >
              <AtSign className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {opt.type === "participant" ? "agent" : "codoc"}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="relative rounded-xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <textarea
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message… (@ to mention agent or codoc)"
          rows={1}
          disabled={sending}
          className="w-full resize-none bg-transparent px-4 py-3 pr-12 text-sm outline-none placeholder:text-muted-foreground/50 disabled:opacity-50 max-h-32 overflow-auto"
          style={{ minHeight: "44px" }}
        />
        <button
          onClick={handleSend}
          disabled={!value.trim() || sending}
          className={cn(
            "absolute right-2 bottom-2 h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
            value.trim() && !sending
              ? "bg-foreground text-background hover:bg-foreground/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
