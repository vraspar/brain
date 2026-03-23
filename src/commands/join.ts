import { Command } from 'commander';
import chalk from 'chalk';
import { joinBrain } from '../core/repo.js';
import { scanEntries } from '../core/entry.js';
import { createIndex, rebuildIndex, getDbPath } from '../core/index-db.js';

export const joinCommand = new Command('join')
  .description('Join an existing team brain by cloning its repository')
  .argument('<url>', 'Git remote URL of the brain repository')
  .action(async (url: string) => {
    const format = joinCommand.parent?.opts().format ?? 'text';

    try {
      const config = await joinBrain(url);
      const entries = await scanEntries(config.local);

      // Build the search index
      const db = createIndex(getDbPath());
      rebuildIndex(db, entries);
      db.close();

      if (format === 'json') {
        console.log(JSON.stringify({
          status: 'joined',
          remote: config.remote,
          local: config.local,
          author: config.author,
          entryCount: entries.length,
        }, null, 2));
      } else {
        console.log(chalk.green(`✅ Joined brain: ${config.remote}`));
        console.log(chalk.dim(`   Local: ${config.local}`));
        console.log(chalk.dim(`   Author: ${config.author}`));
        console.log(chalk.dim(`   Indexed ${entries.length} entries.`));
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
