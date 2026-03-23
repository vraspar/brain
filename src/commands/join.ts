import { Command } from 'commander';
import { handleConnect } from './connect.js';

export const joinCommand = new Command('join')
  .description('Join a brain (alias for "connect")')
  .argument('<url>', 'Git remote URL of the brain repository')
  .option('--author <name>', 'Override git user.name for this brain')
  .action(async (url: string, options: { author?: string }) => {
    await handleConnect(url, options, joinCommand);
  });
