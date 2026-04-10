import { useState, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/codoc/status-badge";
import { FileText, Search, Layers } from "lucide-react";
import type { CodocListItem } from "@/types.js";

interface Props {
  codocs: CodocListItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function CodocSubsetSelector({ codocs, selectedIds, onChange }: Props) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return codocs;
    const q = filter.toLowerCase();
    return codocs.filter((c) => c.path.toLowerCase().includes(q));
  }, [codocs, filter]);

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1 text-sm">
            <Layers className="h-4 w-4" />
            <span>Codocs</span>
            {selectedIds.length > 0 && (
              <span className="ml-1 text-muted-foreground">
                {selectedIds.length}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72 p-0">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8 h-8"
            />
          </div>
        </div>
        <ScrollArea className="max-h-56">
          <div className="p-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground px-3 py-4 text-center">
                No codocs
              </p>
            ) : (
              filtered.map((c) => {
                const checked = selectedIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors ${
                      checked
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <Checkbox checked={checked} readOnly className="size-3.5" />
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{c.path}</span>
                    <StatusBadge state={c.nodeState} />
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
