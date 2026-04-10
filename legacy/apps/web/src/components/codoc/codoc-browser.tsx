import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import { StatusBadge } from "@/components/codoc/status-badge";
import { ChevronRight, FileText } from "lucide-react";
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

/* ---- localStorage-backed collapsed set ---- */
const LS_KEY = "codoc-tree-collapsed";
const listeners = new Set<() => void>();
let snapshot: Set<string> = readFromStorage();

function readFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}

function persist(next: Set<string>) {
  snapshot = next;
  localStorage.setItem(LS_KEY, JSON.stringify([...next]));
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return snapshot;
}

function useCollapsedSet() {
  const set = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const toggle = useCallback((key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist(next);
  }, [set]);
  return { collapsed: set, toggle };
}

/* ---- Tree component ---- */

export function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
  renderActions,
  _prefix = "",
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  renderActions?: ((path: string) => ReactNode) | undefined;
  _prefix?: string;
}) {
  const isLeaf = !!node.path;
  const isSelected = node.path === selectedPath;
  const folderKey = _prefix ? `${_prefix}/${node.name}` : node.name;
  const { collapsed, toggle } = useCollapsedSet();
  const isCollapsed = collapsed.has(folderKey);

  const children = [...node.children.values()].sort((a, b) => {
    // Files (leaf) before folders (non-leaf)
    const aIsLeaf = !!a.path;
    const bIsLeaf = !!b.path;
    if (aIsLeaf !== bIsLeaf) return aIsLeaf ? -1 : 1;
    // Alphabetical within same type
    return a.name.localeCompare(b.name);
  });

  if (isLeaf) {
    return (
      <button
        onClick={() => onSelect(node.path!)}
        className={`group/leaf flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors ${
          isSelected
            ? "bg-primary/10 text-primary font-medium"
            : "text-foreground hover:bg-muted"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1">{node.title ?? node.name}</span>
        {renderActions && node.path && renderActions(node.path)}
        {node.state && <StatusBadge state={node.state} />}
      </button>
    );
  }

  return (
    <div>
      {node.name && (
        <button
          onClick={() => toggle(folderKey)}
          className="flex w-full items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          />
          {node.name}/
        </button>
      )}
      {!isCollapsed &&
        children.map((child) => (
          <TreeItem
            key={child.name}
            node={child}
            depth={node.name ? depth + 1 : depth}
            selectedPath={selectedPath}
            onSelect={onSelect}
            renderActions={renderActions}
            _prefix={node.name ? folderKey : _prefix}
          />
        ))}
    </div>
  );
}
