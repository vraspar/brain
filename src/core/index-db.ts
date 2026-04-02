import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Entry, FreshnessScore, SearchResult } from '../types.js';
import { computeFreshness, type UsageStats } from './freshness.js';
import { computeEntryLinks } from './links.js';
import { STOP_WORDS } from '../utils/constants.js';

/**
 * Returns the default path for the brain cache database: ~/.brain/cache.db
 */
export function getDbPath(): string {
  return path.join(os.homedir(), '.brain', 'cache.db');
}

/**
 * Create or open a SQLite database at the given path and ensure
 * the entries table and FTS5 virtual table exist.
 */
export function createIndex(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tags TEXT,
      status TEXT DEFAULT 'active',
      related_repos TEXT,
      related_tools TEXT,
      summary TEXT,
      content TEXT NOT NULL,
      file_path TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      title, tags, content, summary,
      content='entries', content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entries_fts(rowid, title, tags, content, summary)
      VALUES (new.rowid, new.title, new.tags, new.content, new.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, title, tags, content, summary)
      VALUES ('delete', old.rowid, old.title, old.tags, old.content, old.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, title, tags, content, summary)
      VALUES ('delete', old.rowid, old.title, old.tags, old.content, old.summary);
      INSERT INTO entries_fts(rowid, title, tags, content, summary)
      VALUES (new.rowid, new.title, new.tags, new.content, new.summary);
    END;
  `);

  // Freshness cache columns (added in v0.2)
  const existingColumns = new Set(
    (db.pragma('table_info(entries)') as { name: string }[]).map((c) => c.name),
  );
  if (!existingColumns.has('freshness_score')) {
    db.exec('ALTER TABLE entries ADD COLUMN freshness_score REAL');
  }
  if (!existingColumns.has('freshness_label')) {
    db.exec('ALTER TABLE entries ADD COLUMN freshness_label TEXT');
  }
  if (!existingColumns.has('read_count_30d')) {
    db.exec('ALTER TABLE entries ADD COLUMN read_count_30d INTEGER DEFAULT 0');
  }
  if (!existingColumns.has('source_repo')) {
    db.exec('ALTER TABLE entries ADD COLUMN source_repo TEXT');
  }
  if (!existingColumns.has('source_path')) {
    db.exec('ALTER TABLE entries ADD COLUMN source_path TEXT');
  }
  if (!existingColumns.has('source_content_hash')) {
    db.exec('ALTER TABLE entries ADD COLUMN source_content_hash TEXT');
  }

  // Entry links tablefor auto-linking (added in v0.2)
  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_links (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'related',
      score REAL NOT NULL DEFAULT 0.0,
      reason TEXT,
      PRIMARY KEY (source_id, target_id, link_type),
      FOREIGN KEY (source_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_entry_links_source ON entry_links(source_id);
    CREATE INDEX IF NOT EXISTS idx_entry_links_target ON entry_links(target_id);
  `);

  return db;
}

/**
 * Clear all entries and rebuild the FTS index from a fresh set of entries.
 */
export function rebuildIndex(db: Database.Database, entries: Entry[]): void {
  const insertEntry = db.prepare(`
    INSERT OR REPLACE INTO entries (id, title, type, author, created_at, updated_at, tags, status, related_repos, related_tools, summary, content, file_path, source_repo, source_path, source_content_hash)
    VALUES (@id, @title, @type, @author, @created_at, @updated_at, @tags, @status, @related_repos, @related_tools, @summary, @content, @file_path, @source_repo, @source_path, @source_content_hash)
  `);

  const transaction = db.transaction((entryList: Entry[]) => {
    db.exec('DELETE FROM entries');
    // Rebuild the FTS index to stay in sync after bulk delete
    db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')");

    for (const entry of entryList) {
      insertEntry.run({
        id: entry.id,
        title: entry.title,
        type: entry.type,
        author: entry.author,
        created_at: entry.created,
        updated_at: entry.updated,
        tags: entry.tags.join(','),
        status: entry.status,
        related_repos: entry.related_repos?.join(',') ?? null,
        related_tools: entry.related_tools?.join(',') ?? null,
        summary: entry.summary ?? null,
        content: entry.content,
        file_path: entry.filePath,
        source_repo: entry.source_repo ?? null,
        source_path: entry.source_path ?? null,
        source_content_hash: entry.source_content_hash ?? null,
      });
    }
  });

  transaction(entries);

  // Compute entry-to-entry relationships after all entries are indexed
  computeEntryLinks(db);
}

/**
 * Search entries using FTS5 full-text search with BM25 ranking.
 * Returns matching entries sorted by relevance.
 */
/**
 * Sanitize user input for safe FTS5 querying.
 * Strips FTS5 operators (AND, OR, NOT, NEAR), special chars, and wraps terms in quotes.
 */
function sanitizeFtsQuery(query: string): string {
  // Strip FTS5 reserved operators (case-insensitive, whole words only)
  const withoutOperators = query.replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ');

  // Strip special characters including + (for C++ style tokens) and FTS5 syntax chars
  const cleaned = withoutOperators
    .replace(/['"(){}[\]*:^~!@#$%&+=|\\<>,;+\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Filter stop words to prevent noise from natural language queries
  const meaningful = cleaned.filter((term) => !STOP_WORDS.has(term.toLowerCase()));

  if (meaningful.length === 0) return '';

  // Wrap each term in double quotes with * suffix for prefix matching
  // "kube"* matches "kubernetes", "docker"* matches "dockerfile"
  return meaningful.map((term) => `"${term}"*`).join(' ');
}

export function searchEntries(db: Database.Database, query: string, limit = 20): Entry[] {
  return searchEntriesWithSnippets(db, query, limit).map((r) => r.entry);
}

/**
 * Search entries using FTS5 with BM25 ranking, returning contextual snippets.
 * Uses FTS5's snippet() function for matches, or extracts context manually
 * from content for LIKE fallback results.
 */
export function searchEntriesWithSnippets(
  db: Database.Database,
  query: string,
  limit = 20,
): SearchResult[] {
  if (!query.trim()) return [];

  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  // Try FTS5 search with snippet extraction
  try {
    const stmt = db.prepare(`
      SELECT e.*, snippet(entries_fts, 2, '«', '»', '...', 15) AS snippet
      FROM entries e
      JOIN entries_fts fts ON e.rowid = fts.rowid
      WHERE entries_fts MATCH @query
      ORDER BY rank
      LIMIT @limit
    `);

    const rows = stmt.all({ query: sanitized, limit }) as (EntryRow & { snippet: string })[];
    return rows.map((row) => ({
      entry: rowToEntry(row),
      snippet: row.snippet || buildSnippet(row.content, query),
    }));
  } catch {
    // FTS5 failed — fall back to LIKE search with manual snippet extraction
    const likeQuery = `%${query.replace(/[%_]/g, '')}%`;
    const stmt = db.prepare(`
      SELECT * FROM entries
      WHERE title LIKE @query OR content LIKE @query OR tags LIKE @query
      ORDER BY updated_at DESC
      LIMIT @limit
    `);

    const rows = stmt.all({ query: likeQuery, limit }) as EntryRow[];
    return rows.map((row) => ({
      entry: rowToEntry(row),
      snippet: buildSnippet(row.content, query),
    }));
  }
}

/**
 * Extract a snippet from content around the first occurrence of a query term.
 * Returns the first 80 chars of content if no match found.
 */
function buildSnippet(content: string, query: string, maxLength = 80): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const contentLower = content.toLowerCase();

  for (const term of terms) {
    const cleanTerm = term.replace(/['"*]/g, '');
    if (!cleanTerm) continue;

    const idx = contentLower.indexOf(cleanTerm);
    if (idx !== -1) {
      const start = Math.max(0, idx - 30);
      const end = Math.min(content.length, idx + cleanTerm.length + 50);
      let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';
      return snippet.slice(0, maxLength + 6); // +6 for potential ellipses
    }
  }

  // No match found — return summary-length prefix
  const prefix = content.replace(/\s+/g, ' ').trim();
  return prefix.length > maxLength ? prefix.slice(0, maxLength) + '...' : prefix;
}

/**
 * Get entries created or updated since a given date.
 */
export function getRecentEntries(db: Database.Database, since: Date): Entry[] {
  const sinceIso = since.toISOString();

  const stmt = db.prepare(`
    SELECT * FROM entries
    WHERE created_at >= @since OR updated_at >= @since
    ORDER BY updated_at DESC
  `);

  const rows = stmt.all({ since: sinceIso }) as EntryRow[];
  return rows.map(rowToEntry);
}

/**
 * Get all entries from the database.
 */
export function getAllEntries(db: Database.Database): Entry[] {
  const stmt = db.prepare('SELECT * FROM entries ORDER BY updated_at DESC');
  const rows = stmt.all() as EntryRow[];
  return rows.map(rowToEntry);
}

/**
 * Get a single entry by its ID, or null if not found.
 */
export function getEntryById(db: Database.Database, id: string): Entry | null {
  const stmt = db.prepare('SELECT * FROM entries WHERE id = ?');
  const row = stmt.get(id) as EntryRow | undefined;
  return row ? rowToEntry(row) : null;
}

export interface ResolveResult {
  entry: Entry;
  exactMatch: boolean;
}

/**
 * Resolve a partial entry ID to a full entry.
 * Tries: exact match → startsWith → includes.
 * Returns the entry if exactly one match, throws with suggestions if ambiguous.
 */
export function resolveEntryId(db: Database.Database, partialId: string): ResolveResult {
  // 1. Exact match
  const exact = getEntryById(db, partialId);
  if (exact) return { entry: exact, exactMatch: true };

  // 2. startsWith match
  const allEntries = getAllEntries(db);
  const prefixMatches = allEntries.filter((e) => e.id.startsWith(partialId));
  if (prefixMatches.length === 1) return { entry: prefixMatches[0], exactMatch: false };
  if (prefixMatches.length > 1) {
    const ids = prefixMatches.slice(0, 5).map((e) => `  • ${e.id}`).join('\n');
    const more = prefixMatches.length > 5 ? `\n  ... and ${prefixMatches.length - 5} more` : '';
    throw new Error(
      `Ambiguous ID "${partialId}" matches ${prefixMatches.length} entries:\n${ids}${more}\nBe more specific.`,
    );
  }

  // 3. includes match (fallback) — only if no prefix matches
  const containsMatches = allEntries.filter((e) => e.id.includes(partialId));
  if (containsMatches.length === 1) return { entry: containsMatches[0], exactMatch: false };
  if (containsMatches.length > 1) {
    const ids = containsMatches.slice(0, 5).map((e) => `  • ${e.id}`).join('\n');
    const more = containsMatches.length > 5 ? `\n  ... and ${containsMatches.length - 5} more` : '';
    throw new Error(
      `Ambiguous ID "${partialId}" matches ${containsMatches.length} entries:\n${ids}${more}\nBe more specific.`,
    );
  }

  throw new Error(
    `Entry "${partialId}" not found. Run "brain search" to find entries, or "brain list" to see all.`,
  );
}

/**
 * Get all entries by a specific author.
 */
export function getEntriesByAuthor(db: Database.Database, author: string): Entry[] {
  const stmt = db.prepare('SELECT * FROM entries WHERE author = ? ORDER BY updated_at DESC');
  const rows = stmt.all(author) as EntryRow[];
  return rows.map(rowToEntry);
}

// --- Internal helpers ---

export interface EntryRow {
  id: string;
  title: string;
  type: string;
  author: string;
  created_at: string;
  updated_at: string;
  tags: string | null;
  status: string;
  related_repos: string | null;
  related_tools: string | null;
  summary: string | null;
  content: string;
  file_path: string;
  freshness_score?: number | null;
  freshness_label?: string | null;
  read_count_30d?: number | null;
  source_repo?: string | null;
  source_path?: string | null;
  source_content_hash?: string | null;
}

/**
 * Update cached freshness scores for all entries.
 * Call after sync or before prune to ensure scores are current.
 */
export function updateFreshnessScores(
  db: Database.Database,
  statsMap: Map<string, UsageStats>,
  now: Date = new Date(),
): void {
  const entries = getAllEntries(db);

  const updateStmt = db.prepare(`
    UPDATE entries
    SET freshness_score = @score,
        freshness_label = @label,
        read_count_30d = @readCount
    WHERE id = @id
  `);

  const transaction = db.transaction(() => {
    for (const entry of entries) {
      const stats = statsMap.get(entry.id);
      const score = computeFreshness(entry, stats, now);

      updateStmt.run({
        id: entry.id,
        score: score.score,
        label: score.label,
        readCount: stats?.accessCount30d ?? 0,
      });
    }
  });

  transaction();
}

/**
 * Get all entries with their cached freshness scores.
 */
export function getEntriesWithFreshness(db: Database.Database): (Entry & { freshnessScore: number | null; freshnessLabel: string | null; readCount30d: number })[] {
  const stmt = db.prepare('SELECT * FROM entries ORDER BY freshness_score ASC');
  const rows = stmt.all() as EntryRow[];
  return rows.map((row) => ({
    ...rowToEntry(row),
    freshnessScore: row.freshness_score ?? null,
    freshnessLabel: row.freshness_label ?? null,
    readCount30d: row.read_count_30d ?? 0,
  }));
}

export function rowToEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    title: row.title,
    type: row.type as Entry['type'],
    author: row.author,
    created: row.created_at,
    updated: row.updated_at,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    status: (row.status as Entry['status']) ?? 'active',
    related_repos: row.related_repos ? row.related_repos.split(',').filter(Boolean) : undefined,
    related_tools: row.related_tools ? row.related_tools.split(',').filter(Boolean) : undefined,
    summary: row.summary ?? undefined,
    content: row.content,
    filePath: row.file_path,
  };
}

/**
 * Find an entry by its source repo and source path.
 */
export function findEntryBySourcePath(
  db: Database.Database,
  sourceRepo: string,
  sourcePath: string,
): EntryRow | undefined {
  const stmt = db.prepare('SELECT * FROM entries WHERE source_repo = ? AND source_path = ?');
  return stmt.get(sourceRepo, sourcePath) as EntryRow | undefined;
}
