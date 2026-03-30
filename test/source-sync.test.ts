import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSource } from '../src/core/source-sync.js';
import { createIndex } from '../src/core/index-db.js';
import { safeCleanup } from './test-helpers.js';
import type { SourceConfig } from '../src/types.js';
import { safeCleanup } from './test-helpers.js';

let tempDir: string;
let brainDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-sync-test-'));
  brainDir = path.join(tempDir, 'brain-repo');
  dbPath = path.join(tempDir, 'cache.db');
  fs.mkdirSync(brainDir, { recursive: true });
  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
  fs.mkdirSync(path.join(tempDir, '.brain'), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await safeCleanup(tempDir);
});

describe('syncSource', () => {
  it('returns empty result for non-git sources (no lastCommit)', async () => {
    const sourceConfig: SourceConfig = {
      url: '/local/docs',
      lastSync: '2024-06-15T12:00:00.000Z',
      entryCount: 3,
      sourceTag: false,
    };

    const db = createIndex(dbPath);
    try {
      const result = await syncSource('local-docs', sourceConfig, brainDir, db, {});

      expect(result.added).toEqual([]);
      expect(result.updated).toEqual([]);
      expect(result.archived).toEqual([]);
      expect(result.skippedLocalEdits).toEqual([]);
      expect(result.unchanged).toBe(0);
    } finally {
      db.close();
    }
  });

  it('throws for invalid lastCommit SHA', async () => {
    const sourceConfig: SourceConfig = {
      url: 'https://github.com/team/docs.git',
      lastCommit: 'not-a-valid-sha',
      lastSync: '2024-06-15T12:00:00.000Z',
      entryCount: 3,
      sourceTag: false,
    };

    const db = createIndex(dbPath);
    try {
      await expect(
        syncSource('docs', sourceConfig, brainDir, db, {}),
      ).rejects.toThrow('Invalid commit SHA');
    } finally {
      db.close();
    }
  });
});
