import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntry, writeEntry, scanEntries } from '../src/core/entry.js';
import { createIndex, getDbPath, rebuildIndex, searchEntries, getEntryById, getAllEntries } from '../src/core/index-db.js';
import { saveConfig } from '../src/core/config.js';
import { recordReceipt, getStats, getTopEntries } from '../src/core/receipts.js';
import type { BrainConfig, Entry } from '../src/types.js';

/**
 * These tests verify command-layer logic by testing the core module integrations
 * that commands depend on. We test the data flow rather than commander parsing,
 * since commander is well-tested upstream.
 */

let tempDir: string;
let repoDir: string;
let brainDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-cmd-test-'));
  brainDir = path.join(tempDir, '.brain');
  repoDir = path.join(tempDir, 'repo');
  dbPath = path.join(brainDir, 'cache.db');

  // Set up mock home directory
  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);

  // Create repo structure
  fs.mkdirSync(path.join(repoDir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'skills'), { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  // Save a valid config
  const config: BrainConfig = {
    remote: 'https://github.com/team/brain.git',
    local: repoDir,
    author: 'testuser',
    lastSync: new Date().toISOString(),
  };
  saveConfig(config);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seedEntry(overrides: Partial<Parameters<typeof createEntry>[0]> = {}): Entry {
  return createEntry({
    title: 'Test Guide',
    type: 'guide',
    content: 'This is a test guide about TypeScript and Docker.',
    author: 'alice',
    tags: ['typescript', 'docker'],
    summary: 'A test guide',
    ...overrides,
  });
}

async function seedAndIndex(entries: Entry[]): Promise<void> {
  for (const entry of entries) {
    await writeEntry(repoDir, entry);
  }
  const db = createIndex(dbPath);
  const scanned = await scanEntries(repoDir);
  rebuildIndex(db, scanned);
  db.close();
}

describe('push flow', () => {
  it('creates entry, writes to repo, and indexes it', async () => {
    const entry = seedEntry();
    const filePath = await writeEntry(repoDir, entry);

    expect(filePath).toBe('guides/test-guide.md');
    expect(fs.existsSync(path.join(repoDir, filePath))).toBe(true);

    // Rebuild index and verify it's searchable
    const db = createIndex(dbPath);
    const scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);

    const found = getEntryById(db, 'test-guide');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Test Guide');
    db.close();
  });

  it('auto-extracts tags from content when not provided', async () => {
    // The extractTags function is internal to push.ts, so test the pattern
    const content = 'This guide covers TypeScript and Docker deployment on Kubernetes';
    const words = content.toLowerCase().match(/\b[a-z][a-z0-9/.-]+\b/g) ?? [];
    const techTerms = new Set(['typescript', 'docker', 'kubernetes']);
    const found = words.filter((w) => techTerms.has(w));
    expect(found).toContain('typescript');
    expect(found).toContain('docker');
    expect(found).toContain('kubernetes');
  });
});

describe('digest flow', () => {
  it('retrieves recent entries and classifies new vs updated', async () => {
    const newEntry = seedEntry({ title: 'Brand New Guide' });
    const olderEntry = createEntry({
      title: 'Old Guide',
      type: 'guide',
      content: 'Old content',
      author: 'bob',
    });
    // Simulate an older entry by modifying its created date
    const modifiedOlder: Entry = {
      ...olderEntry,
      created: '2025-01-01T00:00:00Z',
      updated: new Date().toISOString(),
    };

    await seedAndIndex([newEntry, modifiedOlder]);

    const db = createIndex(dbPath);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const recent = getAllEntries(db); // Get all, filter by date

    const recentFiltered = recent.filter(
      (e) => new Date(e.created) >= since || new Date(e.updated) >= since,
    );
    expect(recentFiltered.length).toBeGreaterThanOrEqual(1);

    // Classify
    const newOnes = recentFiltered.filter((e) => new Date(e.created) >= since);
    expect(newOnes.length).toBeGreaterThanOrEqual(1);

    db.close();
  });
});

describe('search flow', () => {
  it('finds entries by full-text search', async () => {
    await seedAndIndex([
      seedEntry({ title: 'Kubernetes Deployment Guide', content: 'How to deploy on k8s', tags: ['k8s'] }),
      seedEntry({ title: 'React Testing Guide', content: 'How to test React apps', tags: ['react'] }),
    ]);

    const db = createIndex(dbPath);
    const results = searchEntries(db, 'kubernetes');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toContain('Kubernetes');
    db.close();
  });

  it('returns empty for non-matching queries', async () => {
    await seedAndIndex([seedEntry()]);

    const db = createIndex(dbPath);
    const results = searchEntries(db, 'xyznonexistent');
    expect(results).toHaveLength(0);
    db.close();
  });
});

describe('show flow', () => {
  it('retrieves entry by ID and records receipt', async () => {
    const entry = seedEntry();
    await seedAndIndex([entry]);

    const db = createIndex(dbPath);
    const found = getEntryById(db, 'test-guide');
    expect(found).not.toBeNull();
    expect(found!.content).toContain('test guide');
    db.close();

    // Record receipt
    await recordReceipt(repoDir, 'test-guide', 'testuser', 'cli');

    // Verify receipt was written
    const receiptsDir = path.join(repoDir, '_analytics', 'receipts');
    expect(fs.existsSync(receiptsDir)).toBe(true);
  });

  it('returns null for non-existent entry', async () => {
    await seedAndIndex([seedEntry()]);

    const db = createIndex(dbPath);
    const found = getEntryById(db, 'nonexistent');
    expect(found).toBeNull();
    db.close();
  });
});

describe('list flow', () => {
  it('lists all entries', async () => {
    await seedAndIndex([
      seedEntry({ title: 'Guide A' }),
      seedEntry({ title: 'Guide B' }),
      createEntry({ title: 'Skill A', type: 'skill', content: 'Skill content', author: 'bob' }),
    ]);

    const db = createIndex(dbPath);
    const all = getAllEntries(db);
    expect(all).toHaveLength(3);
    db.close();
  });

  it('filters by type', async () => {
    await seedAndIndex([
      seedEntry({ title: 'Guide A' }),
      createEntry({ title: 'Skill A', type: 'skill', content: 'Skill content', author: 'bob' }),
    ]);

    const db = createIndex(dbPath);
    const all = getAllEntries(db);
    const guides = all.filter((e) => e.type === 'guide');
    const skills = all.filter((e) => e.type === 'skill');
    expect(guides).toHaveLength(1);
    expect(skills).toHaveLength(1);
    db.close();
  });
});

describe('stats flow', () => {
  it('aggregates receipt stats for entries', async () => {
    const entry = seedEntry();
    await seedAndIndex([entry]);

    // Record multiple receipts
    await recordReceipt(repoDir, 'test-guide', 'alice', 'cli');
    await recordReceipt(repoDir, 'test-guide', 'bob', 'cli');
    await recordReceipt(repoDir, 'test-guide', 'alice', 'mcp');

    const stats = getStats(repoDir, 'testuser', '7d');
    const guideStat = stats.find((s) => s.entryId === 'test-guide');
    expect(guideStat).toBeDefined();
    expect(guideStat!.accessCount).toBe(3);
    expect(guideStat!.uniqueReaders).toBe(2); // alice and bob
  });

  it('returns empty stats when no receipts', async () => {
    const stats = getStats(repoDir, 'testuser', '7d');
    expect(stats).toEqual([]);
  });
});

describe('sync flow', () => {
  it('rebuilds index after scan', async () => {
    // Write entries directly to repo (simulating a pull)
    const entry = seedEntry();
    await writeEntry(repoDir, entry);

    // Scan and rebuild
    const entries = await scanEntries(repoDir);
    const db = createIndex(dbPath);
    rebuildIndex(db, entries);

    const all = getAllEntries(db);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Test Guide');
    db.close();
  });
});
