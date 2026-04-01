import type { JsonSchema } from "../schema/types.js";
import type { DataSpec } from "../source-spec/types.js";

export type ViewSpec = string | FileViewSpec;

export interface FileViewSpec {
  kind: "file";
  path: string;
}

export interface ComponentSpec {
  kind: "local" | "inline" | "codoc" | "builtin" | "remote";
  path?: string;
  ref?: string;
  code?: string;
  name?: string;
  package?: string;
  url?: string;
  export?: string;
}

export interface ComponentMeta {
  props: JsonSchema;
}

export interface CodocMeta {
  data?: JsonSchema;
  view?: JsonSchema;
  component?: Record<string, ComponentMeta>;
  [key: string]: unknown;
}

export interface ParsedCodoc {
  codoc: string;
  id: string;
  filePath: string;
  meta?: CodocMeta;
  data?: Record<string, DataSpec>;
  component?: Record<string, ComponentSpec>;
  view?: ViewSpec;
}
