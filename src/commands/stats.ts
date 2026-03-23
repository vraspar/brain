import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, getEntryById } from '../core/index-db.js';
import { getStats } from '../core/receipts.js';
import { formatStats } from '../utils/output.js';
import type { StatsResult } from '../types.js';

export const statsCommand = new Command('stats')
  .description('See how your contributions are being used')
  .option('--period <period>', 'Time period: 7d, 2w, 1m', '7d')
  .option('--author <author>', 'Show stats for a specific author (default: you)')
  .action(async (options: { period: string; author?: string }) => {
    const format = statsCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();
      const author = options.author ?? config.author;

      // Get raw stats from receipts
      const rawStats = getStats(config.local, author, options.period);

      // Resolve entry titles from the index
      const db = createIndex(getDbPath());
      let resolvedStats: StatsResult[];
      try {
        resolvedStats = rawStats.map((stat) => {
          const entry = getEntryById(db, stat.entryId);
          return {
            ...stat,
            title: entry?.title ?? stat.entryId,
          };
        });
      } finally {
        db.close();
      }

      if (format === 'json') {
        console.log(JSON.stringify(resolvedStats, null, 2));
      } else {
        if (resolvedStats.length === 0) {
          console.log(chalk.dim(`\nNo activity for "${author}" in the last ${options.period}.\n`));
        } else {
          console.log(chalk.bold(`\n📊 Stats for ${author} (${options.period})\n`));

          // Show personalized feedback messages
          for (const stat of resolvedStats) {
            console.log(
              chalk.cyan(`  📖 Your "${stat.title}" was accessed ${stat.accessCount} time${stat.accessCount === 1 ? '' : 's'} by ${stat.uniqueReaders} ${stat.uniqueReaders === 1 ? 'person' : 'people'}.`),
            );
          }

          console.log('');
          console.log(formatStats(resolvedStats));
          console.log('');
        }
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
