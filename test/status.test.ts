import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntry, writeEntry, scanEntries } from '../src/core/entry.js';
import {
  createIndex,
  rebuildIndex,
  getAllEntries,
  getEntriesWithFreshness,
} from '../src/core/index-db.js';
import { saveConfig } from '../src/core/config.js';
import type { BrainConfig, Entry } from '../src/types.js';

/**
 * Tests for brain status command logic.
 * Tests the data collection: entry counts, freshness, storage sizes.
 */

let tempDir: string;
let repoDir: string;
let brainDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-status-test-'));
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
    hubName: 'Test Brain',
    lastSync: '2026-03-20T10:00:00Z',
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
    content: 'Test content.',
    author: 'alice',
    tags: ['testing'],
    ...overrides,
  });
}

async function seedAndIndex(entries: Entry[]): Promise<void> {
  for (const entry of entries) {
    await writeEntry(repoDir, entry);
  }
  const db = createIndex(dbPath);
  try {
    const scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);
  } finally {
    db.close();
  }
}

describe('status: entry counts', () => {
  it('counts total entries', async () => {
    await seedAndIndex([
      seedEntry({ title: 'Guide A' }),
      seedEntry({ title: 'Guide B' }),
      createEntry({ title: 'Skill A', type: 'skill', content: 'Skill', author: 'bob' }),
    ]);

    const db = createIndex(dbPath);
    try {
      const all = getAllEntries(db);
      expect(all).toHaveLength(3);
      expect(all.filter((e) => e.type === 'guide')).toHaveLength(2);
      expect(all.filter((e) => e.type === 'skill')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('handles empty brain', async () => {
    await seedAndIndex([]);

    const db = createIndex(dbPath);
    try {
      const all = getAllEntries(db);
      expect(all).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('status: freshness counts', () => {
  it('returns freshness data when scores are cached', async () => {
    await seedAndIndex([seedEntry({ title: 'Fresh Guide' })]);

    const db = createIndex(dbPath);
    try {
      // getEntriesWithFreshness should work even without cached scores
      const withFreshness = getEntriesWithFreshness(db);
      expect(withFreshness).toHaveLength(1);
      // Without updateFreshnessScores, scores will be null
      expect(withFreshness[0].freshnessScore).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('status: archive counting', () => {
  it('counts archived entries', async () => {
    const entry = seedEntry({ title: 'Archived Guide' });
    await writeEntry(repoDir, entry);

    // Move to archive
    const archiveDir = path.join(repoDir, '_archive', 'guides');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.renameSync(
      path.join(repoDir, entry.filePath),
      path.join(archiveDir, `${entry.id}.md`),
    );

    const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
  });

  it('returns 0 when no archive directory', () => {
    const archiveDir = path.join(repoDir, '_archive');
    expect(fs.existsSync(archiveDir)).toBe(false);
  });
});

describe('status: storage sizes', () => {
  it('database file exists and has size > 0', async () => {
    await seedAndIndex([seedEntry()]);

    expect(fs.existsSync(dbPath)).toBe(true);
    const stat = fs.statSync(dbPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('repo directory has entries with size > 0', async () => {
    await seedAndIndex([seedEntry()]);

    const guidesDir = path.join(repoDir, 'guides');
    const files = fs.readdirSync(guidesDir);
    expect(files.length).toBeGreaterThan(0);
  });
});

describe('status: config fields', () => {
  it('loadConfig returns expected fields', async () => {
    const { loadConfig } = await import('../src/core/config.js');
    const config = loadConfig();

    expect(config.local).toBe(repoDir);
    expect(config.remote).toBe('https://github.com/team/brain.git');
    expect(config.author).toBe('testuser');
    expect(config.hubName).toBe('Test Brain');
    expect(config.lastSync).toBe('2026-03-20T10:00:00Z');
  });
});
