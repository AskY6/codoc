import type { ViewNode } from "../types.js";

interface Props {
  node: ViewNode;
  data?: Record<string, unknown> | null | undefined;
}

function resolve(bind: string | undefined, data: Record<string, unknown> | null | undefined): unknown {
  if (!bind || !data) return undefined;
  // Support dotted paths like "data.field"
  const parts = bind.replace(/^data\./, "").split(".");
  let val: unknown = data;
  for (const p of parts) {
    if (val == null || typeof val !== "object") return undefined;
    val = (val as Record<string, unknown>)[p];
  }
  return val;
}

function RenderNode({ node, data }: Props) {
  const bound = resolve(node.bind, data);

  switch (node.type) {
    case "text": {
      const content = (bound as string) ?? node.props?.content ?? "";
      return <p className="text-sm text-gray-700">{String(content)}</p>;
    }

    case "markdown": {
      const content = (bound as string) ?? node.props?.content ?? "";
      // Simple markdown: just render as pre-formatted text for now
      return (
        <div className="prose prose-sm max-w-none">
          <pre className="whitespace-pre-wrap text-sm text-gray-700">{String(content)}</pre>
        </div>
      );
    }

    case "table": {
      const rows = (bound ?? node.props?.rows) as Record<string, unknown>[] | undefined;
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return <p className="text-sm text-gray-400 italic">No data</p>;
      }
      const headers = Object.keys(rows[0] as Record<string, unknown>);
      return (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200">
            <thead>
              <tr className="bg-gray-50">
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-gray-600 border-b border-gray-200">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {headers.map((h) => (
                    <td key={h} className="px-3 py-2 text-gray-700">
                      {String(row[h] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "stack":
      return (
        <div className="flex flex-col gap-4">
          {node.children?.map((child, i) => (
            <RenderNode key={i} node={child} data={data} />
          ))}
        </div>
      );

    case "grid": {
      const columns = (node.props?.columns as number) ?? 2;
      return (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {node.children?.map((child, i) => (
            <RenderNode key={i} node={child} data={data} />
          ))}
        </div>
      );
    }

    case "tabs": {
      // Simple tabs implementation using details/summary
      return (
        <div className="space-y-1">
          {node.children?.map((child, i) => (
            <details key={i} open={i === 0} className="border border-gray-200 rounded-lg">
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 rounded-t-lg">
                {(child.props?.label as string) ?? child.type ?? `Tab ${i + 1}`}
              </summary>
              <div className="p-4">
                <RenderNode node={child} data={data} />
              </div>
            </details>
          ))}
        </div>
      );
    }

    case "timeline":
      return (
        <div className="relative pl-6 space-y-4">
          <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-gray-200" />
          {node.children?.map((child, i) => (
            <div key={i} className="relative">
              <div className="absolute -left-4 top-1 h-3 w-3 rounded-full border-2 border-blue-500 bg-white" />
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <RenderNode node={child} data={data} />
              </div>
            </div>
          ))}
        </div>
      );

    case "section": {
      const title = (node.props?.title as string) ?? "";
      return (
        <div className="rounded-lg border border-gray-200 bg-white">
          {title && (
            <div className="border-b border-gray-200 px-4 py-2">
              <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
            </div>
          )}
          <div className="p-4 space-y-4">
            {node.children?.map((child, i) => (
              <RenderNode key={i} node={child} data={data} />
            ))}
          </div>
        </div>
      );
    }

    default:
      return (
        <div className="rounded bg-gray-100 p-2 text-xs text-gray-500">
          Unknown view type: {node.type}
        </div>
      );
  }
}

export function ViewRenderer({ node, data }: Props) {
  return <RenderNode node={node} data={data} />;
}
