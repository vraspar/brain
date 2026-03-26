import { describe, expect, it } from 'vitest';
import type { DigestEntry, Entry, StatsResult } from '../src/types.js';
import {
  formatDigest,
  formatSearchResults,
  formatStats,
} from '../src/utils/output.js';

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'test-entry',
    title: 'Test Entry',
    author: 'alice',
    created: '2026-03-01T00:00:00Z',
    updated: '2026-03-20T00:00:00Z',
    tags: ['testing'],
    type: 'guide',
    status: 'active',
    content: 'Body content.',
    filePath: 'guides/test-entry.md',
    ...overrides,
  };
}

describe('table title truncation', () => {
  const longTitle = 'A Very Long Title That Definitely Exceeds The Forty Character Limit For Tables';

  it('truncates long titles in search results', () => {
    const entries = [makeEntry({ title: longTitle })];
    const output = formatSearchResults(entries);
    // Should contain truncated version, not full title
    expect(output).not.toContain(longTitle);
    expect(output).toContain('...');
    // First 37 chars should still be present
    expect(output).toContain(longTitle.slice(0, 37));
  });

  it('does not truncate short titles in search results', () => {
    const shortTitle = 'Short Title';
    const entries = [makeEntry({ title: shortTitle })];
    const output = formatSearchResults(entries);
    expect(output).toContain(shortTitle);
    expect(output).not.toContain('Short Title...');
  });

  it('truncates long titles in digest table', () => {
    const digestEntry: DigestEntry = {
      ...makeEntry({ title: longTitle }),
      isNew: true,
      accessCount: 5,
      uniqueReaders: 3,
    };
    const output = formatDigest([digestEntry]);
    expect(output).not.toContain(longTitle);
    expect(output).toContain('...');
  });

  it('truncates long titles in stats table', () => {
    const stats: StatsResult[] = [{
      entryId: 'test',
      title: longTitle,
      accessCount: 10,
      uniqueReaders: 5,
      period: '7d',
    }];
    const output = formatStats(stats);
    expect(output).not.toContain(longTitle);
    expect(output).toContain('...');
  });

  it('handles title exactly at max length', () => {
    const exact40 = 'A'.repeat(40);
    const entries = [makeEntry({ title: exact40 })];
    const output = formatSearchResults(entries);
    expect(output).toContain(exact40);
    // Should NOT be truncated
    expect(output).not.toContain(exact40 + '...');
  });

  it('handles title one char over max length', () => {
    const over41 = 'B'.repeat(41);
    const entries = [makeEntry({ title: over41 })];
    const output = formatSearchResults(entries);
    expect(output).not.toContain(over41);
    expect(output).toContain('...');
  });

  it('does not truncate titles in JSON output', () => {
    const entries = [makeEntry({ title: longTitle })];
    const output = formatSearchResults(entries, { format: 'json' });
    const parsed = JSON.parse(output);
    // JSON should have the full title
    expect(parsed[0].title).toBe(longTitle);
  });
});
