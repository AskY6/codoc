import { FileText, Folder, FolderOpen, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { CodocListItem } from "../types";
import { relativeTime } from "../lib/format";
import { Button } from "./ui/button";

// ---------------------------------------------------------------------------
// Tree data structure
// ---------------------------------------------------------------------------

type TreeNode =
  | { readonly kind: "dir"; readonly name: string; readonly children: TreeNode[] }
  | { readonly kind: "leaf"; readonly codoc: CodocListItem };

function buildTree(codocs: readonly CodocListItem[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const codoc of codocs) {
    const segments = codoc.path.split("/").filter(Boolean);
    let target = root;

    // Walk / create directories for all but the last segment
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!;
      let dir = target.find(
        (n): n is Extract<TreeNode, { kind: "dir" }> =>
          n.kind === "dir" && n.name === name,
      );
      if (!dir) {
        dir = { kind: "dir", name, children: [] };
        target.push(dir);
      }
      target = dir.children;
    }

    target.push({ kind: "leaf", codoc });
  }

  // Sort: dirs first (alphabetical), then leaves (by updatedAt desc)
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      if (a.kind === "dir" && b.kind === "dir") return a.name.localeCompare(b.name);
      if (a.kind === "leaf" && b.kind === "leaf") return b.codoc.updatedAt - a.codoc.updatedAt;
      return 0;
    });
    for (const n of nodes) {
      if (n.kind === "dir") sortNodes(n.children);
    }
  }
  sortNodes(root);

  return root;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function DirNode({
  node,
  workspaceId,
  depth,
  onDelete,
}: {
  node: Extract<TreeNode, { kind: "dir" }>;
  workspaceId: string;
  depth: number;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const Icon = open ? FolderOpen : Folder;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">{node.name}/</span>
      </button>
      {open && (
        <div>
          {node.children.map((child, i) =>
            child.kind === "dir" ? (
              <DirNode
                key={child.name}
                node={child}
                workspaceId={workspaceId}
                depth={depth + 1}
                onDelete={onDelete}
              />
            ) : (
              <LeafNode
                key={child.codoc.id}
                codoc={child.codoc}
                workspaceId={workspaceId}
                depth={depth + 1}
                onDelete={onDelete}
                isLast={i === node.children.length - 1}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function LeafNode({
  codoc,
  workspaceId,
  depth,
  onDelete,
}: {
  codoc: CodocListItem;
  workspaceId: string;
  depth: number;
  onDelete: (id: string) => void;
  isLast?: boolean;
}) {
  return (
    <div className="group relative">
      <Link
        to={`/workspace/${encodeURIComponent(workspaceId)}/codoc/${encodeURIComponent(codoc.id)}`}
        className="flex items-center gap-1.5 py-1.5 pr-3 transition-colors hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40" />
        <span className="truncate text-sm font-medium text-foreground">
          {codoc.title ?? codoc.path.split("/").pop()}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground/50 shrink-0">
          {relativeTime(codoc.updatedAt)}
        </span>
      </Link>
      <div
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label={`Delete ${codoc.title ?? codoc.path}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(codoc.id);
          }}
        >
          <Trash2 className="h-3 w-3 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function CodocTree({
  codocs,
  workspaceId,
  onDelete,
  onCreate,
}: {
  codocs: readonly CodocListItem[];
  workspaceId: string;
  onDelete: (id: string) => void;
  onCreate: () => void;
}) {
  const tree = buildTree(codocs);

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Codocs
        </h2>
        <Button size="sm" variant="ghost" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>

      {codocs.length > 0 ? (
        <div className="rounded-lg border border-border">
          {tree.map((node, i) =>
            node.kind === "dir" ? (
              <DirNode
                key={node.name}
                node={node}
                workspaceId={workspaceId}
                depth={0}
                onDelete={onDelete}
              />
            ) : (
              <LeafNode
                key={node.codoc.id}
                codoc={node.codoc}
                workspaceId={workspaceId}
                depth={0}
                onDelete={onDelete}
                isLast={i === tree.length - 1}
              />
            ),
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border py-6 px-4">
          <FileText className="h-4 w-4 text-muted-foreground/50 shrink-0" />
          <p className="text-sm text-muted-foreground">No codocs yet</p>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
      )}
    </section>
  );
}
