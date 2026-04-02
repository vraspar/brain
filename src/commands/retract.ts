import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import matter from 'gray-matter';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, resolveEntryId, rebuildIndex } from '../core/index-db.js';
import { scanEntries } from '../core/entry.js';
import { commitAndPush } from '../utils/git.js';
import { createLogger } from '../utils/log.js';

async function confirmRetract(title: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      chalk.yellow(`⚠ Retract "${title}"? This archives the entry (reversible with brain restore). [y/N] `),
    );
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

export const retractCommand = new Command('retract')
  .description('Remove an entry from the team brain')
  .argument('<entry-id>', 'Entry ID (slug) to retract')
  .option('--force', 'Skip confirmation prompt')
  .action(async (entryId: string, options: { force?: boolean }) => {
    const format = retractCommand.parent?.opts().format ?? 'text';
    const log = createLogger(retractCommand.parent?.opts().quiet);

    try {
      const config = loadConfig();
      const db = createIndex(getDbPath());

      let entry;
      try {
        ({ entry } = resolveEntryId(db, entryId));
      } finally {
        db.close();
      }

      // Confirm unless --force
      if (!options.force) {
        const confirmed = await confirmRetract(entry.title);
        if (!confirmed) {
          if (format === 'json') {
            log.data(JSON.stringify({ status: 'cancelled' }));
          } else {
            log.info(chalk.dim('Retract cancelled.'));
          }
          return;
        }
      }

      // Archive the entry (move to _archive/, update status)
      const fullPath = path.join(config.local, entry.filePath);
      const archivePath = path.join(config.local, '_archive', entry.filePath);

      if (fs.existsSync(fullPath)) {
        // Read and update frontmatter
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = matter(raw);
        const newData = {
          ...parsed.data,
          status: 'archived',
          archived_at: new Date().toISOString(),
          archived_reason: 'retracted',
        };
        const updated = matter.stringify(parsed.content, newData);

        // Write to archive location
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        fs.writeFileSync(archivePath, updated, 'utf-8');

        // Remove original
        fs.unlinkSync(fullPath);
      }

      // Commit the changes
      const commitMessage = `Retract ${entry.type}: ${entry.title}`;
      const filesToCommit = [entry.filePath, `_archive/${entry.filePath}`];
      if (config.remote) {
        await commitAndPush(config.local, filesToCommit, commitMessage);
      } else {
        await commitAndPush(config.local, filesToCommit, commitMessage, { skipPush: true });
        if (format !== 'json') {
          log.warn(chalk.yellow('   ⚠ Committed locally (no remote configured).'));
        }
      }

      // Rebuild search index without the deleted entry
      const entries = await scanEntries(config.local);
      const db2 = createIndex(getDbPath());
      try {
        rebuildIndex(db2, entries);
      } finally {
        db2.close();
      }

      if (format === 'json') {
        log.data(JSON.stringify({
          status: 'retracted',
          id: entry.id,
          title: entry.title,
          type: entry.type,
          filePath: entry.filePath,
        }, null, 2));
      } else {
        log.success(chalk.green(`✅ Retracted: ${entry.title}`));
        log.info(chalk.dim(`   ID: ${entry.id}`));
        log.info(chalk.dim(`   Archived to: _archive/${entry.filePath}`));
        log.info(chalk.dim('   Restore with: brain restore ' + entry.id));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (format === 'json') {
        log.error(JSON.stringify({ error: message }));
      } else {
        log.error(chalk.red(`Error: ${message}`));
      }
      process.exitCode = 1;
    }
  });
