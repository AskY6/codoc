"use client";

import { useChatReferences } from "@/workspace/hooks/use-session";
import { removeReference } from "@/workspace/stores/api-client";
import { getChatStore } from "@/workspace/hooks/use-session";
import { Badge } from "@/shared/ui/badge";
import { X, FileText } from "lucide-react";

export function ContextBar() {
  const references = useChatReferences();

  if (references.length === 0) return null;

  const handleRemove = async (refId: string) => {
    getChatStore().removeReference(refId);
    await removeReference(refId);
  };

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 border-b bg-muted/20 overflow-x-auto">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium flex-shrink-0">
        Context
      </span>
      {references.map((ref) => (
        <Badge
          key={ref.id}
          variant="secondary"
          className="gap-1 pl-1.5 pr-1 py-0.5 text-xs font-normal"
        >
          <FileText className="h-3 w-3" />
          {ref.label ?? ref.id}
          <button
            onClick={() => handleRemove(ref.id)}
            className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
