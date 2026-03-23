export type EntryType = 'guide' | 'skill';
export type EntryStatus = 'active' | 'stale' | 'archived';

export interface EntryFrontmatter {
  title: string;
  author: string;
  created: string; // ISO 8601
  updated: string;
  tags: string[];
  type: EntryType;
  status: EntryStatus;
  related_repos?: string[];
  related_tools?: string[];
  summary?: string;
}

export interface Entry extends EntryFrontmatter {
  id: string; // slug derived from filename
  content: string; // markdown body (without frontmatter)
  filePath: string; // relative path in repo
}

export interface Receipt {
  entry_id: string;
  reader: string;
  timestamp: string; // ISO 8601
  source: 'cli' | 'mcp';
}

export interface BrainConfig {
  remote?: string; // git remote URL (undefined for local-only brains)
  local: string; // local clone path
  author: string; // current user
  hubName?: string; // human-readable brain name
  lastSync?: string; // ISO 8601
  lastDigest?: string; // ISO 8601
}

export interface DigestEntry extends Entry {
  accessCount?: number;
  uniqueReaders?: number;
  isNew: boolean; // created in period vs updated
}

export interface StatsResult {
  entryId: string;
  title: string;
  accessCount: number;
  uniqueReaders: number;
  period: string;
}

export interface SearchResult {
  entry: Entry;
  snippet: string;
}
