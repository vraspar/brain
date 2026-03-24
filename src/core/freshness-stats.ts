import { getBulkEntryStats } from './receipts.js';
import type { UsageStats } from './freshness.js';

/**
 * Build a UsageStats map for all entries by scanning receipts.
 * Bridges the receipts system and the freshness scoring engine.
 */
export function buildUsageStatsMap(
  repoPath: string,
  period: string,
): Map<string, UsageStats> {
  const bulkStats = getBulkEntryStats(repoPath, period);
  const result = new Map<string, UsageStats>();

  for (const [entryId, stats] of bulkStats.entries()) {
    result.set(entryId, {
      accessCount30d: stats.accessCount,
      // We don't track exact lastReadDaysAgo from receipts currently,
      // so approximate: if there are reads in the period, assume recent
      lastReadDaysAgo: stats.accessCount > 0 ? 0 : null,
    });
  }

  return result;
}
