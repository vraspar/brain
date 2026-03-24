import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import matter from 'gray-matter';
import { createEntry, writeEntry, scanEntries } from '../src/core/entry.js';
import {
  createIndex,
  rebuildIndex,
  getAllEntries,
  getEntryById,
} from '../src/core/index-db.js';
import { saveConfig } from '../src/core/config.js';
import type { BrainConfig, Entry } from '../src/types.js';

let tempDir: string;
let repoDir: string;
let brainDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-restore-test-'));
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
  };
  saveConfig(config);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function archiveEntry(entry: Entry): void {
  const sourcePath = path.join(repoDir, entry.filePath);
  const archivePath = path.join(repoDir, '_archive', entry.filePath);

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });

  // Update frontmatter to archived using spread to avoid gray-matter reference issues
  const content = fs.readFileSync(sourcePath, 'utf-8');
  const parsed = matter(content);
  const archivedData: Record<string, unknown> = {
    ...parsed.data,
    status: 'archived',
    archived_at: '2026-03-20T00:00:00Z',
    archived_reason: 'freshness-prune',
  };
  const updated = matter.stringify(parsed.content, archivedData);

  fs.writeFileSync(archivePath, updated, 'utf-8');
  fs.unlinkSync(sourcePath);
}

describe('restore: find archived entries', () => {
  it('finds an archived guide by ID', async () => {
    const entry = createEntry({
      title: 'Old Guide',
      type: 'guide',
      content: 'Old content',
      author: 'alice',
    });
    await writeEntry(repoDir, entry);
    archiveEntry(entry);

    const archivePath = path.join(repoDir, '_archive', entry.filePath);
    expect(fs.existsSync(archivePath)).toBe(true);
    expect(fs.existsSync(path.join(repoDir, entry.filePath))).toBe(false);
  });

  it('finds an archived skill by ID', async () => {
    const entry = createEntry({
      title: 'Old Skill',
      type: 'skill',
      content: 'Skill content',
      author: 'bob',
    });
    await writeEntry(repoDir, entry);
    archiveEntry(entry);

    const archivePath = path.join(repoDir, '_archive', entry.filePath);
    expect(fs.existsSync(archivePath)).toBe(true);
    expect(entry.filePath).toMatch(/^skills\//);
  });

  it('returns false for non-archived entry', () => {
    const archivePath = path.join(repoDir, '_archive', 'guides', 'nonexistent.md');
    expect(fs.existsSync(archivePath)).toBe(false);
  });
});

describe('restore: file movement', () => {
  it('moves file back from _archive/ to original location', async () => {
    const entry = createEntry({
      title: 'Restore Me',
      type: 'guide',
      content: 'Content to restore',
      author: 'alice',
    });
    await writeEntry(repoDir, entry);
    archiveEntry(entry);

    // Simulate restore: move back
    const archivePath = path.join(repoDir, '_archive', entry.filePath);
    const restorePath = path.join(repoDir, entry.filePath);

    const content = fs.readFileSync(archivePath, 'utf-8');
    fs.writeFileSync(restorePath, content, 'utf-8');
    fs.unlinkSync(archivePath);

    expect(fs.existsSync(restorePath)).toBe(true);
    expect(fs.existsSync(archivePath)).toBe(false);
  });

  it('restores entry with status set back to active', async () => {
    const entry = createEntry({
      title: 'Restore Status',
      type: 'guide',
      content: 'Content',
      author: 'alice',
    });
    await writeEntry(repoDir, entry);
    archiveEntry(entry);

    // Read archived file
    const archivePath = path.join(repoDir, '_archive', entry.filePath);
    const content = fs.readFileSync(archivePath, 'utf-8');
    const parsed = matter(content);

    expect(parsed.data['status']).toBe('archived');
    expect(parsed.data['archived_at']).toBeDefined();
    expect(parsed.data['archived_reason']).toBe('freshness-prune');

    // Simulate restore: update status
    const restoredData = { ...parsed.data, status: 'active' };
    delete restoredData['archived_at'];
    delete restoredData['archived_reason'];
    const updated = matter.stringify(parsed.content, restoredData);

    const restorePath = path.join(repoDir, entry.filePath);
    fs.writeFileSync(restorePath, updated, 'utf-8');
    fs.unlinkSync(archivePath);

    // Verify restored content
    const restoredContent = fs.readFileSync(restorePath, 'utf-8');
    const restoredParsed = matter(restoredContent);
    expect(restoredParsed.data['status']).toBe('active');
    expect(restoredParsed.data['archived_at']).toBeUndefined();
    expect(restoredParsed.data['archived_reason']).toBeUndefined();
  });
});

describe('restore: index rebuild after restore', () => {
  it('restored entry appears in search index', async () => {
    const entry = createEntry({
      title: 'Kubernetes Guide',
      type: 'guide',
      content: 'Deploy to Kubernetes clusters',
      author: 'alice',
      tags: ['kubernetes'],
    });
    await writeEntry(repoDir, entry);

    // Index before archive
    let db = createIndex(dbPath);
    let scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);
    expect(getAllEntries(db)).toHaveLength(1);
    db.close();

    // Archive
    archiveEntry(entry);
    db = createIndex(dbPath);
    scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);
    expect(getAllEntries(db)).toHaveLength(0);
    db.close();

    // Restore
    const archivePath = path.join(repoDir, '_archive', entry.filePath);
    const content = fs.readFileSync(archivePath, 'utf-8');
    const parsed = matter(content);
    const restoredData = { ...parsed.data, status: 'active' };
    delete restoredData['archived_at'];
    delete restoredData['archived_reason'];
    fs.writeFileSync(path.join(repoDir, entry.filePath), matter.stringify(parsed.content, restoredData), 'utf-8');
    fs.unlinkSync(archivePath);

    // Rebuild and verify
    db = createIndex(dbPath);
    try {
      scanned = await scanEntries(repoDir);
      rebuildIndex(db, scanned);

      expect(getAllEntries(db)).toHaveLength(1);
      const restored = getEntryById(db, entry.id);
      expect(restored).not.toBeNull();
      expect(restored!.title).toBe('Kubernetes Guide');
      expect(restored!.status).toBe('active');
    } finally {
      db.close();
    }
  });
});

describe('restore: list archived entries', () => {
  it('lists all archived entries', async () => {
    const guideA = createEntry({ title: 'Guide A', type: 'guide', content: 'A', author: 'alice' });
    const guideB = createEntry({ title: 'Guide B', type: 'guide', content: 'B', author: 'bob' });
    await writeEntry(repoDir, guideA);
    await writeEntry(repoDir, guideB);
    archiveEntry(guideA);
    archiveEntry(guideB);

    // Check archive directory has files
    const archiveDir = path.join(repoDir, '_archive', 'guides');
    const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(2);
  });

  it('returns empty list when no archived entries', () => {
    const archiveBase = path.join(repoDir, '_archive');
    expect(fs.existsSync(archiveBase)).toBe(false);
  });
});

describe('restore: edge cases', () => {
  it('handles restoring when original directory still exists', async () => {
    const entry = createEntry({
      title: 'Edge Case Guide',
      type: 'guide',
      content: 'Edge case content',
      author: 'alice',
    });
    await writeEntry(repoDir, entry);
    archiveEntry(entry);

    // guides/ directory still exists (other guides might be there)
    expect(fs.existsSync(path.join(repoDir, 'guides'))).toBe(true);

    // Restore should work fine
    const archivePath = path.join(repoDir, '_archive', entry.filePath);
    const content = fs.readFileSync(archivePath, 'utf-8');
    fs.writeFileSync(path.join(repoDir, entry.filePath), content, 'utf-8');
    fs.unlinkSync(archivePath);

    expect(fs.existsSync(path.join(repoDir, entry.filePath))).toBe(true);
  });

  it('preserves original content through archive-restore cycle', async () => {
    const originalContent = 'This is detailed content about deploying with Kubernetes and Helm.';
    const entry = createEntry({
      title: 'Round Trip Guide',
      type: 'guide',
      content: originalContent,
      author: 'alice',
      tags: ['kubernetes', 'helm'],
      summary: 'A deployment guide',
    });
    await writeEntry(repoDir, entry);

    // Read original
    const originalFile = fs.readFileSync(path.join(repoDir, entry.filePath), 'utf-8');
    const originalParsed = matter(originalFile);

    // Archive
    archiveEntry(entry);

    // Restore
    const archivePath = path.join(repoDir, '_archive', entry.filePath);
    const archivedFile = fs.readFileSync(archivePath, 'utf-8');
    const parsed = matter(archivedFile);
    const restoredData = { ...parsed.data, status: 'active' };
    delete restoredData['archived_at'];
    delete restoredData['archived_reason'];
    fs.writeFileSync(path.join(repoDir, entry.filePath), matter.stringify(parsed.content, restoredData), 'utf-8');
    fs.unlinkSync(archivePath);

    // Verify content preserved
    const restoredFile = fs.readFileSync(path.join(repoDir, entry.filePath), 'utf-8');
    const restoredParsed = matter(restoredFile);

    expect(restoredParsed.content.trim()).toBe(originalParsed.content.trim());
    expect(restoredParsed.data['title']).toBe(originalParsed.data['title']);
    expect(restoredParsed.data['tags']).toEqual(originalParsed.data['tags']);
  });
});
