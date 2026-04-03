import { useState, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/status-badge";
import { Search, FileText } from "lucide-react";
import type { CodocListItem } from "@/types.js";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codocs: CodocListItem[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

interface TreeNode {
  name: string;
  path?: string;
  state?: string;
  children: Map<string, TreeNode>;
}

function buildTree(codocs: CodocListItem[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map() };
  for (const c of codocs) {
    const parts = c.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (!cur.children.has(part)) {
        cur.children.set(part, { name: part, children: new Map() });
      }
      cur = cur.children.get(part)!;
      if (i === parts.length - 1) {
        cur.path = c.path;
        cur.state = c.nodeState;
      }
    }
  }
  return root;
}

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const isLeaf = !!node.path;
  const isSelected = node.path === selectedPath;
  const children = [...node.children.values()];

  if (isLeaf) {
    return (
      <button
        onClick={() => onSelect(node.path!)}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors ${
          isSelected
            ? "bg-primary/10 text-primary font-medium"
            : "text-foreground hover:bg-muted"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1">{node.name}</span>
        {node.state && <StatusBadge state={node.state} />}
      </button>
    );
  }

  return (
    <div>
      {node.name && (
        <div
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {node.name}/
        </div>
      )}
      {children.map((child) => (
        <TreeItem
          key={child.name}
          node={child}
          depth={node.name ? depth + 1 : depth}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function CodocBrowser({
  open,
  onOpenChange,
  codocs,
  selectedPath,
  onSelect,
}: Props) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return codocs;
    const q = filter.toLowerCase();
    return codocs.filter((c) => c.path.toLowerCase().includes(q));
  }, [codocs, filter]);

  const tree = buildTree(filtered);

  function handleSelect(path: string) {
    onSelect(path);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80 sm:w-96 p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="text-base">Codocs</SheetTitle>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter codocs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8"
            />
          </div>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-120px)] px-2 pb-4">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-8 text-center">
              {codocs.length === 0 ? "No codocs in workspace" : "No matching codocs"}
            </p>
          ) : (
            <TreeItem
              node={tree}
              depth={0}
              selectedPath={selectedPath}
              onSelect={handleSelect}
            />
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
