import type { CodocRef } from "../ref/types.js";

export type DataSpec =
  | StaticSourceSpec
  | FileSourceSpec
  | CodocSourceSpec
  | ObjectShapeSpec;

export interface StaticSourceSpec {
  kind: "static";
  value: unknown;
}

export interface FileSourceSpec {
  kind: "file";
  path: string;
  format: "text" | "json" | "yaml" | "csv";
}

export interface CodocSourceSpec {
  kind: "codoc";
  ref: CodocRef;
  defaultValue?: unknown;
}

export interface ObjectShapeSpec {
  kind: "object";
  fields: Record<string, DataSpec>;
}
