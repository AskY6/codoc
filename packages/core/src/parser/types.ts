import type { JsonSchema } from "../schema/types.js";
import type { DataSpec } from "../source-spec/types.js";

export type ViewSpec = string | FileViewSpec | ViewNodeSpec;

export type ViewSpacing = "sm" | "md" | "lg";
export type ViewTextTone = "default" | "muted" | "eyebrow" | "title";
export type ViewGridColumns = 1 | 2 | 3;

export type ViewNodeSpec =
  | ViewStackSpec
  | ViewSectionSpec
  | ViewGridSpec
  | ViewTabsSpec
  | ViewMarkdownSpec
  | ViewTextSpec
  | ViewJsonSpec
  | ViewTimelineSpec
  | ViewTableSpec
  | ViewComponentNodeSpec;

export interface FileViewSpec {
  kind: "file";
  path: string;
}

export interface ViewStackSpec {
  type: "stack";
  children: ViewNodeSpec[];
  gap?: ViewSpacing;
}

export interface ViewGridSpec {
  type: "grid";
  children: ViewNodeSpec[];
  columns?: ViewGridColumns;
  gap?: ViewSpacing;
}

export interface ViewSectionSpec {
  type: "section";
  title?: string;
  eyebrow?: string;
  children: ViewNodeSpec[];
  gap?: ViewSpacing;
}

export interface ViewTabSpec {
  id?: string;
  label: string;
  children: ViewNodeSpec[];
}

export interface ViewTabsSpec {
  type: "tabs";
  tabs: ViewTabSpec[];
}

export interface ViewMarkdownSpec {
  type: "markdown";
  content: string;
}

export interface ViewTextSpec {
  type: "text";
  content: string;
  tone?: ViewTextTone;
}

export interface ViewJsonSpec {
  type: "json";
  title?: string;
  value?: unknown;
}

export interface ViewTimelineItemSpec {
  id?: string;
  title: string;
  meta?: string;
  body?: string;
  children?: ViewNodeSpec[];
}

export interface ViewTimelineSpec {
  type: "timeline";
  items: ViewTimelineItemSpec[];
}

export interface ViewTableColumnSpec {
  key: string;
  label?: string;
}

export interface ViewTableSpec {
  type: "table";
  title?: string;
  columns: ViewTableColumnSpec[];
  rows: unknown;
}

export interface ViewComponentNodeSpec {
  type: "component";
  component: string;
  props?: Record<string, unknown>;
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
