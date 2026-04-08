import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { getThread, sendMessage } from "@/api/chat.js";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Bot, CopyIcon, MessageSquare } from "lucide-react";
import { MentionPopover, useMentionItems } from "./mention-popover";
import type { MentionItem } from "./mention-popover";
import { renderMentions } from "./mention-render";
import type { AgentInfo, ChatMessage, CodocListItem, ViewActionContext } from "@/types.js";

export interface ChatPanelSendOptions {
  targetAgentId?: string;
  context?: ViewActionContext;
}

export interface ChatPanelHandle {
  send: (text: string, options?: ChatPanelSendOptions) => void;
}

interface Props {
  workspaceId: string;
  threadId: string;
  agents: AgentInfo[];
  codocs: CodocListItem[];
  selectedPath: string | null;
  onTitleUpdate?: (title: string) => void;
}

interface ToolCall {
  toolName: string;
  input?: unknown;
  output?: unknown;
}

interface StreamingState {
  text: string;
  status: string;
  toolCalls: ToolCall[];
  agentId: string | null;
}

// ---------------------------------------------------------------------------
// Parse @mentions from message text
// ---------------------------------------------------------------------------

function parseMentions(
  text: string,
  agents: AgentInfo[],
  codocs: CodocListItem[],
): { targetAgentId: string | undefined; sourceCodocPath: string | undefined } {
  let targetAgentId: string | undefined;
  let sourceCodocPath: string | undefined;

  // Sort by name length descending so longer names match first
  const sortedAgents = [...agents].sort((a, b) => b.name.length - a.name.length);
  for (const agent of sortedAgents) {
    if (text.includes(`@${agent.name}`)) {
      targetAgentId = agent.id;
      break;
    }
  }

  const sortedCodocs = [...codocs].sort((a, b) => b.path.length - a.path.length);
  for (const codoc of sortedCodocs) {
    if (text.includes(`@${codoc.path}`)) {
      sourceCodocPath = codoc.path;
      break;
    }
  }

  return { targetAgentId, sourceCodocPath };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel(
  { workspaceId, threadId, agents, codocs, selectedPath, onTitleUpdate },
  ref,
) {
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Mention popover state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionTriggerPos, setMentionTriggerPos] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const mentionItems = useMentionItems(agents, codocs, mentionQuery);

  useEffect(() => {
    getThread(threadId).then((result) => {
      if (result) setMessages(result.messages);
    });
  }, [threadId]);

  // Reset mention index when filtered items change
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
      const mentionText = `@${item.label} `;
      const newValue = before + mentionText + after;
      const cursorPos = before.length + mentionText.length;

      // Update the textarea value via native setter to trigger React's onChange
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(ta, newValue);
      ta.dispatchEvent(new Event("input", { bubbles: true }));

      // Restore cursor position
      requestAnimationFrame(() => {
        ta.selectionStart = cursorPos;
        ta.selectionEnd = cursorPos;
        ta.focus();
      });

      closeMention();
    },
    [mentionTriggerPos, closeMention],
  );

  const handleSend = useCallback(
    (text: string, options?: ChatPanelSendOptions) => {
      if (!text.trim() || sending) return;

      closeMention();

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        threadId,
        role: "user",
        content: text.trim(),
        agentId: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setSending(true);
      setStreaming({ text: "", status: "", toolCalls: [], agentId: null });

      // Parse inline mentions for routing
      const mentions = parseMentions(text, agents, codocs);
      const sentTargetAgentId = options?.targetAgentId ?? mentions.targetAgentId;
      const sentContext: ViewActionContext | undefined =
        options?.context ??
        (mentions.sourceCodocPath
          ? { sourceCodocPath: mentions.sourceCodocPath }
          : selectedPath
            ? { sourceCodocPath: selectedPath }
            : undefined);

      const ctrl = sendMessage(
        threadId,
        workspaceId,
        userMsg.content,
        (eventType, data) => {
          const d = data as Record<string, unknown>;
          switch (eventType) {
            case "text-delta":
              setStreaming((prev) =>
                prev
                  ? {
                      ...prev,
                      text: prev.text + (d.text as string),
                      status: "",
                      agentId: (d.agentId as string) ?? prev.agentId,
                    }
                  : prev,
              );
              break;
            case "status":
              setStreaming((prev) =>
                prev
                  ? {
                      ...prev,
                      status: d.text as string,
                      agentId: (d.agentId as string) ?? prev.agentId,
                    }
                  : prev,
              );
              break;
            case "tool-use":
              setStreaming((prev) =>
                prev
                  ? {
                      ...prev,
                      toolCalls: [
                        ...prev.toolCalls,
                        { toolName: d.toolName as string, input: d.input },
                      ],
                    }
                  : prev,
              );
              break;
            case "tool-result":
              setStreaming((prev) => {
                if (!prev) return prev;
                const calls = [...prev.toolCalls];
                const name = d.toolName as string;
                const idx = calls.findLastIndex(
                  (tc) => tc.toolName === name && !tc.output,
                );
                if (idx >= 0) {
                  calls[idx] = {
                    toolName: calls[idx]!.toolName,
                    input: calls[idx]!.input,
                    output: d.output,
                  };
                }
                return { ...prev, toolCalls: calls };
              });
              break;
            case "done": {
              const fullText = d.fullText as string;
              const doneAgentId = (d.agentId as string) ?? null;
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  threadId,
                  role: "assistant",
                  content: fullText,
                  agentId: doneAgentId,
                  createdAt: new Date().toISOString(),
                },
              ]);
              setStreaming(null);
              setSending(false);
              break;
            }
            case "title-update":
              if (onTitleUpdate && d.title) {
                onTitleUpdate(d.title as string);
              }
              break;
            case "error":
              setStreaming(null);
              setSending(false);
              break;
          }
        },
        {
          ...(sentTargetAgentId && { targetAgentId: sentTargetAgentId }),
          ...(sentContext && { context: sentContext }),
        },
      );
      abortRef.current = ctrl;
    },
    [sending, threadId, workspaceId, agents, codocs, selectedPath, closeMention, onTitleUpdate],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(null);
    setSending(false);
  }, []);

  useImperativeHandle(ref, () => ({ send: handleSend }), [handleSend]);

  const chatStatus = sending
    ? streaming?.text
      ? ("streaming" as const)
      : ("submitted" as const)
    : ("ready" as const);

  const isEmpty = messages.length === 0 && !streaming;

  // Keyboard handler for the textarea — detect `@` and handle popover navigation
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

  // onChange handler — detect `@` trigger and update mention query
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const pos = ta.selectionStart;
      const text = ta.value;

      // Find the last `@` before cursor that's either at start or preceded by whitespace
      let triggerIdx = -1;
      for (let i = pos - 1; i >= 0; i--) {
        if (text[i] === "@") {
          if (i === 0 || /\s/.test(text[i - 1]!)) {
            triggerIdx = i;
          }
          break;
        }
        // Stop searching if we hit whitespace before finding `@`
        if (/\s/.test(text[i]!)) break;
      }

      if (triggerIdx >= 0) {
        const query = text.slice(triggerIdx + 1, pos);
        setMentionOpen(true);
        setMentionQuery(query);
        setMentionTriggerPos(triggerIdx);
      } else if (mentionOpen) {
        closeMention();
      }
    },
    [mentionOpen, closeMention],
  );

  // Capture textarea ref from PromptInputTextarea
  const textareaRefCallback = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
    },
    [],
  );

  return (
    <div className="flex flex-col h-full">
      <Conversation className="flex-1">
        <ConversationContent>
          {isEmpty && (
            <ConversationEmptyState
              icon={<MessageSquare className="h-8 w-8" />}
              title="Start a conversation"
              description="Ask the assistant about this workspace"
            />
          )}

          {messages.map((msg) => (
            <Message key={msg.id} from={msg.role}>
              {msg.role === "assistant" && msg.agentId && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Bot className="h-3 w-3" />
                  <span>{agentName(msg.agentId)}</span>
                </div>
              )}
              <MessageContent>
                {msg.role === "user" ? (
                  <p className="whitespace-pre-wrap">
                    {renderMentions(msg.content, agents, codocs)}
                  </p>
                ) : (
                  <MessageResponse>{msg.content}</MessageResponse>
                )}
              </MessageContent>
              {msg.role === "assistant" && (
                <MessageActions>
                  <MessageAction
                    tooltip="Copy"
                    onClick={() => navigator.clipboard.writeText(msg.content)}
                  >
                    <CopyIcon className="size-3" />
                  </MessageAction>
                </MessageActions>
              )}
            </Message>
          ))}

          {streaming && (
            <Message from="assistant">
              {streaming.agentId && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Bot className="h-3 w-3" />
                  <span>{agentName(streaming.agentId)}</span>
                </div>
              )}
              <MessageContent>
                {streaming.text ? (
                  <MessageResponse>{streaming.text}</MessageResponse>
                ) : streaming.status ? (
                  <p className="text-sm text-muted-foreground animate-pulse">{streaming.status}</p>
                ) : (
                  <p className="text-sm text-muted-foreground animate-pulse">Thinking...</p>
                )}
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border p-3 relative">
        <MentionPopover
          open={mentionOpen}
          items={mentionItems}
          activeIndex={mentionIndex}
          onSelect={insertMention}
        />
        <PromptInput
          onSubmit={({ text }) => handleSend(text)}
        >
          <PromptInputTextarea
            ref={textareaRefCallback}
            placeholder="Type @ to mention agents or codocs..."
            onKeyDown={handleTextareaKeyDown}
            onChange={handleTextareaChange}
            onBlur={closeMention}
          />
          <PromptInputFooter>
            <div />
            <PromptInputSubmit
              status={chatStatus}
              onStop={handleStop}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
});
