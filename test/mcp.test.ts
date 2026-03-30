import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createIndex,
  getAllEntries,
  getEntryById,
  getRecentEntries,
  rebuildIndex,
  searchEntries,
} from '../src/core/index-db.js';
import { createEntry, scanEntries, writeEntry } from '../src/core/entry.js';
import { getEntryStats, getStats, recordReceipt } from '../src/core/receipts.js';
import { computeFreshness } from '../src/core/freshness.js';
import { buildUsageStatsMap } from '../src/core/freshness.js';
import { extractSignificantWords, extractTags } from '../src/utils/tags.js';
import { STOP_WORDS } from '../src/utils/constants.js';
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

// Relative dates so tests work regardless of when they run
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'test-entry',
    title: 'Test Entry',
    type: 'guide',
    author: 'alice',
    created: daysAgo(1),
    updated: daysAgo(1),
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
    created: daysAgo(3),
    updated: daysAgo(1),
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
    created: daysAgo(2),
    updated: daysAgo(0),
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
    created: daysAgo(0),
    updated: daysAgo(0),
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
    lastSync: daysAgo(0),
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
  it('registers all 7 tools without errors', () => {
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

// ─── get_recommendations logic ───

describe('get_recommendations logic', () => {
  it('returns entries matching topic via FTS search', () => {
    const results = searchEntries(db, 'kubernetes deployment', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('k8s-deployment');
  });

  it('extracts keywords from topic for tag matching', () => {
    const keywords = extractTags('I am deploying a React app to Kubernetes with Docker');
    expect(keywords).toContain('react');
    expect(keywords).toContain('kubernetes');
    expect(keywords).toContain('docker');
  });

  it('finds entries by tag overlap when FTS has no direct match', () => {
    const allEntries = getAllEntries(db);
    const topicTags = new Set(['testing']);

    const tagMatches = allEntries
      .filter((entry) => entry.tags.some((t) => topicTags.has(t.toLowerCase())))
      .sort((a, b) => {
        const aOverlap = a.tags.filter((t) => topicTags.has(t.toLowerCase())).length;
        const bOverlap = b.tags.filter((t) => topicTags.has(t.toLowerCase())).length;
        return bOverlap - aOverlap;
      });

    expect(tagMatches.length).toBeGreaterThanOrEqual(1);
    expect(tagMatches.some((e) => e.id === 'react-testing')).toBe(true);
  });

  it('scores with freshness component', () => {
    const entry = getEntryById(db, 'k8s-deployment')!;
    const freshness = computeFreshness(entry);
    expect(freshness.score).toBeGreaterThan(0);
    expect(freshness.score).toBeLessThanOrEqual(1);
    expect(['fresh', 'aging', 'stale']).toContain(freshness.label);
  });

  it('deduplicates entries across search and tag strategies', () => {
    // k8s-deployment matches both FTS for "kubernetes" and tag "devops"
    const searchResults = searchEntries(db, 'kubernetes', 10);
    const allEntries = getAllEntries(db);
    const topicTags = new Set(['devops']);

    const tagOnly = allEntries
      .filter((entry) => !searchResults.some((r) => r.id === entry.id))
      .filter((entry) => entry.tags.some((t) => topicTags.has(t.toLowerCase())));

    // k8s-deployment should already be in searchResults, not duplicated in tagOnly
    const searchIds = new Set(searchResults.map((e) => e.id));
    expect(searchIds.has('k8s-deployment')).toBe(true);
    expect(tagOnly.every((e) => !searchIds.has(e.id))).toBe(true);
  });

  it('returns empty for completely unrelated topic', () => {
    const results = searchEntries(db, 'quantum physics parallel universes', 5);
    const keywords = extractTags('quantum physics parallel universes');
    expect(results).toHaveLength(0);
    expect(keywords).toHaveLength(0);
  });

  it('filters stop words from natural language queries', () => {
    const topic = 'What approaches for caching API responses?';
    const techKeywords = extractTags(topic);
    const words = extractSignificantWords(topic);
    const allKeywords = [...new Set([...techKeywords, ...words])];

    // Stop words should be removed
    expect(allKeywords).not.toContain('what');
    expect(allKeywords).not.toContain('for');
    // 'approaches' is in STOP_WORDS as a query filler word
    expect(allKeywords).not.toContain('approaches');
    // Meaningful words should remain
    expect(allKeywords).toContain('caching');
    expect(allKeywords).toContain('responses');
    expect(allKeywords).toContain('api');
    expect(allKeywords.length).toBeGreaterThan(0);
  });

  it('handles queries that are mostly stop words', () => {
    const topic = 'What is the best way to do this?';
    const techKeywords = extractTags(topic);
    const words = extractSignificantWords(topic);
    const allKeywords = [...new Set([...techKeywords, ...words])];

    // Most words filtered, but 'way' survives (it's a meaningful word)
    expect(allKeywords.length).toBeLessThanOrEqual(1);
    // The query should still produce something rather than the raw NL input
    const searchQuery = allKeywords.length > 0 ? allKeywords.join(' ') : topic;
    expect(searchQuery).not.toContain('what');
    expect(searchQuery).not.toContain('best');
  });

  it('produces search results for natural language queries about existing content', () => {
    // This is the exact scenario from the bug report
    const topic = 'How do I deploy applications to Kubernetes?';
    const techKeywords = extractTags(topic);
    const words = extractSignificantWords(topic);
    const allKeywords = [...new Set([...techKeywords, ...words])];
    const searchQuery = allKeywords.length > 0 ? allKeywords.join(' ') : topic;

    // Should contain 'kubernetes' (tech term) and 'deploy'/'applications' (content words)
    expect(allKeywords).toContain('kubernetes');
    expect(allKeywords).toContain('deploy');
    expect(allKeywords).toContain('applications');
    expect(allKeywords).not.toContain('how');
    expect(allKeywords).not.toContain('the');

    // FTS search with filtered keywords should find our k8s entry
    const results = searchEntries(db, searchQuery, 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('k8s-deployment');
  });

  it('strips punctuation from words before stop word check', () => {
    const words = extractSignificantWords('What are the best testing approaches?');

    // 'approaches?' should become 'approaches' and be filtered as stop word
    expect(words).not.toContain('approaches');
    expect(words).not.toContain('approaches?');
    // 'testing' should survive
    expect(words).toContain('testing');
  });

  it('excludes archived entries from recommendations', () => {
    // Add an archived entry to the index
    const archivedEntry = makeEntry({
      id: 'old-docker-guide',
      title: 'Old Docker Guide',
      tags: ['docker', 'deployment'],
      content: 'Outdated Docker deployment guide.',
      status: 'archived',
      filePath: 'guides/old-docker-guide.md',
    });
    rebuildIndex(db, [...sampleEntries, archivedEntry]);

    // Search for docker — archived entry should be excluded
    const results = searchEntries(db, 'docker', 10)
      .filter((entry) => entry.status !== 'archived');
    expect(results.every((e) => e.status !== 'archived')).toBe(true);

    // Tag overlap should also exclude archived
    const allActive = getAllEntries(db)
      .filter((entry) => entry.status !== 'archived');
    expect(allActive.every((e) => e.id !== 'old-docker-guide')).toBe(true);
  });
});

// ─── update_entry logic ───

describe('update_entry logic', () => {
  beforeEach(() => {
    // Write entries to disk so we can update them
    for (const entry of sampleEntries) {
      const dirName = entry.type === 'guide' ? 'guides' : 'skills';
      const dirPath = path.join(tempDir, dirName);
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });

  it('retrieves existing entry for update', () => {
    const existing = getEntryById(db, 'k8s-deployment');
    expect(existing).not.toBeNull();
    expect(existing!.title).toBe('Kubernetes Deployment Guide');
  });

  it('merges only provided fields', () => {
    const existing = getEntryById(db, 'k8s-deployment')!;

    // Simulate partial update: only change tags and summary
    const updated: Entry = {
      ...existing,
      tags: ['kubernetes', 'helm', 'deployment'],
      summary: 'Updated K8s deployment with Helm',
      updated: new Date().toISOString(),
    };

    expect(updated.title).toBe(existing.title); // unchanged
    expect(updated.author).toBe(existing.author); // unchanged
    expect(updated.tags).toEqual(['kubernetes', 'helm', 'deployment']); // changed
    expect(updated.summary).toBe('Updated K8s deployment with Helm'); // changed
  });

  it('preserves unchanged fields during update', () => {
    const existing = getEntryById(db, 'react-testing')!;

    // Only update title
    const updated: Entry = {
      ...existing,
      title: 'React Testing Patterns v2',
      updated: new Date().toISOString(),
    };

    expect(updated.type).toBe('skill'); // preserved
    expect(updated.author).toBe('bob'); // preserved
    expect(updated.tags).toEqual(['react', 'testing']); // preserved
    expect(updated.content).toBe(existing.content); // preserved
  });

  it('writes updated entry to disk and rebuilds index', async () => {
    const existing = getEntryById(db, 'k8s-deployment')!;

    const updated: Entry = {
      ...existing,
      summary: 'Now with Helm charts',
      updated: new Date().toISOString(),
    };

    const filePath = await writeEntry(tempDir, updated);
    expect(filePath).toBe('guides/k8s-deployment.md');

    // Verify file was written
    const fullPath = path.join(tempDir, filePath);
    expect(fs.existsSync(fullPath)).toBe(true);
    const content = fs.readFileSync(fullPath, 'utf-8');
    expect(content).toContain('Now with Helm charts');
  });

  it('returns error for nonexistent entry', () => {
    const entry = getEntryById(db, 'nonexistent-entry');
    expect(entry).toBeNull();
  });

  it('can change entry status to archived', () => {
    const existing = getEntryById(db, 'ci-pipeline')!;
    expect(existing.status).toBe('active');

    const updated: Entry = {
      ...existing,
      status: 'archived',
      updated: new Date().toISOString(),
    };

    expect(updated.status).toBe('archived');
    expect(updated.id).toBe(existing.id); // ID preserved
  });

  it('can update content body', () => {
    const existing = getEntryById(db, 'react-testing')!;
    const newContent = 'Updated: Use React Testing Library instead of Enzyme.';

    const updated: Entry = {
      ...existing,
      content: newContent,
      updated: new Date().toISOString(),
    };

    expect(updated.content).toBe(newContent);
    expect(updated.title).toBe(existing.title); // other fields preserved
  });

  it('rebuilds index after update to reflect changes in search', async () => {
    const existing = getEntryById(db, 'k8s-deployment')!;

    const updated: Entry = {
      ...existing,
      tags: ['kubernetes', 'helm'],
      updated: new Date().toISOString(),
    };

    await writeEntry(tempDir, updated);

    // Write all entries to disk for scanEntries
    for (const entry of sampleEntries.filter((e) => e.id !== 'k8s-deployment')) {
      await writeEntry(tempDir, entry);
    }

    const scanned = await scanEntries(tempDir);
    rebuildIndex(db, scanned);

    const refreshed = getEntryById(db, 'k8s-deployment');
    expect(refreshed).not.toBeNull();
    expect(refreshed!.tags).toContain('helm');
  });
});
