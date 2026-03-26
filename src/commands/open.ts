import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, resolveEntryId } from '../core/index-db.js';

/**
 * Resolve the editor command. Checks $EDITOR, $VISUAL, then platform defaults.
 */
function resolveEditor(): string {
  if (process.env['EDITOR']) return process.env['EDITOR'];
  if (process.env['VISUAL']) return process.env['VISUAL'];

  switch (process.platform) {
    case 'darwin': return 'open';
    case 'win32': return 'start';
    default: return 'xdg-open';
  }
}

export const openCommand = new Command('open')
  .description('Open an entry file in your editor')
  .argument('<entry-id>', 'Entry ID (slug) to open')
  .action(async (entryId: string) => {
    const format = openCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();

      const db = createIndex(getDbPath());
      let filePath: string;
      try {
        const { entry } = resolveEntryId(db, entryId);
        filePath = entry.filePath;
      } finally {
        db.close();
      }

      const fullPath = path.join(config.local, filePath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Entry file not found at "${fullPath}". Run "brain sync" to update.`);
      }

      const editor = resolveEditor();

      // Use execFileSync — no shell interpolation, prevents command injection
      // via $EDITOR or filenames with special characters
      try {
        execFileSync(editor, [fullPath], { stdio: 'inherit' });
      } catch {
        throw new Error(
          `Failed to open "${fullPath}" with "${editor}".\n` +
          'Set $EDITOR or $VISUAL to your preferred editor.',
        );
      }

      if (format === 'json') {
        console.log(JSON.stringify({
          status: 'opened',
          entryId,
          filePath: fullPath,
          editor,
        }, null, 2));
      } else {
        console.log(chalk.dim(`Opened ${filePath} in ${editor}`));
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
