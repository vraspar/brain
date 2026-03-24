import { describe, expect, it } from 'vitest';
import {
  computeFreshness,
  freshnessIndicator,
  freshnessLabel,
  recencyScore,
  usageBoost,
  volatilityModifier,
} from '../src/core/freshness.js';
import type { Entry } from '../src/types.js';

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'test-entry',
    title: 'Test Entry',
    type: 'guide',
    author: 'alice',
    created: '2026-03-20T10:00:00Z',
    updated: '2026-03-20T10:00:00Z',
    tags: ['testing'],
    status: 'active',
    content: 'Test content',
    filePath: 'guides/test-entry.md',
    ...overrides,
  };
}

describe('recencyScore', () => {
  const now = new Date('2026-03-23T00:00:00Z');

  it('returns 1.0 for just-updated entries', () => {
    const score = recencyScore(now, now);
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('returns ~0.71 for 30-day-old entries', () => {
    const thirtyDaysAgo = new Date('2026-02-21T00:00:00Z');
    const score = recencyScore(thirtyDaysAgo, now);
    expect(score).toBeCloseTo(0.71, 1);
  });

  it('returns ~0.50 for 60-day-old entries (half-life)', () => {
    const sixtyDaysAgo = new Date('2026-01-22T00:00:00Z');
    const score = recencyScore(sixtyDaysAgo, now);
    expect(score).toBeCloseTo(0.50, 1);
  });

  it('returns ~0.25 for 120-day-old entries', () => {
    const hundredTwentyDaysAgo = new Date('2025-11-23T00:00:00Z');
    const score = recencyScore(hundredTwentyDaysAgo, now);
    expect(score).toBeCloseTo(0.25, 1);
  });

  it('returns very low score for very old entries', () => {
    const yearAgo = new Date('2025-03-23T00:00:00Z');
    const score = recencyScore(yearAgo, now);
    expect(score).toBeLessThan(0.05);
  });

  it('returns 1.0 for future dates', () => {
    const future = new Date('2026-04-01T00:00:00Z');
    const score = recencyScore(future, now);
    expect(score).toBe(1.0);
  });
});

describe('usageBoost', () => {
  it('returns 1.0 for zero reads (no boost)', () => {
    expect(usageBoost(0)).toBe(1.0);
  });

  it('returns > 1.0 for entries with reads', () => {
    expect(usageBoost(1)).toBeGreaterThan(1.0);
    expect(usageBoost(5)).toBeGreaterThan(1.0);
  });

  it('has diminishing returns (logarithmic)', () => {
    const boost1 = usageBoost(1);
    const boost5 = usageBoost(5);
    const boost10 = usageBoost(10);
    const boost50 = usageBoost(50);

    // Each step adds less boost (diminishing marginal returns)
    const gain1to5 = boost5 - boost1;
    const gain5to10 = boost10 - boost5;
    const gain10to50 = boost50 - boost10;

    // Per-unit gain decreases as reads increase
    expect(gain1to5 / 4).toBeGreaterThan(gain5to10 / 5);
    expect(gain5to10 / 5).toBeGreaterThan(gain10to50 / 40);
  });

  it('returns ~2.0 for 10 reads', () => {
    const boost = usageBoost(10);
    expect(boost).toBeGreaterThan(1.5);
    expect(boost).toBeLessThan(2.5);
  });
});

describe('volatilityModifier', () => {
  it('returns 1.0 for stable tags (architecture, patterns)', () => {
    expect(volatilityModifier(['architecture', 'design'])).toBe(1.0);
  });

  it('returns 0.7 for volatile tags (docker, kubernetes)', () => {
    expect(volatilityModifier(['docker', 'deployment'])).toBe(0.7);
  });

  it('returns 0.82 for neutral tags', () => {
    expect(volatilityModifier(['testing', 'react'])).toBe(0.82);
  });

  it('returns 0.82 when both stable and volatile tags present', () => {
    expect(volatilityModifier(['architecture', 'docker'])).toBe(0.82);
  });

  it('returns 0.82 for empty tags', () => {
    expect(volatilityModifier([])).toBe(0.82);
  });

  it('is case-insensitive', () => {
    expect(volatilityModifier(['Architecture'])).toBe(1.0);
    expect(volatilityModifier(['DOCKER'])).toBe(0.7);
  });
});

describe('computeFreshness', () => {
  const now = new Date('2026-03-23T00:00:00Z');

  it('scores a fresh, frequently-read entry high', () => {
    const entry = makeEntry({ updated: '2026-03-22T00:00:00Z' });
    const stats = { accessCount30d: 10, lastReadDaysAgo: 0 };
    const result = computeFreshness(entry, stats, now);

    expect(result.score).toBeGreaterThan(0.8);
    expect(result.label).toBe('fresh');
  });

  it('scores an old, never-read entry low', () => {
    const entry = makeEntry({
      updated: '2025-06-01T00:00:00Z',
      tags: ['docker', 'deployment'],
    });
    const result = computeFreshness(entry, undefined, now);

    expect(result.score).toBeLessThan(0.1);
    expect(result.label).toBe('stale');
  });

  it('CRITICAL: new unread content scores HIGHER than old content with reads', () => {
    // This is the inversion bug the radical thinker identified
    const newGuide = makeEntry({
      updated: '2026-03-02T00:00:00Z', // 3 weeks old
      tags: ['testing'],
    });
    const oldGuide = makeEntry({
      updated: '2024-03-23T00:00:00Z', // 2 years old
      tags: ['testing'],
    });

    const newScore = computeFreshness(newGuide, undefined, now); // 0 reads
    const oldScore = computeFreshness(oldGuide, { accessCount30d: 6, lastReadDaysAgo: 0 }, now); // 6 reads

    expect(newScore.score).toBeGreaterThan(oldScore.score);
    expect(newScore.label).not.toBe('stale');
  });

  it('usage boosts an aging entry but cannot make it fresh', () => {
    // 6-month-old entry — old enough to be stale without reads
    const agingEntry = makeEntry({
      updated: '2025-09-23T00:00:00Z',
      tags: ['testing'],
    });

    const withoutReads = computeFreshness(agingEntry, undefined, now);
    const withReads = computeFreshness(agingEntry, { accessCount30d: 10, lastReadDaysAgo: 0 }, now);

    // Reads should boost the score
    expect(withReads.score).toBeGreaterThan(withoutReads.score);
    // But a 6-month-old entry even with reads shouldn't be "fresh"
    expect(withReads.label).not.toBe('fresh');
  });

  it('returns score between 0 and 1', () => {
    const entry = makeEntry();
    const result = computeFreshness(entry, undefined, now);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('score is capped at 1.0 even with high boost', () => {
    const entry = makeEntry({ updated: now.toISOString() });
    const result = computeFreshness(entry, { accessCount30d: 100, lastReadDaysAgo: 0 }, now);
    expect(result.score).toBeLessThanOrEqual(1.0);
  });

  it('includes component breakdown', () => {
    const entry = makeEntry();
    const result = computeFreshness(entry, undefined, now);
    expect(result.components).toHaveProperty('recency');
    expect(result.components).toHaveProperty('usage');
    expect(result.components).toHaveProperty('volatility');
  });

  it('rounds score to 2 decimal places', () => {
    const entry = makeEntry();
    const result = computeFreshness(entry, undefined, now);
    const parts = result.score.toString().split('.');
    if (parts[1]) {
      expect(parts[1].length).toBeLessThanOrEqual(2);
    }
  });

  it('volatile content ages faster than stable content', () => {
    const volatileEntry = makeEntry({
      updated: '2026-01-23T00:00:00Z',
      tags: ['docker', 'deployment'],
    });
    const stableEntry = makeEntry({
      updated: '2026-01-23T00:00:00Z',
      tags: ['architecture', 'patterns'],
    });

    const volatileScore = computeFreshness(volatileEntry, undefined, now);
    const stableScore = computeFreshness(stableEntry, undefined, now);

    expect(stableScore.score).toBeGreaterThan(volatileScore.score);
  });
});

describe('freshnessLabel', () => {
  it('returns fresh for scores >= 0.6', () => {
    expect(freshnessLabel(0.6)).toBe('fresh');
    expect(freshnessLabel(0.8)).toBe('fresh');
    expect(freshnessLabel(1.0)).toBe('fresh');
  });

  it('returns aging for scores >= 0.3 and < 0.6', () => {
    expect(freshnessLabel(0.3)).toBe('aging');
    expect(freshnessLabel(0.45)).toBe('aging');
    expect(freshnessLabel(0.59)).toBe('aging');
  });

  it('returns stale for scores < 0.3', () => {
    expect(freshnessLabel(0.0)).toBe('stale');
    expect(freshnessLabel(0.15)).toBe('stale');
    expect(freshnessLabel(0.29)).toBe('stale');
  });
});

describe('freshnessIndicator', () => {
  it('returns green indicator for fresh', () => {
    expect(freshnessIndicator('fresh')).toContain('Fresh');
    expect(freshnessIndicator('fresh')).toContain('🟢');
  });

  it('returns yellow indicator for aging', () => {
    expect(freshnessIndicator('aging')).toContain('Aging');
    expect(freshnessIndicator('aging')).toContain('🟡');
  });

  it('returns red indicator for stale', () => {
    expect(freshnessIndicator('stale')).toContain('Stale');
    expect(freshnessIndicator('stale')).toContain('🔴');
  });
});
