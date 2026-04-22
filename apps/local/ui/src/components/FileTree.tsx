import { useState } from "react";
import type { TreeNode } from "../api.ts";

interface FileTreeProps {
  tree: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  prefix?: string;
}

export function FileTree({ tree, selectedPath, onSelect, prefix = "" }: FileTreeProps) {
  return (
    <ul className="text-sm">
      {tree.map((node) => (
        <FileTreeNode
          key={node.name}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          path={prefix ? `${prefix}/${node.name}` : node.name}
        />
      ))}
    </ul>
  );
}

function FileTreeNode({
  node,
  selectedPath,
  onSelect,
  path,
}: {
  node: TreeNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  path: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === path;

  if (node.type === "directory") {
    return (
      <li>
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-neutral-500 hover:bg-neutral-100"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="w-4 text-center text-xs">{expanded ? "\u25BE" : "\u25B8"}</span>
          <span>{node.name}</span>
        </button>
        {expanded && node.children && (
          <div className="ml-3">
            <FileTree
              tree={node.children}
              selectedPath={selectedPath}
              onSelect={onSelect}
              prefix={path}
            />
          </div>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className={`flex w-full items-center gap-1 rounded px-2 py-0.5 text-left ${
          isSelected
            ? "bg-blue-100 text-blue-800"
            : "hover:bg-neutral-100"
        }`}
        onClick={() => onSelect(path)}
      >
        <span className="w-4 text-center text-xs text-neutral-400">{"\u25A0"}</span>
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}
