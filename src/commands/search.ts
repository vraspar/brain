import readline from 'node:readline/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, searchEntriesWithSnippets } from '../core/index-db.js';
import { getRelatedEntries } from '../core/links.js';
import { recordReceipt } from '../core/receipts.js';
import { formatEntry, formatSearchResults } from '../utils/output.js';
import type { Entry } from '../types.js';

/**
 * Prompt the user to select a search result to view.
 * Returns the selected entry or null if user quits.
 */
async function promptSelection(entries: Entry[]): Promise<Entry | null> {
  if (!process.stdout.isTTY) return null;

  console.log('');
  for (let i = 0; i < entries.length; i++) {
    console.log(chalk.dim(`  [${i + 1}] `) + chalk.cyan(entries[i].id) + chalk.dim(` — ${entries[i].title}`));
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(`\n${chalk.cyan('?')} Show entry (1-${entries.length}, or q to quit): `);
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === 'q' || trimmed === '') return null;

    const index = parseInt(trimmed, 10);
    if (isNaN(index) || index < 1 || index > entries.length) {
      console.log(chalk.dim('  Invalid selection.'));
      return null;
    }

    return entries[index - 1];
  } finally {
    rl.close();
  }
}

export const searchCommand = new Command('search')
  .description('Search the team brain for entries')
  .argument('<query>', 'Search query (full-text search)')
  .option('--limit <n>', 'Maximum results to return', '20')
  .option('--no-preview', 'Hide content preview snippets')
  .option('--no-interactive', 'Skip the selection prompt')
  .action(async (query: string, options: { limit: string; preview: boolean; interactive: boolean }) => {
    const format = searchCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();
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

        // Interactive selection (text mode only, TTY only)
        if (format !== 'json' && options.interactive && entries.length > 0) {
          const selected = await promptSelection(entries);
          if (selected) {
            await recordReceipt(config.local, selected.id, config.author, 'cli');
            console.log('');
            console.log(formatEntry(selected));

            const related = getRelatedEntries(db, selected.id, 5);
            if (related.length > 0) {
              console.log('');
              console.log(chalk.dim('📎 Related entries:'));
              for (const { entry: rel, reason } of related) {
                console.log(chalk.dim(`   • ${rel.id} — ${reason}`));
              }
            }
          }
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
