import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIndex, getDbPath, rebuildIndex, searchEntriesWithSnippets } from '../src/core/index-db.js';
import { scanEntries, createEntry, writeEntry } from '../src/core/entry.js';
import { saveConfig } from '../src/core/config.js';
import type { BrainConfig } from '../src/types.js';

let tempDir: string;
let brainDir: string;
let repoDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-search-test-'));
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

describe('search with interactive selection', () => {
  it('search returns entries with IDs for selection', async () => {
    const entries = [
      createEntry({ title: 'K8s Deployment Guide', type: 'guide', content: 'Deploy on kubernetes k8s cluster.', author: 'alice', tags: ['k8s'] }),
      createEntry({ title: 'Helm Chart Patterns', type: 'skill', content: 'Helm kubernetes patterns.', author: 'bob', tags: ['helm', 'k8s'] }),
    ];

    for (const entry of entries) {
      await writeEntry(repoDir, entry);
    }

    const db = createIndex(dbPath);
    try {
      const scanned = await scanEntries(repoDir);
      rebuildIndex(db, scanned);

      const results = searchEntriesWithSnippets(db, 'kubernetes', 20);
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Verify entries have IDs that can be used for selection
      for (const result of results) {
        expect(result.entry.id).toBeTruthy();
        expect(result.entry.title).toBeTruthy();
      }
    } finally {
      db.close();
    }
  });

  it('search results include entry IDs usable for brain show', async () => {
    const entry = createEntry({
      title: 'Docker Multi-Stage Builds',
      type: 'guide',
      content: 'How to use docker multi-stage builds for smaller images.',
      author: 'alice',
      tags: ['docker'],
    });
    await writeEntry(repoDir, entry);

    const db = createIndex(dbPath);
    try {
      const scanned = await scanEntries(repoDir);
      rebuildIndex(db, scanned);

      const results = searchEntriesWithSnippets(db, 'docker', 20);
      expect(results).toHaveLength(1);
      expect(results[0].entry.id).toBe('docker-multi-stage-builds');
    } finally {
      db.close();
    }
  });

  it('empty search returns no results', async () => {
    const entry = createEntry({
      title: 'Docker Guide',
      type: 'guide',
      content: 'Docker stuff.',
      author: 'alice',
    });
    await writeEntry(repoDir, entry);

    const db = createIndex(dbPath);
    try {
      const scanned = await scanEntries(repoDir);
      rebuildIndex(db, scanned);

      const results = searchEntriesWithSnippets(db, 'xyznonexistent', 20);
      expect(results).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('search command has --no-interactive option', async () => {
    const { searchCommand } = await import('../src/commands/search.js');
    const opts = searchCommand.options.map((o: { long: string }) => o.long);
    expect(opts).toContain('--no-interactive');
  });
});
