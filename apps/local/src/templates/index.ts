// Template types re-export.
//
// Phase 2: the template registry itself is owned by `PluginHost` (plugins
// contribute templates through `manifest.contributes.templates[]`). This
// file keeps the public type re-export so `commands/init.ts`, the API
// route, and the host can share one symbol.

export type { Template, TemplateFile, Command, QuickAction } from "./types.js";
