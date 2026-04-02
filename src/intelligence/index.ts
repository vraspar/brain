import type Database from 'better-sqlite3';
import type { TagResult } from './types.js';
import { rankTags } from './tag-ranker.js';

export type { TagCandidate, TagResult } from './types.js';

/**
 * Extract intelligent tags for an entry.
 * Primary public API — call this instead of extractTags().
 */
export function extractIntelligentTags(
  title: string,
  content: string,
  db: Database.Database | null = null,
): string[] {
  const result = rankTags(title, content, db);
  return result.tags.map(t => t.tag);
}

/**
 * Extract tags with full scoring metadata (for debugging/display).
 */
export function extractIntelligentTagsDetailed(
  title: string,
  content: string,
  db: Database.Database | null = null,
): TagResult {
  return rankTags(title, content, db);
}
