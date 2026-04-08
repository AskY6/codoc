export { Timeline } from "./Timeline.js";
export { DataTable } from "./DataTable.js";
export { Section } from "./Section.js";
export { Stack } from "./Stack.js";
export { Grid } from "./Grid.js";
export { Tabs, Tab } from "./Tabs.js";
export { Navigate } from "./Navigate.js";
export { CodocActionsProvider, useCodocActions } from "./codoc-context.js";

import type { ComponentType } from "react";
import { Timeline } from "./Timeline.js";
import { DataTable } from "./DataTable.js";
import { Section } from "./Section.js";
import { Stack } from "./Stack.js";
import { Grid } from "./Grid.js";
import { Tabs, Tab } from "./Tabs.js";
import { Navigate } from "./Navigate.js";

/** All components available in MDX codocs. */
export const codocComponents: Record<string, ComponentType<any>> = {
  Timeline,
  DataTable,
  Section,
  Stack,
  Grid,
  Tabs,
  Tab,
  Navigate,
};
