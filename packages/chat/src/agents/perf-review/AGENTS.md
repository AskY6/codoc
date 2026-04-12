# perf-review/

Performance review specialist agent — two-phase review workflow producing structured codoc output.

Parent: [`../AGENTS.md`](../AGENTS.md) — agent catalog invariants.
Reads from: `../../state/`, `../../runner/` (for `ChatRunContext`), `../run-tool-loop.ts`.
Must never import from: `../../adapter/`.

## Modules

| File | What it owns |
|---|---|
| `rubric.ts` | Evaluation rubric — dimensions, weights, 1-5 scoring descriptors. **Edit this file to tune the evaluation model.** Changes take effect on server restart. |
| `perf-review.ts` | `createPerfReviewAgent` — Sonnet specialist with platform tools. Two-phase system prompt: individual review and horizontal calibration. Outputs codoc format (YAML frontmatter + MDX). |
| `index.ts` | Barrel re-export. |

## Two-phase workflow

**Phase 1 (individual review):** reads a subordinate's source codoc, strips embellished language, extracts structured facts, scores each rubric dimension 1-5 with evidence, writes a `Review: {name} — {period}` codoc.

**Phase 2 (calibration):** reads all review codocs, builds a comparison matrix via `$ref` to review data fields, flags score distribution anomalies, writes a `校准报告 — {period}` codoc.

## Codoc output format

The agent produces codocs in **frontmatter + MDX** format:
- **Scores** are `data:` fields in frontmatter (machine-queryable)
- **Source tracing** uses `$ref` to point back to source material codocs
- **Calibration** uses `$ref` to aggregate scores from individual review codocs
- **MDX body** uses semantic components (`<ScoreCard>`, `<Evidence>`, `<CalibrationMatrix>`, etc.)

This enables the DAG to automatically track: source material → review → calibration dependency chain.

## Design decisions

- Rubric lives in `rubric.ts` as a string constant (not a runtime-loaded file) to avoid fs dependencies and bundling issues with tsup.
- Same tool-loop infrastructure as general/rss agents — no special execution model.
- Platform tools only (listCodocs, getCodoc, createCodoc, updateCodoc, deleteCodoc) — no agent-specific tools needed.
- MDX components referenced in the prompt (`<ScoreCard>`, `<ReviewHeader>`, etc.) are rendering-layer concerns — the agent produces the source, apps/web renders it.
