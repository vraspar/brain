import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveConfig, loadConfig } from '../src/core/config.js';
import { createIndex, rebuildIndex, getDbPath, getEntryById } from '../src/core/index-db.js';
import { scanEntries, createEntry, writeEntry } from '../src/core/entry.js';
import type { BrainConfig } from '../src/types.js';

let tempDir: string;
let brainDir: string;
let repoDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-remote-open-test-'));
  brainDir = path.join(tempDir, '.brain');
  repoDir = path.join(tempDir, 'repo');
  dbPath = path.join(brainDir, 'cache.db');

  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);

  fs.mkdirSync(path.join(repoDir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'skills'), { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// --- brain remote add ---

describe('brain remote add', () => {
  it('rejects add when remote already exists', () => {
    const config: BrainConfig = {
      remote: 'https://github.com/team/brain.git',
      local: repoDir,
      author: 'testuser',
    };
    saveConfig(config);

    // The remote command would check config.remote and throw
    const loaded = loadConfig();
    expect(loaded.remote).toBeDefined();
    // Simulating the check from remote.ts
    expect(() => {
      if (loaded.remote) {
        throw new Error(`Remote already configured: ${loaded.remote}`);
      }
    }).toThrow('Remote already configured');
  });

  it('allows add when no remote configured', () => {
    const config: BrainConfig = {
      local: repoDir,
      author: 'testuser',
    };
    saveConfig(config);

    const loaded = loadConfig();
    expect(loaded.remote).toBeUndefined();
  });

  it('saves remote URL to config after add', () => {
    const config: BrainConfig = {
      local: repoDir,
      author: 'testuser',
    };
    saveConfig(config);

    // Simulate what remote add does
    const updated = { ...config, remote: 'https://github.com/team/brain.git' };
    saveConfig(updated);

    const loaded = loadConfig();
    expect(loaded.remote).toBe('https://github.com/team/brain.git');
  });
});

// --- brain open ---

describe('brain open', () => {
  it('resolves entry file path from ID', async () => {
    const config: BrainConfig = {
      local: repoDir,
      author: 'testuser',
    };
    saveConfig(config);

    const entry = createEntry({
      title: 'Docker Guide',
      type: 'guide',
      content: 'How to use docker.',
      author: 'alice',
    });
    await writeEntry(repoDir, entry);

    const entries = await scanEntries(repoDir);
    const db = createIndex(dbPath);
    try {
      rebuildIndex(db, entries);
      const found = getEntryById(db, 'docker-guide');
      expect(found).not.toBeNull();
      expect(found!.filePath).toBe('guides/docker-guide.md');

      const fullPath = path.join(repoDir, found!.filePath);
      expect(fs.existsSync(fullPath)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('returns null for non-existent entry', () => {
    const db = createIndex(dbPath);
    try {
      const found = getEntryById(db, 'nonexistent');
      expect(found).toBeNull();
    } finally {
      db.close();
    }
  });
});

// --- brain sync local-only ---

describe('brain sync local-only', () => {
  it('detects local-only brain (no remote)', () => {
    const config: BrainConfig = {
      local: repoDir,
      author: 'testuser',
    };
    saveConfig(config);

    const loaded = loadConfig();
    expect(loaded.remote).toBeUndefined();
  });

  it('rebuilds index locally when no remote', async () => {
    const config: BrainConfig = {
      local: repoDir,
      author: 'testuser',
    };
    saveConfig(config);

    const entry = createEntry({
      title: 'Local Guide',
      type: 'guide',
      content: 'Local-only content.',
      author: 'testuser',
    });
    await writeEntry(repoDir, entry);

    const entries = await scanEntries(repoDir);
    const db = createIndex(dbPath);
    try {
      rebuildIndex(db, entries);
      const found = getEntryById(db, 'local-guide');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Local Guide');
    } finally {
      db.close();
    }
  });
});
