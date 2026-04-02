import { useState, useEffect, useRef, useCallback } from "react";
import {
  createThread,
  getThread,
  listThreads,
  sendMessage,
} from "@/api/chat.js";
import { ThreadSelector } from "./thread-selector";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import type { ChatThread, ChatMessage } from "@/types.js";

interface Props {
  workspaceId: string;
  selectedPath: string | null;
  onClearContext?: () => void;
}

interface StreamingState {
  text: string;
  toolCalls: Array<{ toolName: string; input?: unknown; output?: unknown }>;
}

export function ChatPanel({ workspaceId, selectedPath, onClearContext }: Props) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listThreads(workspaceId).then(setThreads);
  }, [workspaceId]);

  const selectThread = useCallback(async (thread: ChatThread) => {
    setActiveThread(thread);
    const result = await getThread(thread.id);
    if (result) setMessages(result.messages);
  }, []);

  const handleNewThread = useCallback(async () => {
    const thread = await createThread(workspaceId);
    setThreads((prev) => [thread, ...prev]);
    setActiveThread(thread);
    setMessages([]);
  }, [workspaceId]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;

    let thread = activeThread;
    if (!thread) {
      thread = await createThread(workspaceId);
      setThreads((prev) => [thread!, ...prev]);
      setActiveThread(thread);
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      threadId: thread.id,
      role: "user",
      content: input.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setStreaming({ text: "", toolCalls: [] });

    const ctrl = sendMessage(
      thread.id,
      workspaceId,
      userMsg.content,
      (eventType, data) => {
        const d = data as Record<string, unknown>;
        switch (eventType) {
          case "text-delta":
            setStreaming((prev) =>
              prev ? { ...prev, text: prev.text + (d.text as string) } : prev,
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
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                threadId: thread!.id,
                role: "assistant",
                content: fullText,
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
  }, [input, sending, activeThread, workspaceId]);

  const handleSuggest = useCallback(
    (prompt: string) => {
      setInput(prompt);
    },
    [],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center border-b border-border px-3 py-2">
        <ThreadSelector
          threads={threads}
          activeThread={activeThread}
          onSelect={selectThread}
          onNewThread={handleNewThread}
        />
      </div>

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
