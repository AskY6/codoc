import { z } from "zod";

// ---------------------------------------------------------------------------
// Raw YAML Zod schemas (loose — normalised after parsing)
// ---------------------------------------------------------------------------

export const CodocMetaRawSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
});

export const CodocRawSchema = z
  .object({
    meta: CodocMetaRawSchema.optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    view: z.unknown().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Classified AST types
// ---------------------------------------------------------------------------

export interface CodocMeta {
  title?: string;
  description?: string;
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
