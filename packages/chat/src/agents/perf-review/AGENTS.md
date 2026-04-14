# perf-review/

Performance review specialist agent — multi-phase review workflow producing structured codoc output.

Parent: [`../AGENTS.md`](../AGENTS.md) — agent catalog invariants.
Reads from: `../../state/`, `../../runner/` (for `ChatRunContext`), `../run-tool-loop.ts`.
Must never import from: `../../adapter/`.

## Modules

| File | What it owns |
|---|---|
| `rubric.ts` | Evaluation rubric — dimensions, weights, 1-5 scoring descriptors. **Edit this file to tune the evaluation model.** Changes take effect on server restart. |
| `perf-review.ts` | `createPerfReviewAgent` — Sonnet specialist with platform tools. Mode detection routes material-recording to parallel pipeline or single tool loop. |
| `parallel-material.ts` | Three-phase parallel pipeline for material recording: split (Haiku) → N concurrent workers (Sonnet) → merge + createCodoc. Falls back to single tool loop for ≤1 item. |
| `parallel-review.ts` | Four-phase parallel pipeline for individual review: identify+fetch → N concurrent fact-extraction workers → score → assemble + createCodoc. Falls back to single tool loop for ≤1 item. |
| `MATERIAL_TEMPLATE.md` | Human-facing material template aligned with the value-proof framework: baseline delivery, standout contributions, and future plans. |
| `index.ts` | Barrel re-export. |

## Material recording (mode zero) — parallel pipeline

When the user provides raw performance materials with multiple work items:

1. **SPLIT** (Haiku, ~2s): Identifies N independent items from raw text → JSON array.
2. **N WORKERS** (Sonnet, concurrent, ~20-30s each): Each worker structures one item — classifies category, generates MDX section and data entry. Capped at 5 concurrent. Uses `Promise.allSettled` for partial-failure tolerance.
3. **MERGE** (Sonnet tool loop): Programmatically assembles frontmatter + MDX from worker outputs, writes via `createCodoc` tool.

Fallback: ≤1 item or split failure → single `runToolLoop` with full system prompt.

## Individual review (mode one) — parallel pipeline

When the user asks to review a person's materials:

1. **IDENTIFY + FETCH** (Haiku + programmatic, ~5s): Find material codoc via `listCodocs`/`getCodoc` tools called programmatically (no LLM tool loop). Haiku splits the material content into N independent items.
2. **N WORKERS** (Sonnet, concurrent, ~15-20s each): Each worker does fact extraction for one item — strips embellishment, classifies evidence strength, generates `<ExtractedFact>` + `<Evidence>` MDX.
3. **SCORE** (Sonnet, single call, ~10s): Receives all extracted facts, scores 5 dimensions per rubric, generates `<ScoreCard>` MDX + summary.
4. **ASSEMBLE + CREATE** (programmatic + tool loop): Builds frontmatter (scores, `$ref` to source material) + MDX body, writes via `createCodoc`.

Fallback: ≤1 item, material not found, or pipeline failure → single `runToolLoop` with full system prompt.

## Calibration (mode two) — single tool loop

**Calibration** is inherently comparative and uses the standard `runToolLoop`: reads all review codocs, groups people by role/scope before comparing, builds a comparison matrix via `$ref` to review data fields, flags score distribution anomalies, writes a `校准报告 — {period}` codoc.

## Codoc output format

The agent produces codocs in **frontmatter + MDX** format:
- **Scores** are `data:` fields in frontmatter (machine-queryable)
- **Source tracing** uses `$ref` to point back to source material codocs
- **Calibration** uses `$ref` to aggregate scores from individual review codocs
- **MDX body** uses semantic components (`<ScoreCard>`, `<Evidence>`, `<CalibrationMatrix>`, etc.)

This enables the DAG to automatically track: source material → review → calibration dependency chain.

## Design decisions

- Rubric lives in `rubric.ts` as a string constant (not a runtime-loaded file) to avoid fs dependencies and bundling issues with tsup.
- Parallel pipeline is internal to the agent's `run()` — the graph executor sees it as a single node. No changes to `@cobook/graph`.
- Workers share platform tools safely (stateless closures over `PlatformToolDeps`).
- Mode detection uses keyword heuristics on the latest user message; the router has already classified the request as perf-review by the time it reaches this agent.
- MDX components referenced in the prompt (`<ScoreCard>`, `<ReviewHeader>`, etc.) are rendering-layer concerns — the agent produces the source, apps/web renders it.
