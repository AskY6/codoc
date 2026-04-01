import type {
  ComponentMeta,
  ComponentSpec,
  ViewGridColumns,
  ViewNodeSpec,
  ViewSpacing,
  ViewTextTone
} from "../parser/types.js";

export interface RenderStackNode {
  type: "stack";
  gap: ViewSpacing;
  children: RenderViewNode[];
}

export interface RenderMarkdownNode {
  type: "markdown";
  content: string;
}

export interface RenderGridNode {
  type: "grid";
  columns: ViewGridColumns;
  gap: ViewSpacing;
  children: RenderViewNode[];
}

export interface RenderTextNode {
  type: "text";
  content: string;
  tone: ViewTextTone;
}

export interface RenderJsonNode {
  type: "json";
  title?: string;
  value: unknown;
}

export interface RenderComponentNode {
  type: "component";
  source: ComponentSpec["kind"] | "builtin";
  alias?: string;
  component: string;
  props: Record<string, unknown>;
  runtime: RenderComponentRuntime;
  propsSchema?: Record<string, unknown>;
}

export type RenderComponentRuntime =
  | RenderBuiltinComponentRuntime
  | RenderLocalComponentRuntime
  | RenderInlineComponentRuntime
  | RenderCodocComponentRuntime
  | RenderRemoteComponentRuntime;

export interface RenderBuiltinComponentRuntime {
  kind: "builtin";
  name: string;
}

export interface RenderLocalComponentRuntime {
  kind: "local";
  path: string;
}

export interface RenderInlineComponentRuntime {
  kind: "inline";
  code: string;
}

export interface RenderCodocComponentRuntime {
  kind: "codoc";
  ref: string;
}

export interface RenderRemoteComponentRuntime {
  kind: "remote";
  package?: string;
  url?: string;
  export?: string;
}

export interface RenderTableColumn {
  key: string;
  label: string;
}

export interface RenderTableRow {
  cells: unknown[];
}

export interface RenderTableNode {
  type: "table";
  title?: string;
  columns: RenderTableColumn[];
  rows: RenderTableRow[];
}

export type RenderViewNode =
  | RenderStackNode
  | RenderMarkdownNode
  | RenderGridNode
  | RenderTextNode
  | RenderJsonNode
  | RenderTableNode
  | RenderComponentNode;

export type RenderViewDocument = RenderStackNode;

export interface RenderResolvedViewInput {
  view: unknown;
  data?: unknown;
  components?: Record<string, ComponentSpec>;
  componentMeta?: Record<string, ComponentMeta>;
}

export function renderResolvedView(input: RenderResolvedViewInput): RenderViewDocument {
  const context = {
    data: input.data ?? null
  };

  if (input.view === null || input.view === undefined) {
    return {
      type: "stack",
      gap: "md",
      children: []
    };
  }

  if (typeof input.view === "string") {
    return {
      type: "stack",
      gap: "md",
      children: [
        {
          type: "markdown",
          content: interpolateTemplate(input.view, context)
        }
      ]
    };
  }

  if (isViewNodeSpec(input.view)) {
    const rendered = renderViewNode(input.view, context, input.components, input.componentMeta);
    if (rendered.type === "stack") {
      return rendered;
    }

    return {
      type: "stack",
      gap: "md",
      children: [rendered]
    };
  }

  return {
    type: "stack",
    gap: "md",
    children: [
      {
        type: "json",
        title: "Unrenderable view payload",
        value: input.view
      }
    ]
  };
}

function renderViewNode(
  spec: ViewNodeSpec,
  context: Record<string, unknown>,
  components: Record<string, ComponentSpec> | undefined,
  componentMeta: Record<string, ComponentMeta> | undefined
): RenderViewNode {
  switch (spec.type) {
    case "stack":
      return {
        type: "stack",
        gap: spec.gap ?? "md",
        children: spec.children.map((child) =>
          renderViewNode(child, context, components, componentMeta)
        )
      };
    case "markdown":
      return {
        type: "markdown",
        content: interpolateTemplate(spec.content, context)
      };
    case "grid":
      return {
        type: "grid",
        columns: spec.columns ?? 2,
        gap: spec.gap ?? "md",
        children: spec.children.map((child) =>
          renderViewNode(child, context, components, componentMeta)
        )
      };
    case "text":
      return {
        type: "text",
        content: interpolateTemplate(spec.content, context),
        tone: spec.tone ?? "default"
      };
    case "json":
      return {
        type: "json",
        ...(spec.title ? { title: interpolateTemplate(spec.title, context) } : {}),
        value: resolveTemplateValue(spec.value ?? "{data}", context)
      };
    case "table": {
      const resolvedRows = resolveTemplateValue(spec.rows, context);
      const normalizedRows = Array.isArray(resolvedRows) ? resolvedRows : [];

      return {
        type: "table",
        ...(spec.title ? { title: interpolateTemplate(spec.title, context) } : {}),
        columns: spec.columns.map((column) => ({
          key: column.key,
          label: interpolateTemplate(column.label ?? column.key, context)
        })),
        rows: normalizedRows.map((row) => ({
          cells: spec.columns.map((column) => resolveTableCell(row, column.key))
        }))
      };
    }
    case "component": {
      const resolvedComponent = resolveComponentReference(spec.component, components);
      const componentMetaEntry = resolvedComponent.alias
        ? componentMeta?.[resolvedComponent.alias]
        : null;
      const componentSchema =
        componentMetaEntry && isRecord(componentMetaEntry.props) ? componentMetaEntry.props : null;

      return {
        type: "component",
        source: resolvedComponent.source,
        ...(resolvedComponent.alias ? { alias: resolvedComponent.alias } : {}),
        component: resolvedComponent.component,
        runtime: resolvedComponent.runtime,
        ...(componentSchema ? { propsSchema: componentSchema } : {}),
        props: isRecord(spec.props)
          ? (resolveTemplateValue(spec.props, context) as Record<string, unknown>)
          : {}
      };
    }
  }
}

function resolveComponentReference(
  name: string,
  components: Record<string, ComponentSpec> | undefined
): Pick<RenderComponentNode, "source" | "alias" | "component" | "runtime"> {
  const spec = components?.[name];
  if (!spec) {
    return {
      source: "builtin",
      component: name,
      runtime: {
        kind: "builtin",
        name
      }
    };
  }

  switch (spec.kind) {
    case "builtin":
      return {
        source: "builtin",
        alias: name,
        component: spec.name ?? name,
        runtime: {
          kind: "builtin",
          name: spec.name ?? name
        }
      };
    case "local":
      return {
        source: "local",
        alias: name,
        component: spec.path ?? name,
        runtime: {
          kind: "local",
          path: spec.path ?? name
        }
      };
    case "inline":
      return {
        source: "inline",
        alias: name,
        component: name,
        runtime: {
          kind: "inline",
          code: spec.code ?? ""
        }
      };
    case "codoc":
      return {
        source: "codoc",
        alias: name,
        component: spec.ref ?? name,
        runtime: {
          kind: "codoc",
          ref: spec.ref ?? name
        }
      };
    case "remote":
      return {
        source: "remote",
        alias: name,
        component: spec.export ?? spec.package ?? spec.url ?? name,
        runtime: {
          kind: "remote",
          ...(spec.package !== undefined ? { package: spec.package } : {}),
          ...(spec.url !== undefined ? { url: spec.url } : {}),
          ...(spec.export !== undefined ? { export: spec.export } : {})
        }
      };
  }
}

function resolveTemplateValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exactExpression = value.match(/^\{([^}]+)\}$/);
    if (exactExpression) {
      const resolved = resolvePathExpression(exactExpression[1]?.trim() ?? "", context);
      return resolved === undefined ? value : resolved;
    }

    return interpolateTemplate(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveTemplateValue(entry, context));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveTemplateValue(entry, context)])
    );
  }

  return value;
}

function resolveTableCell(row: unknown, key: string): unknown {
  if (typeof key === "string" && key.length > 0) {
    const resolved = resolvePathExpression(`row.${key}`, {
      row
    });
    if (resolved !== undefined) {
      return resolved;
    }
  }

  if (isRecord(row) && key in row) {
    return row[key];
  }

  return "";
}

function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{([^}]+)\}/g, (_, expression) => {
    const resolved = resolvePathExpression(String(expression).trim(), context);
    return resolved === undefined ? `{${expression}}` : stringifyInterpolatedValue(resolved);
  });
}

function stringifyInterpolatedValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  return JSON.stringify(value);
}

function resolvePathExpression(expression: string, context: Record<string, unknown>): unknown {
  return expression.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, context);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isViewNodeSpec(value: unknown): value is ViewNodeSpec {
  return isRecord(value) && typeof value.type === "string";
}
