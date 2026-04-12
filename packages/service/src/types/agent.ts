import type { AgentListing } from "@cobook/core";

export interface AgentListItem {
  readonly listing: AgentListing;
  readonly createdAt: number;
}
