import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDate, parseTimeWindow, relativeTime } from '../src/utils/time.js';

describe('parseTimeWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses days correctly', () => {
    const result = parseTimeWindow('7d');
    const expected = new Date('2026-03-14T00:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('parses weeks correctly', () => {
    const result = parseTimeWindow('2w');
    const expected = new Date('2026-03-07T00:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('parses months correctly (30-day approximation)', () => {
    const result = parseTimeWindow('1m');
    const expected = new Date('2026-02-19T00:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('throws on invalid format', () => {
    expect(() => parseTimeWindow('abc')).toThrow('Invalid time window');
    expect(() => parseTimeWindow('7x')).toThrow('Invalid time window');
    expect(() => parseTimeWindow('')).toThrow('Invalid time window');
  });
});

describe('relativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for very recent times', () => {
    const date = new Date('2026-03-21T11:59:30Z');
    expect(relativeTime(date)).toBe('just now');
  });

  it('returns minutes ago', () => {
    const date = new Date('2026-03-21T11:55:00Z');
    expect(relativeTime(date)).toBe('5 minutes ago');
  });

  it('returns singular minute', () => {
    const date = new Date('2026-03-21T11:59:00Z');
    expect(relativeTime(date)).toBe('1 minute ago');
  });

  it('returns hours ago', () => {
    const date = new Date('2026-03-21T09:00:00Z');
    expect(relativeTime(date)).toBe('3 hours ago');
  });

  it('returns days ago', () => {
    const date = new Date('2026-03-18T12:00:00Z');
    expect(relativeTime(date)).toBe('3 days ago');
  });

  it('returns months ago', () => {
    // 59 days = floor(59/30) = 1 month; use 70+ days for 2 months
    const date = new Date('2026-01-10T12:00:00Z');
    expect(relativeTime(date)).toBe('2 months ago');
  });

  it('returns years ago', () => {
    const date = new Date('2024-03-21T12:00:00Z');
    expect(relativeTime(date)).toBe('2 years ago');
  });

  it('handles future dates', () => {
    const date = new Date('2026-03-22T12:00:00Z');
    expect(relativeTime(date)).toBe('in the future');
  });
});

describe('formatDate', () => {
  it('formats a valid ISO date', () => {
    // Use midday UTC to avoid timezone boundary issues
    const result = formatDate('2026-03-15T12:00:00Z');
    expect(result).toContain('Mar');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });

  it('throws on invalid date', () => {
    expect(() => formatDate('not-a-date')).toThrow('Invalid date');
  });
});
