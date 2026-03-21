#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('brain')
  .description('Team knowledge sharing CLI and MCP server')
  .version('0.1.0');

// Commands will be registered here as they are built
// e.g. program.addCommand(initCommand);

program.parse();
