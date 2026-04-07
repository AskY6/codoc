import { z } from "zod";

// ---------------------------------------------------------------------------
// Supported view node types.
//
// This is the authoritative whitelist — the web view-renderer's switch is
// the only thing that can render these. Adding a new renderer case requires
// adding the type here. Keeping parsing strict makes it impossible to
// persist a codoc whose view the UI cannot render.
// ---------------------------------------------------------------------------
export const VIEW_TYPES = [
  "text",
  "markdown",
  "table",
  "stack",
  "grid",
  "tabs",
  "timeline",
  "section",
] as const;

export type ViewType = (typeof VIEW_TYPES)[number];

// ---------------------------------------------------------------------------
// Raw YAML Zod schemas (loose — normalised after parsing)
// ---------------------------------------------------------------------------

export const CodocMetaRawSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
});

// Recursive view node schema. Only `type` is constrained — everything else
// stays loose so agents have room to iterate on props/children/bind shape
// without tripping validation. The goal here is specifically to prevent
// unrenderable view types from reaching the UI.
export const ViewNodeRawSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      type: z.enum(VIEW_TYPES),
      props: z.record(z.string(), z.unknown()).optional(),
      children: z.array(ViewNodeRawSchema).optional(),
      bind: z.string().optional(),
      action: z.record(z.string(), z.unknown()).optional(),
      repeat: z
        .object({
          bind: z.string(),
          as: z.string(),
        })
        .optional(),
      template: ViewNodeRawSchema.optional(),
    })
    .passthrough(),
);

export const CodocRawSchema = z
  .object({
    meta: CodocMetaRawSchema.optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    view: ViewNodeRawSchema.optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Classified AST types
// ---------------------------------------------------------------------------

export interface CodocMeta {
  title?: string;
  description?: string;
  tags?: string[];
  schema?: Record<string, { type: string }>;
}

export interface StaticField {
  kind: "static";
  value: unknown;
}

export interface RefField {
  kind: "ref";
  $ref: string;
}

export interface SourceField {
  kind: "source";
  source: string;
  params: Record<string, unknown>;
}

export type DataField = StaticField | RefField | SourceField;

export interface CodocAST {
  meta?: CodocMeta;
  data?: Record<string, DataField>;
  view?: unknown;
}
