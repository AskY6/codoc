// RSS workspace detection — heuristic for legacy workspaces without workspaceKind.

import type { Workspace } from "../../workspace/index.js";
import type { WorkspaceConfigFile } from "../types.js";
import { CodocPath } from "@cobook/core";

/**
 * Returns true if the workspace looks like an RSS workspace:
 * - Has inbox.codoc
 * - Has at least one codoc with a $source "rss" field
 */
export function detectRssWorkspace(
  workspace: Workspace,
  _config: WorkspaceConfigFile,
): boolean {
  // Check for inbox.codoc
  if (!workspace.codocs.has(CodocPath("inbox.codoc"))) return false;

  // Check for at least one rss source field
  for (const codoc of workspace.codocs.values()) {
    for (const field of codoc.ast.data.values()) {
      if (field.kind === "source" && field.source === "rss") return true;
    }
  }

  return false;
}
