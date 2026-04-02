import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { syncBrain } from '../core/repo.js';
import { scanEntries } from '../core/entry.js';
import { createIndex, getDbPath, rebuildIndex, updateFreshnessScores } from '../core/index-db.js';
import { buildUsageStatsMap } from '../core/freshness.js';
import { maybeUpdateObsidianLinks } from '../core/obsidian.js';
import { createLogger } from '../utils/log.js';

export const syncCommand = new Command('sync')
  .description('Pull latest changes and rebuild the index')
  .action(async () => {
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

        if (format === 'json') {
          log.data(JSON.stringify({
            status: 'synced-local',
            totalEntries: entries.length,
            message: 'No remote configured. Index rebuilt locally.',
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

      if (format === 'json') {
        log.data(JSON.stringify({
          status: 'synced',
          added: result.added,
          updated: result.updated,
          removed: result.removed,
          pushed: result.pushed,
          totalEntries: entries.length,
        }, null, 2));
      } else {
        log.success(chalk.green('✅ Brain synced successfully.'));

        if (result.added.length > 0) {
          log.info(chalk.green(`   ✨ ${result.added.length} new: ${result.added.join(', ')}`));
        }
        if (result.updated.length > 0) {
          log.info(chalk.blue(`   📝 ${result.updated.length} updated: ${result.updated.join(', ')}`));
        }
        if (result.removed.length > 0) {
          log.info(chalk.yellow(`   🗑️  ${result.removed.length} removed: ${result.removed.join(', ')}`));
        }
        if (result.added.length === 0 && result.updated.length === 0 && result.removed.length === 0) {
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
