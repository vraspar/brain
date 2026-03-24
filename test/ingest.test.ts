import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  shouldIncludeFile,
  matchGlob,
  computeImportFreshness,
  extractRepoName,
  isRemoteUrl,
  discoverCandidates,
  importCandidates,
  runIngest,
} from '../src/core/ingest.js';
import { createIndex, getEntryById, rebuildIndex } from '../src/core/index-db.js';
import { scanEntries, createEntry, writeEntry } from '../src/core/entry.js';
import { saveConfig } from '../src/core/config.js';
import type { BrainConfig, IngestCandidate } from '../src/types.js';

let tempDir: string;
let brainDir: string;
let repoDir: string;
let dbPath: string;
let sourceDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-ingest-test-'));
  brainDir = path.join(tempDir, '.brain');
  repoDir = path.join(tempDir, 'repo');
  dbPath = path.join(brainDir, 'cache.db');
  sourceDir = path.join(tempDir, 'source');

  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);

  // Create brain repo structure
  fs.mkdirSync(path.join(repoDir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'skills'), { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  const config: BrainConfig = {
    remote: 'https://github.com/team/brain.git',
    local: repoDir,
    author: 'testuser',
    lastSync: new Date().toISOString(),
  };
  saveConfig(config);

  // Create source repo with docs
  fs.mkdirSync(path.join(sourceDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, '.github'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeSourceDoc(relPath: string, content: string): void {
  const fullPath = path.join(sourceDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

// --- shouldIncludeFile ---

describe('shouldIncludeFile', () => {
  it('includes regular doc files', () => {
    expect(shouldIncludeFile('docs/setup.md')).toBe(true);
    expect(shouldIncludeFile('guides/deploy.md')).toBe(true);
  });

  it('excludes root-level README and meta files', () => {
    expect(shouldIncludeFile('README.md')).toBe(false);
    expect(shouldIncludeFile('CHANGELOG.md')).toBe(false);
    expect(shouldIncludeFile('LICENSE.md')).toBe(false);
    expect(shouldIncludeFile('CONTRIBUTING.md')).toBe(false);
  });

  it('includes nested README files as documentation', () => {
    expect(shouldIncludeFile('docs/README.md')).toBe(true);
    expect(shouldIncludeFile('guides/readme.md')).toBe(true);
    expect(shouldIncludeFile('api/v2/README.md')).toBe(true);
  });

  it('excludes node_modules and build dirs', () => {
    expect(shouldIncludeFile('node_modules/pkg/readme.md')).toBe(false);
    expect(shouldIncludeFile('dist/output.md')).toBe(false);
    expect(shouldIncludeFile('build/docs.md')).toBe(false);
  });

  it('excludes hidden directories', () => {
    expect(shouldIncludeFile('.github/workflows.md')).toBe(false);
    expect(shouldIncludeFile('.vscode/settings.md')).toBe(false);
  });

  it('is case-insensitive for meta files', () => {
    expect(shouldIncludeFile('readme.md')).toBe(false);
    expect(shouldIncludeFile('Readme.md')).toBe(false);
  });
});

// --- matchGlob ---

describe('matchGlob', () => {
  it('matches single wildcard', () => {
    expect(matchGlob('docs/setup.md', 'docs/*.md')).toBe(true);
    expect(matchGlob('src/setup.md', 'docs/*.md')).toBe(false);
  });

  it('matches double wildcard (globstar)', () => {
    expect(matchGlob('docs/guides/setup.md', 'docs/**/*.md')).toBe(true);
    expect(matchGlob('docs/deep/nested/file.md', 'docs/**/*.md')).toBe(true);
  });

  it('rejects non-matching patterns', () => {
    expect(matchGlob('src/code.ts', 'docs/**/*.md')).toBe(false);
  });
});

// --- computeImportFreshness ---

describe('computeImportFreshness', () => {
  it('returns fresh for recent dates', () => {
    const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    expect(computeImportFreshness(recent)).toBe('fresh');
  });

  it('returns aging for 30-90 day old dates', () => {
    const aging = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    expect(computeImportFreshness(aging)).toBe('aging');
  });

  it('returns stale for 90+ day old dates', () => {
    const stale = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000); // 120 days ago
    expect(computeImportFreshness(stale)).toBe('stale');
  });

  it('returns aging for undefined date (conservative default)', () => {
    expect(computeImportFreshness(undefined)).toBe('aging');
  });
});

// --- extractRepoName ---

describe('extractRepoName', () => {
  it('extracts name from GitHub URL', () => {
    expect(extractRepoName('https://github.com/acme/platform-docs.git')).toBe('platform-docs');
  });

  it('extracts name from URL without .git suffix', () => {
    expect(extractRepoName('https://github.com/acme/platform-docs')).toBe('platform-docs');
  });

  it('extracts name from local path', () => {
    expect(extractRepoName('/path/to/my-repo')).toBe('my-repo');
  });

  it('handles trailing slashes', () => {
    expect(extractRepoName('https://github.com/acme/docs/')).toBe('docs');
  });
});

// --- isRemoteUrl ---

describe('isRemoteUrl', () => {
  it('detects HTTPS URLs', () => {
    expect(isRemoteUrl('https://github.com/acme/repo.git')).toBe(true);
  });

  it('detects SSH URLs', () => {
    expect(isRemoteUrl('git@github.com:acme/repo.git')).toBe(true);
  });

  it('rejects local paths', () => {
    expect(isRemoteUrl('/path/to/repo')).toBe(false);
    expect(isRemoteUrl('./relative/path')).toBe(false);
    expect(isRemoteUrl('C:\\path\\to\\repo')).toBe(false);
  });
});

// --- discoverCandidates ---

describe('discoverCandidates', () => {
  it('discovers markdown files and skips meta files', async () => {
    writeSourceDoc('docs/setup.md', '# Setup Guide\n\nHow to set up.');
    writeSourceDoc('docs/deploy.md', '# Deploy Guide\n\nHow to deploy.');
    writeSourceDoc('README.md', '# My Project');
    writeSourceDoc('CHANGELOG.md', '# Changelog');
    writeSourceDoc('node_modules/pkg/readme.md', '# pkg readme');

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      author: 'testuser',
    });

    const paths = candidates.map(c => c.sourcePath);
    expect(paths).toContain('docs/setup.md');
    expect(paths).toContain('docs/deploy.md');
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('CHANGELOG.md');
    expect(paths).not.toContain('node_modules/pkg/readme.md');
  });

  it('applies --path filter', async () => {
    writeSourceDoc('docs/setup.md', '# Setup');
    writeSourceDoc('guides/deploy.md', '# Deploy');

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      pathFilter: 'docs/*.md',
      author: 'testuser',
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourcePath).toBe('docs/setup.md');
  });

  it('applies --exclude filter', async () => {
    writeSourceDoc('docs/setup.md', '# Setup');
    writeSourceDoc('docs/archive/old.md', '# Old');

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      excludePatterns: ['docs/archive/**'],
      author: 'testuser',
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourcePath).toBe('docs/setup.md');
  });

  it('respects --max cap', async () => {
    for (let i = 0; i < 10; i++) {
      writeSourceDoc(`docs/file${i}.md`, `# File ${i}\n\nContent ${i}.`);
    }

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      maxFiles: 3,
      author: 'testuser',
    });

    expect(candidates).toHaveLength(3);
  });

  it('skips empty files', async () => {
    writeSourceDoc('docs/empty.md', '');
    writeSourceDoc('docs/valid.md', '# Valid\n\nContent.');

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      author: 'testuser',
    });

    const empty = candidates.find(c => c.sourcePath === 'docs/empty.md');
    const valid = candidates.find(c => c.sourcePath === 'docs/valid.md');

    expect(empty?.skip?.reason).toBe('empty file');
    expect(valid?.skip).toBeUndefined();
  });

  it('skips files larger than 1MB', async () => {
    // Create a file just over 1MB
    const largeContent = 'x'.repeat(1_048_577);
    writeSourceDoc('docs/huge.md', largeContent);
    writeSourceDoc('docs/small.md', '# Small\n\nContent.');

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      author: 'testuser',
    });

    const huge = candidates.find(c => c.sourcePath === 'docs/huge.md');
    const small = candidates.find(c => c.sourcePath === 'docs/small.md');

    expect(huge?.skip?.reason).toMatch(/file too large/);
    expect(small?.skip).toBeUndefined();
  });

  // Symlink test skipped on Windows — requires elevated privileges
  // and behaves inconsistently across Windows versions
  it.skipIf(process.platform === 'win32')('skips symbolic links', async () => {
    writeSourceDoc('docs/real.md', '# Real\n\nContent.');
    const linkPath = path.join(sourceDir, 'docs', 'link.md');
    const targetPath = path.join(sourceDir, 'docs', 'real.md');
    fs.symlinkSync(targetPath, linkPath);

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      author: 'testuser',
    });

    const link = candidates.find(c => c.sourcePath === 'docs/link.md');
    const real = candidates.find(c => c.sourcePath === 'docs/real.md');

    expect(link?.skip?.reason).toBe('symbolic link');
    expect(real?.skip).toBeUndefined();
  });

  it('extracts title from frontmatter', async () => {
    writeSourceDoc('docs/guide.md', '---\ntitle: My Guide\n---\n\nContent.');

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      author: 'testuser',
    });

    expect(candidates[0].title).toBe('My Guide');
  });

  it('extracts title from H1 heading', async () => {
    writeSourceDoc('docs/setup.md', '# Setup Instructions\n\nHow to set up.');

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      author: 'testuser',
    });

    expect(candidates[0].title).toBe('Setup Instructions');
  });

  it('falls back to filename for title', async () => {
    writeSourceDoc('docs/my-guide.md', 'Just some content without heading.');

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      author: 'testuser',
    });

    expect(candidates[0].title).toBe('my guide');
  });

  it('auto-extracts tech tags from content', async () => {
    writeSourceDoc('docs/setup.md', '# Setup\n\nUse docker and kubernetes for deployment.');

    const candidates = await discoverCandidates(sourceDir, {
      source: sourceDir,
      author: 'testuser',
    });

    expect(candidates[0].tags).toContain('docker');
    expect(candidates[0].tags).toContain('kubernetes');
  });
});

// --- importCandidates ---

describe('importCandidates', () => {
  it('imports candidates into brain repo', async () => {
    const db = createIndex(dbPath);
    try {
      const candidates: IngestCandidate[] = [
        {
          sourcePath: 'docs/setup.md',
          title: 'Setup Guide',
          tags: ['docker'],
          content: 'How to set up with docker.',
          freshness: 'fresh',
        },
      ];

      const result = await importCandidates(candidates, repoDir, db, {
        source: 'https://github.com/acme/docs.git',
        author: 'testuser',
      });

      expect(result.imported).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);

      // Verify file was written
      const entries = await scanEntries(repoDir);
      rebuildIndex(db, entries);
      const found = getEntryById(db, 'setup-guide');
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Setup Guide');
    } finally {
      db.close();
    }
  });

  it('skips duplicates by default', async () => {
    const db = createIndex(dbPath);
    try {
      // Pre-existing entry
      const existing = createEntry({
        title: 'Setup Guide',
        type: 'guide',
        content: 'Existing content.',
        author: 'alice',
      });
      await writeEntry(repoDir, existing);
      const entries = await scanEntries(repoDir);
      rebuildIndex(db, entries);

      const candidates: IngestCandidate[] = [
        {
          sourcePath: 'docs/setup.md',
          title: 'Setup Guide',
          tags: ['docker'],
          content: 'New content from ingest.',
          freshness: 'fresh',
        },
      ];

      const result = await importCandidates(candidates, repoDir, db, {
        source: 'test-source',
        author: 'testuser',
      });

      expect(result.imported).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('duplicate');
    } finally {
      db.close();
    }
  });

  it('overwrites duplicates with --overwrite flag', async () => {
    const db = createIndex(dbPath);
    try {
      const existing = createEntry({
        title: 'Setup Guide',
        type: 'guide',
        content: 'Old content.',
        author: 'alice',
      });
      await writeEntry(repoDir, existing);
      const entries = await scanEntries(repoDir);
      rebuildIndex(db, entries);

      const candidates: IngestCandidate[] = [
        {
          sourcePath: 'docs/setup.md',
          title: 'Setup Guide',
          tags: ['docker'],
          content: 'New updated content.',
          freshness: 'fresh',
        },
      ];

      const result = await importCandidates(candidates, repoDir, db, {
        source: 'test-source',
        author: 'testuser',
        overwrite: true,
      });

      expect(result.imported).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('sets status to stale for stale freshness', async () => {
    const db = createIndex(dbPath);
    try {
      const candidates: IngestCandidate[] = [
        {
          sourcePath: 'docs/old.md',
          title: 'Old Migration Guide',
          tags: [],
          content: 'Very old content.',
          freshness: 'stale',
        },
      ];

      await importCandidates(candidates, repoDir, db, {
        source: 'test-source',
        author: 'testuser',
      });

      const entries = await scanEntries(repoDir);
      const imported = entries.find(e => e.title === 'Old Migration Guide');
      expect(imported).toBeDefined();
      expect(imported!.status).toBe('stale');
    } finally {
      db.close();
    }
  });

  it('adds source-tag when enabled', async () => {
    const db = createIndex(dbPath);
    try {
      const candidates: IngestCandidate[] = [
        {
          sourcePath: 'docs/guide.md',
          title: 'Docker Guide',
          tags: ['docker'],
          content: 'Docker content.',
          freshness: 'fresh',
        },
      ];

      await importCandidates(candidates, repoDir, db, {
        source: 'https://github.com/acme/platform-docs.git',
        sourceTag: true,
        author: 'testuser',
      });

      const entries = await scanEntries(repoDir);
      const imported = entries.find(e => e.title === 'Docker Guide');
      expect(imported!.tags).toContain('platform-docs');
      expect(imported!.tags).toContain('docker');
    } finally {
      db.close();
    }
  });

  it('records source_repo in frontmatter', async () => {
    const db = createIndex(dbPath);
    try {
      const candidates: IngestCandidate[] = [
        {
          sourcePath: 'docs/guide.md',
          title: 'My Guide',
          tags: [],
          content: 'Content.',
          freshness: 'fresh',
        },
      ];

      await importCandidates(candidates, repoDir, db, {
        source: 'https://github.com/acme/platform-docs.git',
        author: 'testuser',
      });

      const entries = await scanEntries(repoDir);
      const imported = entries.find(e => e.title === 'My Guide');
      expect(imported!.source_repo).toBe('platform-docs');
    } finally {
      db.close();
    }
  });

  it('skips candidates with skip reason', async () => {
    const db = createIndex(dbPath);
    try {
      const candidates: IngestCandidate[] = [
        {
          sourcePath: 'docs/empty.md',
          title: '',
          tags: [],
          content: '',
          freshness: 'fresh',
          skip: { reason: 'empty file' },
        },
      ];

      const result = await importCandidates(candidates, repoDir, db, {
        source: 'test-source',
        author: 'testuser',
      });

      expect(result.imported).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe('empty file');
    } finally {
      db.close();
    }
  });

  it('applies forced type to all entries', async () => {
    const db = createIndex(dbPath);
    try {
      const candidates: IngestCandidate[] = [
        {
          sourcePath: 'docs/snippet.md',
          title: 'Docker Snippet',
          tags: [],
          content: 'Quick docker tip.',
          freshness: 'fresh',
        },
      ];

      await importCandidates(candidates, repoDir, db, {
        source: 'test-source',
        type: 'skill',
        author: 'testuser',
      });

      const entries = await scanEntries(repoDir);
      const imported = entries.find(e => e.title === 'Docker Snippet');
      expect(imported!.type).toBe('skill');
      expect(imported!.filePath.startsWith('skills/')).toBe(true);
    } finally {
      db.close();
    }
  });
});

// --- runIngest URL validation ---

describe('runIngest', () => {
  it('rejects URLs starting with dash (git option injection)', async () => {
    const db = createIndex(dbPath);
    try {
      await expect(
        runIngest({
          source: '--upload-pack=malicious',
          author: 'testuser',
        }, repoDir, db),
      ).rejects.toThrow('URLs must not start with "-"');
    } finally {
      db.close();
    }
  });

  it('rejects non-existent local paths', async () => {
    const db = createIndex(dbPath);
    try {
      await expect(
        runIngest({
          source: path.join(tempDir, 'nonexistent'),
          author: 'testuser',
        }, repoDir, db),
      ).rejects.toThrow('Source path does not exist');
    } finally {
      db.close();
    }
  });
});
