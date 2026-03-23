import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Entry } from '../types.js';

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
export function searchEntries(db: Database.Database, query: string, limit = 20): Entry[] {
  if (!query.trim()) return [];

  const stmt = db.prepare(`
    SELECT e.*
    FROM entries e
    JOIN entries_fts fts ON e.rowid = fts.rowid
    WHERE entries_fts MATCH @query
    ORDER BY rank
    LIMIT @limit
  `);

  const rows = stmt.all({ query, limit }) as EntryRow[];
  return rows.map(rowToEntry);
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
