export { Timeline } from "./Timeline.js";
export { DataTable } from "./DataTable.js";
export { Section } from "./Section.js";
export { Stack } from "./Stack.js";
export { Grid } from "./Grid.js";
export { Tabs, Tab } from "./Tabs.js";
export { Navigate } from "./Navigate.js";
export { MetricBar } from "./MetricBar.js";
export { Callout } from "./Callout.js";
export { MarkdownContent } from "./MarkdownContent.js";
export { CodocActionsProvider, useCodocActions } from "./codoc-context.js";

import type { ComponentType } from "react";
import { Timeline } from "./Timeline.js";
import { DataTable } from "./DataTable.js";
import { Section } from "./Section.js";
import { Stack } from "./Stack.js";
import { Grid } from "./Grid.js";
import { Tabs, Tab } from "./Tabs.js";
import { Navigate } from "./Navigate.js";
import { MetricBar } from "./MetricBar.js";
import { Callout } from "./Callout.js";
import { MarkdownContent } from "./MarkdownContent.js";

// ---- Base components (all codocs can use) ----
const baseComponents: Record<string, ComponentType<any>> = {
  Timeline,
  DataTable,
  Section,
  Stack,
  Grid,
  Tabs,
  Tab,
  Navigate,
  MetricBar,
  Callout,
  MarkdownContent,
};

// ---- Agent-scoped components ----
const scopedComponents = new Map<string, Record<string, ComponentType<any>>>();

export function registerScopedComponents(
  tag: string,
  components: Record<string, ComponentType<any>>,
): void {
  scopedComponents.set(tag, { ...scopedComponents.get(tag), ...components });
}

/** Merge base + scoped components for the given codoc tags. */
export function getComponentsForTags(
  tags: string[],
): Record<string, ComponentType<any>> {
  const merged = { ...baseComponents };
  for (const tag of tags) {
    const scoped = scopedComponents.get(tag);
    if (scoped) Object.assign(merged, scoped);
  }
  return merged;
}

/** Backward-compat: full base set for codocs without tags. */
export const codocComponents = baseComponents;
