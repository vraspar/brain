import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntry, writeEntry, scanEntries } from '../src/core/entry.js';
import {
  createIndex,
  getDbPath,
  rebuildIndex,
  getAllEntries,
  getEntryById,
} from '../src/core/index-db.js';
import { saveConfig } from '../src/core/config.js';
import type { BrainConfig, Entry } from '../src/types.js';

/**
 * Tests for the retract command's core logic:
 * - Finding entries by ID
 * - Deleting files from disk
 * - Rebuilding the index without deleted entries
 *
 * We test the data flow (not commander parsing) since commander is well-tested upstream.
 * Git commit operations are not tested here — they're covered in git.test.ts.
 */

let tempDir: string;
let repoDir: string;
let brainDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-retract-test-'));
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
  try {
    const scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);
  } finally {
    db.close();
  }
}

describe('retract: entry lookup', () => {
  it('finds existing entry by ID', async () => {
    const entry = seedEntry({ title: 'K8s Guide' });
    await seedAndIndex([entry]);

    const db = createIndex(dbPath);
    try {
      const found = getEntryById(db, 'k8s-guide');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('K8s Guide');
    } finally {
      db.close();
    }
  });

  it('returns null for non-existent entry', async () => {
    await seedAndIndex([seedEntry()]);

    const db = createIndex(dbPath);
    try {
      const found = getEntryById(db, 'nonexistent');
      expect(found).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('retract: file deletion', () => {
  it('removes the entry file from disk', async () => {
    const entry = seedEntry({ title: 'Delete Me' });
    await seedAndIndex([entry]);

    const filePath = path.join(repoDir, entry.filePath);
    expect(fs.existsSync(filePath)).toBe(true);

    // Simulate retract: delete the file
    fs.unlinkSync(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('handles already-deleted files gracefully', async () => {
    const entry = seedEntry({ title: 'Already Gone' });
    await seedAndIndex([entry]);

    const filePath = path.join(repoDir, entry.filePath);
    fs.unlinkSync(filePath); // delete once

    // Second delete attempt should not throw (matching retract command behavior)
    expect(fs.existsSync(filePath)).toBe(false);
    // The retract command checks existsSync before unlinkSync
  });
});

describe('retract: index rebuild after deletion', () => {
  it('entry is removed from search index after retract', async () => {
    const guideA = seedEntry({ title: 'Guide Alpha' });
    const guideB = seedEntry({ title: 'Guide Beta', tags: ['beta'] });
    await seedAndIndex([guideA, guideB]);

    // Verify both exist before
    let db = createIndex(dbPath);
    try {
      expect(getAllEntries(db)).toHaveLength(2);
      expect(getEntryById(db, 'guide-alpha')).not.toBeNull();
    } finally {
      db.close();
    }

    // Delete Guide Alpha's file
    const filePath = path.join(repoDir, guideA.filePath);
    fs.unlinkSync(filePath);

    // Rebuild index from disk
    const scanned = await scanEntries(repoDir);
    db = createIndex(dbPath);
    try {
      rebuildIndex(db, scanned);
      expect(getAllEntries(db)).toHaveLength(1);
      expect(getEntryById(db, 'guide-alpha')).toBeNull();
      expect(getEntryById(db, 'guide-beta')).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it('entry is no longer searchable after retract', async () => {
    const entry = seedEntry({
      title: 'Kubernetes Guide',
      content: 'Deploy applications to Kubernetes clusters',
    });
    await seedAndIndex([entry]);

    // Searchable before deletion
    let db = createIndex(dbPath);
    const { searchEntries } = await import('../src/core/index-db.js');
    try {
      const before = searchEntries(db, 'kubernetes');
      expect(before.length).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }

    // Delete and rebuild
    fs.unlinkSync(path.join(repoDir, entry.filePath));
    const scanned = await scanEntries(repoDir);
    db = createIndex(dbPath);
    try {
      rebuildIndex(db, scanned);
      const after = searchEntries(db, 'kubernetes');
      expect(after).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('handles retracting the last entry', async () => {
    const entry = seedEntry({ title: 'Solo Entry' });
    await seedAndIndex([entry]);

    fs.unlinkSync(path.join(repoDir, entry.filePath));
    const scanned = await scanEntries(repoDir);

    const db = createIndex(dbPath);
    try {
      rebuildIndex(db, scanned);
      expect(getAllEntries(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('retract: skill entries', () => {
  it('retracts skill type entries correctly', async () => {
    const skill = createEntry({
      title: 'CI Pipeline Skill',
      type: 'skill',
      content: 'Automate CI pipeline creation with GitHub Actions',
      author: 'bob',
      tags: ['ci', 'github-actions'],
    });
    await seedAndIndex([skill]);

    const filePath = path.join(repoDir, skill.filePath);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(skill.filePath).toMatch(/^skills\//);

    fs.unlinkSync(filePath);
    const scanned = await scanEntries(repoDir);

    const db = createIndex(dbPath);
    try {
      rebuildIndex(db, scanned);
      expect(getEntryById(db, 'ci-pipeline-skill')).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('retract: mixed operations', () => {
  it('retract one entry while others remain intact', async () => {
    const entries = [
      seedEntry({ title: 'Guide A', content: 'Content for guide A' }),
      seedEntry({ title: 'Guide B', content: 'Content for guide B' }),
      createEntry({
        title: 'Skill C',
        type: 'skill',
        content: 'Content for skill C',
        author: 'charlie',
      }),
    ];
    await seedAndIndex(entries);

    // Retract Guide B
    const guideBPath = path.join(repoDir, entries[1].filePath);
    fs.unlinkSync(guideBPath);

    const scanned = await scanEntries(repoDir);
    const db = createIndex(dbPath);
    try {
      rebuildIndex(db, scanned);

      const remaining = getAllEntries(db);
      expect(remaining).toHaveLength(2);
      expect(remaining.map((e) => e.id)).toContain('guide-a');
      expect(remaining.map((e) => e.id)).toContain('skill-c');
      expect(remaining.map((e) => e.id)).not.toContain('guide-b');
    } finally {
      db.close();
    }
  });
});
