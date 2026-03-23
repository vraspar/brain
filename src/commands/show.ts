import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, getEntryById } from '../core/index-db.js';
import { recordReceipt } from '../core/receipts.js';
import { formatEntry } from '../utils/output.js';

export const showCommand = new Command('show')
  .description('Display a full brain entry')
  .argument('<entry-id>', 'Entry ID (slug) to display')
  .action(async (entryId: string) => {
    const format = showCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();
      const db = createIndex(getDbPath());

      let entry;
      try {
        entry = getEntryById(db, entryId);
      } finally {
        db.close();
      }

      if (!entry) {
        throw new Error(
          `Entry "${entryId}" not found. Run "brain search" to find entries, or "brain list" to see all.`,
        );
      }

      // Record a read receipt
      await recordReceipt(config.local, entry.id, config.author, 'cli');

      console.log(formatEntry(entry, { format }));
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
