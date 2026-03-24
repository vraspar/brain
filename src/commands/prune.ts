import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import matter from 'gray-matter';
import { loadConfig } from '../core/config.js';
import {
  createIndex,
  getDbPath,
  rebuildIndex,
  updateFreshnessScores,
  getEntriesWithFreshness,
} from '../core/index-db.js';
import { scanEntries } from '../core/entry.js';
import { commitAndPush } from '../utils/git.js';
import { buildUsageStatsMap } from '../core/freshness-stats.js';
import { freshnessIndicator } from '../core/freshness.js';
import Table from 'cli-table3';

interface PruneOptions {
  dryRun?: boolean;
  threshold: string;
  force?: boolean;
  includeType?: string;
  minAge: string;
}

function parseMinAge(period: string): number {
  const match = period.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(`Invalid --min-age "${period}". Use format like 30d (days).`);
  }
  return parseInt(match[1], 10);
}

async function confirmPrune(count: number): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      chalk.yellow(`⚠ Archive ${count} stale entries? They'll move to _archive/ and be hidden from search. [y/N] `),
    );
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

function archiveEntry(repoPath: string, filePath: string): { from: string; to: string } {
  const sourcePath = path.join(repoPath, filePath);
  const archivePath = path.join(repoPath, '_archive', filePath);

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });

  // Update status in frontmatter
  const content = fs.readFileSync(sourcePath, 'utf-8');
  const parsed = matter(content);
  const archivedData: Record<string, unknown> = {
    ...parsed.data,
    status: 'archived',
    archived_at: new Date().toISOString(),
    archived_reason: 'freshness-prune',
  };
  const updated = matter.stringify(parsed.content, archivedData);

  fs.writeFileSync(archivePath, updated, 'utf-8');
  fs.unlinkSync(sourcePath);

  return { from: filePath, to: `_archive/${filePath}` };
}

export const pruneCommand = new Command('prune')
  .description('Archive stale entries based on freshness scoring')
  .option('--dry-run', 'Preview what would be pruned without archiving')
  .option('--threshold <score>', 'Freshness score cutoff (0.0-1.0)', '0.3')
  .option('--force', 'Skip confirmation prompt')
  .option('--include-type <type>', 'Only consider entries of this type')
  .option('--min-age <period>', 'Only prune entries older than this', '30d')
  .action(async (options: PruneOptions) => {
    const format = pruneCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();
      const threshold = parseFloat(options.threshold);
      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        throw new Error('--threshold must be a number between 0.0 and 1.0.');
      }
      const minAgeDays = parseMinAge(options.minAge);

      const db = createIndex(getDbPath());

      try {
        // Compute freshness scores
        const statsMap = buildUsageStatsMap(config.local, '30d');
        updateFreshnessScores(db, statsMap);

        // Get entries with freshness scores
        let candidates = getEntriesWithFreshness(db);

        // Filter by type if specified
        if (options.includeType) {
          if (options.includeType !== 'guide' && options.includeType !== 'skill') {
            throw new Error(`Invalid type "${options.includeType}". Must be "guide" or "skill".`);
          }
          candidates = candidates.filter((e) => e.type === options.includeType);
        }

        // Filter by min-age
        const minAgeDate = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000);
        candidates = candidates.filter((e) => new Date(e.created) <= minAgeDate);

        // Filter by threshold
        const staleEntries = candidates.filter(
          (e) => e.freshnessScore !== null && e.freshnessScore < threshold,
        );

        const freshEntries = candidates.filter(
          (e) => e.freshnessScore === null || e.freshnessScore >= threshold,
        );

        if (staleEntries.length === 0) {
          if (format === 'json') {
            console.log(JSON.stringify({ status: 'no-stale-entries', pruned: 0 }));
          } else {
            console.log(chalk.green('✅ No stale entries found. Your brain is healthy!'));
          }
          return;
        }

        // Display preview table
        if (format !== 'json') {
          const table = new Table({
            head: ['Title', 'Author', 'Freshness', 'Score', 'Reads/30d'],
            style: { head: ['cyan'] },
          });

          for (const entry of staleEntries) {
            table.push([
              entry.title,
              entry.author,
              freshnessIndicator(entry.freshnessLabel as 'fresh' | 'aging' | 'stale' ?? 'stale'),
              (entry.freshnessScore ?? 0).toFixed(2),
              String(entry.readCount30d ?? 0),
            ]);
          }

          if (options.dryRun) {
            console.log(chalk.bold(`\n🔍 Freshness Analysis (${candidates.length + freshEntries.length} entries)\n`));
            console.log(chalk.bold(`Would archive ${staleEntries.length} entries:`));
          } else {
            console.log(chalk.bold(`\n🔍 Found ${staleEntries.length} stale entries to archive.\n`));
          }
          console.log(table.toString());
        }

        // Dry run stops here
        if (options.dryRun) {
          if (format === 'json') {
            console.log(JSON.stringify({
              status: 'dry-run',
              wouldPrune: staleEntries.map((e) => ({
                id: e.id,
                title: e.title,
                score: e.freshnessScore,
                label: e.freshnessLabel,
              })),
              count: staleEntries.length,
            }, null, 2));
          } else {
            console.log(chalk.dim('\nNo files changed. Run without --dry-run to archive.'));
          }
          return;
        }

        // Confirm unless --force
        if (!options.force) {
          const confirmed = await confirmPrune(staleEntries.length);
          if (!confirmed) {
            if (format === 'json') {
              console.log(JSON.stringify({ status: 'cancelled' }));
            } else {
              console.log(chalk.dim('Prune cancelled.'));
            }
            return;
          }
        }

        // Archive each stale entry
        const archived: { from: string; to: string }[] = [];
        for (const entry of staleEntries) {
          const result = archiveEntry(config.local, entry.filePath);
          archived.push(result);
          if (format !== 'json') {
            console.log(chalk.green(`   ✅ Archived: ${entry.title} → ${result.to}`));
          }
        }

        // Commit all changes
        const allPaths = archived.flatMap((a) => [a.from, a.to]);
        const commitMessage = `Prune ${archived.length} stale entries`;
        if (config.remote) {
          await commitAndPush(config.local, allPaths, commitMessage);
        } else {
          await commitAndPush(config.local, allPaths, commitMessage, { skipPush: true });
          if (format !== 'json') {
            console.log(chalk.yellow('   ⚠ Committed locally (no remote configured).'));
          }
        }

        // Rebuild index
        const entries = await scanEntries(config.local);
        rebuildIndex(db, entries);

        if (format === 'json') {
          console.log(JSON.stringify({
            status: 'pruned',
            archived: archived.map((a) => a.from),
            count: archived.length,
          }, null, 2));
        } else {
          console.log(chalk.green(`\n✅ Pruned ${archived.length} entries. Run "brain list --archived" to see them.`));
        }
      } finally {
        db.close();
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
