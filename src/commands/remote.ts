import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../core/config.js';
import { addRemote, pushToRemote } from '../utils/git.js';
import { sanitizeUrl } from '../utils/url.js';

export const remoteCommand = new Command('remote')
  .description('Manage brain remote')
  .argument('<action>', '"add" to set a remote URL')
  .argument('<url>', 'Git remote URL')
  .action(async (action: string, url: string) => {
    const format = remoteCommand.parent?.opts().format ?? 'text';

    try {
      if (action !== 'add') {
        throw new Error(`Unknown action "${action}". Use: brain remote add <url>`);
      }

      const config = loadConfig();

      if (config.remote) {
        throw new Error(
          `Remote already configured: ${config.remote}\n` +
          'Remove ~/.brain/config.yaml and re-run brain connect to change remotes.',
        );
      }

      await addRemote(config.local, 'origin', url);

      // Try initial push
      let pushed = false;
      try {
        await pushToRemote(config.local);
        pushed = true;
      } catch {
        // Push failure is non-fatal
      }

      // Update config with remote
      const updatedConfig = {
        ...config,
        remote: sanitizeUrl(url),
      };
      saveConfig(updatedConfig);

      if (format === 'json') {
        console.log(JSON.stringify({
          status: 'remote-added',
          remote: sanitizeUrl(url),
          pushed,
        }, null, 2));
      } else {
        console.log(chalk.green(`✅ Remote added: ${sanitizeUrl(url)}`));
        if (pushed) {
          console.log(chalk.dim('   Pushed existing content to remote.'));
        } else {
          console.log(chalk.yellow('   ⚠ Could not push to remote. Run "brain sync" to retry.'));
        }
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
