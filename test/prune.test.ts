import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntry, writeEntry, scanEntries } from '../src/core/entry.js';
import {
  createIndex,
  rebuildIndex,
  getAllEntries,
  updateFreshnessScores,
  getEntriesWithFreshness,
} from '../src/core/index-db.js';
import { saveConfig } from '../src/core/config.js';
import { recordReceipt } from '../src/core/receipts.js';
import { buildUsageStatsMap } from '../src/core/freshness-stats.js';
import type { BrainConfig, Entry } from '../src/types.js';
import type Database from 'better-sqlite3';

let tempDir: string;
let repoDir: string;
let brainDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-prune-test-'));
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
  };
  saveConfig(config);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeOldEntry(title: string, daysOld: number): Entry {
  const created = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  const entry = createEntry({
    title,
    type: 'guide',
    content: `Content for ${title}`,
    author: 'alice',
    tags: ['docker', 'deployment'],
  });
  return { ...entry, created, updated: created };
}

function makeFreshEntry(title: string): Entry {
  return createEntry({
    title,
    type: 'guide',
    content: `Content for ${title}`,
    author: 'bob',
    tags: ['architecture', 'patterns'],
  });
}

async function seedAndIndex(entries: Entry[]): Promise<Database.Database> {
  for (const entry of entries) {
    await writeEntry(repoDir, entry);
  }
  const db = createIndex(dbPath);
  const scanned = await scanEntries(repoDir);
  rebuildIndex(db, scanned);
  return db;
}

describe('updateFreshnessScores', () => {
  it('computes and caches freshness scores for all entries', async () => {
    const entries = [
      makeFreshEntry('Fresh Guide'),
      makeOldEntry('Old Docker Guide', 180),
    ];
    const db = await seedAndIndex(entries);

    try {
      const statsMap = buildUsageStatsMap(repoDir, '30d');
      updateFreshnessScores(db, statsMap);

      const withFreshness = getEntriesWithFreshness(db);
      expect(withFreshness).toHaveLength(2);

      for (const entry of withFreshness) {
        expect(entry.freshnessScore).not.toBeNull();
        expect(entry.freshnessLabel).not.toBeNull();
        expect(typeof entry.freshnessScore).toBe('number');
      }
    } finally {
      db.close();
    }
  });

  it('fresh entries get higher scores than old entries', async () => {
    const entries = [
      makeFreshEntry('Fresh Guide'),
      makeOldEntry('Old Guide', 180),
    ];
    const db = await seedAndIndex(entries);

    try {
      const statsMap = buildUsageStatsMap(repoDir, '30d');
      updateFreshnessScores(db, statsMap);

      const withFreshness = getEntriesWithFreshness(db);
      const fresh = withFreshness.find((e) => e.title === 'Fresh Guide');
      const old = withFreshness.find((e) => e.title === 'Old Guide');

      expect(fresh!.freshnessScore!).toBeGreaterThan(old!.freshnessScore!);
    } finally {
      db.close();
    }
  });

  it('entries with reads get boosted scores', async () => {
    const entry = makeOldEntry('Read Guide', 90);
    const db = await seedAndIndex([entry]);

    try {
      // Record some reads
      await recordReceipt(repoDir, entry.id, 'user1', 'cli');
      await recordReceipt(repoDir, entry.id, 'user2', 'cli');
      await recordReceipt(repoDir, entry.id, 'user3', 'cli');

      const statsMapWithReads = buildUsageStatsMap(repoDir, '30d');
      updateFreshnessScores(db, statsMapWithReads);
      const withReads = getEntriesWithFreshness(db);

      // Compare with no reads
      const db2 = createIndex(dbPath);
      try {
        const emptyStats = new Map();
        updateFreshnessScores(db2, emptyStats);
        const withoutReads = getEntriesWithFreshness(db2);

        expect(withReads[0].freshnessScore!).toBeGreaterThan(withoutReads[0].freshnessScore!);
      } finally {
        db2.close();
      }
    } finally {
      db.close();
    }
  });
});

describe('getEntriesWithFreshness', () => {
  it('returns entries sorted by freshness score ascending', async () => {
    const entries = [
      makeFreshEntry('Fresh Guide'),
      makeOldEntry('Old Guide', 180),
      makeOldEntry('Medium Guide', 45),
    ];
    const db = await seedAndIndex(entries);

    try {
      const statsMap = buildUsageStatsMap(repoDir, '30d');
      updateFreshnessScores(db, statsMap);

      const withFreshness = getEntriesWithFreshness(db);
      expect(withFreshness).toHaveLength(3);

      // Should be sorted ascending (stalest first)
      for (let i = 1; i < withFreshness.length; i++) {
        expect(withFreshness[i].freshnessScore!).toBeGreaterThanOrEqual(
          withFreshness[i - 1].freshnessScore!,
        );
      }
    } finally {
      db.close();
    }
  });

  it('includes readCount30d', async () => {
    const entry = makeFreshEntry('Guide');
    const db = await seedAndIndex([entry]);

    try {
      const statsMap = buildUsageStatsMap(repoDir, '30d');
      updateFreshnessScores(db, statsMap);

      const withFreshness = getEntriesWithFreshness(db);
      expect(withFreshness[0].readCount30d).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('prune: archive mechanics', () => {
  it('moves file to _archive/ directory', async () => {
    const entry = makeOldEntry('Old Guide', 180);
    await writeEntry(repoDir, entry);

    const sourcePath = path.join(repoDir, entry.filePath);
    const archivePath = path.join(repoDir, '_archive', entry.filePath);

    expect(fs.existsSync(sourcePath)).toBe(true);

    // Simulate archive: move file
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.renameSync(sourcePath, archivePath);

    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(fs.existsSync(archivePath)).toBe(true);
  });

  it('archived entries are excluded from scanEntries', async () => {
    const entry1 = makeFreshEntry('Keep Guide');
    const entry2 = makeOldEntry('Archive Guide', 180);
    await writeEntry(repoDir, entry1);
    await writeEntry(repoDir, entry2);

    // Move entry2 to _archive/
    const sourcePath = path.join(repoDir, entry2.filePath);
    const archivePath = path.join(repoDir, '_archive', entry2.filePath);
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.renameSync(sourcePath, archivePath);

    const scanned = await scanEntries(repoDir);
    expect(scanned).toHaveLength(1);
    expect(scanned[0].title).toBe('Keep Guide');
  });

  it('rebuild index after archive removes entry from search', async () => {
    const entry = makeOldEntry('Archive Me', 180);
    const db = await seedAndIndex([entry]);

    try {
      expect(getAllEntries(db)).toHaveLength(1);

      // Archive the file
      const sourcePath = path.join(repoDir, entry.filePath);
      const archivePath = path.join(repoDir, '_archive', entry.filePath);
      fs.mkdirSync(path.dirname(archivePath), { recursive: true });
      fs.renameSync(sourcePath, archivePath);

      // Rebuild
      const scanned = await scanEntries(repoDir);
      rebuildIndex(db, scanned);

      expect(getAllEntries(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('prune: schema columns', () => {
  it('freshness columns exist after createIndex', () => {
    const db = createIndex(dbPath);
    try {
      // These should not throw
      const result = db.prepare('SELECT freshness_score, freshness_label, read_count_30d, source_repo FROM entries LIMIT 1').all();
      expect(result).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('createIndex is idempotent with freshness columns', () => {
    const db1 = createIndex(dbPath);
    db1.close();

    // Second call should not throw
    const db2 = createIndex(dbPath);
    try {
      const result = db2.prepare('SELECT freshness_score FROM entries LIMIT 1').all();
      expect(result).toEqual([]);
    } finally {
      db2.close();
    }
  });
});

describe('buildUsageStatsMap', () => {
  it('returns empty map when no receipts', () => {
    const stats = buildUsageStatsMap(repoDir, '30d');
    expect(stats.size).toBe(0);
  });

  it('includes entries with receipts', async () => {
    await recordReceipt(repoDir, 'test-entry', 'user1', 'cli');
    await recordReceipt(repoDir, 'test-entry', 'user2', 'cli');

    const stats = buildUsageStatsMap(repoDir, '30d');
    expect(stats.has('test-entry')).toBe(true);
    expect(stats.get('test-entry')!.accessCount30d).toBe(2);
  });
});
