import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntry, writeEntry, scanEntries } from '../src/core/entry.js';
import {
  createIndex,
  getAllEntries,
  getDbPath,
  getEntriesByAuthor,
  getRecentEntries,
  rebuildIndex,
} from '../src/core/index-db.js';
import { saveConfig } from '../src/core/config.js';
import { getReadEntryIds, recordReceipt, getEntryStats } from '../src/core/receipts.js';
import { formatDigestSummary } from '../src/utils/output.js';
import type { BrainConfig, DigestEntry, Entry } from '../src/types.js';

let tempDir: string;
let repoDir: string;
let brainDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-filters-test-'));
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
    author: 'testuser',
    lastSync: new Date().toISOString(),
  };
  saveConfig(config);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<Parameters<typeof createEntry>[0]> = {}): Entry {
  return createEntry({
    title: 'Test Guide',
    type: 'guide',
    content: 'This is a test guide.',
    author: 'alice',
    tags: ['typescript'],
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

function toDigestEntries(entries: Entry[]): DigestEntry[] {
  return entries.map((entry) => ({
    ...entry,
    accessCount: 0,
    uniqueReaders: 0,
    isNew: true,
  }));
}

// ─── Tag filtering ───

describe('tag filtering', () => {
  it('filters entries by single tag', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Docker Guide', tags: ['docker', 'devops'] }),
      makeEntry({ title: 'React Guide', tags: ['react', 'frontend'] }),
      makeEntry({ title: 'K8s Guide', tags: ['kubernetes', 'devops'] }),
    ]);

    const db = createIndex(dbPath);
    const all = getAllEntries(db);
    db.close();

    const filtered = all.filter((e) =>
      e.tags.some((t) => t.toLowerCase() === 'devops'),
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.map((e) => e.title).sort()).toEqual(['Docker Guide', 'K8s Guide']);
  });

  it('is case-insensitive', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Docker Guide', tags: ['Docker'] }),
    ]);

    const db = createIndex(dbPath);
    const all = getAllEntries(db);
    db.close();

    const filtered = all.filter((e) =>
      e.tags.some((t) => t.toLowerCase() === 'docker'),
    );

    expect(filtered).toHaveLength(1);
  });

  it('returns empty for non-matching tag', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Docker Guide', tags: ['docker'] }),
    ]);

    const db = createIndex(dbPath);
    const all = getAllEntries(db);
    db.close();

    const filtered = all.filter((e) =>
      e.tags.some((t) => t.toLowerCase() === 'nonexistent'),
    );

    expect(filtered).toHaveLength(0);
  });
});

// ─── Type filtering ───

describe('type filtering', () => {
  it('filters entries by type', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Guide A', type: 'guide' }),
      makeEntry({ title: 'Skill A', type: 'skill' }),
      makeEntry({ title: 'Skill B', type: 'skill' }),
    ]);

    const db = createIndex(dbPath);
    const all = getAllEntries(db);
    db.close();

    const skills = all.filter((e) => e.type === 'skill');
    expect(skills).toHaveLength(2);

    const guides = all.filter((e) => e.type === 'guide');
    expect(guides).toHaveLength(1);
  });
});

// ─── Author filtering ───

describe('author filtering', () => {
  it('filters by author using getEntriesByAuthor', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Alice Guide', author: 'alice' }),
      makeEntry({ title: 'Bob Guide', author: 'bob' }),
      makeEntry({ title: 'Alice Skill', author: 'alice', type: 'skill' }),
    ]);

    const db = createIndex(dbPath);
    const aliceEntries = getEntriesByAuthor(db, 'alice');
    const bobEntries = getEntriesByAuthor(db, 'bob');
    db.close();

    expect(aliceEntries).toHaveLength(2);
    expect(bobEntries).toHaveLength(1);
  });
});

// ─── --mine filter ───

describe('--mine filter', () => {
  it('resolves to current user from config', async () => {
    await seedAndIndex([
      makeEntry({ title: 'My Guide', author: 'testuser' }),
      makeEntry({ title: 'Their Guide', author: 'alice' }),
    ]);

    const db = createIndex(dbPath);
    // --mine resolves to config.author = 'testuser'
    const mineEntries = getEntriesByAuthor(db, 'testuser');
    db.close();

    expect(mineEntries).toHaveLength(1);
    expect(mineEntries[0].title).toBe('My Guide');
  });
});

// ─── --unread filter ───

describe('--unread filter (getReadEntryIds)', () => {
  it('returns empty set when no receipts exist', () => {
    const readIds = getReadEntryIds(repoDir, 'testuser');
    expect(readIds.size).toBe(0);
  });

  it('returns entry IDs that a reader has read', async () => {
    await recordReceipt(repoDir, 'k8s-guide', 'testuser', 'cli');
    await recordReceipt(repoDir, 'react-guide', 'testuser', 'mcp');
    await recordReceipt(repoDir, 'docker-guide', 'alice', 'cli');

    const readIds = getReadEntryIds(repoDir, 'testuser');

    expect(readIds.has('k8s-guide')).toBe(true);
    expect(readIds.has('react-guide')).toBe(true);
    expect(readIds.has('docker-guide')).toBe(false); // alice read this, not testuser
  });

  it('filters entries to only unread', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Read Guide', tags: ['read'] }),
      makeEntry({ title: 'Unread Guide', tags: ['unread'] }),
    ]);

    // Record receipt for the first entry
    await recordReceipt(repoDir, 'read-guide', 'testuser', 'cli');

    const db = createIndex(dbPath);
    const all = getAllEntries(db);
    db.close();

    const readIds = getReadEntryIds(repoDir, 'testuser');
    const unread = all.filter((e) => !readIds.has(e.id));

    expect(unread).toHaveLength(1);
    expect(unread[0].title).toBe('Unread Guide');
  });

  it('handles multiple receipts for same entry', async () => {
    await recordReceipt(repoDir, 'k8s-guide', 'testuser', 'cli');
    await recordReceipt(repoDir, 'k8s-guide', 'testuser', 'mcp');

    const readIds = getReadEntryIds(repoDir, 'testuser');
    expect(readIds.has('k8s-guide')).toBe(true);
    expect(readIds.size).toBe(1);
  });
});

// ─── Combined filters ───

describe('combined filters', () => {
  it('applies tag + type together', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Docker Guide', type: 'guide', tags: ['docker', 'devops'] }),
      makeEntry({ title: 'Docker Skill', type: 'skill', tags: ['docker'] }),
      makeEntry({ title: 'React Guide', type: 'guide', tags: ['react'] }),
    ]);

    const db = createIndex(dbPath);
    let entries = getAllEntries(db);
    db.close();

    // Filter by tag 'docker' AND type 'guide'
    entries = entries.filter((e) =>
      e.tags.some((t) => t.toLowerCase() === 'docker'),
    );
    entries = entries.filter((e) => e.type === 'guide');

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Docker Guide');
  });

  it('applies author + tag together', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Alice Docker', author: 'alice', tags: ['docker'] }),
      makeEntry({ title: 'Bob Docker', author: 'bob', tags: ['docker'] }),
      makeEntry({ title: 'Alice React', author: 'alice', tags: ['react'] }),
    ]);

    const db = createIndex(dbPath);
    let entries = getEntriesByAuthor(db, 'alice');
    db.close();

    entries = entries.filter((e) =>
      e.tags.some((t) => t.toLowerCase() === 'docker'),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Alice Docker');
  });

  it('applies unread + tag together', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Read Docker', tags: ['docker'] }),
      makeEntry({ title: 'Unread Docker', tags: ['docker'] }),
      makeEntry({ title: 'Unread React', tags: ['react'] }),
    ]);

    await recordReceipt(repoDir, 'read-docker', 'testuser', 'cli');

    const db = createIndex(dbPath);
    let entries = getAllEntries(db);
    db.close();

    // Filter by tag 'docker'
    entries = entries.filter((e) =>
      e.tags.some((t) => t.toLowerCase() === 'docker'),
    );
    // Filter unread
    const readIds = getReadEntryIds(repoDir, 'testuser');
    entries = entries.filter((e) => !readIds.has(e.id));

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Unread Docker');
  });

  it('returns empty when all filters combined exclude everything', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Only Guide', type: 'guide', author: 'alice', tags: ['docker'] }),
    ]);

    const db = createIndex(dbPath);
    let entries = getAllEntries(db);
    db.close();

    // Filter by type 'skill' — excludes the only entry
    entries = entries.filter((e) => e.type === 'skill');

    expect(entries).toHaveLength(0);
  });
});

// ─── Digest filters with recent entries ───

describe('digest filter flow', () => {
  it('filters recent entries by tag', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Docker Guide', tags: ['docker'] }),
      makeEntry({ title: 'React Guide', tags: ['react'] }),
    ]);

    const db = createIndex(dbPath);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let recent = getRecentEntries(db, since);
    db.close();

    const filterTags = new Set(['docker']);
    recent = recent.filter((e) =>
      e.tags.some((t) => filterTags.has(t.toLowerCase())),
    );

    expect(recent).toHaveLength(1);
    expect(recent[0].title).toBe('Docker Guide');
  });

  it('filters recent entries by type', async () => {
    await seedAndIndex([
      makeEntry({ title: 'My Guide', type: 'guide' }),
      makeEntry({ title: 'My Skill', type: 'skill' }),
    ]);

    const db = createIndex(dbPath);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let recent = getRecentEntries(db, since);
    db.close();

    recent = recent.filter((e) => e.type === 'skill');

    expect(recent).toHaveLength(1);
    expect(recent[0].title).toBe('My Skill');
  });

  it('filters recent entries by author', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Alice Guide', author: 'alice' }),
      makeEntry({ title: 'Bob Guide', author: 'bob' }),
    ]);

    const db = createIndex(dbPath);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let recent = getRecentEntries(db, since);
    db.close();

    recent = recent.filter((e) => e.author === 'alice');

    expect(recent).toHaveLength(1);
    expect(recent[0].title).toBe('Alice Guide');
  });

  it('filters recent entries with --unread', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Already Read' }),
      makeEntry({ title: 'Not Yet Read' }),
    ]);

    await recordReceipt(repoDir, 'already-read', 'testuser', 'cli');

    const db = createIndex(dbPath);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let recent = getRecentEntries(db, since);
    db.close();

    const readIds = getReadEntryIds(repoDir, 'testuser');
    recent = recent.filter((e) => !readIds.has(e.id));

    expect(recent).toHaveLength(1);
    expect(recent[0].title).toBe('Not Yet Read');
  });

  it('applies multiple digest tags (repeatable --tag)', async () => {
    await seedAndIndex([
      makeEntry({ title: 'Docker Guide', tags: ['docker'] }),
      makeEntry({ title: 'K8s Guide', tags: ['kubernetes'] }),
      makeEntry({ title: 'React Guide', tags: ['react'] }),
    ]);

    const db = createIndex(dbPath);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let recent = getRecentEntries(db, since);
    db.close();

    // Multiple tags: match docker OR kubernetes
    const filterTags = new Set(['docker', 'kubernetes']);
    recent = recent.filter((e) =>
      e.tags.some((t) => filterTags.has(t.toLowerCase())),
    );

    expect(recent).toHaveLength(2);
    expect(recent.map((e) => e.title).sort()).toEqual(['Docker Guide', 'K8s Guide']);
  });
});

// ─── Summary format ───

describe('formatDigestSummary', () => {
  it('formats entries in compact one-line format', () => {
    const entries: DigestEntry[] = [
      {
        ...makeEntry({ title: 'Docker Guide', author: 'alice', tags: ['docker', 'devops'] }),
        accessCount: 5,
        uniqueReaders: 3,
        isNew: true,
      },
      {
        ...makeEntry({ title: 'React Guide', author: 'bob', tags: ['react'] }),
        accessCount: 2,
        uniqueReaders: 1,
        isNew: false,
      },
    ];

    const output = formatDigestSummary(entries);

    // Should contain both entry titles
    expect(output).toContain('Docker Guide');
    expect(output).toContain('React Guide');
    // Should contain authors
    expect(output).toContain('alice');
    expect(output).toContain('bob');
    // Should contain tags with # prefix (in ANSI-escaped form)
    expect(output).toContain('#docker');
    expect(output).toContain('#react');
  });

  it('returns dim message for empty entries', () => {
    const output = formatDigestSummary([]);
    expect(output).toContain('No entries found');
  });

  it('limits tags to 3 per entry', () => {
    const entries: DigestEntry[] = [
      {
        ...makeEntry({
          title: 'Many Tags',
          tags: ['docker', 'kubernetes', 'devops', 'cicd', 'helm'],
        }),
        accessCount: 0,
        uniqueReaders: 0,
        isNew: true,
      },
    ];

    const output = formatDigestSummary(entries);

    expect(output).toContain('#docker');
    expect(output).toContain('#kubernetes');
    expect(output).toContain('#devops');
    expect(output).not.toContain('#cicd');
    expect(output).not.toContain('#helm');
  });
});
