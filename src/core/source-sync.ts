import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import matter from 'gray-matter';
import type { SourceConfig } from '../types.js';
import { cloneRepo, getHeadCommit, getChangedFilesSince } from '../utils/git.js';
import { upsertSource } from './sources.js';
import { rowToEntry, findEntryBySourcePath, type EntryRow } from './index-db.js';
import { parseInputContent, createEntry } from './entry.js';
import { extractTags } from '../utils/tags.js';
import { extractIntelligentTags } from '../intelligence/index.js';

export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function validateCommitSha(sha: string): void {
  if (!COMMIT_SHA_PATTERN.test(sha)) {
    throw new Error(`Invalid commit SHA "${sha}". Expected 40-character hex string.`);
  }
}

/** List all .md files in a directory, optionally scoped to a subpath. */
function getAllMarkdownFiles(repoDir: string, subpath?: string): string[] {
  const baseDir = subpath ? path.join(repoDir, subpath) : repoDir;
  if (!fs.existsSync(baseDir)) return [];

  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(path.relative(repoDir, fullPath).replace(/\\/g, '/'));
      }
    }
  };
  walk(baseDir);
  return results;
}

export interface SyncResult {
  added: string[];
  updated: string[];
  archived: string[];
  skippedLocalEdits: string[];
  unchanged: number;
}

export async function syncSource(
  sourceName: string,
  sourceConfig: SourceConfig,
  brainRepoPath: string,
  db: Database.Database,
  options: { dryRun?: boolean; force?: boolean },
): Promise<SyncResult> {
  // No lastCommit means first sync or non-git source — skip SHA validation
  if (sourceConfig.lastCommit) {
    validateCommitSha(sourceConfig.lastCommit);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `brain-sync-${sourceName}-`));
  try {
    await cloneRepo(sourceConfig.url, tempDir, false);
    const headCommit = await getHeadCommit(tempDir);

    if (sourceConfig.lastCommit && headCommit === sourceConfig.lastCommit) {
      return { added: [], updated: [], archived: [], skippedLocalEdits: [], unchanged: -1 };
    }

    // If no lastCommit, this is first sync — get all files instead of diff
    const changes = sourceConfig.lastCommit
      ? await getChangedFilesSince(tempDir, sourceConfig.lastCommit, sourceConfig.path)
      : (await getAllMarkdownFiles(tempDir, sourceConfig.path)).map((p) => ({ path: p, status: 'A' as const }));
    const mdChanges = changes.filter((c) => c.path.endsWith('.md'));

    // Apply exclude filters
    const filtered = sourceConfig.exclude?.length
      ? mdChanges.filter(
          (c) =>
            !sourceConfig.exclude!.some((ex) =>
              c.path.includes(ex.replace('**/', '').replace('/**', '')),
            ),
        )
      : mdChanges;

    const result: SyncResult = {
      added: [],
      updated: [],
      archived: [],
      skippedLocalEdits: [],
      unchanged: 0,
    };

    if (options.dryRun) {
      for (const change of filtered) {
        if (change.status === 'A') result.added.push(change.path);
        else if (change.status === 'M') result.updated.push(change.path);
        else if (change.status === 'D') result.archived.push(change.path);
      }
      return result;
    }

    for (const change of filtered) {
      switch (change.status) {
        case 'A': {
          const fullPath = path.join(tempDir, change.path);
          if (!fs.existsSync(fullPath)) break;
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const parsed = parseInputContent(raw);
          const title =
            parsed.title ?? path.basename(change.path, '.md').replace(/[-_]/g, ' ');
          const entry = createEntry({
            title,
            type: sourceConfig.type ?? parsed.type ?? 'guide',
            content: parsed.content,
            author: 'ingest',
            tags: parsed.tags ?? extractIntelligentTags(title, parsed.content),
            summary: parsed.summary ?? undefined,
          });
          // Add source tracking frontmatter
          const frontmatter = matter(raw);
          const enrichedData = {
            ...frontmatter.data,
            title: entry.title,
            author: entry.author,
            created: entry.created,
            updated: entry.updated,
            type: entry.type,
            status: entry.status,
            tags: entry.tags,
            source_repo: sourceName,
            source_path: change.path,
            source_content_hash: computeContentHash(parsed.content),
          };
          const enrichedContent = matter.stringify(parsed.content, enrichedData);
          const entryPath = path.join(brainRepoPath, entry.filePath);
          fs.mkdirSync(path.dirname(entryPath), { recursive: true });
          fs.writeFileSync(entryPath, enrichedContent, 'utf-8');
          result.added.push(change.path);
          break;
        }
        case 'M': {
          const row = findEntryBySourcePath(db, sourceName, change.path);
          if (!row) {
            result.unchanged++;
            break;
          }
          const existingEntry = rowToEntry(row);

          // Check for local edits via content hash
          const currentHash = computeContentHash(existingEntry.content);
          const sourceHash = (row as EntryRow & { source_content_hash?: string })
            .source_content_hash;
          if (sourceHash && currentHash !== sourceHash && !options.force) {
            result.skippedLocalEdits.push(change.path);
            break;
          }

          // Safe to update
          const fullPath = path.join(tempDir, change.path);
          if (!fs.existsSync(fullPath)) break;
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const parsed = parseInputContent(raw);
          const updatedPath = path.join(brainRepoPath, existingEntry.filePath);
          const updatedFrontmatter = matter(fs.readFileSync(updatedPath, 'utf-8'));
          const newData = {
            ...updatedFrontmatter.data,
            updated: new Date().toISOString(),
            source_content_hash: computeContentHash(parsed.content),
          };
          fs.writeFileSync(updatedPath, matter.stringify(parsed.content, newData), 'utf-8');
          result.updated.push(change.path);
          break;
        }
        case 'D': {
          const row = findEntryBySourcePath(db, sourceName, change.path);
          if (!row) {
            result.unchanged++;
            break;
          }
          const entry = rowToEntry(row);
          // Archive: move to _archive/
          const sourcePath = path.join(brainRepoPath, entry.filePath);
          const archivePath = path.join(brainRepoPath, '_archive', entry.filePath);
          if (fs.existsSync(sourcePath)) {
            fs.mkdirSync(path.dirname(archivePath), { recursive: true });
            const content = fs.readFileSync(sourcePath, 'utf-8');
            const parsedContent = matter(content);
            const archivedData = {
              ...parsedContent.data,
              status: 'archived',
              archived_at: new Date().toISOString(),
              archived_reason: 'source-deleted',
            };
            fs.writeFileSync(
              archivePath,
              matter.stringify(parsedContent.content, archivedData),
              'utf-8',
            );
            fs.unlinkSync(sourcePath);
          }
          result.archived.push(change.path);
          break;
        }
      }
    }

    // Update registry
    upsertSource(sourceName, {
      ...sourceConfig,
      lastCommit: headCommit,
      lastSync: new Date().toISOString(),
      entryCount: sourceConfig.entryCount + result.added.length - result.archived.length,
    });

    return result;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
