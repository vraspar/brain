import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, getBrainDir } from '../core/config.js';
import { createIndex, getDbPath, getEntriesWithFreshness, getAllEntries } from '../core/index-db.js';
import { getUnpushedCommitCount } from '../utils/git.js';
import { createLogger } from '../utils/log.js';
import type { FreshnessLabel } from '../types.js';

function getDirectorySize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;

  let totalSize = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules') {
        totalSize += getDirectorySize(fullPath);
      }
    } else {
      totalSize += fs.statSync(fullPath).size;
    }
  }
  return totalSize;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileSize(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  return fs.statSync(filePath).size;
}

export const statusCommand = new Command('status')
  .description('Show brain health dashboard')
  .action(async () => {
    const format = statusCommand.parent?.opts().format ?? 'text';
    const log = createLogger(statusCommand.parent?.opts().quiet);

    try {
      const config = loadConfig();
      const db = createIndex(getDbPath());

      try {
        const allEntries = getAllEntries(db);
        const totalEntries = allEntries.length;
        const guides = allEntries.filter((e) => e.type === 'guide').length;
        const skills = allEntries.filter((e) => e.type === 'skill').length;

        // Freshness counts
        let freshCount = 0;
        let agingCount = 0;
        let staleCount = 0;

        try {
          const withFreshness = getEntriesWithFreshness(db);
          for (const entry of withFreshness) {
            const label = entry.freshnessLabel as FreshnessLabel | null;
            if (label === 'fresh') freshCount++;
            else if (label === 'aging') agingCount++;
            else if (label === 'stale') staleCount++;
            else freshCount++; // no score = assume fresh
          }
        } catch {
          // Freshness columns might not exist yet
          freshCount = totalEntries;
        }

        // Source repos
        const sourceRepos = new Set(
          allEntries
            .filter((e) => e.source_repo)
            .map((e) => e.source_repo),
        );

        // Storage sizes
        const repoSize = getDirectorySize(config.local);
        const dbSize = getFileSize(getDbPath());

        // Archive count
        const archiveDir = path.join(config.local, '_archive');
        let archivedCount = 0;
        if (fs.existsSync(archiveDir)) {
          for (const subdir of ['guides', 'skills']) {
            const dir = path.join(archiveDir, subdir);
            if (fs.existsSync(dir)) {
              archivedCount += fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length;
            }
          }
        }

        // Unpushed commits
        const unpushedResult = config.remote
          ? await getUnpushedCommitCount(config.local)
          : { count: 0, noUpstream: false };

        if (format === 'json') {
          log.data(JSON.stringify({
            hubName: config.hubName ?? null,
            remote: config.remote ?? null,
            local: config.local,
            author: config.author,
            totalEntries,
            guides,
            skills,
            freshness: { fresh: freshCount, aging: agingCount, stale: staleCount },
            archived: archivedCount,
            sourceRepos: [...sourceRepos],
            unpushedCommits: unpushedResult.count,
            noUpstreamTracking: unpushedResult.noUpstream,
            lastSync: config.lastSync ?? null,
            lastDigest: config.lastDigest ?? null,
            repoSize,
            indexSize: dbSize,
          }, null, 2));
        } else {
          const name = config.hubName ? chalk.bold.cyan(config.hubName) : chalk.bold.cyan('Brain');
          log.info(`\n🧠 ${name}`);
          log.info(`   ${chalk.dim('Local:')}  ${config.local} (${totalEntries} entries — ${guides} guides, ${skills} skills)`);

          if (config.remote) {
            log.info(`   ${chalk.dim('Remote:')} ${config.remote}`);
          } else {
            log.info(`   ${chalk.dim('Remote:')} ${chalk.yellow('none (local-only)')}`);
          }

          if (unpushedResult.noUpstream) {
            log.warn(chalk.yellow('   ⚠ No remote tracking branch — run "brain sync" to push'));
          } else if (unpushedResult.count > 0) {
            log.warn(chalk.yellow(`   ⚠ ${unpushedResult.count} local commit${unpushedResult.count === 1 ? '' : 's'} not yet pushed to remote`));
          }

          log.info(`   ${chalk.dim('Author:')} ${config.author}`);
          log.info(`   ${chalk.dim('Index:')}  ${totalEntries} entries indexed (${formatBytes(dbSize)})`);
          log.info(`   ${chalk.dim('Repo:')}   ${formatBytes(repoSize)}`);

          // Freshness
          const freshStr = freshCount > 0 ? chalk.green(`🟢 ${freshCount} Fresh`) : '';
          const agingStr = agingCount > 0 ? chalk.yellow(`🟡 ${agingCount} Aging`) : '';
          const staleStr = staleCount > 0 ? chalk.red(`🔴 ${staleCount} Stale`) : '';
          const freshnessLine = [freshStr, agingStr, staleStr].filter(Boolean).join('  ');
          if (freshnessLine) {
            log.info(`   ${chalk.dim('Health:')} ${freshnessLine}`);
          }

          if (archivedCount > 0) {
            log.info(`   ${chalk.dim('Archive:')} ${archivedCount} archived entries`);
          }

          if (sourceRepos.size > 0) {
            log.info(`   ${chalk.dim('Sources:')} ${[...sourceRepos].join(', ')}`);
          }

          if (config.lastSync) {
            log.info(`   ${chalk.dim('Last sync:')} ${config.lastSync}`);
          }
          if (config.lastDigest) {
            log.info(`   ${chalk.dim('Last digest:')} ${config.lastDigest}`);
          }
        }
      } finally {
        db.close();
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
