import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Entry, SearchResult } from '../types.js';

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

  return db;
}

/**
 * Clear all entries and rebuild the FTS index from a fresh set of entries.
 */
export function rebuildIndex(db: Database.Database, entries: Entry[]): void {
  const insertEntry = db.prepare(`
    INSERT OR REPLACE INTO entries (id, title, type, author, created_at, updated_at, tags, status, related_repos, related_tools, summary, content, file_path)
    VALUES (@id, @title, @type, @author, @created_at, @updated_at, @tags, @status, @related_repos, @related_tools, @summary, @content, @file_path)
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
      });
    }
  });

  transaction(entries);
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

  if (cleaned.length === 0) return '';

  // Wrap each term in double quotes with * suffix for prefix matching
  // "kube"* matches "kubernetes", "docker"* matches "dockerfile"
  return cleaned.map((term) => `"${term}"*`).join(' ');
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

/**
 * Get all entries by a specific author.
 */
export function getEntriesByAuthor(db: Database.Database, author: string): Entry[] {
  const stmt = db.prepare('SELECT * FROM entries WHERE author = ? ORDER BY updated_at DESC');
  const rows = stmt.all(author) as EntryRow[];
  return rows.map(rowToEntry);
}

// --- Internal helpers ---

interface EntryRow {
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
}

function rowToEntry(row: EntryRow): Entry {
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
