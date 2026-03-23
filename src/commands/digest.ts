import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../core/config.js';
import { createIndex, getDbPath, getRecentEntries } from '../core/index-db.js';
import { getEntryStats, getTopEntries } from '../core/receipts.js';
import { recordReceipt } from '../core/receipts.js';
import { formatDigest } from '../utils/output.js';
import { parseTimeWindow } from '../utils/time.js';
import type { DigestEntry } from '../types.js';

export const digestCommand = new Command('digest')
  .description('See what\'s new in the team brain')
  .option('--since <period>', 'Time period: 7d, 2w, 1m (default: since last digest or 7d)')
  .action(async (options: { since?: string }) => {
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

        // Get recent entries from index
        const recentEntries = getRecentEntries(db, since);

        // Build digest entries with access stats and new/updated classification
        const digestEntries: DigestEntry[] = recentEntries.map((entry) => {
          const stats = getEntryStats(config.local, entry.id, options.since ?? '7d');
          const isNew = new Date(entry.created) >= since;

          return {
            ...entry,
            accessCount: stats.accessCount,
            uniqueReaders: stats.uniqueReaders,
            isNew,
          };
        });

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

          console.log(formatDigest(digestEntries));

          if (topEntries.length > 0) {
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
