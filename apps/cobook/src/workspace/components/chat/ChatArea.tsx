"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useChatMessages, useTypingAgents } from "@/workspace/hooks/use-session";
import { useWorkspaceDocs } from "@/workspace/hooks/use-workspace";
import { MessageRow } from "./MessageRow";
import { ContextBar } from "./ContextBar";
import { ChatInput } from "./ChatInput";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Sparkles,
  LayoutDashboard,
  Wrench,
  BarChart3,
  PenLine,
  Loader2,
} from "lucide-react";

const GUIDE_CARDS = [
  {
    icon: LayoutDashboard,
    title: "搭建飞书消息看板",
    subtitle: "聚合飞书、QA 系统等消息源",
    prompt: "帮我搭建一个信息看板，消息源来自飞书群和内部 QA 系统",
  },
  {
    icon: Wrench,
    title: "创建周报 Skill",
    subtitle: "团队可复用的 prompt 模板",
    prompt: "帮我创建一个周报生成的 skill，让团队同事可以复用",
  },
  {
    icon: BarChart3,
    title: "项目进度跟踪",
    subtitle: "汇总 Linear/Jira 任务状态",
    prompt: "帮我创建一个项目进度跟踪文档，汇总 Linear 的任务状态",
  },
  {
    icon: PenLine,
    title: "自由创建",
    subtitle: "描述你想做的任何东西",
    prompt: "",
  },
];

export function ChatArea() {
  const messages = useChatMessages();
  const typingAgents = useTypingAgents();
  const docs = useWorkspaceDocs();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [suggestedPrompt, setSuggestedPrompt] = useState<string | undefined>();

  const isTyping = typingAgents.size > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping]);

  const handleCardClick = useCallback((prompt: string) => {
    if (prompt) {
      setSuggestedPrompt(prompt);
    }
    // For empty prompt ("自由创建"), just focus the input — handled by ChatInput
  }, []);

  const handleSuggestionConsumed = useCallback(() => {
    setSuggestedPrompt(undefined);
  }, []);

  const showGuide = messages.length === 0 && docs.length === 0;

  return (
    <div className="flex flex-col h-full">
      <ContextBar />

      <ScrollArea className="flex-1">
        {messages.length === 0 ? (
          showGuide ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-6 px-4">
              <div className="flex flex-col items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-50 to-violet-50 border border-blue-100 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-blue-500" />
                </div>
                <div className="text-center max-w-md">
                  <p className="text-base font-medium text-foreground">
                    开始创建你的第一个 codoc
                  </p>
                  <p className="text-sm mt-1.5 text-muted-foreground leading-relaxed">
                    描述你的需求，AI 会帮你设计结构
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
                {GUIDE_CARDS.map((card) => (
                  <button
                    key={card.title}
                    onClick={() => handleCardClick(card.prompt)}
                    className="group text-left rounded-xl border bg-card p-4 transition-all hover:border-blue-200 hover:shadow-sm hover:bg-blue-50/30"
                  >
                    <card.icon className="h-4.5 w-4.5 text-muted-foreground group-hover:text-blue-500 transition-colors mb-2" />
                    <p className="text-sm font-medium text-foreground">
                      {card.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {card.subtitle}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-4 text-muted-foreground">
              <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <div className="text-center max-w-sm">
                <p className="text-base font-medium text-foreground">
                  Start a conversation
                </p>
                <p className="text-sm mt-1.5 leading-relaxed">
                  Type a message or use{" "}
                  <kbd className="px-1 py-0.5 rounded border bg-muted text-xs font-mono">
                    @
                  </kbd>{" "}
                  to mention an agent.
                </p>
              </div>
            </div>
          )
        ) : (
          <>
            <div className="divide-y">
              {messages.map((msg) => (
                <MessageRow key={msg.id} message={msg} />
              ))}
            </div>
            {isTyping && (
              <div className="flex items-center gap-2 px-4 py-3 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-sm">
                  {Array.from(typingAgents).join(", ")} 思考中…
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </ScrollArea>

      <div className="p-3 border-t bg-background">
        <ChatInput
          suggestedPrompt={suggestedPrompt}
          onSuggestionConsumed={handleSuggestionConsumed}
        />
      </div>
    </div>
  );
}
