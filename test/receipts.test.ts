import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEntryStats,
  getStats,
  getTopEntries,
  recordReceipt,
} from '../src/core/receipts.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-receipts-test-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('recordReceipt', () => {
  it('creates a receipt JSON file in the correct directory', async () => {
    await recordReceipt(tempDir, 'k8s-deployment', 'priya', 'cli');

    const receiptsBase = path.join(tempDir, '_analytics', 'receipts');
    expect(fs.existsSync(receiptsBase)).toBe(true);

    const dateDirs = fs.readdirSync(receiptsBase);
    expect(dateDirs).toHaveLength(1);
    expect(dateDirs[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const dateDir = path.join(receiptsBase, dateDirs[0]);
    const files = fs.readdirSync(dateDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^priya-k8s-deployment-[a-f0-9]{6}\.json$/);
  });

  it('writes correct receipt content', async () => {
    await recordReceipt(tempDir, 'react-testing', 'bob', 'mcp');

    const receiptsBase = path.join(tempDir, '_analytics', 'receipts');
    const dateDirs = fs.readdirSync(receiptsBase);
    const dateDir = path.join(receiptsBase, dateDirs[0]);
    const files = fs.readdirSync(dateDir);
    const content = JSON.parse(fs.readFileSync(path.join(dateDir, files[0]), 'utf-8'));

    expect(content.entry_id).toBe('react-testing');
    expect(content.reader).toBe('bob');
    expect(content.source).toBe('mcp');
    expect(content.timestamp).toBeTruthy();
    // Validate ISO 8601 format
    expect(new Date(content.timestamp).toISOString()).toBe(content.timestamp);
  });

  it('creates unique files to avoid collisions', async () => {
    await recordReceipt(tempDir, 'k8s-deployment', 'priya', 'cli');
    await recordReceipt(tempDir, 'k8s-deployment', 'priya', 'cli');

    const receiptsBase = path.join(tempDir, '_analytics', 'receipts');
    const dateDirs = fs.readdirSync(receiptsBase);
    const dateDir = path.join(receiptsBase, dateDirs[0]);
    const files = fs.readdirSync(dateDir);
    expect(files).toHaveLength(2);
    // Files should have different random suffixes
    expect(files[0]).not.toBe(files[1]);
  });

  it('supports both cli and mcp sources', async () => {
    await recordReceipt(tempDir, 'entry-1', 'alice', 'cli');
    await recordReceipt(tempDir, 'entry-2', 'bob', 'mcp');

    const receiptsBase = path.join(tempDir, '_analytics', 'receipts');
    const dateDirs = fs.readdirSync(receiptsBase);
    const dateDir = path.join(receiptsBase, dateDirs[0]);
    const files = fs.readdirSync(dateDir).sort();

    const content1 = JSON.parse(fs.readFileSync(path.join(dateDir, files[0]), 'utf-8'));
    const content2 = JSON.parse(fs.readFileSync(path.join(dateDir, files[1]), 'utf-8'));

    expect([content1.source, content2.source].sort()).toEqual(['cli', 'mcp']);
  });
});

describe('getStats', () => {
  beforeEach(async () => {
    // Create receipts for today
    await recordReceipt(tempDir, 'k8s-deployment', 'priya', 'cli');
    await recordReceipt(tempDir, 'k8s-deployment', 'bob', 'mcp');
    await recordReceipt(tempDir, 'k8s-deployment', 'priya', 'cli');
    await recordReceipt(tempDir, 'react-testing', 'alice', 'cli');
  });

  it('aggregates stats by entry', () => {
    const stats = getStats(tempDir, 'alice', '7d');

    const k8sStats = stats.find((s) => s.entryId === 'k8s-deployment');
    const reactStats = stats.find((s) => s.entryId === 'react-testing');

    expect(k8sStats).toBeDefined();
    expect(k8sStats!.accessCount).toBe(3);
    expect(k8sStats!.uniqueReaders).toBe(2); // priya and bob

    expect(reactStats).toBeDefined();
    expect(reactStats!.accessCount).toBe(1);
    expect(reactStats!.uniqueReaders).toBe(1);
  });

  it('sorts by access count descending', () => {
    const stats = getStats(tempDir, 'alice', '7d');
    expect(stats[0].entryId).toBe('k8s-deployment');
    expect(stats[1].entryId).toBe('react-testing');
  });

  it('returns empty array when no receipts exist', () => {
    const emptyDir = path.join(tempDir, 'empty-repo');
    fs.mkdirSync(emptyDir, { recursive: true });
    const stats = getStats(emptyDir, 'alice', '7d');
    expect(stats).toHaveLength(0);
  });

  it('includes the period in results', () => {
    const stats = getStats(tempDir, 'alice', '7d');
    expect(stats.every((s) => s.period === '7d')).toBe(true);
  });
});

describe('getEntryStats', () => {
  beforeEach(async () => {
    await recordReceipt(tempDir, 'k8s-deployment', 'priya', 'cli');
    await recordReceipt(tempDir, 'k8s-deployment', 'bob', 'mcp');
    await recordReceipt(tempDir, 'k8s-deployment', 'priya', 'cli');
  });

  it('returns access count and unique readers for a single entry', () => {
    const stats = getEntryStats(tempDir, 'k8s-deployment', '7d');
    expect(stats.accessCount).toBe(3);
    expect(stats.uniqueReaders).toBe(2);
  });

  it('returns zeros for unknown entry', () => {
    const stats = getEntryStats(tempDir, 'nonexistent', '7d');
    expect(stats.accessCount).toBe(0);
    expect(stats.uniqueReaders).toBe(0);
  });
});

describe('getTopEntries', () => {
  beforeEach(async () => {
    await recordReceipt(tempDir, 'k8s-deployment', 'priya', 'cli');
    await recordReceipt(tempDir, 'k8s-deployment', 'bob', 'mcp');
    await recordReceipt(tempDir, 'k8s-deployment', 'alice', 'cli');
    await recordReceipt(tempDir, 'react-testing', 'alice', 'cli');
    await recordReceipt(tempDir, 'react-testing', 'bob', 'mcp');
    await recordReceipt(tempDir, 'ci-pipeline', 'priya', 'cli');
  });

  it('returns entries sorted by access count', () => {
    const top = getTopEntries(tempDir, '7d');
    expect(top[0].entryId).toBe('k8s-deployment');
    expect(top[0].accessCount).toBe(3);
    expect(top[1].entryId).toBe('react-testing');
    expect(top[1].accessCount).toBe(2);
    expect(top[2].entryId).toBe('ci-pipeline');
    expect(top[2].accessCount).toBe(1);
  });

  it('respects the limit parameter', () => {
    const top = getTopEntries(tempDir, '7d', 2);
    expect(top).toHaveLength(2);
  });

  it('uses default limit of 10', () => {
    const top = getTopEntries(tempDir, '7d');
    expect(top.length).toBeLessThanOrEqual(10);
  });
});

describe('period filtering', () => {
  it('excludes receipts outside the period window', async () => {
    // Create a receipt dir for an old date
    const oldDate = '2026-01-01';
    const oldDir = path.join(tempDir, '_analytics', 'receipts', oldDate);
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(
      path.join(oldDir, 'alice-old-entry-abc123.json'),
      JSON.stringify({
        entry_id: 'old-entry',
        reader: 'alice',
        timestamp: '2026-01-01T10:00:00Z',
        source: 'cli',
      }),
      'utf-8',
    );

    // Create a receipt for today
    await recordReceipt(tempDir, 'new-entry', 'bob', 'cli');

    const stats = getStats(tempDir, 'alice', '7d');
    const entryIds = stats.map((s) => s.entryId);
    expect(entryIds).toContain('new-entry');
    expect(entryIds).not.toContain('old-entry');
  });

  it('throws for invalid period format', () => {
    expect(() => getStats(tempDir, 'alice', 'invalid')).toThrow('Invalid period');
  });

  it('supports day, week, and month periods', async () => {
    await recordReceipt(tempDir, 'entry-1', 'alice', 'cli');

    // All these should work without throwing
    expect(() => getStats(tempDir, 'alice', '1d')).not.toThrow();
    expect(() => getStats(tempDir, 'alice', '2w')).not.toThrow();
    expect(() => getStats(tempDir, 'alice', '3m')).not.toThrow();
  });
});
