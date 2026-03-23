import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getAllEntries, getDbPath, getEntriesByAuthor } from '../core/index-db.js';
import { formatSearchResults } from '../utils/output.js';
import type { Entry, EntryType } from '../types.js';

export const listCommand = new Command('list')
  .description('List all entries in the team brain')
  .option('--type <type>', 'Filter by type: guide or skill')
  .option('--author <author>', 'Filter by author name')
  .action(async (options: { type?: string; author?: string }) => {
    const format = listCommand.parent?.opts().format ?? 'text';

    try {
      loadConfig(); // validate brain is initialized
      const db = createIndex(getDbPath());

      let entries: Entry[];
      if (options.author) {
        entries = getEntriesByAuthor(db, options.author);
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

      db.close();

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
