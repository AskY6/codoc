// ai-summary — optional AI-powered digest summary enhancement.
//
// Uses the Anthropic Messages API directly (raw fetch, no SDK dependency).
// Gracefully degrades: returns empty map when ANTHROPIC_API_KEY is absent,
// the call fails, or the response times out.
//
// The caller merges AI summaries over deterministic ones — AI never blocks
// the digest pipeline.

import { fetch, ProxyAgent, type Dispatcher } from "undici";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 30_000;

const proxyUrl =
  process.env["HTTPS_PROXY"] ||
  process.env["https_proxy"] ||
  process.env["HTTP_PROXY"] ||
  process.env["http_proxy"];
const dispatcher: Dispatcher | undefined = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SummaryInput {
  readonly id: string;
  readonly title: string;
  /** Preferred input — full fetched article body (markdown). */
  readonly body?: string | undefined;
  /** Fallback when body is unavailable — feed-supplied description (often noisy). */
  readonly description?: string | undefined;
  readonly source: string;
}

/**
 * Enhance article summaries with AI-generated one-liners.
 *
 * Returns a map of id → enhanced summary. Missing entries mean the AI
 * had nothing better than the deterministic fallback.
 *
 * Silently returns empty map when:
 * - ANTHROPIC_API_KEY env var is not set
 * - The API call fails or times out
 * - The response can't be parsed
 */
export async function enhanceSummaries(
  articles: readonly SummaryInput[],
): Promise<Map<string, string>> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey || articles.length === 0) return new Map();

  try {
    const prompt = buildPrompt(articles);

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(dispatcher ? { dispatcher } : {}),
    });

    if (!response.ok) {
      console.warn(`[digest-ai] API returned ${response.status}`);
      return new Map();
    }

    const data = (await response.json()) as ApiResponse;
    return parseResponse(data, articles);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(`[digest-ai] enhancement skipped: ${reason}`);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

// Cap each article's raw content fed into the prompt — longer ones rarely
// add value beyond ~6k chars and inflate token cost meaningfully.
const MAX_CONTENT_CHARS = 6000;

function buildPrompt(articles: readonly SummaryInput[]): string {
  const items = articles.map((a, i) => {
    const content = (a.body || a.description || "").slice(0, MAX_CONTENT_CHARS);
    return `[${i}] "${a.title}" (${a.source})\n${content || "(no content available)"}`;
  }).join("\n\n---\n\n");

  return `You are an editor writing daily digest summaries for a busy engineer. For each article below, write a 3-5 sentence paragraph (under 400 characters total) that captures:
- The core claim or finding
- The most important supporting detail or evidence
- Why this matters to someone in tech

Write naturally, as if briefing a colleague. Do NOT just restate the title. If the source content is too thin (e.g. only metadata or a stub), return an empty string for that entry.

Return ONLY a JSON array of strings, one per article, in the same order. No markdown fencing, no explanation.

Articles:
${items}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface ApiResponse {
  content?: Array<{ type: string; text?: string }>;
}

function parseResponse(
  data: ApiResponse,
  articles: readonly SummaryInput[],
): Map<string, string> {
  const result = new Map<string, string>();

  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) return result;

  try {
    // Extract JSON array from response (may have markdown fencing).
    const raw = textBlock.text.replace(/^```json?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
    const summaries = JSON.parse(raw) as unknown;

    if (!Array.isArray(summaries)) return result;

    for (let i = 0; i < Math.min(summaries.length, articles.length); i++) {
      const summary = summaries[i];
      if (typeof summary === "string" && summary.length > 0) {
        result.set(articles[i]!.id, summary);
      }
    }
  } catch {
    console.warn("[digest-ai] failed to parse AI summaries");
  }

  return result;
}
