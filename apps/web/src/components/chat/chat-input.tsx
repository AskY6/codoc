import { useRef, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  selectedPath: string | null;
  onClearContext?: (() => void) | undefined;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  sending,
  selectedPath,
  onClearContext,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      // Auto-resize
      const el = e.target;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 150) + "px";
    },
    [onChange],
  );

  return (
    <div className="border-t border-border p-3 space-y-2">
      {selectedPath && (
        <div className="flex items-center gap-1">
          <Badge variant="secondary" className="text-xs gap-1 max-w-full">
            <span className="truncate">{selectedPath}</span>
            {onClearContext && (
              <button onClick={onClearContext} className="ml-0.5 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        </div>
      )}
      <div className="flex gap-2 items-end">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Ask the assistant..."
          rows={1}
          className="min-h-[38px] max-h-[150px] resize-none"
        />
        <Button
          onClick={onSend}
          disabled={sending || !value.trim()}
          size="icon"
          className="shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
