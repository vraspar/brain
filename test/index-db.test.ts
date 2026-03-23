import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createIndex,
  getAllEntries,
  getDbPath,
  getEntriesByAuthor,
  getEntryById,
  getRecentEntries,
  rebuildIndex,
  searchEntries,
} from '../src/core/index-db.js';
import type { Entry } from '../src/types.js';
import type Database from 'better-sqlite3';

let tempDir: string;
let db: Database.Database;

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'test-entry',
    title: 'Test Entry',
    type: 'guide',
    author: 'alice',
    created: '2026-03-20T10:00:00Z',
    updated: '2026-03-20T10:00:00Z',
    tags: ['testing', 'example'],
    status: 'active',
    content: 'This is test content for the entry.',
    filePath: 'guides/test-entry.md',
    summary: 'A test entry for unit testing',
    ...overrides,
  };
}

const sampleEntries: Entry[] = [
  makeEntry({
    id: 'k8s-deployment',
    title: 'Kubernetes Deployment Guide',
    author: 'alice',
    tags: ['kubernetes', 'deployment', 'devops'],
    content: 'How to deploy applications to Kubernetes clusters using helm charts.',
    filePath: 'guides/k8s-deployment.md',
    summary: 'Step-by-step Kubernetes deployment',
    created: '2026-03-18T10:00:00Z',
    updated: '2026-03-20T14:00:00Z',
  }),
  makeEntry({
    id: 'react-testing',
    title: 'React Testing Best Practices',
    author: 'bob',
    tags: ['react', 'testing', 'frontend'],
    content: 'Best practices for testing React components with vitest and testing library.',
    filePath: 'guides/react-testing.md',
    summary: 'React testing patterns',
    created: '2026-03-15T08:00:00Z',
    updated: '2026-03-19T12:00:00Z',
  }),
  makeEntry({
    id: 'ci-pipeline-skill',
    title: 'CI Pipeline Setup Skill',
    type: 'skill',
    author: 'alice',
    tags: ['ci', 'pipeline', 'github-actions'],
    content: 'A reusable skill for setting up CI pipelines with GitHub Actions.',
    filePath: 'skills/ci-pipeline-skill.md',
    summary: 'Automate CI pipeline creation',
    created: '2026-03-21T09:00:00Z',
    updated: '2026-03-21T09:00:00Z',
  }),
  makeEntry({
    id: 'python-fastapi',
    title: 'FastAPI REST API Template',
    author: 'charlie',
    tags: ['python', 'fastapi', 'api'],
    content: 'Template for building REST APIs with FastAPI, including authentication and validation.',
    filePath: 'guides/python-fastapi.md',
    summary: 'FastAPI starter template',
    created: '2026-03-10T06:00:00Z',
    updated: '2026-03-10T06:00:00Z',
    related_repos: ['team/fastapi-template'],
    related_tools: ['fastapi', 'uvicorn'],
  }),
];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-index-test-'));
  const dbPath = path.join(tempDir, 'test-cache.db');
  db = createIndex(dbPath);
});

afterEach(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('getDbPath', () => {
  it('returns a path under ~/.brain/', () => {
    const dbPath = getDbPath();
    expect(dbPath).toContain('.brain');
    expect(dbPath).toMatch(/cache\.db$/);
  });
});

describe('createIndex', () => {
  it('creates a database with the entries table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entries'",
    ).all();
    expect(tables).toHaveLength(1);
  });

  it('creates the FTS5 virtual table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='entries_fts'",
    ).all();
    expect(tables).toHaveLength(1);
  });

  it('is idempotent — calling twice does not throw', () => {
    const dbPath = path.join(tempDir, 'test-cache.db');
    const db2 = createIndex(dbPath);
    db2.close();
  });
});

describe('rebuildIndex', () => {
  it('inserts all entries into the database', () => {
    rebuildIndex(db, sampleEntries);
    const entries = getAllEntries(db);
    expect(entries).toHaveLength(sampleEntries.length);
  });

  it('clears existing entries before rebuilding', () => {
    rebuildIndex(db, sampleEntries);
    expect(getAllEntries(db)).toHaveLength(4);

    rebuildIndex(db, [sampleEntries[0]]);
    expect(getAllEntries(db)).toHaveLength(1);
  });

  it('preserves all entry fields', () => {
    rebuildIndex(db, [sampleEntries[3]]); // python-fastapi with related_repos/tools
    const entry = getEntryById(db, 'python-fastapi');

    expect(entry).not.toBeNull();
    expect(entry!.title).toBe('FastAPI REST API Template');
    expect(entry!.author).toBe('charlie');
    expect(entry!.type).toBe('guide');
    expect(entry!.tags).toEqual(['python', 'fastapi', 'api']);
    expect(entry!.status).toBe('active');
    expect(entry!.related_repos).toEqual(['team/fastapi-template']);
    expect(entry!.related_tools).toEqual(['fastapi', 'uvicorn']);
    expect(entry!.summary).toBe('FastAPI starter template');
    expect(entry!.content).toContain('FastAPI');
    expect(entry!.filePath).toBe('guides/python-fastapi.md');
    expect(entry!.created).toBe('2026-03-10T06:00:00Z');
    expect(entry!.updated).toBe('2026-03-10T06:00:00Z');
  });

  it('handles entries without optional fields', () => {
    const minimal = makeEntry({
      id: 'minimal',
      related_repos: undefined,
      related_tools: undefined,
      summary: undefined,
    });
    rebuildIndex(db, [minimal]);
    const entry = getEntryById(db, 'minimal');

    expect(entry).not.toBeNull();
    expect(entry!.related_repos).toBeUndefined();
    expect(entry!.related_tools).toBeUndefined();
    expect(entry!.summary).toBeUndefined();
  });

  it('handles empty entry list', () => {
    rebuildIndex(db, sampleEntries);
    rebuildIndex(db, []);
    expect(getAllEntries(db)).toHaveLength(0);
  });
});

describe('searchEntries', () => {
  beforeEach(() => {
    rebuildIndex(db, sampleEntries);
  });

  it('finds entries matching a keyword in content', () => {
    const results = searchEntries(db, 'kubernetes');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('k8s-deployment');
  });

  it('finds entries matching a keyword in title', () => {
    const results = searchEntries(db, 'FastAPI');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((e) => e.id === 'python-fastapi')).toBe(true);
  });

  it('finds entries matching tags', () => {
    const results = searchEntries(db, 'devops');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((e) => e.id === 'k8s-deployment')).toBe(true);
  });

  it('finds entries matching summary', () => {
    const results = searchEntries(db, 'starter template');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((e) => e.id === 'python-fastapi')).toBe(true);
  });

  it('returns empty array for empty query', () => {
    expect(searchEntries(db, '')).toEqual([]);
    expect(searchEntries(db, '   ')).toEqual([]);
  });

  it('returns empty array for no matches', () => {
    const results = searchEntries(db, 'xyznonexistent');
    expect(results).toHaveLength(0);
  });

  it('respects the limit parameter', () => {
    const results = searchEntries(db, 'testing OR deployment OR pipeline OR api', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('handles special characters without crashing', () => {
    // These should not throw FTS5 syntax errors
    expect(() => searchEntries(db, 'C++')).not.toThrow();
    expect(() => searchEntries(db, '"quoted text"')).not.toThrow();
    expect(() => searchEntries(db, 'node AND react')).not.toThrow();
    expect(() => searchEntries(db, 'test*')).not.toThrow();
    expect(() => searchEntries(db, '(parentheses)')).not.toThrow();
    expect(() => searchEntries(db, "it's a test")).not.toThrow();
    expect(() => searchEntries(db, 'colon: semi;')).not.toThrow();
  });

  it('still finds results after sanitizing special characters', () => {
    const results = searchEntries(db, '"kubernetes" deployment');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('k8s-deployment');
  });

  it('strips FTS5 operators (AND, OR, NOT, NEAR) from queries', () => {
    // Should not interpret AND/OR as boolean operators
    expect(() => searchEntries(db, 'kubernetes AND deployment')).not.toThrow();
    expect(() => searchEntries(db, 'NOT testing')).not.toThrow();
    expect(() => searchEntries(db, 'NEAR react')).not.toThrow();
    // Should still find results (operators are stripped, terms remain)
    const results = searchEntries(db, 'kubernetes AND deployment');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('handles C++ style queries by stripping plus signs', () => {
    // C++ should become just "C" after sanitization
    expect(() => searchEntries(db, 'C++')).not.toThrow();
    expect(() => searchEntries(db, 'node.js')).not.toThrow();
  });

  it('falls back to LIKE search if FTS5 somehow fails', () => {
    // Query with only special characters should return empty (not crash)
    const results = searchEntries(db, '+++***');
    expect(results).toEqual([]);
  });

  it('matches partial words via prefix search', () => {
    // "kube" should match "kubernetes" via prefix wildcard
    const results = searchEntries(db, 'kube');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((e) => e.id === 'k8s-deployment')).toBe(true);
  });

  it('matches prefix of title words', () => {
    // "Fast" should match "FastAPI"
    const results = searchEntries(db, 'Fast');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((e) => e.id === 'python-fastapi')).toBe(true);
  });

  it('matches prefix of tag words', () => {
    // "deploy" should match "deployment" tag
    const results = searchEntries(db, 'deploy');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((e) => e.id === 'k8s-deployment')).toBe(true);
  });
});

describe('getRecentEntries', () => {
  beforeEach(() => {
    rebuildIndex(db, sampleEntries);
  });

  it('returns entries created or updated since the given date', () => {
    const since = new Date('2026-03-19T00:00:00Z');
    const entries = getRecentEntries(db, since);

    const ids = entries.map((e) => e.id);
    expect(ids).toContain('k8s-deployment'); // updated 2026-03-20
    expect(ids).toContain('ci-pipeline-skill'); // created 2026-03-21
    expect(ids).toContain('react-testing'); // updated 2026-03-19
  });

  it('excludes old entries', () => {
    const since = new Date('2026-03-19T00:00:00Z');
    const entries = getRecentEntries(db, since);
    const ids = entries.map((e) => e.id);
    expect(ids).not.toContain('python-fastapi'); // last updated 2026-03-10
  });

  it('returns entries sorted by updated_at desc', () => {
    const since = new Date('2026-03-01T00:00:00Z');
    const entries = getRecentEntries(db, since);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].updated >= entries[i].updated).toBe(true);
    }
  });
});

describe('getAllEntries', () => {
  it('returns all entries', () => {
    rebuildIndex(db, sampleEntries);
    const entries = getAllEntries(db);
    expect(entries).toHaveLength(sampleEntries.length);
  });

  it('returns empty array when database is empty', () => {
    expect(getAllEntries(db)).toHaveLength(0);
  });
});

describe('getEntryById', () => {
  beforeEach(() => {
    rebuildIndex(db, sampleEntries);
  });

  it('returns the entry when found', () => {
    const entry = getEntryById(db, 'k8s-deployment');
    expect(entry).not.toBeNull();
    expect(entry!.title).toBe('Kubernetes Deployment Guide');
  });

  it('returns null when not found', () => {
    expect(getEntryById(db, 'nonexistent')).toBeNull();
  });
});

describe('getEntriesByAuthor', () => {
  beforeEach(() => {
    rebuildIndex(db, sampleEntries);
  });

  it('returns entries by the given author', () => {
    const entries = getEntriesByAuthor(db, 'alice');
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.author === 'alice')).toBe(true);
  });

  it('returns empty array for unknown author', () => {
    expect(getEntriesByAuthor(db, 'unknown')).toHaveLength(0);
  });
});
