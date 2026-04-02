import { StatusPill } from "./status-pill.js";
import type { CodocListItem, GraphData } from "../types.js";

interface Props {
  codocs: CodocListItem[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  graph: GraphData | null;
}

interface TreeNode {
  name: string;
  path?: string; // leaf
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
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left ${
          isSelected
            ? "bg-blue-50 text-blue-700 font-medium"
            : "text-gray-700 hover:bg-gray-100"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="truncate flex-1">{node.name}</span>
        {node.state && <StatusPill state={node.state} />}
      </button>
    );
  }

  return (
    <div>
      {node.name && (
        <div
          className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider"
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

export function Sidebar({ codocs, selectedPath, onSelect, graph }: Props) {
  const tree = buildTree(codocs);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Codocs
        </h2>
        <span className="text-xs text-gray-400">{codocs.length}</span>
      </div>

      {codocs.length === 0 ? (
        <p className="text-sm text-gray-400 px-2">No codocs found</p>
      ) : (
        <TreeItem
          node={tree}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      )}

      {graph && (
        <div className="mt-6 border-t border-gray-100 pt-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Graph
          </h2>
          <p className="text-xs text-gray-500">
            {graph.nodes.length} nodes, {graph.edges.length} edges
          </p>
        </div>
      )}
    </div>
  );
}
