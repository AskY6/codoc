---
name: tree-context
description: Deep reference for authoring AGENTS.md files in a tree-based context-management layout. Use ONLY when (a) writing a new AGENTS.md from scratch, (b) reviewing an existing AGENTS.md for compliance with the tree pattern, or (c) deciding whether an AGENTS.md should be split (too long / new subdirectory with independent semantics) or merged back into its parent (stayed thin with no children). Do NOT use for routine "load the right docs for this task" — that's covered by the ambient rules in AGENTS.md and (eventually) by hooks.
---

# Tree Context — Authoring Reference

This skill is for **writing and maintaining** `AGENTS.md` files, not for the everyday "load the right subtree" posture. The ambient rules (tree shape, dependency headers, load path) live in the project root (`AGENTS.md`) so they are always in context. This document adds the authoring-time depth those one-liners leave out.

## Mental model

The tree is isomorphic to the directory tree. Each `AGENTS.md` is a **local contract**: what this directory guarantees to its parent, what it assumes about its siblings, what it delegates to its children. Three things flow differently across levels:

- **Abstractions flow up.** Parents hold cross-module contracts, global invariants, and an index of children. They do not hold child details.
- **Details flow down.** Leaves hold types, function signatures, local invariants. They do not restate parent rules.
- **Dependencies flow sideways, explicitly.** Every child declares who it may read from and who it must never import from, so AI can judge context boundaries without reading code.

A fact lives in exactly one place. If two `AGENTS.md` files are tempted to state the same rule, the rule belongs to their nearest common ancestor.

## Authoring checklist (new or edited `AGENTS.md`)

1. **Header declares direction.** First lines contain `Parent: ...`, `Reads from: ...`, `Must never import from: ...`. These are the only way AI knows the subtree's edges without reading source.
2. **Scope matches the directory's own semantics.** If a rule would be identical in any sibling directory, it belongs one level up. If a rule only applies to a single child subdirectory, it belongs one level down.
3. **Children are indexed, not inlined.** Each child gets a one-line description + relative link, nothing more. Inlining child content destroys the "load only the path" property of the tree.
4. **Cross-references use relative paths.** `see ../AGENTS.md#layering` is fine; copy-pasted rules are not. Duplication silently drifts.
5. **Length is a signal.**
   - `> 500` lines → this file is carrying content that belongs to a subdirectory. Split: create a subdirectory `AGENTS.md`, move the relevant section there, replace it here with an index entry.
   - `< 100` lines, no children, no independent semantics → fold the file into the parent and delete the shell. Empty scaffolds cost more than they save.
6. **No sibling leakage.** If editing `packages/foo/AGENTS.md` makes you want to mention `packages/bar` internals, stop — that rule belongs to `packages/AGENTS.md` (the common ancestor), not to `foo` nor to `bar`.

## Split decision — worked example

Suppose `packages/service/src/usecases/AGENTS.md` has grown to 600 lines because it documents every usecase inline (`codoc/`, `workspace/`, `chat/`, ...).

Signals that a split is overdue:
- Length > 500 lines.
- Subdirectories with independent semantics already exist on disk.
- The file contains rules that apply to exactly one subdirectory.

Resolution:
1. For each subdirectory with independent semantics, create `usecases/<sub>/AGENTS.md` with its own `Parent: ../AGENTS.md` header.
2. Move the relevant section from the parent into each new child, verbatim.
3. In the parent, replace those sections with a one-line index entry pointing at the child.
4. Re-check the parent's remaining content: anything that is now duplicated in a child must be deleted from the parent (single source of truth).
5. Verify each new child is still < 500 lines and each child's `Must never import from:` is inherited correctly from the parent or tightened locally.

## Merge decision — worked example

Suppose `packages/service/src/types/AGENTS.md` has stayed at ~40 lines for months, has no subdirectories, and its rules are already implicit in the parent's type conventions.

Signals that a merge is appropriate:
- File < 100 lines.
- No subdirectories.
- Content is mostly restating parent rules or listing trivia that belongs inline with the parent's index.

Resolution:
1. Lift any genuinely unique content up into the parent's section on that directory.
2. Delete the leaf `AGENTS.md`.
3. Update the parent's index: the entry becomes a description instead of a link.

## Review questions (when auditing an existing tree)

- Does every directory with independent semantics have an `AGENTS.md`? Every `AGENTS.md` live under a directory with independent semantics?
- Does every `AGENTS.md` start with `Parent:` / `Reads from:` / `Must never import from:`?
- For each parent, is every child referenced in the index? For each child, does the parent exist at the declared path?
- Are there rules repeated in more than one file? If yes, lift to the nearest common ancestor.
- Is any file > 500 or < 100 lines? Apply the split/merge worked example.
- Do sibling files mention each other's internals? If yes, lift the shared rule to the parent and delete the leakage.

## Out of scope

- **Runtime loading** (deciding which `AGENTS.md` to read for a given task) — handled by ambient `AGENTS.md` rules and future hooks, not by this skill.
- **Project-specific invariants** (layering rules, naming conventions, domain vocabulary) — these belong in the project's own `AGENTS.md` tree, not here. This skill only teaches the *shape* of the tree, not its contents.
- **Tree linting and scaffolding** — those are separate commands (`/agents-lint`, `/agents-new`) that a future plugin will bundle alongside this skill.
