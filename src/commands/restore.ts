import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import matter from 'gray-matter';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, rebuildIndex } from '../core/index-db.js';
import { scanEntries } from '../core/entry.js';
import { commitAndPush } from '../utils/git.js';
import { createLogger } from '../utils/log.js';

/**
 * Scan the _archive/ directory for a specific entry by its ID (slug).
 * Returns the archive-relative file path if found, or null.
 */
function findArchivedEntry(repoPath: string, entryId: string): string | null {
  const archiveBase = path.join(repoPath, '_archive');
  if (!fs.existsSync(archiveBase)) return null;

  // Search in guides/ and skills/ subdirectories
  for (const subdir of ['guides', 'skills']) {
    const filePath = path.join(archiveBase, subdir, `${entryId}.md`);
    if (fs.existsSync(filePath)) {
      return `${subdir}/${entryId}.md`;
    }
  }

  return null;
}

/**
 * List all archived entries with their titles.
 */
function listArchivedEntries(repoPath: string): { id: string; title: string; filePath: string }[] {
  const archiveBase = path.join(repoPath, '_archive');
  if (!fs.existsSync(archiveBase)) return [];

  const entries: { id: string; title: string; filePath: string }[] = [];

  for (const subdir of ['guides', 'skills']) {
    const dirPath = path.join(archiveBase, subdir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = matter(content);
        const title = parsed.data['title'] ? String(parsed.data['title']) : file.replace('.md', '');
        const id = file.replace('.md', '');
        entries.push({ id, title, filePath: `${subdir}/${file}` });
      } catch {
        // Skip malformed files
      }
    }
  }

  return entries;
}

async function confirmRestore(title: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      chalk.yellow(`Restore "${title}" from archive? [y/N] `),
    );
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

export const restoreCommand = new Command('restore')
  .description('Restore an archived entry back to the brain')
  .argument('[entry-id]', 'Entry ID (slug) to restore')
  .option('--force', 'Skip confirmation prompt')
  .option('--list', 'List all archived entries')
  .action(async (entryId: string | undefined, options: { force?: boolean; list?: boolean }) => {
    const format = restoreCommand.parent?.opts().format ?? 'text';
    const log = createLogger(restoreCommand.parent?.opts().quiet);

    try {
      const config = loadConfig();

      // List mode
      if (options.list) {
        const archived = listArchivedEntries(config.local);
        if (archived.length === 0) {
          if (format === 'json') {
            log.data(JSON.stringify({ archived: [] }));
          } else {
            log.info(chalk.dim('No archived entries found.'));
          }
          return;
        }

        if (format === 'json') {
          log.data(JSON.stringify({ archived }, null, 2));
        } else {
          log.data(chalk.bold(`\n📦 Archived entries (${archived.length}):\n`));
          for (const entry of archived) {
            log.data(`  ${chalk.dim(entry.id)} — ${entry.title}`);
          }
          log.info(chalk.dim('\nRun: brain restore <id> to restore an entry.'));
        }
        return;
      }

      // Restore mode requires an entry ID
      if (!entryId) {
        throw new Error(
          'Entry ID required. Run "brain restore --list" to see archived entries.',
        );
      }

      // Find the archived entry
      const archivedPath = findArchivedEntry(config.local, entryId);
      if (!archivedPath) {
        throw new Error(
          `Archived entry "${entryId}" not found. Run "brain restore --list" to see archived entries.`,
        );
      }

      // Read the archived file and extract title
      const archiveFullPath = path.join(config.local, '_archive', archivedPath);
      const content = fs.readFileSync(archiveFullPath, 'utf-8');
      const parsed = matter(content);
      const title = parsed.data['title'] ? String(parsed.data['title']) : entryId;

      // Confirm unless --force
      if (!options.force) {
        const confirmed = await confirmRestore(title);
        if (!confirmed) {
          if (format === 'json') {
            log.data(JSON.stringify({ status: 'cancelled' }));
          } else {
            log.info(chalk.dim('Restore cancelled.'));
          }
          return;
        }
      }

      // Update frontmatter: set status back to active, remove archive metadata
      const restoredData: Record<string, unknown> = { ...parsed.data, status: 'active' };
      delete restoredData['archived_at'];
      delete restoredData['archived_reason'];
      const updatedContent = matter.stringify(parsed.content, restoredData);

      // Move file back to original location
      const restorePath = path.join(config.local, archivedPath);
      fs.mkdirSync(path.dirname(restorePath), { recursive: true });
      fs.writeFileSync(restorePath, updatedContent, 'utf-8');
      fs.unlinkSync(archiveFullPath);

      // Clean up empty archive subdirectories
      const archiveSubdir = path.dirname(archiveFullPath);
      try {
        const remaining = fs.readdirSync(archiveSubdir);
        if (remaining.length === 0) {
          fs.rmdirSync(archiveSubdir);
        }
      } catch {
        // Ignore cleanup errors
      }

      // Commit the restore
      const commitMessage = `Restore: ${title}`;
      const filesToCommit = [archivedPath, `_archive/${archivedPath}`];
      if (config.remote) {
        await commitAndPush(config.local, filesToCommit, commitMessage);
      } else {
        await commitAndPush(config.local, filesToCommit, commitMessage, { skipPush: true });
        if (format !== 'json') {
          log.warn(chalk.yellow('   ⚠ Committed locally (no remote configured).'));
        }
      }

      // Rebuild search index
      const entries = await scanEntries(config.local);
      const db = createIndex(getDbPath());
      try {
        rebuildIndex(db, entries);
      } finally {
        db.close();
      }

      if (format === 'json') {
        log.data(JSON.stringify({
          status: 'restored',
          id: entryId,
          title,
          filePath: archivedPath,
        }, null, 2));
      } else {
        log.success(chalk.green(`✅ Restored: ${title}`));
        log.info(chalk.dim(`   ID: ${entryId}`));
        log.info(chalk.dim(`   File: ${archivedPath}`));
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
