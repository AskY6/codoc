// Shared utilities for perf-review parallel pipelines.

/** Strip markdown code fences (```json ... ```) and parse JSON. */
export function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}
