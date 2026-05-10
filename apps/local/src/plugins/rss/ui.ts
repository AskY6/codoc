// RSS plugin UI descriptor — inbox-first layout with domain actions.

import type { WorkspaceUiSpec } from "../types.js";

export const rssUiSpec: WorkspaceUiSpec = {
  homeView: "inbox",
  hiddenPaths: ["guide.codoc"],
  primaryActions: [
    {
      kind: "rest",
      id: "refresh",
      label: "Refresh feeds",
      method: "POST",
      path: "/api/plugins/rss/refresh",
    },
    {
      kind: "rest",
      id: "digest",
      label: "Update digest",
      method: "POST",
      path: "/api/plugins/rss/digest",
    },
    {
      kind: "chat-prompt",
      id: "subscribe",
      label: "Subscribe",
      prompt: "Subscribe to ",
    },
  ],
};
