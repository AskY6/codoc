// Template registry — lists and looks up built-in workspace templates.

import type { Template } from "./types.js";
import { rssTemplate } from "../../plugins/rss/template/index.js";
import { bookmarksTemplate } from "./bookmarks.js";

export type { Template, TemplateFile, Command, QuickAction } from "./types.js";

export const templates: readonly Template[] = [
  rssTemplate,
  bookmarksTemplate,
];

export function findTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}
