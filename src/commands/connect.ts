import { Command } from 'commander';
import chalk from 'chalk';
import { joinBrain } from '../core/repo.js';
import { scanEntries } from '../core/entry.js';
import { createIndex, rebuildIndex, getDbPath } from '../core/index-db.js';
import { maybeUpdateObsidianLinks } from '../core/obsidian.js';

/**
 * Shared handler for both `brain connect` and `brain join`.
 * Clones the remote repo, builds the search index, and displays results.
 */
export async function handleConnect(
  url: string,
  options: { author?: string },
  command: Command,
): Promise<void> {
  const format = command.parent?.opts().format ?? 'text';

  try {
    if (format !== 'json') {
      console.log(chalk.dim('🔗 Connecting to team brain...'));
      console.log(chalk.dim('   Cloning repository...'));
    }

    const config = await joinBrain(url, options.author);
    const entries = await scanEntries(config.local);

    if (format !== 'json') {
      console.log(chalk.dim('   Building search index...'));
    }

    // Build the search index
    const db = createIndex(getDbPath());
    try {
      rebuildIndex(db, entries);
      maybeUpdateObsidianLinks(config, db);
    } finally {
      db.close();
    }

    if (format === 'json') {
      console.log(JSON.stringify({
        status: 'connected',
        name: config.hubName ?? null,
        remote: config.remote,
        local: config.local,
        author: config.author,
        entryCount: entries.length,
      }, null, 2));
    } else {
      console.log('');
      console.log(chalk.green(`✅ Connected to brain: ${config.remote}`));
      console.log(chalk.dim(`   Local:  ${config.local}`));
      console.log(chalk.dim(`   Remote: ${config.remote}`));
      console.log(chalk.dim(`   Author: ${config.author}`));
      console.log(chalk.dim(`   Indexed ${entries.length} entries.`));
      console.log('');
      console.log(chalk.dim('   Try: brain digest'));
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
}

export const connectCommand = new Command('connect')
  .description('Connect to an existing team brain')
  .argument('<url>', 'Git remote URL of the brain repository')
  .option('--author <name>', 'Override git user.name for this brain')
  .action(async (url: string, options: { author?: string }) => {
    await handleConnect(url, options, connectCommand);
  });
