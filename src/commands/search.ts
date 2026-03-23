import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, searchEntriesWithSnippets } from '../core/index-db.js';
import { formatSearchResults } from '../utils/output.js';

export const searchCommand = new Command('search')
  .description('Search the team brain for entries')
  .argument('<query>', 'Search query (full-text search)')
  .option('--limit <n>', 'Maximum results to return', '20')
  .option('--no-preview', 'Hide content preview snippets')
  .action(async (query: string, options: { limit: string; preview: boolean }) => {
    const format = searchCommand.parent?.opts().format ?? 'text';

    try {
      loadConfig(); // validate brain is initialized
      const db = createIndex(getDbPath());

      try {
        const limit = parseInt(options.limit, 10);
        if (isNaN(limit) || limit < 1) {
          throw new Error('--limit must be a positive number.');
        }

        const results = searchEntriesWithSnippets(db, query, limit);
        const entries = results.map((r) => r.entry);

        const snippets = options.preview
          ? new Map(results.map((r) => [r.entry.id, r.snippet]))
          : undefined;

        console.log(formatSearchResults(entries, { format, snippets }));
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
