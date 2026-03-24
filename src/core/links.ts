import type Database from 'better-sqlite3';
import type { Entry } from '../types.js';
import { getAllEntries, searchEntries, rowToEntry, type EntryRow } from './index-db.js';

interface LinkCandidate {
  type: string;
  score: number;
  reason: string;
}

/**
 * Compute the relationship score between two entries.
 * Returns null if the score is below the threshold (0.2).
 *
 * Signals:
 * 1. Shared tags: 0.15 per tag, capped at 0.6
 * 2. Title keyword overlap: 0.15 per word (>3 chars), capped at 0.3
 * 3. Same author: +0.1
 * 4. Content cross-reference: +0.2 per direction
 */
export function computeRelationship(a: Entry, b: Entry): LinkCandidate | null {
  let score = 0;
  const reasons: string[] = [];

  // Signal 1: Shared tags
  const aTags = new Set(a.tags.map((t) => t.toLowerCase()));
  const bTags = new Set(b.tags.map((t) => t.toLowerCase()));
  const sharedTags = [...aTags].filter((t) => bTags.has(t));

  if (sharedTags.length > 0) {
    const tagScore = Math.min(0.6, sharedTags.length * 0.15);
    score += tagScore;
    reasons.push(`${sharedTags.length} shared tag${sharedTags.length > 1 ? 's' : ''}: ${sharedTags.join(', ')}`);
  }

  // Signal 2: Title keyword overlap (words > 3 chars)
  const aWords = new Set(a.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const bWords = new Set(b.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const sharedWords = [...aWords].filter((w) => bWords.has(w));

  if (sharedWords.length > 0) {
    score += Math.min(0.3, sharedWords.length * 0.15);
    reasons.push(`title overlap: ${sharedWords.join(', ')}`);
  }

  // Signal 3: Same author
  if (a.author === b.author) {
    score += 0.1;
    reasons.push('same author');
  }

  // Signal 4: Content cross-reference
  const aContentLower = a.content.toLowerCase();
  const bContentLower = b.content.toLowerCase();

  if (aContentLower.includes(b.title.toLowerCase()) || aContentLower.includes(b.id)) {
    score += 0.2;
    reasons.push(`"${a.title}" references "${b.title}"`);
  }
  if (bContentLower.includes(a.title.toLowerCase()) || bContentLower.includes(a.id)) {
    score += 0.2;
    reasons.push(`"${b.title}" references "${a.title}"`);
  }

  if (score < 0.2) return null;

  return {
    type: 'related',
    score: Math.min(1.0, score),
    reason: reasons.join('; '),
  };
}

/**
 * Compute and store all entry-to-entry relationships.
 * Called after rebuildIndex populates the entries table.
 * Stores links symmetrically (A→B and B→A) for fast lookup.
 */
export function computeEntryLinks(db: Database.Database): void {
  const entries = getAllEntries(db);

  db.exec('DELETE FROM entry_links');

  const insertLink = db.prepare(`
    INSERT OR REPLACE INTO entry_links (source_id, target_id, link_type, score, reason)
    VALUES (@source, @target, @type, @score, @reason)
  `);

  const transaction = db.transaction(() => {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        const link = computeRelationship(a, b);

        if (link && link.score >= 0.2) {
          insertLink.run({ source: a.id, target: b.id, type: link.type, score: link.score, reason: link.reason });
          insertLink.run({ source: b.id, target: a.id, type: link.type, score: link.score, reason: link.reason });
        }
      }
    }
  });

  transaction();
}

export interface RelatedEntry {
  entry: Entry;
  score: number;
  reason: string;
}

/**
 * Get related entries for a given entry ID, ordered by relationship score.
 */
export function getRelatedEntries(
  db: Database.Database,
  entryId: string,
  limit = 5,
): RelatedEntry[] {
  const stmt = db.prepare(`
    SELECT e.*, el.score, el.reason
    FROM entry_links el
    JOIN entries e ON el.target_id = e.id
    WHERE el.source_id = @entryId AND el.link_type = 'related'
    ORDER BY el.score DESC
    LIMIT @limit
  `);

  const rows = stmt.all({ entryId, limit }) as (EntryRow & { score: number; reason: string })[];
  return rows.map((row) => ({
    entry: rowToEntry(row),
    score: row.score,
    reason: row.reason,
  }));
}

export interface TrailEntry {
  entry: Entry;
  related: Array<{ id: string; title: string; score: number }>;
}

/**
 * Get all entries related to a topic via FTS5 search + one hop of link traversal.
 */
export function getTrailEntries(
  db: Database.Database,
  topic: string,
  limit = 20,
): TrailEntry[] {
  const directMatches = searchEntries(db, topic, limit);
  const expanded = new Map<string, Entry>();

  for (const entry of directMatches) {
    expanded.set(entry.id, entry);
    const related = getRelatedEntries(db, entry.id, 5);
    for (const { entry: relatedEntry } of related) {
      if (!expanded.has(relatedEntry.id)) {
        expanded.set(relatedEntry.id, relatedEntry);
      }
    }
  }

  const trail = [...expanded.values()].slice(0, limit);
  return trail.map((entry) => {
    const related = getRelatedEntries(db, entry.id, 3);
    return {
      entry,
      related: related.map((r) => ({ id: r.entry.id, title: r.entry.title, score: r.score })),
    };
  });
}
