import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, resolveEntryId } from '../core/index-db.js';
import { getRelatedEntries } from '../core/links.js';
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

      try {
        const { entry } = resolveEntryId(db, entryId);

        // Record a read receipt
        await recordReceipt(config.local, entry.id, config.author, 'cli');

        if (format === 'json') {
          const related = getRelatedEntries(db, entry.id, 5);
          console.log(JSON.stringify({
            ...entry,
            related: related.map((r) => ({
              id: r.entry.id,
              title: r.entry.title,
              score: r.score,
              reason: r.reason,
            })),
          }, null, 2));
        } else {
          console.log(formatEntry(entry));

          const related = getRelatedEntries(db, entry.id, 5);
          if (related.length > 0) {
            console.log('');
            console.log(chalk.dim('📎 Related entries:'));
            for (const { entry: rel, reason } of related) {
              console.log(chalk.dim(`   • ${rel.id} — ${reason}`));
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
