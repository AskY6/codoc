import { useState, useEffect, useRef, useCallback } from "react";
import {
  createThread,
  getThread,
  listThreads,
  sendMessage,
} from "../api/chat.js";
import type { ChatThread, ChatMessage } from "../types.js";

interface Props {
  workspaceId: string;
  selectedPath: string | null;
}

interface StreamingState {
  text: string;
  toolCalls: Array<{ toolName: string; input?: unknown; output?: unknown }>;
}

export function ChatPanel({ workspaceId, selectedPath }: Props) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load threads
  useEffect(() => {
    listThreads(workspaceId).then(setThreads);
  }, [workspaceId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

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
                calls[idx] = { toolName: calls[idx]!.toolName, input: calls[idx]!.input, output: d.output };
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
        <h2 className="text-sm font-semibold text-gray-600">Chat</h2>
        <button
          onClick={handleNewThread}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          + New
        </button>
      </div>

      {/* Context pin */}
      {selectedPath && (
        <div className="flex items-center gap-1 border-b border-gray-100 px-4 py-1.5 bg-blue-50">
          <span className="text-xs text-blue-600">Context:</span>
          <span className="text-xs text-blue-800 font-medium truncate">
            {selectedPath}
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <p className="text-sm text-gray-400 text-center mt-8">
            Start a conversation with the Cobook assistant
          </p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] space-y-2">
              {streaming.toolCalls.map((tc, i) => (
                <div key={i} className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-800">
                  <span className="font-medium">{tc.toolName}</span>
                  {tc.output != null && (
                    <span className="text-green-700 ml-1"> done</span>
                  )}
                </div>
              ))}
              {streaming.text && (
                <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800">
                  <p className="whitespace-pre-wrap">{streaming.text}</p>
                </div>
              )}
              {!streaming.text && streaming.toolCalls.length === 0 && (
                <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-400">
                  Thinking...
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the Cobook assistant..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
