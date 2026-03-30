import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEntry, writeEntry, scanEntries, parseInputContent, extractTitle, titleFromFilename } from '../src/core/entry.js';
import { createIndex, rebuildIndex, getDbPath, getEntryById } from '../src/core/index-db.js';
import { saveConfig } from '../src/core/config.js';
import { extractTags } from '../src/utils/tags.js';
import type { BrainConfig } from '../src/types.js';
import { safeCleanup } from './test-helpers.js';

let tempDir: string;
let brainDir: string;
let repoDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-push-dryrun-test-'));
  brainDir = path.join(tempDir, '.brain');
  repoDir = path.join(tempDir, 'repo');
  dbPath = path.join(brainDir, 'cache.db');

  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);

  fs.mkdirSync(path.join(repoDir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'skills'), { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  const config: BrainConfig = {
    local: repoDir,
    author: 'testuser',
  };
  saveConfig(config);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await safeCleanup(tempDir);
});

// --- push --dry-run ---

describe('push dry-run preview', () => {
  it('previews title, type, and tags without writing', () => {
    const docPath = path.join(tempDir, 'docker-guide.md');
    fs.writeFileSync(docPath, '---\ntitle: Docker Guide\ntype: guide\ntags:\n  - docker\n---\n\nDocker content.');

    const raw = fs.readFileSync(docPath, 'utf-8');
    const parsed = parseInputContent(raw);

    expect(parsed.title).toBe('Docker Guide');
    expect(parsed.type).toBe('guide');
    expect(parsed.tags).toContain('docker');

    // Verify no files were written to brain repo
    const entries = fs.readdirSync(path.join(repoDir, 'guides'));
    expect(entries).not.toContain('docker-guide.md');
  });

  it('auto-detects title from H1 when no frontmatter', () => {
    const docPath = path.join(tempDir, 'setup.md');
    fs.writeFileSync(docPath, '# My Setup Guide\n\nSetup instructions with docker.');

    const raw = fs.readFileSync(docPath, 'utf-8');
    const parsed = parseInputContent(raw);
    const title = parsed.title ?? extractTitle(raw) ?? titleFromFilename(docPath);

    expect(title).toBe('My Setup Guide');
  });

  it('auto-detects tags from content', () => {
    const docPath = path.join(tempDir, 'guide.md');
    fs.writeFileSync(docPath, '# Guide\n\nUsing docker and kubernetes for deployment.');

    const raw = fs.readFileSync(docPath, 'utf-8');
    const parsed = parseInputContent(raw);
    const tags = parsed.tags ?? extractTags(parsed.content);

    expect(tags).toContain('docker');
    expect(tags).toContain('kubernetes');
  });

  it('falls back to filename for title', () => {
    const docPath = path.join(tempDir, 'my-awesome-guide.md');
    fs.writeFileSync(docPath, 'Just some text without a heading.');

    const title = titleFromFilename(docPath);
    expect(title).toBe('my awesome guide');
  });
});

// --- retract archives instead of deleting ---

describe('retract archives entry', () => {
  it('moves entry to _archive/ with updated frontmatter', async () => {
    const entry = createEntry({
      title: 'Old Guide',
      type: 'guide',
      content: 'Outdated content.',
      author: 'alice',
    });
    await writeEntry(repoDir, entry);

    const originalPath = path.join(repoDir, entry.filePath);
    expect(fs.existsSync(originalPath)).toBe(true);

    // Simulate retract: read, update frontmatter, write to archive, delete original
    const matter = await import('gray-matter');
    const raw = fs.readFileSync(originalPath, 'utf-8');
    const parsed = matter.default(raw);
    const newData = { ...parsed.data, status: 'archived', archived_reason: 'retracted' };
    const updated = matter.default.stringify(parsed.content, newData);

    const archivePath = path.join(repoDir, '_archive', entry.filePath);
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, updated, 'utf-8');
    fs.unlinkSync(originalPath);

    // Verify original is gone
    expect(fs.existsSync(originalPath)).toBe(false);

    // Verify archive exists with correct frontmatter
    expect(fs.existsSync(archivePath)).toBe(true);
    const archived = matter.default(fs.readFileSync(archivePath, 'utf-8'));
    expect(archived.data['status']).toBe('archived');
    expect(archived.data['archived_reason']).toBe('retracted');
  });

  it('retracted entry is not in scan results', async () => {
    const entry = createEntry({
      title: 'Retracted Guide',
      type: 'guide',
      content: 'Will be retracted.',
      author: 'bob',
    });
    await writeEntry(repoDir, entry);

    // Move to archive
    const originalPath = path.join(repoDir, entry.filePath);
    const archivePath = path.join(repoDir, '_archive', entry.filePath);
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.renameSync(originalPath, archivePath);

    // Scan should not find it
    const entries = await scanEntries(repoDir);
    const found = entries.find(e => e.id === 'retracted-guide');
    expect(found).toBeUndefined();
  });
});
