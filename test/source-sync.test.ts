import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSource } from '../src/core/source-sync.js';
import { createIndex } from '../src/core/index-db.js';
import { safeCleanup } from './test-helpers.js';
import type { SourceConfig } from '../src/types.js';

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
  it('does full sync on first run when lastCommit is undefined', async () => {
    // Create a local bare repo with a markdown file
    const { simpleGit } = await import('simple-git');
    const bareDir = path.join(tempDir, 'source.git');
    fs.mkdirSync(bareDir);
    await simpleGit(bareDir).init(true);

    const setupDir = path.join(tempDir, 'setup');
    await simpleGit().clone(bareDir, setupDir);
    const git = simpleGit(setupDir);
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@test.com');
    fs.writeFileSync(path.join(setupDir, 'doc.md'), '---\ntitle: Doc\n---\nContent.', 'utf-8');
    await git.add('.');
    await git.commit('Add doc');
    await git.push('origin', 'main');

    const sourceConfig: SourceConfig = {
      url: bareDir,
      lastSync: '2024-06-15T12:00:00.000Z',
      entryCount: 0,
      sourceTag: false,
    };

    const db = createIndex(dbPath);
    try {
      const result = await syncSource('test-source', sourceConfig, brainDir, db, {});
      // First sync with no lastCommit should find all files as added
      expect(result.added.length).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  }, 30_000);

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
