import { useState, useEffect, useRef, useCallback } from "react";
import {
  getThread,
  sendMessage,
} from "@/api/chat.js";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import type { ChatMessage } from "@/types.js";

interface Props {
  workspaceId: string;
  threadId: string;
  selectedPath: string | null;
  onClearContext?: () => void;
}

interface StreamingState {
  text: string;
  toolCalls: Array<{ toolName: string; input?: unknown; output?: unknown }>;
  agentId: string | null;
}

export function ChatPanel({ workspaceId, threadId, selectedPath, onClearContext }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getThread(threadId).then((result) => {
      if (result) setMessages(result.messages);
    });
  }, [threadId]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      threadId,
      role: "user",
      content: input.trim(),
      agentId: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setStreaming({ text: "", toolCalls: [], agentId: null });

    const ctrl = sendMessage(
      threadId,
      workspaceId,
      userMsg.content,
      (eventType, data) => {
        const d = data as Record<string, unknown>;
        switch (eventType) {
          case "text-delta":
            setStreaming((prev) =>
              prev ? { ...prev, text: prev.text + (d.text as string), agentId: (d.agentId as string) ?? prev.agentId } : prev,
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
          case "error":
            setStreaming(null);
            setSending(false);
            break;
        }
      },
    );
    abortRef.current = ctrl;
  }, [input, sending, threadId, workspaceId]);

  const handleSuggest = useCallback(
    (prompt: string) => {
      setInput(prompt);
    },
    [],
  );

  return (
    <div className="flex flex-col h-full">
      <MessageList
        messages={messages}
        streaming={streaming}
        onSuggest={handleSuggest}
      />

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        sending={sending}
        selectedPath={selectedPath}
        onClearContext={onClearContext}
      />
    </div>
  );
}
