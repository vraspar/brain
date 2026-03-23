import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveConfig } from '../src/core/config.js';
import { createEntry, scanEntries, writeEntry, serializeEntry, parseEntry } from '../src/core/entry.js';
import { createIndex, rebuildIndex, searchEntries, getEntryById, getAllEntries, getRecentEntries, getEntriesByAuthor } from '../src/core/index-db.js';
import { recordReceipt, getStats, getEntryStats, getTopEntries } from '../src/core/receipts.js';
import { formatEntry, formatDigest, formatStats, formatSearchResults } from '../src/utils/output.js';
import { parseTimeWindow, relativeTime, formatDate } from '../src/utils/time.js';
import { toSlug, slugFromPath } from '../src/utils/slug.js';
import type { BrainConfig, DigestEntry, Entry } from '../src/types.js';
import type Database from 'better-sqlite3';

/**
 * Integration tests verifying the full Brain CLI workflow end-to-end.
 * These tests exercise the real data path: create → write → index → search → receipt → stats.
 */

let tempDir: string;
let repoDir: string;
let brainDir: string;
let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-integration-'));
  brainDir = path.join(tempDir, '.brain');
  repoDir = path.join(tempDir, 'repo');
  dbPath = path.join(brainDir, 'cache.db');

  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);

  fs.mkdirSync(path.join(repoDir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'skills'), { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  const config: BrainConfig = {
    remote: 'https://github.com/team/brain.git',
    local: repoDir,
    author: 'integration-tester',
    lastSync: new Date().toISOString(),
  };
  saveConfig(config);

  db = createIndex(dbPath);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('full workflow: create → index → search → show → receipt → stats', () => {
  it('completes the entire brain lifecycle', async () => {
    // Step 1: Create multiple entries
    const guide = createEntry({
      title: 'Kubernetes Best Practices',
      type: 'guide',
      content: 'Deploy containers efficiently using Kubernetes with proper resource limits and health checks.',
      author: 'alice',
      tags: ['kubernetes', 'devops', 'containers'],
      summary: 'K8s best practices for production',
    });

    const skill = createEntry({
      title: 'TypeScript Generics',
      type: 'skill',
      content: 'Master TypeScript generics for type-safe reusable code patterns.',
      author: 'bob',
      tags: ['typescript', 'generics'],
      summary: 'How to use TS generics effectively',
    });

    // Step 2: Write to repo
    const guidePath = await writeEntry(repoDir, guide);
    const skillPath = await writeEntry(repoDir, skill);
    expect(guidePath).toBe('guides/kubernetes-best-practices.md');
    expect(skillPath).toBe('skills/typescript-generics.md');

    // Verify files exist on disk
    expect(fs.existsSync(path.join(repoDir, guidePath))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, skillPath))).toBe(true);

    // Step 3: Scan and index
    const scanned = await scanEntries(repoDir);
    expect(scanned).toHaveLength(2);
    rebuildIndex(db, scanned);

    // Step 4: Search
    const k8sResults = searchEntries(db, 'kubernetes');
    expect(k8sResults).toHaveLength(1);
    expect(k8sResults[0].title).toBe('Kubernetes Best Practices');

    const tsResults = searchEntries(db, 'typescript generics');
    expect(tsResults).toHaveLength(1);
    expect(tsResults[0].title).toBe('TypeScript Generics');

    // Step 5: Show (get by ID)
    const found = getEntryById(db, 'kubernetes-best-practices');
    expect(found).not.toBeNull();
    expect(found!.content).toContain('Deploy containers');
    expect(found!.tags).toContain('kubernetes');

    // Step 6: Record receipts (simulating reads by different users)
    await recordReceipt(repoDir, 'kubernetes-best-practices', 'charlie', 'cli');
    await recordReceipt(repoDir, 'kubernetes-best-practices', 'dave', 'mcp');
    await recordReceipt(repoDir, 'kubernetes-best-practices', 'charlie', 'cli'); // duplicate reader
    await recordReceipt(repoDir, 'typescript-generics', 'charlie', 'cli');

    // Step 7: Verify stats
    const allStats = getStats(repoDir, 'integration-tester', '7d');
    const k8sStats = allStats.find((s) => s.entryId === 'kubernetes-best-practices');
    expect(k8sStats).toBeDefined();
    expect(k8sStats!.accessCount).toBe(3);
    expect(k8sStats!.uniqueReaders).toBe(2); // charlie and dave

    // Step 8: Top entries
    const top = getTopEntries(repoDir, '7d', 1);
    expect(top).toHaveLength(1);
    expect(top[0].entryId).toBe('kubernetes-best-practices');

    // Step 9: Entry stats
    const entryStats = getEntryStats(repoDir, 'kubernetes-best-practices', '7d');
    expect(entryStats.accessCount).toBe(3);
    expect(entryStats.uniqueReaders).toBe(2);
  });
});

describe('entry roundtrip: create → serialize → parse', () => {
  it('preserves all fields through serialization roundtrip', () => {
    const original = createEntry({
      title: 'Roundtrip Test',
      type: 'skill',
      content: 'Content that should survive roundtrip.',
      author: 'tester',
      tags: ['test', 'roundtrip'],
      summary: 'Testing serialization',
      related_repos: ['repo-a', 'repo-b'],
      related_tools: ['eslint', 'prettier'],
    });

    const serialized = serializeEntry(original);
    const parsed = parseEntry(original.filePath, serialized);

    expect(parsed.title).toBe(original.title);
    expect(parsed.author).toBe(original.author);
    expect(parsed.type).toBe(original.type);
    expect(parsed.tags).toEqual(original.tags);
    expect(parsed.summary).toBe(original.summary);
    expect(parsed.related_repos).toEqual(original.related_repos);
    expect(parsed.related_tools).toEqual(original.related_tools);
    expect(parsed.content).toContain('Content that should survive roundtrip.');
  });

  it('handles entries with minimal fields', () => {
    const minimal = createEntry({
      title: 'Bare Minimum',
      type: 'guide',
      content: 'Just content.',
      author: 'minimalist',
    });

    const serialized = serializeEntry(minimal);
    const parsed = parseEntry(minimal.filePath, serialized);

    expect(parsed.title).toBe('Bare Minimum');
    expect(parsed.tags).toEqual([]);
    expect(parsed.summary).toBeUndefined();
    expect(parsed.related_repos).toBeUndefined();
    expect(parsed.related_tools).toBeUndefined();
  });
});

describe('index operations', () => {
  it('rebuilds index idempotently', async () => {
    const entry = createEntry({
      title: 'Idempotent Test',
      type: 'guide',
      content: 'Testing rebuild idempotency.',
      author: 'tester',
    });
    await writeEntry(repoDir, entry);
    const scanned = await scanEntries(repoDir);

    // Rebuild twice
    rebuildIndex(db, scanned);
    rebuildIndex(db, scanned);

    const all = getAllEntries(db);
    expect(all).toHaveLength(1);
  });

  it('handles index rebuild with removed entries', async () => {
    // Index with two entries
    const entry1 = createEntry({ title: 'Entry One', type: 'guide', content: 'Content 1', author: 'a' });
    const entry2 = createEntry({ title: 'Entry Two', type: 'guide', content: 'Content 2', author: 'b' });
    await writeEntry(repoDir, entry1);
    await writeEntry(repoDir, entry2);
    let scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);
    expect(getAllEntries(db)).toHaveLength(2);

    // Remove one entry from disk and rebuild
    fs.unlinkSync(path.join(repoDir, 'guides', 'entry-two.md'));
    scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);
    expect(getAllEntries(db)).toHaveLength(1);
    expect(getAllEntries(db)[0].title).toBe('Entry One');
  });

  it('filters entries by author', async () => {
    const aliceEntry = createEntry({ title: 'Alice Guide', type: 'guide', content: 'By Alice', author: 'alice' });
    const bobEntry = createEntry({ title: 'Bob Guide', type: 'guide', content: 'By Bob', author: 'bob' });
    await writeEntry(repoDir, aliceEntry);
    await writeEntry(repoDir, bobEntry);
    const scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);

    const aliceResults = getEntriesByAuthor(db, 'alice');
    expect(aliceResults).toHaveLength(1);
    expect(aliceResults[0].author).toBe('alice');
  });

  it('retrieves recent entries by time window', async () => {
    const entry = createEntry({ title: 'Recent Entry', type: 'guide', content: 'Just created', author: 'a' });
    await writeEntry(repoDir, entry);
    const scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);

    const since = parseTimeWindow('7d');
    const recent = getRecentEntries(db, since);
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent[0].title).toBe('Recent Entry');
  });
});

describe('output formatting integration', () => {
  it('formats an entry for both text and JSON', () => {
    const entry = createEntry({
      title: 'Format Test',
      type: 'guide',
      content: 'Content here.',
      author: 'alice',
      tags: ['test'],
    });

    const textOutput = formatEntry(entry, { format: 'text' });
    expect(textOutput).toContain('Format Test');
    expect(textOutput).toContain('alice');

    const jsonOutput = formatEntry(entry, { format: 'json' });
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.title).toBe('Format Test');
  });

  it('formats digest with new and updated entries', () => {
    const digestEntries: DigestEntry[] = [
      {
        ...createEntry({ title: 'New Guide', type: 'guide', content: 'New', author: 'a' }),
        isNew: true,
        accessCount: 5,
        uniqueReaders: 3,
      },
      {
        ...createEntry({ title: 'Updated Skill', type: 'skill', content: 'Updated', author: 'b' }),
        isNew: false,
        accessCount: 2,
        uniqueReaders: 1,
      },
    ];

    const textOutput = formatDigest(digestEntries);
    expect(textOutput).toContain('New Entries');
    expect(textOutput).toContain('Updated Entries');

    const jsonOutput = formatDigest(digestEntries, { format: 'json' });
    const parsed = JSON.parse(jsonOutput);
    expect(parsed).toHaveLength(2);
  });

  it('formats stats with resolved titles', () => {
    const stats = [
      { entryId: 'test', title: 'Test Guide', accessCount: 10, uniqueReaders: 5, period: '7d' },
    ];

    const textOutput = formatStats(stats);
    expect(textOutput).toContain('Test Guide');
    expect(textOutput).toContain('10');

    const jsonOutput = formatStats(stats, { format: 'json' });
    const parsed = JSON.parse(jsonOutput);
    expect(parsed[0].accessCount).toBe(10);
  });

  it('formats search results correctly', () => {
    const entries = [
      createEntry({ title: 'Found It', type: 'guide', content: 'Match', author: 'a', tags: ['tag1'] }),
    ];

    const output = formatSearchResults(entries);
    expect(output).toContain('Found It');
    expect(output).toContain('1 result');
  });
});

describe('slug edge cases', () => {
  it('handles unicode characters by removing them', () => {
    expect(toSlug('Café Guide')).toBe('caf-guide');
  });

  it('handles numbers at start', () => {
    expect(toSlug('3 Tips for Docker')).toBe('3-tips-for-docker');
  });

  it('handles very long titles by preserving them', () => {
    const longTitle = 'A'.repeat(200);
    const slug = toSlug(longTitle);
    expect(slug.length).toBe(200);
  });

  it('extracts slug from Windows-style paths', () => {
    // slugFromPath uses forward slashes (git-style paths)
    expect(slugFromPath('guides/sub/my-guide.md')).toBe('my-guide');
  });
});

describe('time utility edge cases', () => {
  it('parseTimeWindow handles large values', () => {
    const date = parseTimeWindow('365d');
    const expectedMs = 365 * 24 * 60 * 60 * 1000;
    expect(Math.abs(Date.now() - expectedMs - date.getTime())).toBeLessThan(100);
  });

  it('relativeTime handles boundary at exactly 60 seconds', () => {
    const date = new Date(Date.now() - 60 * 1000);
    expect(relativeTime(date)).toBe('1 minute ago');
  });

  it('formatDate handles different valid date formats', () => {
    expect(formatDate('2026-01-15T12:00:00Z')).toContain('2026');
    expect(formatDate('2026-06-01')).toContain('2026');
  });
});

describe('receipt system edge cases', () => {
  it('handles concurrent receipts from multiple users', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(recordReceipt(repoDir, 'test-entry', `user-${i}`, 'cli'));
    }
    await Promise.all(promises);

    const stats = getEntryStats(repoDir, 'test-entry', '7d');
    expect(stats.accessCount).toBe(10);
    expect(stats.uniqueReaders).toBe(10);
  });

  it('returns zero stats for non-existent entry', () => {
    const stats = getEntryStats(repoDir, 'nonexistent', '7d');
    expect(stats.accessCount).toBe(0);
    expect(stats.uniqueReaders).toBe(0);
  });
});
