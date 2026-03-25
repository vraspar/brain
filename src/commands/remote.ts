import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../core/config.js';
import { addRemote, pushToRemote, validateUrl } from '../utils/git.js';
import { sanitizeUrl } from '../utils/url.js';
import { simpleGit } from 'simple-git';

export const remoteCommand = new Command('remote')
  .description('Manage brain remote repository');

const addAction = new Command('add')
  .description('Add a git remote to a local-only brain')
  .argument('<url>', 'Git remote URL')
  .action(async (url: string) => {
    const format = remoteCommand.parent?.opts().format ?? 'text';
    try {
      const config = loadConfig();
      if (config.remote) {
        throw new Error(
          `Remote already configured: ${config.remote}\n` +
          'Run "brain remote remove" first to disconnect.',
        );
      }
      validateUrl(url);
      await addRemote(config.local, 'origin', url);
      let pushed = false;
      try {
        await pushToRemote(config.local);
        pushed = true;
      } catch {
        // Push failure is non-fatal
      }
      const safeUrl = sanitizeUrl(url);
      saveConfig({ ...config, remote: safeUrl });
      if (format === 'json') {
        console.log(JSON.stringify({ status: 'remote-added', remote: safeUrl, pushed }, null, 2));
      } else {
        console.log(chalk.green(`✅ Remote added: ${safeUrl}`));
        if (pushed) {
          console.log(chalk.dim('   Pushed existing content to remote.'));
        } else {
          console.log(chalk.yellow('   ⚠ Could not push to remote. Run "brain sync" to retry.'));
        }
        console.log('');
        console.log(chalk.bold('   📋 Share with your team:'));
        console.log(chalk.cyan(`      brain connect ${safeUrl}`));
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

const removeAction = new Command('remove')
  .description('Disconnect from the current remote')
  .action(async () => {
    const format = remoteCommand.parent?.opts().format ?? 'text';
    try {
      const config = loadConfig();
      if (!config.remote) {
        throw new Error('No remote configured. Nothing to remove.');
      }
      const removedUrl = config.remote;
      try {
        const git = simpleGit(config.local);
        await git.removeRemote('origin');
      } catch {
        // Remote may not exist in git — that's fine
      }
      const { remote: _, ...configWithoutRemote } = config;
      saveConfig(configWithoutRemote as typeof config);
      if (format === 'json') {
        console.log(JSON.stringify({ status: 'remote-removed', removed: removedUrl }, null, 2));
      } else {
        console.log(chalk.green(`✅ Remote removed: ${removedUrl}`));
        console.log(chalk.dim('   Brain is now local-only. Push operations will commit locally.'));
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

remoteCommand.addCommand(addAction);
remoteCommand.addCommand(removeAction);
