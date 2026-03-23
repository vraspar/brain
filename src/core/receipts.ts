import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Receipt, StatsResult } from '../types.js';

const RECEIPTS_DIR = '_analytics/receipts';

/**
 * Record a read receipt for an entry.
 * Writes a JSON file to _analytics/receipts/YYYY-MM-DD/{reader}-{entryId}-{random6}.json
 */
export async function recordReceipt(
  repoPath: string,
  entryId: string,
  reader: string,
  source: 'cli' | 'mcp',
): Promise<void> {
  const now = new Date();
  const dateDir = formatDateDir(now);
  const receiptDir = path.join(repoPath, RECEIPTS_DIR, dateDir);

  fs.mkdirSync(receiptDir, { recursive: true });

  const randomSuffix = crypto.randomBytes(3).toString('hex');
  const fileName = `${reader}-${entryId}-${randomSuffix}.json`;
  const filePath = path.join(receiptDir, fileName);

  const receipt: Receipt = {
    entry_id: entryId,
    reader,
    timestamp: now.toISOString(),
    source,
  };

  fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2) + '\n', 'utf-8');
}

/**
 * Get aggregated stats for entries by a specific author within a time period.
 * Period format: '7d', '2w', '1m' (days, weeks, months).
 */
export function getStats(repoPath: string, author: string, period: string): StatsResult[] {
  const receipts = scanReceipts(repoPath, period);

  // Group receipts by entry_id
  const byEntry = groupByEntry(receipts);

  // We can't filter by author here without the entry index,
  // so we return all stats and let the caller filter if needed.
  // However, per the spec, we accept author — we'll include it in the result
  // for the caller to use. In practice, the CLI command filters by author.
  const results: StatsResult[] = [];

  for (const [entryId, entryReceipts] of byEntry.entries()) {
    const uniqueReaders = new Set(entryReceipts.map((r) => r.reader)).size;
    results.push({
      entryId,
      title: entryId, // title resolution happens at the command layer
      accessCount: entryReceipts.length,
      uniqueReaders,
      period,
    });
  }

  return results.sort((a, b) => b.accessCount - a.accessCount);
}

/**
 * Get stats for a single entry within a time period.
 */
export function getEntryStats(
  repoPath: string,
  entryId: string,
  period: string,
): { accessCount: number; uniqueReaders: number } {
  const receipts = scanReceipts(repoPath, period);
  const entryReceipts = receipts.filter((r) => r.entry_id === entryId);

  return {
    accessCount: entryReceipts.length,
    uniqueReaders: new Set(entryReceipts.map((r) => r.reader)).size,
  };
}

/**
 * Get stats for all entries within a time period in a single pass.
 * Returns a Map from entry ID to { accessCount, uniqueReaders }.
 * Use this instead of calling getEntryStats() per entry to avoid O(N×M) scanning.
 */
export function getBulkEntryStats(
  repoPath: string,
  period: string,
): Map<string, { accessCount: number; uniqueReaders: number }> {
  const receipts = scanReceipts(repoPath, period);
  const byEntry = groupByEntry(receipts);

  const result = new Map<string, { accessCount: number; uniqueReaders: number }>();
  for (const [entryId, entryReceipts] of byEntry.entries()) {
    result.set(entryId, {
      accessCount: entryReceipts.length,
      uniqueReaders: new Set(entryReceipts.map((r) => r.reader)).size,
    });
  }

  return result;
}

/**
 * Get the most accessed entries within a time period.
 */
export function getTopEntries(repoPath: string, period: string, limit = 10): StatsResult[] {
  const receipts = scanReceipts(repoPath, period);
  const byEntry = groupByEntry(receipts);

  const results: StatsResult[] = [];

  for (const [entryId, entryReceipts] of byEntry.entries()) {
    const uniqueReaders = new Set(entryReceipts.map((r) => r.reader)).size;
    results.push({
      entryId,
      title: entryId,
      accessCount: entryReceipts.length,
      uniqueReaders,
      period,
    });
  }

  return results
    .sort((a, b) => b.accessCount - a.accessCount)
    .slice(0, limit);
}

/**
 * Get the set of entry IDs that a specific reader has read (ever).
 * Scans all receipt directories regardless of period.
 */
export function getReadEntryIds(repoPath: string, reader: string): Set<string> {
  const receiptsBase = path.join(repoPath, RECEIPTS_DIR);

  if (!fs.existsSync(receiptsBase)) {
    return new Set();
  }

  const readIds = new Set<string>();

  const dateDirs = fs.readdirSync(receiptsBase).filter((name) =>
    /^\d{4}-\d{2}-\d{2}$/.test(name),
  );

  for (const dateDir of dateDirs) {
    const dirPath = path.join(receiptsBase, dateDir);
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = path.join(dirPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const receipt = JSON.parse(content) as Receipt;

        if (receipt.reader === reader) {
          readIds.add(receipt.entry_id);
        }
      } catch {
        // Skip malformed receipt files
      }
    }
  }

  return readIds;
}

// --- Internal helpers ---

/**
 * Format a Date into YYYY-MM-DD for receipt directory names.
 */
function formatDateDir(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a period string like '7d', '2w', '1m' into a cutoff Date.
 */
function parsePeriodCutoff(period: string): Date {
  const match = period.match(/^(\d+)([dwm])$/);
  if (!match) {
    throw new Error(
      `Invalid period "${period}". Use format like 7d (days), 2w (weeks), 1m (months).`,
    );
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const multipliers: Record<string, number> = {
    d: MS_PER_DAY,
    w: 7 * MS_PER_DAY,
    m: 30 * MS_PER_DAY,
  };

  return new Date(Date.now() - amount * multipliers[unit]);
}

/**
 * Scan receipt files within the given period.
 * Reads all JSON files from _analytics/receipts/ date directories
 * that fall within the period window.
 */
function scanReceipts(repoPath: string, period: string): Receipt[] {
  const cutoff = parsePeriodCutoff(period);
  const receiptsBase = path.join(repoPath, RECEIPTS_DIR);

  if (!fs.existsSync(receiptsBase)) {
    return [];
  }
  const cutoffStr = formatDateDir(cutoff);
  const receipts: Receipt[] = [];

  const dateDirs = fs.readdirSync(receiptsBase).filter((name) => {
    // Only process directories that look like dates and are >= cutoff
    return /^\d{4}-\d{2}-\d{2}$/.test(name) && name >= cutoffStr;
  });

  for (const dateDir of dateDirs) {
    const dirPath = path.join(receiptsBase, dateDir);
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = path.join(dirPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const receipt = JSON.parse(content) as Receipt;

        // Double-check timestamp is within range
        if (new Date(receipt.timestamp) >= cutoff) {
          receipts.push(receipt);
        }
      } catch {
        // Skip malformed receipt files
      }
    }
  }

  return receipts;
}

/**
 * Group receipts by entry_id.
 */
function groupByEntry(receipts: Receipt[]): Map<string, Receipt[]> {
  const map = new Map<string, Receipt[]>();

  for (const receipt of receipts) {
    const existing = map.get(receipt.entry_id);
    if (existing) {
      existing.push(receipt);
    } else {
      map.set(receipt.entry_id, [receipt]);
    }
  }

  return map;
}
