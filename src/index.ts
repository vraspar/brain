#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { connectCommand } from './commands/connect.js';
import { pushCommand } from './commands/push.js';
import { digestCommand } from './commands/digest.js';
import { searchCommand } from './commands/search.js';
import { showCommand } from './commands/show.js';
import { listCommand } from './commands/list.js';
import { statsCommand } from './commands/stats.js';
import { syncCommand } from './commands/sync.js';
import { serveCommand } from './commands/serve.js';
import { retractCommand } from './commands/retract.js';
import { trailCommand } from './commands/trail.js';
import { pruneCommand } from './commands/prune.js';
import { ingestCommand } from './commands/ingest.js';
import { restoreCommand } from './commands/restore.js';
import { sourcesCommand } from './commands/sources.js';
import { remoteCommand } from './commands/remote.js';
import { openCommand } from './commands/open.js';
import { editCommand } from './commands/edit.js';
import { statusCommand } from './commands/status.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('brain')
  .description('CLI-first knowledge sharing for dev teams')
  .version(pkg.version)
  .option('--format <format>', 'Output format: text or json', 'text')
  .option('-q, --quiet', 'Suppress non-essential output');

// Register all commands
program.addCommand(pushCommand);
program.addCommand(searchCommand);
program.addCommand(showCommand);
program.addCommand(digestCommand);
program.addCommand(syncCommand);
program.addCommand(editCommand);
program.addCommand(retractCommand);
program.addCommand(openCommand);
program.addCommand(listCommand);
program.addCommand(trailCommand);
program.addCommand(sourcesCommand);
program.addCommand(ingestCommand);
program.addCommand(pruneCommand);
program.addCommand(restoreCommand);
program.addCommand(initCommand);
program.addCommand(connectCommand);
program.addCommand(remoteCommand);
program.addCommand(statusCommand);
program.addCommand(serveCommand);
program.addCommand(statsCommand);

// Grouped help output
const COMMAND_GROUPS: { heading: string; commands: string[] }[] = [
  { heading: 'Core', commands: ['push', 'search', 'show', 'digest', 'sync'] },
  { heading: 'Entry Management', commands: ['edit', 'retract', 'open', 'list'] },
  { heading: 'Discovery', commands: ['trail', 'sources'] },
  { heading: 'Content Lifecycle', commands: ['ingest', 'prune', 'restore'] },
  { heading: 'Setup', commands: ['init', 'connect', 'remote', 'status', 'serve', 'stats'] },
];

program.configureHelp({
  formatHelp(cmd, helper) {
    const termWidth = helper.padWidth(cmd, helper);
    const helpWidth = helper.helpWidth ?? 80;

    const lines: string[] = [];

    // Usage
    lines.push(`Usage: ${helper.commandUsage(cmd)}`);
    lines.push('');

    // Description
    const desc = helper.commandDescription(cmd);
    if (desc) {
      lines.push(desc);
      lines.push('');
    }

    // Options
    const opts = helper.visibleOptions(cmd);
    if (opts.length > 0) {
      lines.push('Options:');
      for (const opt of opts) {
        const optStr = helper.optionTerm(opt);
        const optDesc = helper.optionDescription(opt);
        const padding = ' '.repeat(Math.max(termWidth - optStr.length + 2, 2));
        lines.push(`  ${optStr}${padding}${optDesc}`);
      }
      lines.push('');
    }

    // Grouped commands
    const cmdMap = new Map(
      helper.visibleCommands(cmd).map((c) => [c.name(), c]),
    );

    for (const group of COMMAND_GROUPS) {
      const groupCmds = group.commands
        .map((name) => cmdMap.get(name))
        .filter((c): c is Command => c !== undefined);

      if (groupCmds.length === 0) continue;

      lines.push(`${group.heading}:`);
      for (const c of groupCmds) {
        const term = helper.subcommandTerm(c);
        const desc = helper.subcommandDescription(c);
        const padding = ' '.repeat(Math.max(termWidth - term.length + 2, 2));
        lines.push(`  ${term}${padding}${desc}`);
        cmdMap.delete(c.name());
      }
      lines.push('');
    }

    // Any ungrouped commands (e.g. help)
    if (cmdMap.size > 0) {
      for (const [, c] of cmdMap) {
        const term = helper.subcommandTerm(c);
        const desc = helper.subcommandDescription(c);
        const padding = ' '.repeat(Math.max(termWidth - term.length + 2, 2));
        lines.push(`  ${term}${padding}${desc}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  },
});

program.parse();
