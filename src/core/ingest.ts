import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { cloneForIngest, cloneRepo, getBatchFileModifiedDates, validateUrl } from '../utils/git.js';
import { extractTags } from '../utils/tags.js';
import {
  createEntry,
  extractTitle,
  generateEntryId,
  generateUniqueEntryId,
  parseInputContent,
  titleFromFilename,
  writeEntry,
} from './entry.js';
import { getAllEntries, getEntryById } from './index-db.js';
import type { Entry, EntryType, IngestCandidate, IngestResult } from '../types.js';
import type Database from 'better-sqlite3';

export interface IngestOptions {
  source: string;
  pathFilter?: string;
  excludePatterns?: string[];
  dryRun?: boolean;
  type?: EntryType;
  sourceTag?: boolean | string;
  maxFiles?: number;
  overwrite?: boolean;
  author: string;
  shallow?: boolean;
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

// Additional dirs excluded only when scanning the brain's own repo
const BRAIN_ONLY_EXCLUDED_DIRS = new Set([
  'docs', '_archive',
]);

/**
 * Determine if a relative path should be included for ingest.
 * Excludes meta files, hidden dirs, and known non-doc directories.
 * Set isBrainRepo=true when scanning the brain's own repo (excludes docs/, _archive/).
 */
export function shouldIncludeFile(relativePath: string, isBrainRepo = false): boolean {
  const filename = path.basename(relativePath).toLowerCase();
  const isRootLevel = !relativePath.includes('/') && !relativePath.includes('\\');

  // Only exclude meta files at root level — nested READMEs are documentation
  if (isRootLevel && META_FILES.has(filename)) return false;

  const parts = relativePath.split(/[/\\]/);
  if (parts.some(p => EXCLUDED_DIRS.has(p))) return false;
  if (isBrainRepo && parts.some(p => BRAIN_ONLY_EXCLUDED_DIRS.has(p))) return false;
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
 * Compute freshness label for import preview.
 * All ingested content is 'fresh' — it's new to this brain.
 * The source file's age is stored as metadata for reference only.
 */
export function computeImportFreshness(
  _sourceUpdated: Date | undefined,
): 'fresh' | 'aging' | 'stale' {
  return 'fresh';
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
    } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.md')) {
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
  files = files.filter((f) => shouldIncludeFile(f));

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

  // Batch fetch file dates in a single git log call (instead of per-file)
  const fileDates = await getBatchFileModifiedDates(sourceDir, cappedFiles);

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
    const rawTitle = parsed.title
      ?? extractTitle(raw)
      ?? titleFromFilename(filePath);

    // For generic filenames (readme, index, etc.), prefix with parent directory
    // to avoid slug collisions: cmake/external/opencv/README.md → "opencv readme"
    const genericNames = new Set(['readme', 'index', 'overview', 'introduction', 'getting-started']);
    const baseTitle = titleFromFilename(filePath);
    let title = rawTitle;
    if (genericNames.has(baseTitle.toLowerCase())) {
      const parts = filePath.replace(/\\/g, '/').split('/');
      if (parts.length >= 2) {
        const parentDir = parts[parts.length - 2].replace(/[-_]/g, ' ');
        title = `${parentDir} ${baseTitle}`;
      }
    }
    const tags = parsed.tags ?? extractTags(raw);
    const content = parsed.content;

    // Use batch-fetched date (single git log call for all files)
    const normalizedPath = filePath.replace(/\\/g, '/');
    const sourceUpdated = fileDates.get(normalizedPath);
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

  // Build set of existing IDs for collision detection
  const existingEntries = getAllEntries(db);
  const existingIds = new Set(existingEntries.map(e => e.id));

  for (const candidate of candidates) {
    if (candidate.skip) {
      skipped.push({ path: candidate.sourcePath, reason: candidate.skip.reason });
      continue;
    }

    // Generate slug from source path for uniqueness.
    // Include repo name + parent dir + filename to avoid collisions.
    // Example: onnxruntime-genai/cmake/external/opencv/README.md → onnxruntime-genai-opencv-readme
    let slug: string;
    try {
      const pathParts = candidate.sourcePath.replace(/\\/g, '/').split('/');
      const filename = pathParts[pathParts.length - 1].replace(/\.md$/i, '');
      const parentDir = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : '';

      // For generic filenames, include parent dir in slug
      const genericNames = new Set(['readme', 'index', 'overview', 'introduction', 'getting-started']);
      let slugBase: string;
      if (genericNames.has(filename.toLowerCase()) && parentDir) {
        // Include repo name prefix if source-tag is set
        const repoPrefix = repoName ? `${repoName}-` : '';
        slugBase = `${repoPrefix}${parentDir}-${filename}`;
      } else {
        slugBase = candidate.title;
      }

      const baseSlug = generateEntryId(slugBase);

      // If slug collides with existing entry, append numeric suffix
      if (existingIds.has(baseSlug)) {
        if (!options.overwrite) {
          let counter = 2;
          let uniqueSlug = `${baseSlug}-${counter}`;
          while (existingIds.has(uniqueSlug)) {
            counter++;
            uniqueSlug = `${baseSlug}-${counter}`;
          }
          slug = uniqueSlug;
        } else {
          slug = baseSlug;
        }
      } else {
        slug = baseSlug;
      }
    } catch {
      skipped.push({ path: candidate.sourcePath, reason: 'cannot generate slug from title' });
      continue;
    }

    // Determine entry status based on freshness
    const status = candidate.freshness === 'stale' ? 'stale' as const : 'active' as const;

    // Build tags
    const tags = [...candidate.tags];
    if (options.sourceTag) {
      const tagValue = typeof options.sourceTag === 'string' ? options.sourceTag : repoName;
      if (!tags.includes(tagValue)) {
        tags.push(tagValue);
      }
    }

    const entry: Entry = createEntry({
      title: candidate.title,
      type: options.type ?? 'guide',
      content: candidate.content,
      author: options.author,
      tags,
    });

    const dirName = (options.type ?? 'guide') === 'skill' ? 'skills' : 'guides';

    // Override status, ID (for collision handling), and source metadata
    const entryWithMeta: Entry = {
      ...entry,
      id: slug,
      filePath: `${dirName}/${slug}.md`,
      status,
      source_repo: repoName,
      source_path: candidate.sourcePath,
      source_content_hash: crypto.createHash('sha256').update(candidate.content).digest('hex'),
    };

    // Store source date as metadata but use ingest date for freshness
    // All ingested content starts fresh — it's new to THIS brain
    if (candidate.sourceUpdated) {
      Object.assign(entryWithMeta, { source_updated: candidate.sourceUpdated });
    }

    await writeEntry(brainRepoPath, entryWithMeta);
    existingIds.add(entryWithMeta.id);
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
): Promise<{ candidates: IngestCandidate[]; result?: IngestResult; headCommit?: string }> {
  let sourceDir: string;
  let tempDir: string | undefined;
  const progress = options.onProgress ?? (() => {});

  // Reject sources that look like git flags (option injection)
  validateUrl(options.source);

  // Resolve source
  if (isRemoteUrl(options.source)) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-ingest-'));
    if (options.shallow) {
      progress('Cloning repository (shallow)...');
      await cloneRepo(options.source, tempDir, true);
    } else {
      progress('Cloning repository (partial)...');
      await cloneForIngest(options.source, tempDir);
    }
    sourceDir = tempDir;
  } else {
    sourceDir = path.resolve(options.source);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Source path does not exist: ${sourceDir}`);
    }
  }

  try {
    // Get HEAD commit for source registration (before cleanup)
    let headCommit: string | undefined;
    try {
      const { getHeadCommit } = await import('../utils/git.js');
      headCommit = await getHeadCommit(sourceDir);
    } catch {
      // Not a git repo or no commits — headCommit stays undefined
    }

    progress('Scanning for markdown files...');
    const candidates = await discoverCandidates(sourceDir, options);
    progress(`Found ${candidates.length} files`);

    if (options.dryRun) {
      return { candidates };
    }

    progress('Importing entries...');
    const result = await importCandidates(candidates, brainRepoPath, db, options);
    return { candidates, result, headCommit };
  } finally {
    if (tempDir) {
      progress('Cleaning up temp directory...');
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
