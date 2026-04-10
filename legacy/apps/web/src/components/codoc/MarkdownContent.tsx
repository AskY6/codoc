import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";

interface MarkdownContentProps {
  content?: string;
  children?: ReactNode;
}

export function MarkdownContent({ content, children }: MarkdownContentProps) {
  const text = content ?? (typeof children === "string" ? children : null);
  if (!text) return null;

  return (
    <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-hr:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
