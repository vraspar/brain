import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createEntry,
  extractTitle,
  generateEntryId,
  parseEntry,
  parseInputContent,
  scanEntries,
  serializeEntry,
  titleFromFilename,
  writeEntry,
} from '../src/core/entry.js';
import type { Entry } from '../src/types.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-entry-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const VALID_FRONTMATTER = `---
title: My Test Guide
author: alice
created: "2026-03-01T00:00:00Z"
updated: "2026-03-20T00:00:00Z"
tags:
  - testing
  - demo
type: guide
status: active
summary: A test guide for testing
---

This is the body content.

## Section One

More content here.`;

describe('parseEntry', () => {
  it('parses valid frontmatter and content', () => {
    const entry = parseEntry('guides/my-test-guide.md', VALID_FRONTMATTER);
    expect(entry.id).toBe('my-test-guide');
    expect(entry.title).toBe('My Test Guide');
    expect(entry.author).toBe('alice');
    expect(entry.tags).toEqual(['testing', 'demo']);
    expect(entry.type).toBe('guide');
    expect(entry.status).toBe('active');
    expect(entry.summary).toBe('A test guide for testing');
    expect(entry.content).toContain('This is the body content.');
    expect(entry.content).toContain('Section One');
    expect(entry.filePath).toBe('guides/my-test-guide.md');
  });

  it('defaults status to active when not specified', () => {
    const content = `---
title: No Status
author: bob
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
type: skill
---
Content here.`;
    const entry = parseEntry('skills/no-status.md', content);
    expect(entry.status).toBe('active');
  });

  it('defaults tags to empty array when not specified', () => {
    const content = `---
title: No Tags
author: bob
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
type: guide
---
Content.`;
    const entry = parseEntry('guides/no-tags.md', content);
    expect(entry.tags).toEqual([]);
  });

  it('throws on missing required fields', () => {
    const content = `---
title: Missing Author
---
Content.`;
    expect(() => parseEntry('guides/bad.md', content)).toThrow('missing required frontmatter');
  });

  it('throws on invalid type', () => {
    const content = `---
title: Bad Type
author: alice
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
type: invalid
---
Content.`;
    expect(() => parseEntry('guides/bad.md', content)).toThrow('invalid type');
  });

  it('throws on invalid status', () => {
    const content = `---
title: Bad Status
author: alice
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
type: guide
status: deleted
---
Content.`;
    expect(() => parseEntry('guides/bad.md', content)).toThrow('invalid status');
  });

  it('parses optional related_repos and related_tools', () => {
    const content = `---
title: With Relations
author: alice
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
type: guide
related_repos:
  - repo-a
  - repo-b
related_tools:
  - eslint
---
Content.`;
    const entry = parseEntry('guides/relations.md', content);
    expect(entry.related_repos).toEqual(['repo-a', 'repo-b']);
    expect(entry.related_tools).toEqual(['eslint']);
  });
});

describe('serializeEntry', () => {
  it('roundtrips through parse and serialize', () => {
    const original = parseEntry('guides/roundtrip.md', VALID_FRONTMATTER);
    const serialized = serializeEntry(original);
    const reparsed = parseEntry('guides/roundtrip.md', serialized);

    expect(reparsed.title).toBe(original.title);
    expect(reparsed.author).toBe(original.author);
    expect(reparsed.type).toBe(original.type);
    expect(reparsed.tags).toEqual(original.tags);
    expect(reparsed.content).toContain('This is the body content.');
  });

  it('includes optional fields when present', () => {
    const entry = createEntry({
      title: 'With Summary',
      type: 'guide',
      content: 'Test content',
      author: 'alice',
      summary: 'A summary',
      related_repos: ['repo-a'],
      related_tools: ['tool-b'],
    });
    const serialized = serializeEntry(entry);
    expect(serialized).toContain('summary');
    expect(serialized).toContain('related_repos');
    expect(serialized).toContain('related_tools');
  });

  it('omits optional fields when absent', () => {
    const entry = createEntry({
      title: 'Minimal',
      type: 'skill',
      content: 'Bare minimum',
      author: 'bob',
    });
    const serialized = serializeEntry(entry);
    expect(serialized).not.toContain('summary');
    expect(serialized).not.toContain('related_repos');
    expect(serialized).not.toContain('related_tools');
  });
});

describe('scanEntries', () => {
  it('scans guides and skills directories', async () => {
    // Set up a fake repo with entries
    const guidesDir = path.join(tempDir, 'guides');
    const skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(guidesDir);
    fs.mkdirSync(skillsDir);

    fs.writeFileSync(path.join(guidesDir, 'guide-one.md'), VALID_FRONTMATTER, 'utf-8');
    fs.writeFileSync(
      path.join(skillsDir, 'skill-one.md'),
      `---
title: Skill One
author: bob
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
type: skill
---
Skill content.`,
      'utf-8',
    );

    const entries = await scanEntries(tempDir);
    expect(entries).toHaveLength(2);

    const ids = entries.map((e) => e.id);
    expect(ids).toContain('guide-one');
    expect(ids).toContain('skill-one');
  });

  it('skips malformed entries without crashing', async () => {
    const guidesDir = path.join(tempDir, 'guides');
    fs.mkdirSync(guidesDir);

    // Valid entry
    fs.writeFileSync(path.join(guidesDir, 'good.md'), VALID_FRONTMATTER, 'utf-8');
    // Malformed entry (missing required fields)
    fs.writeFileSync(path.join(guidesDir, 'bad.md'), '---\ntitle: Bad\n---\nNo author.', 'utf-8');

    const entries = await scanEntries(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('good');
  });

  it('returns empty array when directories do not exist', async () => {
    const entries = await scanEntries(tempDir);
    expect(entries).toEqual([]);
  });

  it('ignores non-markdown files', async () => {
    const guidesDir = path.join(tempDir, 'guides');
    fs.mkdirSync(guidesDir);
    fs.writeFileSync(path.join(guidesDir, 'notes.txt'), 'Not markdown', 'utf-8');

    const entries = await scanEntries(tempDir);
    expect(entries).toEqual([]);
  });
});

describe('writeEntry', () => {
  it('writes a guide to the guides directory', async () => {
    const entry = createEntry({
      title: 'Write Test',
      type: 'guide',
      content: 'Guide content here.',
      author: 'alice',
      tags: ['test'],
    });

    const filePath = await writeEntry(tempDir, entry);
    expect(filePath).toBe('guides/write-test.md');

    const fullPath = path.join(tempDir, filePath);
    expect(fs.existsSync(fullPath)).toBe(true);

    const content = fs.readFileSync(fullPath, 'utf-8');
    expect(content).toContain('title: Write Test');
    expect(content).toContain('Guide content here.');
  });

  it('writes a skill to the skills directory', async () => {
    const entry = createEntry({
      title: 'Skill Test',
      type: 'skill',
      content: 'Skill content.',
      author: 'bob',
    });

    const filePath = await writeEntry(tempDir, entry);
    expect(filePath).toBe('skills/skill-test.md');
    expect(fs.existsSync(path.join(tempDir, filePath))).toBe(true);
  });

  it('creates directory if it does not exist', async () => {
    const guidesDir = path.join(tempDir, 'guides');
    expect(fs.existsSync(guidesDir)).toBe(false);

    const entry = createEntry({
      title: 'Create Dir',
      type: 'guide',
      content: 'Content.',
      author: 'alice',
    });

    await writeEntry(tempDir, entry);
    expect(fs.existsSync(guidesDir)).toBe(true);
  });
});

describe('generateEntryId', () => {
  it('generates a slug from title', () => {
    expect(generateEntryId('My Cool Guide')).toBe('my-cool-guide');
  });

  it('throws for empty/special-only titles', () => {
    expect(() => generateEntryId('!!!')).toThrow('Cannot generate ID');
  });
});

describe('createEntry', () => {
  it('creates a fully populated entry', () => {
    const entry = createEntry({
      title: 'New Guide',
      type: 'guide',
      content: 'Content here.',
      author: 'alice',
      tags: ['tag1', 'tag2'],
      summary: 'A summary.',
    });

    expect(entry.id).toBe('new-guide');
    expect(entry.title).toBe('New Guide');
    expect(entry.author).toBe('alice');
    expect(entry.type).toBe('guide');
    expect(entry.status).toBe('active');
    expect(entry.tags).toEqual(['tag1', 'tag2']);
    expect(entry.summary).toBe('A summary.');
    expect(entry.filePath).toBe('guides/new-guide.md');
    expect(entry.created).toBeTruthy();
    expect(entry.updated).toBeTruthy();
  });

  it('defaults tags to empty array', () => {
    const entry = createEntry({
      title: 'Minimal',
      type: 'skill',
      content: 'Content.',
      author: 'bob',
    });
    expect(entry.tags).toEqual([]);
    expect(entry.filePath).toBe('skills/minimal.md');
  });
});

describe('extractTitle', () => {
  it('extracts title from frontmatter', () => {
    const content = '---\ntitle: My Guide\n---\n# Heading\nBody text.';
    expect(extractTitle(content)).toBe('My Guide');
  });

  it('extracts title from H1 heading when no frontmatter', () => {
    const content = '# Docker Deployment Guide\n\nHow to deploy.';
    expect(extractTitle(content)).toBe('Docker Deployment Guide');
  });

  it('extracts first non-empty line when no H1', () => {
    const content = 'This is the first line.\n\nMore content.';
    expect(extractTitle(content)).toBe('This is the first line.');
  });

  it('returns null for empty content', () => {
    expect(extractTitle('')).toBeNull();
  });

  it('prefers frontmatter title over H1', () => {
    const content = '---\ntitle: Frontmatter Title\n---\n# H1 Title\nBody.';
    expect(extractTitle(content)).toBe('Frontmatter Title');
  });
});

describe('titleFromFilename', () => {
  it('converts hyphens to spaces', () => {
    expect(titleFromFilename('docker-deployment-guide.md')).toBe('docker deployment guide');
  });

  it('converts underscores to spaces', () => {
    expect(titleFromFilename('my_guide_v2.md')).toBe('my guide v2');
  });

  it('handles path with directories', () => {
    expect(titleFromFilename('/home/user/docs/my-guide.md')).toBe('my guide');
  });
});

describe('parseInputContent', () => {
  it('parses content with full frontmatter', () => {
    const raw = '---\ntitle: My Guide\ntype: guide\ntags:\n  - docker\nsummary: A guide\n---\nBody text.';
    const parsed = parseInputContent(raw);
    expect(parsed.title).toBe('My Guide');
    expect(parsed.type).toBe('guide');
    expect(parsed.tags).toEqual(['docker']);
    expect(parsed.summary).toBe('A guide');
    expect(parsed.content).toBe('Body text.');
  });

  it('parses content without frontmatter', () => {
    const raw = '# Plain Markdown\n\nSome content here.';
    const parsed = parseInputContent(raw);
    expect(parsed.title).toBeNull();
    expect(parsed.type).toBeNull();
    expect(parsed.tags).toBeNull();
    expect(parsed.content).toBe(raw);
  });

  it('handles partial frontmatter (only title)', () => {
    const raw = '---\ntitle: Just a Title\n---\nContent.';
    const parsed = parseInputContent(raw);
    expect(parsed.title).toBe('Just a Title');
    expect(parsed.type).toBeNull();
    expect(parsed.tags).toBeNull();
  });

  it('rejects invalid type values', () => {
    const raw = '---\ntitle: Test\ntype: invalid\n---\nContent.';
    const parsed = parseInputContent(raw);
    expect(parsed.type).toBeNull();
  });
});
