import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";

interface ToolCall {
  toolName: string;
  input?: unknown;
  output?: unknown;
}

interface Props {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

function ToolCallChip({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = tc.output != null;

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 text-xs"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <Badge variant="outline" className="gap-1 font-normal">
          <Wrench className="h-3 w-3" />
          {tc.toolName}
          {isDone && <span className="text-green-600 ml-0.5">done</span>}
          {!isDone && <span className="text-muted-foreground ml-0.5 animate-pulse">running</span>}
        </Badge>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 text-xs space-y-1">
          {tc.input != null && (
            <pre className="rounded bg-muted p-2 overflow-x-auto text-muted-foreground">
              {JSON.stringify(tc.input, null, 2)}
            </pre>
          )}
          {tc.output != null && (
            <pre className="rounded bg-muted p-2 overflow-x-auto text-muted-foreground">
              {typeof tc.output === "string"
                ? tc.output
                : JSON.stringify(tc.output, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ role, content, toolCalls, isStreaming }: Props) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm">
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        {toolCalls && toolCalls.length > 0 && (
          <div className="space-y-0.5">
            {toolCalls.map((tc, i) => (
              <ToolCallChip key={i} tc={tc} />
            ))}
          </div>
        )}
        {content && (
          <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        )}
        {isStreaming && !content && (!toolCalls || toolCalls.length === 0) && (
          <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm text-muted-foreground">
            Thinking...
          </div>
        )}
      </div>
    </div>
  );
}
