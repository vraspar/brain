import readline from 'node:readline/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import { initBrain } from '../core/repo.js';
import { scanEntries } from '../core/entry.js';
import { createIndex, rebuildIndex, getDbPath } from '../core/index-db.js';

async function promptUser(question: string, hint?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const prefix = hint ? `  ${chalk.dim(hint)}\n` : '';
    const answer = await rl.question(`${prefix}${chalk.cyan('?')} ${question} `);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export const initCommand = new Command('init')
  .description('Create a new team brain hub')
  .option('--name <name>', 'Brain name (used in README)')
  .option('--remote <url>', 'GitHub remote URL to push to')
  .option('--author <name>', 'Override git user.name')
  .action(async (options: {
    name?: string;
    remote?: string;
    author?: string;
  }) => {
    const format = initCommand.parent?.opts().format ?? 'text';

    try {
      let name = options.name;
      let remote = options.remote;

      // Interactive wizard if name not provided
      if (!name) {
        if (format === 'json') {
          throw new Error('--name is required in JSON mode. Usage: brain init --name "My Brain"');
        }
        console.log(`\n${chalk.bold('🧠 Create a New Team Brain')}\n`);

        name = await promptUser(
          'Brain name:',
          'This appears in the README. Use something your team will recognize.',
        );
        if (!name) {
          throw new Error('Brain name is required.');
        }

        if (remote === undefined) {
          remote = await promptUser(
            'GitHub remote URL (optional, press Enter to skip):',
            'Create an empty repo on GitHub first, then paste its URL here.',
          ) || undefined;
        }
        console.log('');
      }

      // Execute
      if (format !== 'json') {
        console.log(chalk.dim(`Creating brain "${name}"...`));
      }

      const { config, pushFailed } = await initBrain({ name, remote, author: options.author });

      // Build search index with seed content
      const entries = await scanEntries(config.local);
      const db = createIndex(getDbPath());
      try {
        rebuildIndex(db, entries);
      } finally {
        db.close();
      }

      if (format === 'json') {
        console.log(JSON.stringify({
          status: 'initialized',
          name,
          local: config.local,
          remote: config.remote ?? null,
          author: config.author,
          pushFailed,
        }, null, 2));
      } else {
        console.log(chalk.green(`✅ Brain "${name}" is ready!${config.remote ? '' : ' (local-only)'}`));
        console.log(chalk.dim(`   Local:  ${config.local}`));
        if (config.remote) {
          console.log(chalk.dim(`   Remote: ${config.remote}`));
        }
        console.log(chalk.dim(`   Author: ${config.author}`));

        if (pushFailed) {
          console.log('');
          console.log(chalk.yellow(`   ⚠ Created locally but failed to push to remote. Run "brain sync" to retry.`));
        } else if (config.remote) {
          console.log('');
          console.log(chalk.bold('   📋 Share this with your team:'));
          console.log(chalk.cyan(`      brain connect ${config.remote}`));
        } else {
          console.log('');
          console.log(chalk.yellow('   ⚠ No remote configured. Knowledge stays on this machine.'));
        }

        console.log('');
        console.log(chalk.dim('   Next steps:'));
        console.log(chalk.dim('     brain push --title "My First Guide" --file ./guide.md'));
        console.log(chalk.dim('     brain digest'));
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
