import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import matter from 'gray-matter';
import { createEntry, writeEntry, scanEntries, parseEntry } from '../src/core/entry.js';
import {
  createIndex,
  rebuildIndex,
  getAllEntries,
  getEntryById,
} from '../src/core/index-db.js';
import { saveConfig } from '../src/core/config.js';
import type { BrainConfig, Entry } from '../src/types.js';

/**
 * Tests for brain edit command logic.
 * Tests the data flow: read entry → modify fields → serialize → write.
 */

let tempDir: string;
let repoDir: string;
let brainDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-edit-test-'));
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

async function seedEntry(title: string, overrides: Partial<Parameters<typeof createEntry>[0]> = {}): Promise<Entry> {
  const entry = createEntry({
    title,
    type: 'guide',
    content: 'Test content for editing.',
    author: 'alice',
    tags: ['typescript', 'testing'],
    summary: 'Original summary',
    ...overrides,
  });
  await writeEntry(repoDir, entry);

  const db = createIndex(dbPath);
  try {
    const scanned = await scanEntries(repoDir);
    rebuildIndex(db, scanned);
  } finally {
    db.close();
  }

  return entry;
}

describe('edit: title change', () => {
  it('updates the title in frontmatter', async () => {
    const entry = await seedEntry('Original Title');
    const fullPath = path.join(repoDir, entry.filePath);

    // Simulate edit: read, modify, write
    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseEntry(entry.filePath, content);
    const updated = { ...parsed, title: 'New Title', updated: new Date().toISOString() };

    const { serializeEntry } = await import('../src/core/entry.js');
    fs.writeFileSync(fullPath, serializeEntry(updated), 'utf-8');

    // Verify
    const reread = fs.readFileSync(fullPath, 'utf-8');
    const reparsed = matter(reread);
    expect(reparsed.data['title']).toBe('New Title');
  });
});

describe('edit: tag operations', () => {
  it('replaces all tags', async () => {
    const entry = await seedEntry('Tag Test', { tags: ['old1', 'old2'] });
    const fullPath = path.join(repoDir, entry.filePath);

    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseEntry(entry.filePath, content);
    const newTags = ['new1', 'new2', 'new3'];
    const updated = { ...parsed, tags: newTags, updated: new Date().toISOString() };

    const { serializeEntry } = await import('../src/core/entry.js');
    fs.writeFileSync(fullPath, serializeEntry(updated), 'utf-8');

    const reread = fs.readFileSync(fullPath, 'utf-8');
    const reparsed = matter(reread);
    expect(reparsed.data['tags']).toEqual(['new1', 'new2', 'new3']);
  });

  it('adds tags without removing existing', async () => {
    const entry = await seedEntry('Add Tag Test', { tags: ['existing'] });
    const fullPath = path.join(repoDir, entry.filePath);

    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseEntry(entry.filePath, content);
    const existing = new Set(parsed.tags.map((t) => t.toLowerCase()));

    const tagsToAdd = ['newTag'];
    for (const tag of tagsToAdd) {
      if (!existing.has(tag.toLowerCase())) {
        parsed.tags.push(tag);
        existing.add(tag.toLowerCase());
      }
    }

    const { serializeEntry } = await import('../src/core/entry.js');
    fs.writeFileSync(fullPath, serializeEntry({ ...parsed, updated: new Date().toISOString() }), 'utf-8');

    const reread = fs.readFileSync(fullPath, 'utf-8');
    const reparsed = matter(reread);
    expect(reparsed.data['tags']).toContain('existing');
    expect(reparsed.data['tags']).toContain('newTag');
  });

  it('does not duplicate existing tags on add', async () => {
    const entry = await seedEntry('Dup Tag Test', { tags: ['react', 'testing'] });
    const fullPath = path.join(repoDir, entry.filePath);

    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseEntry(entry.filePath, content);
    const existing = new Set(parsed.tags.map((t) => t.toLowerCase()));

    // Try to add 'react' again
    const tagsToAdd = ['react', 'newone'];
    for (const tag of tagsToAdd) {
      if (!existing.has(tag.toLowerCase())) {
        parsed.tags.push(tag);
        existing.add(tag.toLowerCase());
      }
    }

    expect(parsed.tags.filter((t) => t.toLowerCase() === 'react')).toHaveLength(1);
    expect(parsed.tags).toContain('newone');
  });

  it('removes specific tags', async () => {
    const entry = await seedEntry('Remove Tag Test', { tags: ['keep', 'remove-me', 'also-keep'] });
    const fullPath = path.join(repoDir, entry.filePath);

    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseEntry(entry.filePath, content);
    const toRemove = new Set(['remove-me']);
    parsed.tags = parsed.tags.filter((t) => !toRemove.has(t.toLowerCase()));

    const { serializeEntry } = await import('../src/core/entry.js');
    fs.writeFileSync(fullPath, serializeEntry({ ...parsed, updated: new Date().toISOString() }), 'utf-8');

    const reread = fs.readFileSync(fullPath, 'utf-8');
    const reparsed = matter(reread);
    expect(reparsed.data['tags']).toContain('keep');
    expect(reparsed.data['tags']).toContain('also-keep');
    expect(reparsed.data['tags']).not.toContain('remove-me');
  });
});

describe('edit: type change', () => {
  it('moves file from guides/ to skills/ on type change', async () => {
    const entry = await seedEntry('Type Change Test', { type: 'guide' });
    const oldPath = path.join(repoDir, entry.filePath);
    expect(fs.existsSync(oldPath)).toBe(true);
    expect(entry.filePath).toMatch(/^guides\//);

    // Simulate type change: read, modify, write to new location, delete old
    const content = fs.readFileSync(oldPath, 'utf-8');
    const parsed = parseEntry(entry.filePath, content);
    const updated = { ...parsed, type: 'skill' as const, updated: new Date().toISOString() };

    const newFilePath = `skills/${entry.id}.md`;
    const newFullPath = path.join(repoDir, newFilePath);

    const { serializeEntry } = await import('../src/core/entry.js');
    fs.writeFileSync(newFullPath, serializeEntry(updated), 'utf-8');
    fs.unlinkSync(oldPath);

    expect(fs.existsSync(newFullPath)).toBe(true);
    expect(fs.existsSync(oldPath)).toBe(false);

    // Verify type in frontmatter
    const reread = fs.readFileSync(newFullPath, 'utf-8');
    const reparsed = matter(reread);
    expect(reparsed.data['type']).toBe('skill');
  });
});

describe('edit: summary change', () => {
  it('updates the summary', async () => {
    const entry = await seedEntry('Summary Test', { summary: 'Old summary' });
    const fullPath = path.join(repoDir, entry.filePath);

    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseEntry(entry.filePath, content);
    const updated = { ...parsed, summary: 'New summary', updated: new Date().toISOString() };

    const { serializeEntry } = await import('../src/core/entry.js');
    fs.writeFileSync(fullPath, serializeEntry(updated), 'utf-8');

    const reread = fs.readFileSync(fullPath, 'utf-8');
    const reparsed = matter(reread);
    expect(reparsed.data['summary']).toBe('New summary');
  });
});

describe('edit: index rebuild after edit', () => {
  it('search index reflects edited metadata', async () => {
    const entry = await seedEntry('Search Index Test', { tags: ['oldtag'] });
    const fullPath = path.join(repoDir, entry.filePath);

    // Edit tags
    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseEntry(entry.filePath, content);
    const updated = { ...parsed, tags: ['newtag', 'updated'], updated: new Date().toISOString() };

    const { serializeEntry } = await import('../src/core/entry.js');
    fs.writeFileSync(fullPath, serializeEntry(updated), 'utf-8');

    // Rebuild index
    const scanned = await scanEntries(repoDir);
    const db = createIndex(dbPath);
    try {
      rebuildIndex(db, scanned);

      const found = getEntryById(db, entry.id);
      expect(found).not.toBeNull();
      expect(found!.tags).toContain('newtag');
      expect(found!.tags).toContain('updated');
      expect(found!.tags).not.toContain('oldtag');
    } finally {
      db.close();
    }
  });
});

describe('edit: preserves content', () => {
  it('editing metadata does not change the markdown body', async () => {
    const originalContent = 'This is the detailed guide content.\n\n## Section 1\n\nMore details here.';
    const entry = await seedEntry('Content Preserve Test', {
      content: originalContent,
    });
    const fullPath = path.join(repoDir, entry.filePath);

    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseEntry(entry.filePath, content);
    const updated = { ...parsed, title: 'Changed Title', updated: new Date().toISOString() };

    const { serializeEntry } = await import('../src/core/entry.js');
    fs.writeFileSync(fullPath, serializeEntry(updated), 'utf-8');

    const reread = fs.readFileSync(fullPath, 'utf-8');
    const reparsed = matter(reread);
    expect(reparsed.content.trim()).toBe(originalContent);
  });
});
