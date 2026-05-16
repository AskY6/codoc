// ranking — multi-signal article scoring for digest generation.
//
// Signals: recency (exponential decay), starred boost, description quality.
// Source diversity: no single source exceeds 40% of highlights.
//
// Pure functions, zero I/O.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankableArticle {
  readonly title?: string;
  readonly link?: string;
  readonly pubDate?: string;
  readonly description?: string;
  readonly readAt?: string | null;
  readonly starred?: boolean;
  readonly feedTitle: string;
}

export interface ScoredArticle extends RankableArticle {
  readonly score: number;
}

export interface RankedDigest {
  readonly highlights: ScoredArticle[];
  readonly trending: ScoredArticle[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const HALF_LIFE_HOURS = 48;
const RECENCY_WEIGHT = 40;
const STARRED_BONUS = 20;
const DESCRIPTION_BONUS = 5;

/**
 * Score a single article. Higher = more prominent in digest.
 *
 * - Recency: 40 * exp(-hoursAgo / 48) — fresh articles score ~40, 2-day old ~20
 * - Starred: +20 — user signal is strongest
 * - Has description: +5 — articles with real content rank above title-only
 */
export function scoreArticle(article: RankableArticle, now: number = Date.now()): number {
  let score = 0;

  // Recency — exponential decay.
  if (article.pubDate) {
    const ageMs = now - new Date(article.pubDate).getTime();
    const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
    score += RECENCY_WEIGHT * Math.exp(-ageHours / HALF_LIFE_HOURS);
  }

  // Starred boost.
  if (article.starred) {
    score += STARRED_BONUS;
  }

  // Description quality — has meaningful content beyond just a title.
  if (article.description && article.description.length > 30) {
    score += DESCRIPTION_BONUS;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Ranking with diversity
// ---------------------------------------------------------------------------

const MAX_SOURCE_SHARE = 0.4; // No source exceeds 40% of highlights.

/**
 * Rank articles into highlights and trending buckets.
 *
 * 1. Score all unread articles.
 * 2. Sort by score desc.
 * 3. Pick highlights with source diversity enforcement.
 * 4. Trending = starred articles not in highlights, then highest remaining scores.
 */
export function rankForDigest(
  articles: readonly RankableArticle[],
  maxHighlights: number,
  maxTrending: number,
): RankedDigest {
  const now = Date.now();

  // Score all articles (caller should pre-filter to unread for highlights).
  const scored: ScoredArticle[] = articles.map((a) => ({
    ...a,
    score: scoreArticle(a, now),
  }));

  // Sort by score descending, stable tie-break by pubDate.
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.001) return diff;
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });

  // Pick highlights with source diversity cap.
  const highlights = pickWithDiversity(scored, maxHighlights, MAX_SOURCE_SHARE);
  const highlightSet = new Set(highlights.map((h) => h.link ?? h.title));

  // Trending: starred articles not in highlights, then highest remaining.
  const remaining = scored.filter(
    (a) => !highlightSet.has(a.link ?? a.title),
  );

  const starredRemaining = remaining.filter((a) => a.starred);
  const nonStarredRemaining = remaining.filter((a) => !a.starred);

  const trending = [
    ...starredRemaining.slice(0, maxTrending),
    ...nonStarredRemaining,
  ].slice(0, maxTrending);

  return { highlights, trending };
}

// ---------------------------------------------------------------------------
// Diversity enforcement
// ---------------------------------------------------------------------------

function pickWithDiversity(
  sorted: readonly ScoredArticle[],
  max: number,
  maxShare: number,
): ScoredArticle[] {
  const result: ScoredArticle[] = [];
  const sourceCounts = new Map<string, number>();
  const cap = Math.ceil(max * maxShare);
  const skipped: ScoredArticle[] = [];

  // Pass 1: respect per-source cap.
  for (const article of sorted) {
    if (result.length >= max) break;

    const source = article.feedTitle;
    const count = sourceCounts.get(source) ?? 0;

    if (count >= cap) {
      skipped.push(article);
      continue;
    }

    result.push(article);
    sourceCounts.set(source, count + 1);
  }

  // Pass 2: backfill from skipped articles (by score order) to fill remaining slots.
  for (const article of skipped) {
    if (result.length >= max) break;
    result.push(article);
  }

  return result;
}
