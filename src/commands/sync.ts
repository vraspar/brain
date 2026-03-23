import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { syncBrain } from '../core/repo.js';
import { scanEntries } from '../core/entry.js';
import { createIndex, getDbPath, rebuildIndex } from '../core/index-db.js';

export const syncCommand = new Command('sync')
  .description('Pull latest changes and rebuild the index')
  .action(async () => {
    const format = syncCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();

      // Sync repo
      const result = await syncBrain(config);

      // Rebuild index
      const entries = await scanEntries(config.local);
      const db = createIndex(getDbPath());
      rebuildIndex(db, entries);
      db.close();

      if (format === 'json') {
        console.log(JSON.stringify({
          status: 'synced',
          added: result.added,
          updated: result.updated,
          removed: result.removed,
          totalEntries: entries.length,
        }, null, 2));
      } else {
        console.log(chalk.green('✅ Brain synced successfully.'));

        if (result.added.length > 0) {
          console.log(chalk.green(`   ✨ ${result.added.length} new: ${result.added.join(', ')}`));
        }
        if (result.updated.length > 0) {
          console.log(chalk.blue(`   📝 ${result.updated.length} updated: ${result.updated.join(', ')}`));
        }
        if (result.removed.length > 0) {
          console.log(chalk.yellow(`   🗑️  ${result.removed.length} removed: ${result.removed.join(', ')}`));
        }
        if (result.added.length === 0 && result.updated.length === 0 && result.removed.length === 0) {
          console.log(chalk.dim('   Already up to date.'));
        }

        console.log(chalk.dim(`   Total entries indexed: ${entries.length}`));
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
