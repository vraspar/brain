import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import matter from 'gray-matter';
import { loadConfig } from '../core/config.js';
import { syncBrain } from '../core/repo.js';
import { scanEntries } from '../core/entry.js';
import { createIndex, getAllEntries, getDbPath, rebuildIndex, updateFreshnessScores } from '../core/index-db.js';
import { buildUsageStatsMap } from '../core/freshness.js';
import { maybeUpdateObsidianLinks } from '../core/obsidian.js';
import { createLogger } from '../utils/log.js';
import { KNOWN_TECH_TERMS } from '../utils/constants.js';
import { extractIntelligentTags } from '../intelligence/index.js';
import { commitAndPush } from '../utils/git.js';

export const syncCommand = new Command('sync')
  .description('Pull latest changes and rebuild the index')
  .option('--retag', 'Re-extract tags using intelligent tagging for entries with generic tags')
  .action(async (options: { retag?: boolean }) => {
    const format = syncCommand.parent?.opts().format ?? 'text';
    const log = createLogger(syncCommand.parent?.opts().quiet);

    try {
      const config = loadConfig();

      // Check for local-only brain (no remote configured)
      if (!config.remote) {
        // Rebuild index locally without pulling
        const entries = await scanEntries(config.local);
        const db = createIndex(getDbPath());
        try {
          rebuildIndex(db, entries);
          maybeUpdateObsidianLinks(config, db);
          const statsMap = buildUsageStatsMap(config.local, '30d');
          updateFreshnessScores(db, statsMap);
        } finally {
          db.close();
        }

        // Retag entries with intelligent tagging if requested
        const retagResult = options.retag
          ? await retagEntries(config.local, format, log)
          : undefined;

        if (format === 'json') {
          log.data(JSON.stringify({
            status: 'synced-local',
            totalEntries: entries.length,
            message: 'No remote configured. Index rebuilt locally.',
            ...(retagResult ? { retagged: retagResult.count } : {}),
          }, null, 2));
        } else {
          log.success(chalk.green('✅ Index rebuilt locally.'));
          log.info(chalk.dim(`   Total entries indexed: ${entries.length}`));
          log.info('');
          log.warn(chalk.yellow('   ⚠ No remote configured. Add one with: brain remote add <url>'));
        }
        return;
      }

      // Sync repo
      const result = await syncBrain(config);

      // Rebuild index
      const entries = await scanEntries(config.local);
      const db = createIndex(getDbPath());
      try {
        rebuildIndex(db, entries);
        maybeUpdateObsidianLinks(config, db);

        // Update freshness scores after rebuilding index
        const statsMap = buildUsageStatsMap(config.local, '30d');
        updateFreshnessScores(db, statsMap);
      } finally {
        db.close();
      }

      // Retag entries with intelligent tagging if requested
      const retagResult = options.retag
        ? await retagEntries(config.local, format, log)
        : undefined;

      if (format === 'json') {
        log.data(JSON.stringify({
          status: result.pullError ? 'partial' : 'synced',
          added: result.added,
          updated: result.updated,
          removed: result.removed,
          pushed: result.pushed,
          pullError: result.pullError ?? null,
          totalEntries: entries.length,
          ...(retagResult ? { retagged: retagResult.count } : {}),
        }, null, 2));
      } else {
        if (result.pullError) {
          log.warn(chalk.yellow('⚠ Brain sync partially completed.'));
          log.warn(chalk.yellow(`   Pull failed: ${result.pullError}`));
        } else {
          log.success(chalk.green('✅ Brain synced successfully.'));
        }

        if (result.added.length > 0) {
          log.info(chalk.green(`   ✨ ${result.added.length} new: ${result.added.join(', ')}`));
        }
        if (result.updated.length > 0) {
          log.info(chalk.blue(`   📝 ${result.updated.length} updated: ${result.updated.join(', ')}`));
        }
        if (result.removed.length > 0) {
          log.info(chalk.yellow(`   🗑️  ${result.removed.length} removed: ${result.removed.join(', ')}`));
        }
        if (!result.pullError && result.added.length === 0 && result.updated.length === 0 && result.removed.length === 0) {
          log.info(chalk.dim('   Already up to date.'));
        }
        if (!result.pushed) {
          log.warn(chalk.yellow('   ⚠ Push to remote failed — local commits remain unpushed.'));
        }

        log.info(chalk.dim(`   Total entries indexed: ${entries.length}`));
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

interface RetagChange {
  id: string;
  oldTags: string[];
  newTags: string[];
}

/**
 * Re-extract tags for entries that only have dictionary-based or empty tags.
 * Writes updated frontmatter to disk and commits changes.
 */
async function retagEntries(
  brainRepoPath: string,
  format: string,
  log: ReturnType<typeof createLogger>,
): Promise<{ count: number; changes: RetagChange[] }> {
  const db = createIndex(getDbPath());
  try {
    const entries = getAllEntries(db);
    const changes: RetagChange[] = [];
    const changedFiles: string[] = [];

    for (const entry of entries) {
      // Only retag entries with empty tags or all tags from KNOWN_TECH_TERMS
      const hasOnlyDictTags = entry.tags.length === 0 ||
        entry.tags.every(t => KNOWN_TECH_TERMS.has(t.toLowerCase()));

      if (!hasOnlyDictTags) continue;

      const newTags = extractIntelligentTags(entry.title, entry.content);
      if (newTags.length === 0) continue;

      // Skip if tags are identical
      const oldSorted = [...entry.tags].sort().join(',');
      const newSorted = [...newTags].sort().join(',');
      if (oldSorted === newSorted) continue;

      // Update frontmatter on disk
      const fullPath = path.join(brainRepoPath, entry.filePath);
      if (!fs.existsSync(fullPath)) continue;

      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsed = matter(raw);
      parsed.data.tags = newTags;
      fs.writeFileSync(fullPath, matter.stringify(parsed.content, parsed.data), 'utf-8');

      changes.push({ id: entry.id, oldTags: entry.tags, newTags });
      changedFiles.push(entry.filePath);
    }

    if (changes.length > 0) {
      // Rebuild index with new tags
      const updatedEntries = await scanEntries(brainRepoPath);
      rebuildIndex(db, updatedEntries);

      // Commit retagged files
      try {
        await commitAndPush(
          brainRepoPath,
          changedFiles,
          `retag ${changes.length} entries with intelligent extraction`,
          { skipPush: false },
        );
      } catch {
        // Push may fail — entries are still retagged locally
      }

      // Display before→after diffs
      if (format !== 'json') {
        log.info('');
        log.success(`🔄 Retagged ${changes.length}/${entries.length} entries`);
        for (const change of changes.slice(0, 5)) {
          const oldStr = change.oldTags.length > 0 ? change.oldTags.join(', ') : '(none)';
          log.info(`   ${chalk.dim(change.id)}`);
          log.info(`     ${chalk.red('- ' + oldStr)}`);
          log.info(`     ${chalk.green('+ ' + change.newTags.join(', '))}`);
        }
        if (changes.length > 5) {
          log.info(chalk.dim(`   ... and ${changes.length - 5} more`));
        }
      }
    } else if (format !== 'json') {
      log.info(chalk.dim('   No entries needed retagging.'));
    }

    return { count: changes.length, changes };
  } finally {
    db.close();
  }
}