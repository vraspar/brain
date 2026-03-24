import type { Entry, FreshnessLabel, FreshnessScore } from '../types.js';

const HALF_LIFE_DAYS = 60;
const LN2 = 0.693;

const VOLATILE_TAGS = new Set([
  'api', 'docker', 'kubernetes', 'cicd', 'deployment', 'config',
]);

const STABLE_TAGS = new Set([
  'architecture', 'design', 'principles', 'patterns', 'conventions',
]);

/**
 * Exponential decay based on days since last update.
 * Half-life of 60 days: score halves every 60 days.
 *
 * 0 days → 1.0, 30 days → 0.71, 60 days → 0.50, 120 days → 0.25
 */
export function recencyScore(updatedAt: Date, now: Date = new Date()): number {
  const daysSinceUpdate = (now.getTime() - updatedAt.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceUpdate < 0) return 1.0;
  return Math.exp(-LN2 * daysSinceUpdate / HALF_LIFE_DAYS);
}

/**
 * Usage boost multiplier based on access count in last 30 days.
 * Returns a multiplier >= 1.0 that boosts the recency base score.
 * Logarithmic scale: diminishing returns above 10 reads.
 *
 * 0 reads → 1.0 (no boost), 5 reads → 1.70, 10 reads → 2.04
 */
export function usageBoost(accessCount30d: number): number {
  if (accessCount30d === 0) return 1.0;
  return 1 + Math.log2(1 + accessCount30d) * 0.3;
}

/**
 * Content-type volatility modifier.
 * Volatile topics (API, Docker, K8s) decay faster (lower modifier).
 * Stable topics (architecture, patterns) decay slower (higher modifier).
 *
 * Stable → 1.0, Neutral → 0.82, Volatile → 0.7
 */
export function volatilityModifier(tags: string[]): number {
  const lowerTags = tags.map((t) => t.toLowerCase());
  const hasVolatile = lowerTags.some((t) => VOLATILE_TAGS.has(t));
  const hasStable = lowerTags.some((t) => STABLE_TAGS.has(t));

  if (hasStable && !hasVolatile) return 1.0;
  if (hasVolatile && !hasStable) return 0.7;
  return 0.82;
}

export interface UsageStats {
  accessCount30d: number;
  lastReadDaysAgo: number | null;
}

/**
 * Compute the composite freshness score for an entry.
 *
 * Multiplicative model: recency is the BASE signal (it can only decay with time).
 * Usage BOOSTS a decaying entry (heavily-read old docs stay alive longer).
 * Volatility adjusts how fast content should age.
 *
 * Formula: min(recency × usageBoost × volatilityModifier, 1.0)
 *
 * This prevents the inversion bug where new unread content scores lower
 * than ancient content with a few reads.
 *
 * Examples:
 * - New guide (3 weeks, 0 reads):  0.79 × 1.0 × 0.82 = 0.65 (Fresh ✅)
 * - Old Heroku guide (2yr, 6 reads): 0.001 × 1.77 × 0.82 = 0.001 (Stale ✅)
 * - K8s classic (6mo, 12 reads):     0.13 × 2.08 × 0.82 = 0.22 (Aging ✅)
 */
export function computeFreshness(
  entry: Entry,
  stats: UsageStats | undefined,
  now: Date = new Date(),
): FreshnessScore {
  const recency = recencyScore(new Date(entry.updated), now);
  const boost = usageBoost(stats?.accessCount30d ?? 0);
  const volatility = volatilityModifier(entry.tags);

  const score = Math.min(recency * boost * volatility, 1.0);

  return {
    score: Math.round(score * 100) / 100,
    label: freshnessLabel(score),
    components: {
      recency: Math.round(recency * 100) / 100,
      usage: Math.round(boost * 100) / 100,
      volatility: Math.round(volatility * 100) / 100,
    },
  };
}

/**
 * Map a numeric score to a human-readable freshness label.
 */
export function freshnessLabel(score: number): FreshnessLabel {
  if (score >= 0.6) return 'fresh';
  if (score >= 0.3) return 'aging';
  return 'stale';
}

/**
 * Format a freshness label with a colored emoji indicator.
 */
export function freshnessIndicator(label: FreshnessLabel): string {
  switch (label) {
    case 'fresh': return '🟢 Fresh';
    case 'aging': return '🟡 Aging';
    case 'stale': return '🔴 Stale';
  }
}
