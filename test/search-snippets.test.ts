import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createIndex,
  rebuildIndex,
  searchEntriesWithSnippets,
  searchEntries,
} from '../src/core/index-db.js';
import { formatSearchResults } from '../src/utils/output.js';
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
    content:
      'How to deploy applications to Kubernetes clusters using helm charts. ' +
      'First, install kubectl and configure your kubeconfig. Then create your deployment YAML. ' +
      'Use helm to manage releases and rollbacks across environments.',
    filePath: 'guides/k8s-deployment.md',
    summary: 'Step-by-step Kubernetes deployment',
  }),
  makeEntry({
    id: 'react-testing',
    title: 'React Testing Best Practices',
    author: 'bob',
    tags: ['react', 'testing', 'frontend'],
    content:
      'Best practices for testing React components with vitest and testing library. ' +
      'Always test user interactions over implementation details. ' +
      'Use screen queries and prefer getByRole for accessibility.',
    filePath: 'guides/react-testing.md',
    summary: 'React testing patterns',
  }),
  makeEntry({
    id: 'docker-multistage',
    title: 'Docker Multi-Stage Builds',
    author: 'charlie',
    tags: ['docker', 'optimization'],
    content:
      'How to use multi-stage builds in Docker to create smaller production images. ' +
      'Stage 1 compiles the application, stage 2 copies only the binary. ' +
      'This reduces image size by up to 90 percent compared to single-stage builds.',
    filePath: 'guides/docker-multistage.md',
  }),
];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-snippet-test-'));
  const dbPath = path.join(tempDir, 'test-cache.db');
  db = createIndex(dbPath);
  rebuildIndex(db, sampleEntries);
});

afterEach(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('searchEntriesWithSnippets', () => {
  it('returns search results with snippet text', () => {
    const results = searchEntriesWithSnippets(db, 'kubernetes');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].entry.id).toBe('k8s-deployment');
    expect(results[0].snippet).toBeTruthy();
    expect(typeof results[0].snippet).toBe('string');
  });

  it('snippet contains context around matching term', () => {
    const results = searchEntriesWithSnippets(db, 'helm');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const snippet = results[0].snippet;
    // The snippet should include text near the matching term
    expect(snippet.length).toBeGreaterThan(0);
  });

  it('returns empty array for empty query', () => {
    expect(searchEntriesWithSnippets(db, '')).toEqual([]);
    expect(searchEntriesWithSnippets(db, '   ')).toEqual([]);
  });

  it('returns empty array for no matches', () => {
    const results = searchEntriesWithSnippets(db, 'xyznonexistent');
    expect(results).toHaveLength(0);
  });

  it('respects the limit parameter', () => {
    const results = searchEntriesWithSnippets(db, 'deploy OR react OR docker', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('snippet is non-empty for every result', () => {
    const results = searchEntriesWithSnippets(db, 'testing');
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      expect(result.snippet.length).toBeGreaterThan(0);
    }
  });

  it('handles special characters safely', () => {
    expect(() => searchEntriesWithSnippets(db, 'C++')).not.toThrow();
    expect(() => searchEntriesWithSnippets(db, '"quoted"')).not.toThrow();
    expect(() => searchEntriesWithSnippets(db, '(test)')).not.toThrow();
  });
});

describe('searchEntries backward compatibility', () => {
  it('still returns Entry[] (not SearchResult[])', () => {
    const results = searchEntries(db, 'kubernetes');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Should be Entry, not SearchResult
    expect(results[0].id).toBe('k8s-deployment');
    expect(results[0].title).toBe('Kubernetes Deployment Guide');
    // Should NOT have a 'snippet' property
    expect('snippet' in results[0]).toBe(false);
  });
});

describe('formatSearchResults with snippets', () => {
  it('shows Preview column when snippets provided', () => {
    const entries = [makeEntry({ id: 'test', title: 'Test Guide' })];
    const snippets = new Map([['test', 'This is a preview snippet']]);
    const output = formatSearchResults(entries, { snippets });
    expect(output).toContain('Preview');
    expect(output).toContain('This is a preview snippet');
  });

  it('shows Status column when no snippets provided (list behavior)', () => {
    const entries = [makeEntry({ id: 'test', title: 'Test Guide', status: 'active' })];
    const output = formatSearchResults(entries);
    expect(output).toContain('Status');
    expect(output).not.toContain('Preview');
  });

  it('strips FTS5 highlight markers from snippets', () => {
    const entries = [makeEntry({ id: 'test', title: 'Test Guide' })];
    const snippets = new Map([['test', 'deploy to «kubernetes» clusters']]);
    const output = formatSearchResults(entries, { snippets });
    expect(output).not.toContain('«');
    expect(output).not.toContain('»');
    expect(output).toContain('kubernetes');
  });

  it('includes snippet in JSON output', () => {
    const entries = [makeEntry({ id: 'test', title: 'Test Guide' })];
    const snippets = new Map([['test', 'A preview text']]);
    const output = formatSearchResults(entries, { format: 'json', snippets });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].preview).toBe('A preview text');
  });

  it('JSON without snippets remains unchanged', () => {
    const entries = [makeEntry({ id: 'test', title: 'Test Guide' })];
    const output = formatSearchResults(entries, { format: 'json' });
    const parsed = JSON.parse(output);
    expect(parsed[0].title).toBe('Test Guide');
    expect(parsed[0].preview).toBeUndefined();
  });

  it('handles empty snippets map gracefully', () => {
    const entries = [makeEntry({ id: 'test', title: 'Test Guide' })];
    const snippets = new Map<string, string>();
    const output = formatSearchResults(entries, { snippets });
    // Empty map => no preview column, falls back to Status
    expect(output).toContain('Status');
  });
});
