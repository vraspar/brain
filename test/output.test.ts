import { describe, expect, it } from 'vitest';
import type { DigestEntry, Entry, StatsResult } from '../src/types.js';
import { formatDigest, formatEntry, formatSearchResults, formatStats } from '../src/utils/output.js';

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'test-entry',
    title: 'Test Entry',
    author: 'alice',
    created: '2026-03-01T00:00:00Z',
    updated: '2026-03-20T00:00:00Z',
    tags: ['testing', 'demo'],
    type: 'guide',
    status: 'active',
    content: 'This is the body content.',
    filePath: 'guides/test-entry.md',
    ...overrides,
  };
}

function makeDigestEntry(overrides: Partial<DigestEntry> = {}): DigestEntry {
  return {
    ...makeEntry(),
    isNew: true,
    accessCount: 5,
    uniqueReaders: 3,
    ...overrides,
  };
}

describe('formatEntry', () => {
  it('renders text output by default', () => {
    const output = formatEntry(makeEntry());
    expect(output).toContain('Test Entry');
    expect(output).toContain('alice');
    expect(output).toContain('This is the body content.');
  });

  it('renders JSON when format is json', () => {
    const output = formatEntry(makeEntry(), { format: 'json' });
    const parsed = JSON.parse(output);
    expect(parsed.title).toBe('Test Entry');
    expect(parsed.author).toBe('alice');
  });

  it('includes summary when present', () => {
    const output = formatEntry(makeEntry({ summary: 'A short summary' }));
    expect(output).toContain('A short summary');
  });

  it('includes related repos when present', () => {
    const output = formatEntry(makeEntry({ related_repos: ['repo-a', 'repo-b'] }));
    expect(output).toContain('repo-a');
    expect(output).toContain('repo-b');
  });

  it('includes related tools when present', () => {
    const output = formatEntry(makeEntry({ related_tools: ['eslint', 'prettier'] }));
    expect(output).toContain('eslint');
    expect(output).toContain('prettier');
  });
});

describe('formatDigest', () => {
  it('shows empty message when no entries', () => {
    const output = formatDigest([]);
    expect(output).toContain('No entries found');
  });

  it('separates new and updated entries', () => {
    const entries = [
      makeDigestEntry({ title: 'New Guide', isNew: true }),
      makeDigestEntry({ title: 'Updated Guide', isNew: false }),
    ];
    const output = formatDigest(entries);
    expect(output).toContain('New Entries');
    expect(output).toContain('Updated Entries');
    expect(output).toContain('New Guide');
    expect(output).toContain('Updated Guide');
  });

  it('returns JSON when format is json', () => {
    const entries = [makeDigestEntry()];
    const output = formatDigest(entries, { format: 'json' });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].title).toBe('Test Entry');
  });
});

describe('formatStats', () => {
  it('shows empty message when no stats', () => {
    const output = formatStats([]);
    expect(output).toContain('No stats available');
  });

  it('renders stats table', () => {
    const stats: StatsResult[] = [
      { entryId: 'test', title: 'Test', accessCount: 10, uniqueReaders: 5, period: '7d' },
    ];
    const output = formatStats(stats);
    expect(output).toContain('Test');
    expect(output).toContain('10');
    expect(output).toContain('5');
  });

  it('returns JSON when format is json', () => {
    const stats: StatsResult[] = [
      { entryId: 'test', title: 'Test', accessCount: 10, uniqueReaders: 5, period: '7d' },
    ];
    const output = formatStats(stats, { format: 'json' });
    const parsed = JSON.parse(output);
    expect(parsed[0].accessCount).toBe(10);
  });
});

describe('formatSearchResults', () => {
  it('shows empty message when no results', () => {
    const output = formatSearchResults([]);
    expect(output).toContain('No matching entries');
  });

  it('renders search results table', () => {
    const entries = [makeEntry({ title: 'Found Entry', tags: ['a', 'b', 'c', 'd'] })];
    const output = formatSearchResults(entries);
    expect(output).toContain('Found Entry');
    expect(output).toContain('1 result');
  });

  it('shows correct plural for multiple results', () => {
    const entries = [makeEntry({ title: 'One' }), makeEntry({ title: 'Two', id: 'two' })];
    const output = formatSearchResults(entries);
    expect(output).toContain('2 results');
  });

  it('returns JSON when format is json', () => {
    const entries = [makeEntry()];
    const output = formatSearchResults(entries, { format: 'json' });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('suppresses header but keeps table when quiet', () => {
    const entries = [makeEntry({ title: 'Quiet Entry' })];
    const output = formatSearchResults(entries, { quiet: true });
    expect(output).toContain('Quiet Entry');
    expect(output).not.toContain('Found');
    expect(output).not.toContain('result');
  });

  it('returns empty string for no results when quiet', () => {
    const output = formatSearchResults([], { quiet: true });
    expect(output).toBe('');
  });

  it('quiet does not affect JSON output', () => {
    const entries = [makeEntry()];
    const output = formatSearchResults(entries, { format: 'json', quiet: true });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].title).toBe('Test Entry');
  });
});
