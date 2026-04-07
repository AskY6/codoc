import { StatusBadge } from "@/components/status-badge";
import { FileText } from "lucide-react";
import type { CodocListItem } from "@/types.js";

export interface TreeNode {
  name: string;
  title?: string;
  path?: string;
  state?: string;
  children: Map<string, TreeNode>;
}

export function buildTree(codocs: CodocListItem[]): TreeNode {
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
        if (c.meta.title) cur.title = c.meta.title;
        cur.state = c.nodeState;
      }
    }
  }
  return root;
}

export function TreeItem({
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
        <span className="truncate flex-1">{node.title ?? node.name}</span>
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
