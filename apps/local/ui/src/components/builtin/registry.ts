import type { ComponentType } from "react";
import { Badge } from "./Badge.tsx";
import { Progress } from "./Progress.tsx";
import { Table } from "./Table.tsx";
import { Card } from "./Card.tsx";
import { Chart } from "./Chart.tsx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PropSpec {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

export interface ComponentMeta {
  readonly name: string;
  readonly description: string;
  readonly props: readonly PropSpec[];
  readonly template: string;
  /** Value types this component is designed for. */
  readonly dataTypeHints: readonly string[];
}

export interface RegisteredComponent {
  readonly component: ComponentType<Record<string, unknown>>;
  readonly meta: ComponentMeta;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const registry: readonly RegisteredComponent[] = [
  {
    component: Badge as ComponentType<Record<string, unknown>>,
    meta: {
      name: "Badge",
      description: "Colored pill displaying a value — status, score, or label.",
      props: [
        { name: "value", type: "string | number", required: true },
        { name: "label", type: "string", required: false },
        { name: "color", type: "blue | green | red | amber | purple | neutral", required: false },
      ],
      template: "<Badge value={data.FIELD} />",
      dataTypeHints: ["string", "number", "boolean"],
    },
  },
  {
    component: Progress as ComponentType<Record<string, unknown>>,
    meta: {
      name: "Progress",
      description: "Horizontal progress bar with value and max.",
      props: [
        { name: "value", type: "number", required: true },
        { name: "max", type: "number", required: false },
        { name: "label", type: "string", required: false },
      ],
      template: "<Progress value={data.FIELD} max={100} />",
      dataTypeHints: ["number"],
    },
  },
  {
    component: Table as ComponentType<Record<string, unknown>>,
    meta: {
      name: "Table",
      description: "Data table auto-generated from an array of objects.",
      props: [
        { name: "data", type: "Array<Record<string, unknown>>", required: true },
        { name: "columns", type: "string[]", required: false },
      ],
      template: "<Table data={data.FIELD} />",
      dataTypeHints: ["array"],
    },
  },
  {
    component: Card as ComponentType<Record<string, unknown>>,
    meta: {
      name: "Card",
      description: "Information card with title, value, and description.",
      props: [
        { name: "title", type: "string", required: false },
        { name: "value", type: "string | number", required: false },
        { name: "description", type: "string", required: false },
      ],
      template: '<Card title="Title" value={data.FIELD} />',
      dataTypeHints: ["number", "string", "object"],
    },
  },
  {
    component: Chart as ComponentType<Record<string, unknown>>,
    meta: {
      name: "Chart",
      description: "Simple bar chart from {label, value} data.",
      props: [
        { name: "data", type: "Array<{label: string, value: number}>", required: true },
        { name: "height", type: "number", required: false },
      ],
      template: "<Chart data={data.FIELD} />",
      dataTypeHints: ["array"],
    },
  },
];

/** Name → React component, for injection into MDX scope. */
export const componentMap: Record<string, ComponentType<Record<string, unknown>>> =
  Object.fromEntries(registry.map((r) => [r.meta.name, r.component]));

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

/** Suggest component names suitable for a given runtime value. */
export function recommendFor(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    const names: string[] = ["Table"];
    if (
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0] !== null &&
      "label" in value[0] &&
      "value" in value[0]
    ) {
      names.unshift("Chart");
    }
    return names;
  }
  if (typeof value === "number") return ["Progress", "Badge"];
  if (typeof value === "string") return ["Badge"];
  if (typeof value === "boolean") return ["Badge"];
  return [];
}
