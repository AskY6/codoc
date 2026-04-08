import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Sparkles, FileText } from "lucide-react";
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
    if (template.action.type === "chat") {
      node.action = {
        ...template.action,
        prompt: interpolate(template.action.prompt, scope),
      };
      if (template.action.meta) {
        const meta: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(template.action.meta)) {
          meta[k] = typeof v === "string" ? interpolate(v, scope) : v;
        }
        (node.action as { meta: Record<string, unknown> }).meta = meta;
      }
    } else if (template.action.type === "navigate") {
      node.action = {
        ...template.action,
        path: interpolate(template.action.path, scope),
      };
      if (template.action.generate) {
        const params: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(template.action.generate.params)) {
          params[k] = typeof v === "string" ? interpolate(v, scope) : v;
        }
        (node.action as { generate: { source: string; params: Record<string, unknown> } }).generate = {
          source: template.action.generate.source,
          params,
        };
      }
    }
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
  const expanded: ViewNode[] = arr.map((item, index) => {
    const scope: Record<string, unknown> = { [varName]: item as unknown, _index: index };
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

interface MetaPair { key: string; value: string; isUrl: boolean }

/**
 * Extract key-value metadata from detail children content.
 * Returns URL pairs, stat pairs, and whether this is metadata-only content.
 */
function extractMetadata(
  nodes: ViewNode[],
  data: Record<string, unknown> | null | undefined,
): { urls: MetaPair[]; stats: MetaPair[]; isMetadataOnly: boolean } {
  const contents: string[] = [];
  for (const n of nodes) {
    const resolved = interpolateProps(expandRepeat(n, data), data);
    const bound = resolve(resolved.bind, data);
    const raw = (bound as string) ?? resolved.props?.content ?? "";
    contents.push(String(raw));
  }
  const joined = contents.join(" ").trim();

  const kvPattern = /(?:^|\s)([\w\s]+?):\s+(https?:\/\/\S+|\d+)/g;
  const urls: MetaPair[] = [];
  const stats: MetaPair[] = [];
  let match: RegExpExecArray | null;
  while ((match = kvPattern.exec(joined)) !== null) {
    const raw = match[1]?.trim();
    const value = match[2];
    if (raw && value) {
      // Shorten common verbose labels
      const key = raw.replace(/\s*URL$/i, "");
      const isUrl = value.startsWith("http");
      (isUrl ? urls : stats).push({ key, value, isUrl });
    }
  }
  const isMetadataOnly = urls.length + stats.length >= 2;
  return { urls, stats, isMetadataOnly };
}

/**
 * Render the non-URL portion of a feed summary (stats as tags, or prose fallback).
 */
function SummaryContent({
  nodes,
  data,
  onAction,
}: {
  nodes: ViewNode[];
  data?: Record<string, unknown> | null | undefined;
  onAction?: ((action: ViewAction) => void) | undefined;
}) {
  return (
    <div className="text-sm text-muted-foreground space-y-2">
      {nodes.map((dc, di) => (
        <RenderNode key={di} node={dc} data={data} onAction={onAction} />
      ))}
    </div>
  );
}

/**
 * Timeline with collapsible items and keyboard navigation.
 * j/k = move focus, Enter = toggle expand, o = open link, m = AI summary.
 * Each child's first sub-child is always visible; the rest collapse.
 */
function TimelineView({ node, data, onAction }: Props) {
  const children = node.children ?? [];
  const [expandedSet, setExpandedSet] = useState<Set<number>>(() => new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const toggle = useCallback((i: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (children.length === 0) return;
      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(focusedIndex + 1, children.length - 1);
          setFocusedIndex(next);
          itemRefs.current.get(next)?.scrollIntoView({ block: "nearest" });
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(focusedIndex - 1, 0);
          setFocusedIndex(prev);
          itemRefs.current.get(prev)?.scrollIntoView({ block: "nearest" });
          break;
        }
        case "Enter": {
          e.preventDefault();
          toggle(focusedIndex);
          break;
        }
        case "o": {
          e.preventDefault();
          const link = children[focusedIndex]?.props?.link;
          if (typeof link === "string" && link) window.open(link, "_blank", "noopener,noreferrer");
          break;
        }
        case "m": {
          e.preventDefault();
          const child = children[focusedIndex];
          if (child?.action && onAction) onAction(child.action);
          break;
        }
      }
    },
    [children, focusedIndex, toggle, onAction],
  );

  return (
    <div
      ref={containerRef}
      className="space-y-2 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {children.map((child, i) => {
        const isRead = Boolean(child.props?.readAt);
        const isExpanded = expandedSet.has(i);
        const isFocused = focusedIndex === i;
        const link = child.props?.link as string | undefined;
        const subChildren = child.children ?? [];
        const headerChild: ViewNode | undefined = subChildren[0];
        const detailChildren = subChildren.slice(1);
        const meta = detailChildren.length > 0
          ? extractMetadata(detailChildren, data)
          : { urls: [], stats: [], isMetadataOnly: false };

        return (
          <div
            key={i}
            ref={(el) => { if (el) itemRefs.current.set(i, el); }}
            className={`rounded-lg px-4 py-3 transition-all ${
              isFocused ? "bg-muted/80 ring-1 ring-primary/20" : "hover:bg-muted/50"
            } ${isRead ? "text-muted-foreground" : ""}`}
          >
            {/* Header */}
            <div className="flex items-start gap-2">
              <div className={`flex-1 min-w-0 ${isRead ? "" : "font-medium"}`}>
                {headerChild && (
                  <RenderNode node={headerChild} data={data} onAction={onAction} />
                )}
              </div>
              <span className={`shrink-0 text-xs rounded px-1.5 py-0.5 ${
                isRead
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary/10 text-primary"
              }`}>
                {isRead ? "read" : "new"}
              </span>
            </div>

            {/* Action bar: links + actions + stats */}
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Original
                </a>
              )}
              {meta.urls.map((u, ui) => (
                <a
                  key={ui}
                  href={u.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {u.key}
                </a>
              ))}
              {child.action && onAction && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onAction(child.action!); }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded px-2 py-1 hover:bg-muted transition-colors"
                >
                  <Sparkles className="h-3 w-3" />
                  AI Summary
                </button>
              )}
              {detailChildren.length > 0 && !meta.isMetadataOnly && (
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className={`inline-flex items-center gap-1 text-xs rounded px-2 py-1 transition-colors ${
                    isExpanded
                      ? "text-foreground bg-muted"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <FileText className="h-3 w-3" />
                  Summary
                </button>
              )}
              {meta.stats.map((s, si) => (
                <span
                  key={si}
                  className="inline-flex items-center gap-1 text-xs bg-muted/60 text-muted-foreground rounded px-2 py-1"
                >
                  {s.key}: <span className="font-medium">{s.value}</span>
                </span>
              ))}
            </div>

            {/* Feed summary — expanded (only for prose content) */}
            {isExpanded && detailChildren.length > 0 && !meta.isMetadataOnly && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <SummaryContent nodes={detailChildren} data={data} onAction={onAction} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Try to parse a string as a date. Returns a Date if valid, undefined otherwise.
 */
function tryParseDate(str: string): Date | undefined {
  const trimmed = str.trim();
  if (!trimmed) return undefined;
  // ISO 8601 or RFC 2822 patterns
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || /^\w{3},\s\d{2}\s\w{3}\s\d{4}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

/**
 * Format a date as a short relative or absolute string.
 */
function formatDateShort(d: Date): string {
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 0) return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Auto-render data fields when a view node has no explicit children.
 */
function AutoDataView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <div key={key}>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            {key.replace(/_/g, " ")}
          </h4>
          <AutoDataValue value={value} />
        </div>
      ))}
    </div>
  );
}

function AutoDataValue({ value }: { value: unknown }) {
  if (value == null) return null;

  if (Array.isArray(value)) {
    return (
      <ul className="list-disc list-inside space-y-1 text-sm text-foreground">
        {value.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    );
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {Object.entries(obj).map(([k, v]) => {
          const str = String(v ?? "");
          const isUrl = str.startsWith("http");
          return (
            <span key={k} className="text-muted-foreground">
              {k}:{" "}
              {isUrl ? (
                <a
                  href={str}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline underline-offset-2 hover:text-primary"
                >
                  {str}
                </a>
              ) : (
                <span className="text-foreground">{str}</span>
              )}
            </span>
          );
        })}
      </div>
    );
  }

  const str = String(value);
  if (str.startsWith("http")) {
    return (
      <a
        href={str}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-foreground underline underline-offset-2 hover:text-primary"
      >
        {str}
      </a>
    );
  }
  return <p className="text-sm text-foreground">{str}</p>;
}

function RenderNode({ node: rawNode, data, onAction }: Props) {
  const node = interpolateProps(expandRepeat(rawNode, data), data);
  const bound = resolve(node.bind, data);

  switch (node.type) {
    case "text": {
      const content = (bound as string) ?? node.props?.content ?? "";
      const str = String(content);
      if (!str) return null;
      const variant = node.props?.variant as string | undefined;
      // Caption variant: small muted text, auto-format dates
      if (variant === "caption") {
        const parsed = tryParseDate(str);
        return (
          <span className="inline-block text-xs text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
            {parsed ? formatDateShort(parsed) : str}
          </span>
        );
      }
      // Auto-detect pure date strings even without variant
      const parsed = tryParseDate(str);
      if (parsed) {
        return (
          <span className="inline-block text-xs text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
            {formatDateShort(parsed)}
          </span>
        );
      }
      // Legacy: "DATE — TITLE" pattern (existing RSS codocs)
      const emDashIdx = str.indexOf(" — ");
      if (emDashIdx > 0) {
        const maybeDatePart = str.slice(0, emDashIdx);
        const titlePart = str.slice(emDashIdx + 3);
        const parsedPrefix = tryParseDate(maybeDatePart);
        if (parsedPrefix && titlePart) {
          return (
            <span className="flex items-baseline gap-2 flex-wrap">
              <span className="text-foreground">{titlePart}</span>
              <span className="text-xs text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
                {formatDateShort(parsedPrefix)}
              </span>
            </span>
          );
        }
      }
      return <p className="text-foreground">{str}</p>;
    }

    case "markdown": {
      const content = (bound as string) ?? node.props?.content ?? "";
      return (
        <div className="prose prose-sm max-w-none prose-p:my-1.5 prose-headings:my-3 prose-pre:my-2 prose-ul:my-1.5 prose-ol:my-1.5 text-foreground">
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
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                {headers.map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left font-medium text-muted-foreground border-b border-border/60"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
                  {headers.map((h) => (
                    <td key={h} className="px-3 py-2.5 text-foreground">
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
        <div className="space-y-2">
          {node.children?.map((child, i) => (
            <details
              key={i}
              open={i === 0}
              className="group/tab rounded-lg border border-border/60"
            >
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 rounded-lg transition-colors group-open/tab:rounded-b-none">
                {(child.props?.label as string) ?? child.type ?? `Tab ${i + 1}`}
              </summary>
              <div className="px-4 py-3 border-t border-border/40">
                <RenderNode node={child} data={data} onAction={onAction} />
              </div>
            </details>
          ))}
        </div>
      );
    }

    case "timeline":
      return (
        <TimelineView node={node} data={data} onAction={onAction} />
      );

    case "section": {
      const title = (node.props?.title as string) ?? "";
      const hasChildren = node.children && node.children.length > 0;
      return (
        <div className="rounded-lg border border-border/60">
          {title && (
            <div className="border-b border-border/40 px-4 py-2.5">
              <h3 className="text-sm font-medium text-foreground">
                {title}
              </h3>
            </div>
          )}
          <div className="px-4 py-3 space-y-3">
            {hasChildren
              ? node.children!.map((child, i) => (
                  <RenderNode key={i} node={child} data={data} onAction={onAction} />
                ))
              : data && <AutoDataView data={data} />}
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
