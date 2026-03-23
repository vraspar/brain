#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { joinCommand } from './commands/join.js';
import { connectCommand } from './commands/connect.js';
import { pushCommand } from './commands/push.js';
import { digestCommand } from './commands/digest.js';
import { searchCommand } from './commands/search.js';
import { showCommand } from './commands/show.js';
import { listCommand } from './commands/list.js';
import { statsCommand } from './commands/stats.js';
import { syncCommand } from './commands/sync.js';
import { serveCommand } from './commands/serve.js';

const program = new Command();

program
  .name('brain')
  .description('Team knowledge sharing CLI and MCP server')
  .version('0.1.0')
  .option('--format <format>', 'Output format: text or json', 'text')
  .option('-q, --quiet', 'Suppress non-essential output');

program.addCommand(initCommand);
program.addCommand(connectCommand);
program.addCommand(joinCommand, { hidden: true });
program.addCommand(pushCommand);
program.addCommand(digestCommand);
program.addCommand(searchCommand);
program.addCommand(showCommand);
program.addCommand(listCommand);
program.addCommand(statsCommand);
program.addCommand(syncCommand);
program.addCommand(serveCommand);

program.parse();
