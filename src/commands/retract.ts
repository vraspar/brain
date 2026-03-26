import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import matter from 'gray-matter';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, getEntryById, rebuildIndex } from '../core/index-db.js';
import { scanEntries } from '../core/entry.js';
import { commitAndPush } from '../utils/git.js';

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

    try {
      const config = loadConfig();
      const db = createIndex(getDbPath());

      let entry;
      try {
        entry = getEntryById(db, entryId);
      } finally {
        db.close();
      }

      if (!entry) {
        throw new Error(
          `Entry "${entryId}" not found. Run "brain search" to find entries, or "brain list" to see all.`,
        );
      }

      // Confirm unless --force
      if (!options.force) {
        const confirmed = await confirmRetract(entry.title);
        if (!confirmed) {
          if (format === 'json') {
            console.log(JSON.stringify({ status: 'cancelled' }));
          } else {
            console.log(chalk.dim('Retract cancelled.'));
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
          console.log(chalk.yellow('   ⚠ Committed locally (no remote configured).'));
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
        console.log(JSON.stringify({
          status: 'retracted',
          id: entry.id,
          title: entry.title,
          type: entry.type,
          filePath: entry.filePath,
        }, null, 2));
      } else {
        console.log(chalk.green(`✅ Retracted: ${entry.title}`));
        console.log(chalk.dim(`   ID: ${entry.id}`));
        console.log(chalk.dim(`   Archived to: _archive/${entry.filePath}`));
        console.log(chalk.dim('   Restore with: brain restore ' + entry.id));
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
