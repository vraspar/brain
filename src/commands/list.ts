import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getAllEntries, getDbPath, getEntriesByAuthor } from '../core/index-db.js';
import { getReadEntryIds } from '../core/receipts.js';
import { formatSearchResults } from '../utils/output.js';
import type { Entry } from '../types.js';

interface ListOptions {
  type?: string;
  author?: string;
  tag?: string;
  mine?: boolean;
  unread?: boolean;
}

export const listCommand = new Command('list')
  .description('List all entries in the team brain')
  .option('--type <type>', 'Filter by type: guide or skill')
  .option('--author <author>', 'Filter by author name')
  .option('--tag <tag>', 'Filter by tag')
  .option('--mine', 'Show only your own entries')
  .option('--unread', 'Show only entries you have not read')
  .action(async (options: ListOptions) => {
    const format = listCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();
      const db = createIndex(getDbPath());

      let entries: Entry[];
      try {
        // Resolve --mine to --author with current user
        const authorFilter = options.mine ? config.author : options.author;

        if (authorFilter) {
          entries = getEntriesByAuthor(db, authorFilter);
        } else {
          entries = getAllEntries(db);
        }

        // Apply type filter
        if (options.type) {
          if (options.type !== 'guide' && options.type !== 'skill') {
            throw new Error(`Invalid type "${options.type}". Must be "guide" or "skill".`);
          }
          entries = entries.filter((e) => e.type === options.type);
        }

        // Apply tag filter
        if (options.tag) {
          entries = entries.filter((e) =>
            e.tags.some((t) => t.toLowerCase() === options.tag!.toLowerCase()),
          );
        }

        // Apply unread filter
        if (options.unread) {
          const readIds = getReadEntryIds(config.local, config.author);
          entries = entries.filter((e) => !readIds.has(e.id));
        }
      } finally {
        db.close();
      }

      console.log(formatSearchResults(entries, { format }));
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
