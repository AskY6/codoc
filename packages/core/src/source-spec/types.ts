import type { CodocRef } from "../ref/types.js";

export type DataSpec =
  | StaticSourceSpec
  | FileSourceSpec
  | HttpSourceSpec
  | CodocSourceSpec
  | ObjectShapeSpec;

export type SourceDataFormat = "text" | "json" | "yaml" | "csv";

export interface StaticSourceSpec {
  kind: "static";
  value: unknown;
}

export interface FileSourceSpec {
  kind: "file";
  path: string;
  format: SourceDataFormat;
}

export interface HttpSourceSpec {
  kind: "http";
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  format: SourceDataFormat;
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
