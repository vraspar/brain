import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, searchEntries } from '../core/index-db.js';
import { formatSearchResults } from '../utils/output.js';

export const searchCommand = new Command('search')
  .description('Search the team brain for entries')
  .argument('<query>', 'Search query (full-text search)')
  .option('--limit <n>', 'Maximum results to return', '20')
  .action(async (query: string, options: { limit: string }) => {
    const format = searchCommand.parent?.opts().format ?? 'text';

    try {
      loadConfig(); // validate brain is initialized
      const db = createIndex(getDbPath());

      const limit = parseInt(options.limit, 10);
      if (isNaN(limit) || limit < 1) {
        throw new Error('--limit must be a positive number.');
      }

      const results = searchEntries(db, query, limit);
      db.close();

      console.log(formatSearchResults(results, { format }));
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
