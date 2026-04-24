import { useState } from "react";
import type { TreeNode } from "../api.ts";

interface FileTreeProps {
  tree: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onDelete?: (path: string) => void;
  prefix?: string;
  searchTerm?: string;
}

export function FileTree({ tree, selectedPath, onSelect, onDelete, prefix = "", searchTerm = "" }: FileTreeProps) {
  const filteredTree = searchTerm
    ? filterTree(tree, searchTerm.toLowerCase())
    : tree;

  if (filteredTree.length === 0 && searchTerm) {
    return <p className="px-4 py-2 text-xs text-neutral-400">No matches</p>;
  }

  return (
    <ul className="space-y-0.5 text-sm">
      {filteredTree.map((node) => (
        <FileTreeNode
          key={node.name}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          {...(onDelete ? { onDelete } : {})}
          path={prefix ? `${prefix}/${node.name}` : node.name}
          autoExpand={!!searchTerm}
        />
      ))}
    </ul>
  );
}

function FileTreeNode({
  node,
  selectedPath,
  onSelect,
  onDelete,
  path,
  autoExpand,
}: {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onDelete?: (path: string) => void;
  path: string;
  autoExpand?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === path;

  const toggle = () => setExpanded(!expanded);

  if (node.type === "directory") {
    return (
      <li>
        <button
          type="button"
          className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-neutral-600 transition-colors hover:bg-neutral-200/50"
          onClick={toggle}
        >
          <span className={`transition-transform duration-200 ${expanded || autoExpand ? "rotate-90" : ""}`}>
            <ChevronRightIcon />
          </span>
          <FolderIcon className="text-neutral-400 group-hover:text-blue-500" />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {(expanded || autoExpand) && node.children && (
          <div className="ml-4 border-l border-neutral-200 pl-1">
            <FileTree
              tree={node.children}
              selectedPath={selectedPath}
              onSelect={onSelect}
              {...(onDelete ? { onDelete } : {})}
              prefix={path}
              searchTerm="" // already filtered at parent level
            />
          </div>
        )}
      </li>
    );
  }

  return (
    <li>
      <div
        className={`group flex w-full items-center rounded-md px-2 py-1 transition-all ${
          isSelected
            ? "bg-blue-100 text-blue-700 shadow-sm"
            : "text-neutral-600 hover:bg-neutral-200/50"
        }`}
      >
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left min-w-0"
          onClick={() => onSelect(path)}
        >
          <div className="ml-4 flex items-center gap-2 min-w-0">
            <FileIcon className={isSelected ? "text-blue-500" : "text-neutral-400 group-hover:text-blue-400"} />
            <span className={`truncate ${isSelected ? "font-semibold" : ""}`}>{node.name.replace(/\.mdx$/, "")}</span>
          </div>
        </button>
        {onDelete && (
          <button
            type="button"
            className="ml-auto shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-100 hover:text-red-500"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              // Convert .mdx display path back to .codoc
              onDelete(path.replace(/\.mdx$/, ".codoc"));
            }}
          >
            <XSmallIcon />
          </button>
        )}
      </div>
    </li>
  );
}

// --- Icons ---

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function XSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// --- Filter helper ---

function filterTree(tree: TreeNode[], term: string): TreeNode[] {
  const result: TreeNode[] = [];

  for (const node of tree) {
    if (node.type === "directory") {
      const filteredChildren = node.children ? filterTree(node.children, term) : [];
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(term)) {
        result.push({ ...node, children: filteredChildren });
      }
    } else if (node.name.toLowerCase().includes(term)) {
      result.push(node);
    }
  }

  return result;
}
