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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { AtSign, Bot, CopyIcon, MessageSquare, X } from "lucide-react";
import type { AgentInfo, ChatMessage, ViewActionContext } from "@/types.js";

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
  selectedPath: string | null;
  onClearContext?: () => void;
  onTitleUpdate?: (title: string) => void;
}

interface ToolCall {
  toolName: string;
  input?: unknown;
  output?: unknown;
}

interface StreamingState {
  text: string;
  toolCalls: ToolCall[];
  agentId: string | null;
}

export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel(
  { workspaceId, threadId, agents, selectedPath, onClearContext, onTitleUpdate },
  ref,
) {
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [sending, setSending] = useState(false);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getThread(threadId).then((result) => {
      if (result) setMessages(result.messages);
    });
  }, [threadId]);

  const handleSend = useCallback(
    (text: string, options?: ChatPanelSendOptions) => {
      if (!text.trim() || sending) return;

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
      setStreaming({ text: "", toolCalls: [], agentId: null });

      const sentTargetAgentId = options?.targetAgentId ?? targetAgentId ?? undefined;
      setTargetAgentId(null);

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
          ...(options?.context && { context: options.context }),
        },
      );
      abortRef.current = ctrl;
    },
    [sending, threadId, workspaceId, targetAgentId],
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
                  <p className="whitespace-pre-wrap">{msg.content}</p>
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
                ) : (
                  <p className="text-sm text-muted-foreground">Thinking...</p>
                )}
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border p-3 space-y-2">
        <div className="flex items-center gap-1 flex-wrap">
          {selectedPath && (
            <Badge variant="secondary" className="text-xs gap-1 max-w-full">
              <span className="truncate">{selectedPath}</span>
              {onClearContext && (
                <button onClick={onClearContext} className="ml-0.5 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          )}
          {targetAgentId && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Bot className="h-3 w-3" />
              <span>{agentName(targetAgentId)}</span>
              <button onClick={() => setTargetAgentId(null)} className="ml-0.5 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>
        <PromptInput
          onSubmit={({ text }) => handleSend(text)}
        >
          <PromptInputTextarea placeholder={targetAgentId ? `Ask ${agentName(targetAgentId)}...` : "Ask the assistant..."} />
          <PromptInputFooter>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Target a specific agent"
                  >
                    <AtSign className="h-4 w-4" />
                  </button>
                }
              />
              <DropdownMenuContent align="start" className="w-64 p-1">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setTargetAgentId(targetAgentId === a.id ? null : a.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                      targetAgentId === a.id
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{a.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.description}</div>
                    </div>
                  </button>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
