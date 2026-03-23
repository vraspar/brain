import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../core/config.js';
import { createIndex, getDbPath, getRecentEntries } from '../core/index-db.js';
import { getBulkEntryStats, getReadEntryIds, getTopEntries } from '../core/receipts.js';
import { recordReceipt } from '../core/receipts.js';
import { formatDigest, formatDigestSummary } from '../utils/output.js';
import { parseTimeWindow } from '../utils/time.js';
import type { DigestEntry } from '../types.js';

interface DigestOptions {
  since?: string;
  tag?: string[];
  type?: string;
  author?: string;
  mine?: boolean;
  unread?: boolean;
  summary?: boolean;
}

export const digestCommand = new Command('digest')
  .description('See what\'s new in the team brain')
  .option('--since <period>', 'Time period: 7d, 2w, 1m (default: since last digest or 7d)')
  .option('--tag <tag...>', 'Filter by tag (repeatable)')
  .option('--type <type>', 'Filter by type: guide or skill')
  .option('--author <author>', 'Filter by author')
  .option('--mine', 'Show only your own entries')
  .option('--unread', 'Show only entries you have not read')
  .option('--summary', 'Compact one-line-per-entry output')
  .action(async (options: DigestOptions) => {
    const format = digestCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();
      const db = createIndex(getDbPath());

      try {
        // Determine the cutoff date
        let since: Date;
        if (options.since) {
          since = parseTimeWindow(options.since);
        } else if (config.lastDigest) {
          since = new Date(config.lastDigest);
        } else {
          since = parseTimeWindow('7d');
        }

        // Validate --type if provided
        if (options.type && options.type !== 'guide' && options.type !== 'skill') {
          throw new Error(`Invalid type "${options.type}". Must be "guide" or "skill".`);
        }

        // Resolve --mine to --author with current user
        const authorFilter = options.mine ? config.author : options.author;

        // Get recent entries from index
        const recentEntries = getRecentEntries(db, since);

        // Scan all receipts once upfront (O(M) instead of O(N×M))
        const bulkStats = getBulkEntryStats(config.local, options.since ?? '7d');

        // Build digest entries with access stats and new/updated classification
        let digestEntries: DigestEntry[] = recentEntries.map((entry) => {
          const stats = bulkStats.get(entry.id) ?? { accessCount: 0, uniqueReaders: 0 };
          const isNew = new Date(entry.created) >= since;

          return {
            ...entry,
            accessCount: stats.accessCount,
            uniqueReaders: stats.uniqueReaders,
            isNew,
          };
        });

        // Apply filters
        if (options.type) {
          digestEntries = digestEntries.filter((e) => e.type === options.type);
        }
        if (authorFilter) {
          digestEntries = digestEntries.filter((e) => e.author === authorFilter);
        }
        if (options.tag?.length) {
          const filterTags = new Set(options.tag.map((t) => t.toLowerCase()));
          digestEntries = digestEntries.filter((e) =>
            e.tags.some((t) => filterTags.has(t.toLowerCase())),
          );
        }
        if (options.unread) {
          const readIds = getReadEntryIds(config.local, config.author);
          digestEntries = digestEntries.filter((e) => !readIds.has(e.id));
        }

        // Record receipts for all entries shown
        for (const entry of digestEntries) {
          await recordReceipt(config.local, entry.id, config.author, 'cli');
        }

        // Get top entry for highlight
        const topEntries = getTopEntries(config.local, options.since ?? '7d', 1);

        // Update lastDigest in config
        saveConfig({ ...config, lastDigest: new Date().toISOString() });

        if (format === 'json') {
          console.log(JSON.stringify({
            period: options.since ?? (config.lastDigest ? 'since last digest' : '7d'),
            entries: digestEntries,
            topEntry: topEntries[0] ?? null,
          }, null, 2));
        } else {
          const period = options.since ?? (config.lastDigest ? 'since last digest' : '7d');
          console.log(chalk.bold(`\n🧠 Brain Digest (${period})\n`));

          if (options.summary) {
            console.log(formatDigestSummary(digestEntries));
          } else {
            console.log(formatDigest(digestEntries));
          }

          if (topEntries.length > 0 && !options.summary) {
            const top = topEntries[0];
            console.log(
              chalk.bold.yellow(
                `\n🔥 Most accessed: "${top.title}" — ${top.accessCount} reads by ${top.uniqueReaders} people`,
              ),
            );
          }

          console.log('');
        }
      } finally {
        db.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (format === 'json') {
        console.error(JSON.stringify({ error: message }));
      } else {
        console.error(chalk.red(`Error: ${message}`));
      }
      process.exitCode = 1;
    }
  });
