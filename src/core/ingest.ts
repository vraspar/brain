import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloneRepo, getFileLastModified, validateUrl } from '../utils/git.js';
import { extractTags } from '../utils/tags.js';
import {
  createEntry,
  extractTitle,
  parseInputContent,
  titleFromFilename,
  writeEntry,
} from './entry.js';
import { getEntryById } from './index-db.js';
import type { Entry, EntryType, IngestCandidate, IngestResult } from '../types.js';
import type Database from 'better-sqlite3';

export interface IngestOptions {
  source: string;
  pathFilter?: string;
  excludePatterns?: string[];
  dryRun?: boolean;
  type?: EntryType;
  sourceTag?: boolean;
  maxFiles?: number;
  overwrite?: boolean;
  author: string;
  onProgress?: (message: string) => void;
}

const META_FILES = new Set([
  'readme.md', 'changelog.md', 'changes.md', 'license.md', 'licence.md',
  'contributing.md', 'code_of_conduct.md', 'security.md',
  'pull_request_template.md', 'issue_template.md',
]);

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.github', '.vscode', 'dist', 'build',
  'coverage', '__pycache__', '.tox', 'vendor', 'target',
]);

/**
 * Determine if a relative path should be included for ingest.
 * Excludes meta files, hidden dirs, and known non-doc directories.
 */
export function shouldIncludeFile(relativePath: string): boolean {
  const filename = path.basename(relativePath).toLowerCase();
  const isRootLevel = !relativePath.includes('/') && !relativePath.includes('\\');

  // Only exclude meta files at root level — nested READMEs are documentation
  if (isRootLevel && META_FILES.has(filename)) return false;

  const parts = relativePath.split(/[/\\]/);
  if (parts.some(p => EXCLUDED_DIRS.has(p))) return false;
  if (parts.some(p => p.startsWith('.'))) return false;

  return true;
}

/**
 * Simple glob matching for --path and --exclude filters.
 * Supports * (any segment chars) and ** (any path segments).
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const regex = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*');
  return new RegExp(`^${regex}$`).test(normalized);
}

/**
 * Compute freshness label based on how recently the file was modified.
 */
export function computeImportFreshness(
  sourceUpdated: Date | undefined,
): 'fresh' | 'aging' | 'stale' {
  if (!sourceUpdated) return 'aging';

  const ageMs = Date.now() - sourceUpdated.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  if (ageDays <= 30) return 'fresh';
  if (ageDays <= 90) return 'aging';
  return 'stale';
}

/**
 * Extract a short repo name from a URL or path.
 * "https://github.com/acme/platform-docs.git" → "platform-docs"
 * "/path/to/my-repo" → "my-repo"
 */
export function extractRepoName(source: string): string {
  const cleaned = source.replace(/\.git$/, '').replace(/\/+$/, '');
  const lastSegment = cleaned.split(/[/\\]/).pop() ?? cleaned;
  return lastSegment;
}

/**
 * Check if a source is a remote URL (vs local path).
 */
export function isRemoteUrl(source: string): boolean {
  return source.startsWith('https://') ||
    source.startsWith('http://') ||
    source.startsWith('git@') ||
    source.startsWith('ssh://');
}

/**
 * Recursively scan a directory for .md files, returning relative paths.
 */
function scanMarkdownFiles(rootDir: string, currentDir: string = ''): string[] {
  const results: string[] = [];
  const fullDir = currentDir ? path.join(rootDir, currentDir) : rootDir;

  if (!fs.existsSync(fullDir)) return results;

  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = currentDir ? `${currentDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...scanMarkdownFiles(rootDir, relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(relativePath);
    }
  }

  return results;
}

/**
 * Discover and classify files from a source repo for ingestion.
 */
export async function discoverCandidates(
  sourceDir: string,
  options: IngestOptions,
): Promise<IngestCandidate[]> {
  let files = scanMarkdownFiles(sourceDir);

  // Apply default exclusions
  files = files.filter(shouldIncludeFile);

  // Apply --path filter
  if (options.pathFilter) {
    files = files.filter(f => matchGlob(f, options.pathFilter!));
  }

  // Apply --exclude patterns
  if (options.excludePatterns) {
    for (const pattern of options.excludePatterns) {
      files = files.filter(f => !matchGlob(f, pattern));
    }
  }

  // Apply max cap
  const maxFiles = options.maxFiles ?? 100;
  const cappedFiles = files.slice(0, maxFiles);

  const MAX_FILE_SIZE = 1_048_576; // 1MB

  const candidates: IngestCandidate[] = [];
  for (const filePath of cappedFiles) {
    const fullPath = path.join(sourceDir, filePath);

    // Skip symlinks to avoid following links to unexpected targets
    const lstat = fs.lstatSync(fullPath);
    if (lstat.isSymbolicLink()) {
      candidates.push({
        sourcePath: filePath,
        title: '',
        tags: [],
        content: '',
        freshness: 'aging',
        skip: { reason: 'symbolic link' },
      });
      continue;
    }

    // Skip oversized files
    if (lstat.size > MAX_FILE_SIZE) {
      candidates.push({
        sourcePath: filePath,
        title: '',
        tags: [],
        content: '',
        freshness: 'aging',
        skip: { reason: `file too large (${(lstat.size / 1024 / 1024).toFixed(1)}MB)` },
      });
      continue;
    }

    const raw = fs.readFileSync(fullPath, 'utf-8');

    if (!raw.trim()) {
      candidates.push({
        sourcePath: filePath,
        title: '',
        tags: [],
        content: '',
        freshness: 'fresh',
        skip: { reason: 'empty file' },
      });
      continue;
    }

    const parsed = parseInputContent(raw);
    const title = parsed.title
      ?? extractTitle(raw)
      ?? titleFromFilename(filePath);
    const tags = parsed.tags ?? extractTags(raw);
    const content = parsed.content;

    // Get file last modified from git history
    const sourceUpdated = await getFileLastModified(sourceDir, filePath);
    const freshness = computeImportFreshness(sourceUpdated);

    candidates.push({
      sourcePath: filePath,
      title,
      tags,
      content,
      freshness,
      sourceUpdated: sourceUpdated?.toISOString(),
    });
  }

  return candidates;
}

/**
 * Import candidates into the brain repo.
 */
export async function importCandidates(
  candidates: IngestCandidate[],
  brainRepoPath: string,
  db: Database.Database,
  options: IngestOptions,
): Promise<IngestResult> {
  const repoName = extractRepoName(options.source);
  const imported: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const candidate of candidates) {
    if (candidate.skip) {
      skipped.push({ path: candidate.sourcePath, reason: candidate.skip.reason });
      continue;
    }

    // Check for duplicates
    const slug = candidate.title.toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!slug) {
      skipped.push({ path: candidate.sourcePath, reason: 'cannot generate slug from title' });
      continue;
    }

    const existing = getEntryById(db, slug);
    if (existing && !options.overwrite) {
      skipped.push({ path: candidate.sourcePath, reason: `duplicate slug "${slug}"` });
      continue;
    }

    // Determine entry status based on freshness
    const status = candidate.freshness === 'stale' ? 'stale' as const : 'active' as const;

    // Build tags
    const tags = [...candidate.tags];
    if (options.sourceTag && !tags.includes(repoName)) {
      tags.push(repoName);
    }

    const entry: Entry = createEntry({
      title: candidate.title,
      type: options.type ?? 'guide',
      content: candidate.content,
      author: options.author,
      tags,
    });

    // Override status and add source metadata
    const entryWithMeta: Entry = {
      ...entry,
      status,
      source_repo: repoName,
    };

    // Set dates from source if available
    if (candidate.sourceUpdated) {
      entryWithMeta.updated = candidate.sourceUpdated;
    }

    await writeEntry(brainRepoPath, entryWithMeta);
    imported.push(candidate.sourcePath);
  }

  return {
    imported,
    skipped,
    source: options.source,
    sourceRepoName: repoName,
  };
}

/**
 * Run the full ingest pipeline: resolve source, discover, classify, import.
 */
export async function runIngest(
  options: IngestOptions,
  brainRepoPath: string,
  db: Database.Database,
): Promise<{ candidates: IngestCandidate[]; result?: IngestResult }> {
  let sourceDir: string;
  let tempDir: string | undefined;
  const progress = options.onProgress ?? (() => {});

  // Resolve source
  if (isRemoteUrl(options.source)) {
    validateUrl(options.source);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-ingest-'));
    progress('Cloning repository...');
    // Full clone (not shallow) for accurate git log dates
    await cloneRepo(options.source, tempDir, false);
    sourceDir = tempDir;
  } else {
    sourceDir = path.resolve(options.source);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Source path does not exist: ${sourceDir}`);
    }
  }

  try {
    progress('Scanning for markdown files...');
    const candidates = await discoverCandidates(sourceDir, options);
    progress(`Found ${candidates.length} files`);

    if (options.dryRun) {
      return { candidates };
    }

    progress('Importing entries...');
    const result = await importCandidates(candidates, brainRepoPath, db, options);
    return { candidates, result };
  } finally {
    if (tempDir) {
      progress('Cleaning up temp directory...');
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
