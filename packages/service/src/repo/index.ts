// Barrel for the repo layer.
//
// Each export is a thin facade over one storage store. Use cases
// import from here; nothing else in the monorepo should.
//
// New repo modules land here: one file per storage store, one export
// per file, matching the shape in ./AGENTS.md.

export { workspaceRepo } from "./workspace.js";
export { codocRepo } from "./codoc.js";
export { threadRepo } from "./thread.js";
