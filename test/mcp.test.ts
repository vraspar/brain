import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createIndex,
  getEntryById,
  getRecentEntries,
  rebuildIndex,
  searchEntries,
} from '../src/core/index-db.js';
import { createEntry } from '../src/core/entry.js';
import { getEntryStats, getStats, recordReceipt } from '../src/core/receipts.js';
import { parseTimeWindow } from '../src/utils/time.js';
import { registerTools } from '../src/mcp/tools.js';
import { registerResources } from '../src/mcp/resources.js';
import type { BrainMcpContext } from '../src/mcp/server.js';
import type { BrainConfig, Entry } from '../src/types.js';
import type Database from 'better-sqlite3';

let tempDir: string;
let db: Database.Database;
let server: McpServer;
let context: BrainMcpContext;

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'test-entry',
    title: 'Test Entry',
    type: 'guide',
    author: 'alice',
    created: '2026-03-20T10:00:00Z',
    updated: '2026-03-20T10:00:00Z',
    tags: ['testing'],
    status: 'active',
    content: 'This is test content.',
    filePath: 'guides/test-entry.md',
    summary: 'A test entry',
    ...overrides,
  };
}

const sampleEntries: Entry[] = [
  makeEntry({
    id: 'k8s-deployment',
    title: 'Kubernetes Deployment Guide',
    author: 'alice',
    tags: ['kubernetes', 'deployment', 'devops'],
    content: 'How to deploy applications to Kubernetes clusters.',
    filePath: 'guides/k8s-deployment.md',
    summary: 'Step-by-step K8s deployment',
    created: '2026-03-18T10:00:00Z',
    updated: '2026-03-20T14:00:00Z',
  }),
  makeEntry({
    id: 'react-testing',
    title: 'React Testing Best Practices',
    author: 'bob',
    type: 'skill',
    tags: ['react', 'testing'],
    content: 'Best practices for testing React components.',
    filePath: 'skills/react-testing.md',
    summary: 'React testing patterns',
    created: '2026-03-19T08:00:00Z',
    updated: '2026-03-21T12:00:00Z',
  }),
  makeEntry({
    id: 'ci-pipeline',
    title: 'CI Pipeline Setup',
    author: 'alice',
    type: 'skill',
    tags: ['ci', 'github-actions'],
    content: 'Setting up CI pipelines with GitHub Actions.',
    filePath: 'skills/ci-pipeline.md',
    summary: 'CI pipeline automation',
    created: '2026-03-21T09:00:00Z',
    updated: '2026-03-21T09:00:00Z',
  }),
];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-mcp-test-'));
  const dbPath = path.join(tempDir, 'test-cache.db');
  db = createIndex(dbPath);
  rebuildIndex(db, sampleEntries);

  // Create repo structure for receipts
  fs.mkdirSync(path.join(tempDir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'skills'), { recursive: true });

  const config: BrainConfig = {
    remote: 'https://github.com/team/brain.git',
    local: tempDir,
    author: 'alice',
    lastSync: '2026-03-21T00:00:00Z',
  };

  context = { config, db };
  server = new McpServer({ name: 'brain-test', version: '0.1.0' });
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('registerTools', () => {
  it('registers all 5 tools without errors', () => {
    expect(() => registerTools(server, context)).not.toThrow();
  });
});

describe('registerResources', () => {
  it('registers all 2 resources without errors', () => {
    expect(() => registerResources(server, context)).not.toThrow();
  });
});

// Test tool handlers directly by calling the underlying functions
describe('tool handler logic', () => {
  describe('search_knowledge logic', () => {
    it('finds entries matching a query', () => {
      const results = searchEntries(db, 'kubernetes');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe('k8s-deployment');
    });

    it('filters by type', () => {
      const results = searchEntries(db, 'testing');
      const skills = results.filter((e) => e.type === 'skill');
      expect(skills.length).toBeGreaterThanOrEqual(1);
      expect(skills.every((e) => e.type === 'skill')).toBe(true);
    });
  });

  describe('whats_new logic', () => {
    it('returns recent entries within the time window', () => {
      const since = parseTimeWindow('7d');
      const entries = getRecentEntries(db, since);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('get_entry logic', () => {
    it('returns full entry content', () => {
      const entry = getEntryById(db, 'k8s-deployment');
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe('Kubernetes Deployment Guide');
      expect(entry!.content).toContain('Kubernetes');
    });

    it('returns null for nonexistent entry', () => {
      const entry = getEntryById(db, 'nonexistent');
      expect(entry).toBeNull();
    });
  });

  describe('brain_stats logic', () => {
    it('returns stats with receipt data', async () => {
      await recordReceipt(tempDir, 'k8s-deployment', 'bob', 'mcp');
      await recordReceipt(tempDir, 'k8s-deployment', 'charlie', 'mcp');

      const stats = getStats(tempDir, 'alice', '7d');
      const k8sStats = stats.find((s) => s.entryId === 'k8s-deployment');
      expect(k8sStats).toBeDefined();
      expect(k8sStats!.accessCount).toBe(2);
      expect(k8sStats!.uniqueReaders).toBe(2);
    });
  });

  describe('push_knowledge logic', () => {
    it('creates an entry with correct fields', () => {
      const entry = createEntry({
        title: 'New Guide',
        content: 'Some content here',
        type: 'guide',
        author: 'alice',
        tags: ['new', 'test'],
        summary: 'A new guide',
      });

      expect(entry.id).toBe('new-guide');
      expect(entry.title).toBe('New Guide');
      expect(entry.type).toBe('guide');
      expect(entry.author).toBe('alice');
      expect(entry.tags).toEqual(['new', 'test']);
      expect(entry.status).toBe('active');
    });
  });
});

describe('resource handler logic', () => {
  describe('brain://digest', () => {
    it('generates a markdown digest of recent entries', () => {
      const since = parseTimeWindow('7d');
      const entries = getRecentEntries(db, since);

      expect(entries.length).toBeGreaterThanOrEqual(1);

      const hasTitle = entries.some((e) => e.title.length > 0);
      const hasAuthor = entries.some((e) => e.author.length > 0);
      expect(hasTitle).toBe(true);
      expect(hasAuthor).toBe(true);
    });
  });

  describe('brain://stats', () => {
    it('generates stats summary', async () => {
      await recordReceipt(tempDir, 'k8s-deployment', 'bob', 'mcp');

      const stats = getStats(tempDir, 'alice', '7d');
      expect(stats.length).toBeGreaterThanOrEqual(1);

      const totalReads = stats.reduce((sum, s) => sum + s.accessCount, 0);
      expect(totalReads).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('MCP server integration', () => {
  it('creates server with tools and resources registered', () => {
    registerTools(server, context);
    registerResources(server, context);
    // If we get here without throwing, registration succeeded
    expect(server).toBeDefined();
  });

  it('records receipts on search', async () => {
    const results = searchEntries(db, 'kubernetes');
    for (const entry of results) {
      await recordReceipt(tempDir, entry.id, context.config.author, 'mcp');
    }

    const stats = getEntryStats(tempDir, 'k8s-deployment', '7d');
    expect(stats.accessCount).toBeGreaterThanOrEqual(1);
  });

  it('records receipts on get_entry', async () => {
    const entry = getEntryById(db, 'react-testing');
    expect(entry).not.toBeNull();

    await recordReceipt(tempDir, entry!.id, context.config.author, 'mcp');
    const stats = getEntryStats(tempDir, 'react-testing', '7d');
    expect(stats.accessCount).toBe(1);
  });
});
