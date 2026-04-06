import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ViewAction, ViewNode } from "@/types.js";

interface Props {
  node: ViewNode;
  data?: Record<string, unknown> | null | undefined;
  onAction?: ((action: ViewAction) => void) | undefined;
}

function resolve(
  bind: string | undefined,
  data: Record<string, unknown> | null | undefined,
): unknown {
  if (!bind || !data) return undefined;
  const parts = bind.replace(/^data\./, "").split(".");
  let val: unknown = data;
  for (const p of parts) {
    if (val == null || typeof val !== "object") return undefined;
    val = (val as Record<string, unknown>)[p];
  }
  return val;
}

/**
 * Interpolate `{{var.path}}` placeholders in a string with values from `scope`.
 */
function interpolate(template: string, scope: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const parts = path.split(".");
    let val: unknown = scope;
    for (const p of parts) {
      if (val == null || typeof val !== "object") return "";
      val = (val as Record<string, unknown>)[p];
    }
    return val == null ? "" : String(val);
  });
}

/**
 * Deep-clone a ViewNode, replacing all `{{var.xxx}}` in string props/bind values.
 */
function instantiateTemplate(
  template: ViewNode,
  scope: Record<string, unknown>,
): ViewNode {
  const node: ViewNode = { type: template.type };
  if (template.props) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template.props)) {
      props[k] = typeof v === "string" ? interpolate(v, scope) : v;
    }
    node.props = props;
  }
  if (template.bind) {
    node.bind = interpolate(template.bind, scope);
  }
  if (template.action) {
    node.action = {
      ...template.action,
      prompt: interpolate(template.action.prompt, scope),
    };
  }
  if (template.children) {
    node.children = template.children.map((c) => instantiateTemplate(c, scope));
  }
  if (template.repeat) node.repeat = template.repeat;
  if (template.template) node.template = instantiateTemplate(template.template, scope);
  return node;
}

/**
 * If a node has `repeat` + `template`, expand into concrete children from the bound array.
 */
function expandRepeat(
  node: ViewNode,
  data: Record<string, unknown> | null | undefined,
): ViewNode {
  if (!node.repeat || !node.template) return node;
  const arr = resolve(node.repeat.bind, data);
  if (!Array.isArray(arr)) return node;
  const varName = node.repeat.as;
  const expanded: ViewNode[] = arr.map((item) => {
    const scope: Record<string, unknown> = { [varName]: item as unknown };
    return instantiateTemplate(node.template!, scope);
  });
  // Return node without repeat/template, with expanded children appended
  const { repeat: _r, template: _t, ...rest } = node;
  return { ...rest, children: [...(node.children ?? []), ...expanded] };
}

/**
 * Wrap content in a clickable container if the node has an action.
 */
function ActionWrapper({
  action,
  onAction,
  children,
}: {
  action?: ViewAction | undefined;
  onAction?: ((action: ViewAction) => void) | undefined;
  children: React.ReactNode;
}) {
  if (!action || !onAction) return children;
  return (
    <button
      type="button"
      onClick={() => onAction(action)}
      className="w-full text-left cursor-pointer rounded-md ring-primary/30 transition-shadow hover:ring-2 focus-visible:outline-none focus-visible:ring-2"
    >
      {children}
    </button>
  );
}

/**
 * Interpolate `{{data.xxx}}` in all string props of a node using resolved data.
 */
function interpolateProps(
  node: ViewNode,
  data: Record<string, unknown> | null | undefined,
): ViewNode {
  if (!data || !node.props) return node;
  const hasTemplate = Object.values(node.props).some(
    (v) => typeof v === "string" && /\{\{/.test(v),
  );
  if (!hasTemplate) return node;
  const scope = { data } as Record<string, unknown>;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.props)) {
    props[k] = typeof v === "string" ? interpolate(v, scope) : v;
  }
  return { ...node, props };
}

function RenderNode({ node: rawNode, data, onAction }: Props) {
  const node = interpolateProps(expandRepeat(rawNode, data), data);
  const bound = resolve(node.bind, data);

  switch (node.type) {
    case "text": {
      const content = (bound as string) ?? node.props?.content ?? "";
      const str = String(content);
      if (!str) return null;
      return <p className="text-sm text-muted-foreground">{str}</p>;
    }

    case "markdown": {
      const content = (bound as string) ?? node.props?.content ?? "";
      return (
        <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 text-foreground">
          <Markdown remarkPlugins={[remarkGfm]}>{String(content)}</Markdown>
        </div>
      );
    }

    case "table": {
      const rows = (bound ?? node.props?.rows) as
        | Record<string, unknown>[]
        | undefined;
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return <p className="text-sm text-muted-foreground italic">No data</p>;
      }
      const headers = Object.keys(rows[0] as Record<string, unknown>);
      return (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-muted">
                {headers.map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {headers.map((h) => (
                    <td key={h} className="px-3 py-2 text-foreground">
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
        <div className="flex flex-col gap-3">
          {node.children?.map((child, i) => (
            <ActionWrapper key={i} action={child.action} onAction={onAction}>
              <RenderNode node={child} data={data} onAction={onAction} />
            </ActionWrapper>
          ))}
        </div>
      );

    case "grid": {
      const columns = (node.props?.columns as number) ?? 2;
      return (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {node.children?.map((child, i) => (
            <ActionWrapper key={i} action={child.action} onAction={onAction}>
              <RenderNode key={i} node={child} data={data} onAction={onAction} />
            </ActionWrapper>
          ))}
        </div>
      );
    }

    case "tabs": {
      return (
        <div className="space-y-1">
          {node.children?.map((child, i) => (
            <details
              key={i}
              open={i === 0}
              className="border border-border rounded-lg"
            >
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground bg-muted rounded-t-lg">
                {(child.props?.label as string) ?? child.type ?? `Tab ${i + 1}`}
              </summary>
              <div className="p-4">
                <RenderNode node={child} data={data} onAction={onAction} />
              </div>
            </details>
          ))}
        </div>
      );
    }

    case "timeline":
      return (
        <div className="relative pl-6 space-y-3">
          <div className="absolute left-2 top-0 bottom-0 w-px bg-border" />
          {node.children?.map((child, i) => (
            <div key={i} className="relative">
              <div className="absolute -left-4 top-2.5 h-2 w-2 rounded-full bg-foreground/20" />
              <ActionWrapper action={child.action} onAction={onAction}>
                <div className="rounded-lg border border-border bg-card px-4 py-3">
                  <RenderNode node={child} data={data} onAction={onAction} />
                </div>
              </ActionWrapper>
            </div>
          ))}
        </div>
      );

    case "section": {
      const title = (node.props?.title as string) ?? "";
      return (
        <div className="rounded-lg border border-border bg-card">
          {title && (
            <div className="border-b border-border px-4 py-2">
              <h3 className="text-sm font-medium text-foreground">
                {title}
              </h3>
            </div>
          )}
          <div className="p-4 space-y-2">
            {node.children?.map((child, i) => (
              <RenderNode key={i} node={child} data={data} onAction={onAction} />
            ))}
          </div>
        </div>
      );
    }

    default:
      return (
        <div className="rounded bg-muted p-2 text-xs text-muted-foreground">
          Unknown view type: {node.type}
        </div>
      );
  }
}

export function ViewRenderer({ node, data, onAction }: Props) {
  return <RenderNode node={node} data={data} onAction={onAction} />;
}
