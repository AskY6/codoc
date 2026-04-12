// Attachment-style codoc card for inline display in chat messages.
//
// Renders a compact clickable card showing codoc title and path,
// similar to AI Elements Attachments grid variant. Clicking the card
// signals the parent to open the codoc in the side panel.

import { FileText } from "lucide-react";

export interface CodocCardProps {
  readonly codocId: string;
  readonly title: string | null;
  readonly path: string;
  readonly isSelected: boolean;
  readonly onClick: (codocId: string) => void;
}

export function CodocCard({
  codocId,
  title,
  path,
  isSelected,
  onClick,
}: CodocCardProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(codocId)}
      className={`inline-flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
        isSelected
          ? "border-foreground/30 bg-foreground/5"
          : "border-border bg-background hover:border-foreground/20 hover:bg-muted/50"
      }`}
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {title ?? path}
        </div>
        {title && (
          <div className="truncate text-xs text-muted-foreground">{path}</div>
        )}
      </div>
    </button>
  );
}
