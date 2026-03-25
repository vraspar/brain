import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { Entry, EntryFrontmatter, EntryStatus, EntryType } from '../types.js';
import { slugFromPath, toSlug } from '../utils/slug.js';

const ENTRY_DIRECTORIES: Record<EntryType, string> = {
  guide: 'guides',
  skill: 'skills',
};

const VALID_TYPES: ReadonlySet<string> = new Set<EntryType>(['guide', 'skill']);
const VALID_STATUSES: ReadonlySet<string> = new Set<EntryStatus>(['active', 'stale', 'archived']);

/**
 * Parse a markdown file with frontmatter into an Entry.
 * Validates required frontmatter fields and throws clear errors.
 */
export function parseEntry(filePath: string, content: string): Entry {
  const parsed = matter(content);
  const data = parsed.data as Record<string, unknown>;

  const missing: string[] = [];
  for (const field of ['title', 'author', 'created', 'updated', 'type']) {
    if (!data[field]) missing.push(field);
  }
  if (missing.length > 0) {
    throw new Error(`Entry "${filePath}" missing required frontmatter: ${missing.join(', ')}`);
  }

  const entryType = String(data['type']);
  if (!VALID_TYPES.has(entryType)) {
    throw new Error(`Entry "${filePath}" has invalid type "${entryType}". Must be: guide, skill`);
  }

  const status = data['status'] ? String(data['status']) : 'active';
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Entry "${filePath}" has invalid status "${status}". Must be: active, stale, archived`);
  }

  const tags = Array.isArray(data['tags']) ? data['tags'].map(String) : [];

  return {
    id: slugFromPath(filePath),
    title: String(data['title']),
    author: String(data['author']),
    created: String(data['created']),
    updated: String(data['updated']),
    tags,
    type: entryType as EntryType,
    status: status as EntryStatus,
    content: parsed.content.trim(),
    filePath,
    related_repos: asStringArray(data['related_repos']),
    related_tools: asStringArray(data['related_tools']),
    summary: data['summary'] ? String(data['summary']) : undefined,
    source_repo: data['source_repo'] ? String(data['source_repo']) : undefined,
  };
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(String);
}

/**
 * Serialize entry data back into a markdown string with YAML frontmatter.
 */
export function serializeEntry(entry: Omit<Entry, 'id' | 'filePath'>): string {
  const frontmatter: Record<string, unknown> = {
    title: entry.title,
    author: entry.author,
    created: entry.created,
    updated: entry.updated,
    tags: entry.tags,
    type: entry.type,
    status: entry.status,
  };

  if (entry.summary) frontmatter['summary'] = entry.summary;
  if (entry.related_repos?.length) frontmatter['related_repos'] = entry.related_repos;
  if (entry.related_tools?.length) frontmatter['related_tools'] = entry.related_tools;
  if (entry.source_repo) frontmatter['source_repo'] = entry.source_repo;

  return matter.stringify(entry.content, frontmatter);
}

/**
 * Scan guides/ and skills/ directories for markdown entries.
 */
export async function scanEntries(repoPath: string): Promise<Entry[]> {
  const entries: Entry[] = [];

  for (const [type, dirName] of Object.entries(ENTRY_DIRECTORIES)) {
    const dirPath = path.join(repoPath, dirName);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const filePath = `${dirName}/${file}`;
      const fullPath = path.join(repoPath, filePath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      try {
        const entry = parseEntry(filePath, content);
        entries.push(entry);
      } catch (error) {
        // Log and skip malformed entries rather than failing entirely
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Skipping malformed entry ${filePath}: ${message}`);
      }
    }
  }

  return entries;
}

/**
 * Write an entry to the correct directory based on its type.
 * Returns the relative file path within the repo.
 */
export async function writeEntry(repoPath: string, entry: Entry): Promise<string> {
  const dirName = ENTRY_DIRECTORIES[entry.type];
  const dirPath = path.join(repoPath, dirName);

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const fileName = `${entry.id}.md`;
  const filePath = `${dirName}/${fileName}`;
  const fullPath = path.join(repoPath, filePath);

  const content = serializeEntry(entry);
  fs.writeFileSync(fullPath, content, 'utf-8');

  return filePath;
}

/**
 * Generate an entry ID (slug) from a title string.
 */
export function generateEntryId(title: string): string {
  const slug = toSlug(title);
  if (!slug) {
    throw new Error(`Cannot generate ID from title "${title}". Title must contain alphanumeric characters.`);
  }
  return slug;
}

/**
 * Generate a unique entry ID by appending -2, -3, etc. if the slug already exists.
 * Pass a set of existing IDs to check against.
 */
export function generateUniqueEntryId(title: string, existingIds: Set<string>): string {
  const baseSlug = generateEntryId(title);
  if (!existingIds.has(baseSlug)) return baseSlug;

  let counter = 2;
  while (existingIds.has(`${baseSlug}-${counter}`)) {
    counter++;
  }
  return `${baseSlug}-${counter}`;
}

interface CreateEntryOptions {
  title: string;
  type: EntryType;
  content: string;
  author: string;
  tags?: string[];
  summary?: string;
  related_repos?: string[];
  related_tools?: string[];
}

/**
 * Create a new Entry object with all fields populated.
 */
export function createEntry(opts: CreateEntryOptions): Entry {
  const now = new Date().toISOString();
  const id = generateEntryId(opts.title);
  const dirName = ENTRY_DIRECTORIES[opts.type];

  return {
    id,
    title: opts.title,
    author: opts.author,
    created: now,
    updated: now,
    tags: opts.tags ?? [],
    type: opts.type,
    status: 'active',
    content: opts.content,
    filePath: `${dirName}/${id}.md`,
    summary: opts.summary,
    related_repos: opts.related_repos,
    related_tools: opts.related_tools,
  };
}

/**
 * Extract title from markdown content.
 * Tries: (1) YAML frontmatter 'title', (2) first H1 heading, (3) null.
 * Does NOT use first line — caller should fall back to filename instead.
 */
export function extractTitle(content: string): string | null {
  const parsed = matter(content);
  if (parsed.data['title']) return String(parsed.data['title']);

  // Try first H1 heading
  const h1Match = parsed.content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  return null;
}

/**
 * Derive a title from a filename.
 * Example: "docker-deployment-guide.md" → "docker deployment guide"
 */
export function titleFromFilename(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));
  return basename.replace(/[-_]/g, ' ');
}

/**
 * Parse content that may or may not have frontmatter.
 * Returns extracted fields with nulls for missing values.
 */
export interface ParsedInput {
  title: string | null;
  type: EntryType | null;
  tags: string[] | null;
  summary: string | null;
  content: string;
}

export function parseInputContent(raw: string): ParsedInput {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;

  const hasFrontmatter = Object.keys(data).length > 0;

  const type = data['type'] ? String(data['type']) : null;
  const validType = type === 'guide' || type === 'skill' ? type : null;

  return {
    title: data['title'] ? String(data['title']) : null,
    type: validType,
    tags: Array.isArray(data['tags']) ? data['tags'].map(String) : null,
    summary: data['summary'] ? String(data['summary']) : null,
    content: hasFrontmatter ? parsed.content.trim() : raw,
  };
}
