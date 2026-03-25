import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { loadSources, saveSources, upsertSource, removeSource, getSourcesPath } from '../src/core/sources.js';
import { computeContentHash } from '../src/core/source-sync.js';
import type { SourceRegistry } from '../src/types.js';

let tempDir: string;
let originalHomedir: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-sources-test-'));
  originalHomedir = vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
  // Ensure .brain directory exists
  fs.mkdirSync(path.join(tempDir, '.brain'), { recursive: true });
});

afterEach(() => {
  originalHomedir.mockRestore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('loadSources', () => {
  it('returns empty registry when no file exists', () => {
    const registry = loadSources();
    expect(registry).toEqual({ sources: {} });
  });

  it('parses existing sources file', () => {
    const json = JSON.stringify({
      sources: {
        'my-docs': {
          url: 'https://github.com/org/docs.git',
          path: 'docs',
          exclude: ['**/drafts/**', '**/internal/**'],
          lastCommit: 'abc123',
          lastSync: '2024-01-01T00:00:00.000Z',
          entryCount: 5,
          type: 'guide',
          sourceTag: true,
        },
      },
    }, null, 2);
    fs.writeFileSync(path.join(tempDir, '.brain', 'sources.json'), json, 'utf-8');
    const registry = loadSources();
    expect(registry.sources['my-docs']).toBeDefined();
    expect(registry.sources['my-docs'].url).toBe('https://github.com/org/docs.git');
    expect(registry.sources['my-docs'].path).toBe('docs');
    expect(registry.sources['my-docs'].exclude).toEqual(['**/drafts/**', '**/internal/**']);
    expect(registry.sources['my-docs'].lastCommit).toBe('abc123');
    expect(registry.sources['my-docs'].entryCount).toBe(5);
    expect(registry.sources['my-docs'].type).toBe('guide');
    expect(registry.sources['my-docs'].sourceTag).toBe(true);
  });
});

describe('saveSources + loadSources roundtrip', () => {
  it('persists and reloads registry correctly', () => {
    const registry: SourceRegistry = {
      sources: {
        'team-docs': {
          url: 'https://github.com/team/docs.git',
          path: 'content',
          exclude: ['**/archive/**'],
          lastCommit: 'def456',
          lastSync: '2024-06-15T12:00:00.000Z',
          entryCount: 12,
          type: 'guide',
          sourceTag: false,
        },
        'skills-repo': {
          url: 'https://github.com/team/skills.git',
          lastCommit: '789abc',
          lastSync: '2024-06-16T08:00:00.000Z',
          entryCount: 3,
          sourceTag: true,
        },
      },
    };

    saveSources(registry);
    const loaded = loadSources();

    expect(loaded.sources['team-docs'].url).toBe('https://github.com/team/docs.git');
    expect(loaded.sources['team-docs'].path).toBe('content');
    expect(loaded.sources['team-docs'].exclude).toEqual(['**/archive/**']);
    expect(loaded.sources['team-docs'].entryCount).toBe(12);
    expect(loaded.sources['team-docs'].sourceTag).toBe(false);

    expect(loaded.sources['skills-repo'].url).toBe('https://github.com/team/skills.git');
    expect(loaded.sources['skills-repo'].entryCount).toBe(3);
    expect(loaded.sources['skills-repo'].sourceTag).toBe(true);
  });
});

describe('upsertSource', () => {
  it('adds a new source', () => {
    upsertSource('new-source', {
      url: 'https://github.com/org/new.git',
      lastCommit: 'aaa111',
      lastSync: '2024-01-01T00:00:00.000Z',
      entryCount: 0,
      sourceTag: true,
    });

    const registry = loadSources();
    expect(registry.sources['new-source']).toBeDefined();
    expect(registry.sources['new-source'].url).toBe('https://github.com/org/new.git');
  });

  it('updates an existing source', () => {
    upsertSource('existing', {
      url: 'https://github.com/org/repo.git',
      lastCommit: 'bbb222',
      lastSync: '2024-01-01T00:00:00.000Z',
      entryCount: 5,
      sourceTag: false,
    });

    upsertSource('existing', {
      url: 'https://github.com/org/repo.git',
      lastCommit: 'ccc333',
      lastSync: '2024-02-01T00:00:00.000Z',
      entryCount: 8,
      sourceTag: false,
    });

    const registry = loadSources();
    expect(registry.sources['existing'].lastCommit).toBe('ccc333');
    expect(registry.sources['existing'].entryCount).toBe(8);
  });
});

describe('removeSource', () => {
  it('deletes an existing source', () => {
    upsertSource('to-remove', {
      url: 'https://github.com/org/remove.git',
      lastCommit: 'ddd444',
      lastSync: '2024-01-01T00:00:00.000Z',
      entryCount: 2,
      sourceTag: false,
    });

    const removed = removeSource('to-remove');
    expect(removed).toBe(true);

    const registry = loadSources();
    expect(registry.sources['to-remove']).toBeUndefined();
  });

  it('returns false for nonexistent source', () => {
    const removed = removeSource('does-not-exist');
    expect(removed).toBe(false);
  });
});

describe('computeContentHash', () => {
  it('produces consistent results', () => {
    const content = 'Hello, world!';
    const hash1 = computeContentHash(content);
    const hash2 = computeContentHash(content);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('detects changes', () => {
    const hash1 = computeContentHash('Original content');
    const hash2 = computeContentHash('Modified content');
    expect(hash1).not.toBe(hash2);
  });
});
