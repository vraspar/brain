import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { runIngest, extractRepoName } from '../core/ingest.js';
import { scanEntries } from '../core/entry.js';
import { createIndex, rebuildIndex, getDbPath, updateFreshnessScores } from '../core/index-db.js';
import { commitAndPush } from '../utils/git.js';
import { recordReceipt } from '../core/receipts.js';
import { upsertSource } from '../core/sources.js';
import { buildUsageStatsMap } from '../core/freshness.js';
import { maybeUpdateObsidianLinks } from '../core/obsidian.js';
import type { EntryType, IngestCandidate } from '../types.js';

function freshnessIcon(freshness: string): string {
  if (freshness === 'fresh') return '🟢';
  if (freshness === 'aging') return '🟡';
  return '🔴';
}

function formatPreviewTable(candidates: IngestCandidate[]): void {
  const importable = candidates.filter(c => !c.skip);
  const skipped = candidates.filter(c => c.skip);

  for (const candidate of importable) {
    const icon = freshnessIcon(candidate.freshness);
    const tags = candidate.tags.length > 0
      ? chalk.dim(`[${candidate.tags.slice(0, 3).join(', ')}]`)
      : '';
    console.log(`   ${icon} ${candidate.sourcePath} → "${candidate.title}" ${tags}`);
  }

  for (const candidate of skipped) {
    console.log(chalk.dim(`   ⏭ ${candidate.sourcePath} — ${candidate.skip!.reason}`));
  }
}

export const ingestCommand = new Command('ingest')
  .description('Import documentation from a git repository')
  .argument('<source>', 'Git repo URL or local directory path')
  .option('--path <glob>', 'Restrict scan to paths matching glob')
  .option('--exclude <glob...>', 'Exclude paths matching glob (repeatable)')
  .option('--dry-run', 'Preview without importing')
  .option('--type <type>', 'Force entry type for all imports')
  .option('--source-tag [tag]', 'Tag entries with source name or custom string')
  .option('--max <n>', 'Maximum files to import', '100')
  .option('--overwrite', 'Overwrite existing entries with same slug')
  .option('--shallow', 'Use shallow clone (fastest, but no freshness dating)')
  .action(async (source: string, options: {
    path?: string;
    exclude?: string[];
    dryRun?: boolean;
    type?: string;
    sourceTag?: boolean | string;
    max: string;
    overwrite?: boolean;
    shallow?: boolean;
  }) => {
    const format = ingestCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();

      // Validate type if provided
      if (options.type && options.type !== 'guide' && options.type !== 'skill') {
        throw new Error(`Invalid type "${options.type}". Must be "guide" or "skill".`);
      }

      const maxFiles = parseInt(options.max, 10);
      if (isNaN(maxFiles) || maxFiles < 1) {
        throw new Error(`Invalid --max value "${options.max}". Must be a positive number.`);
      }

      const repoName = extractRepoName(source);

      if (format !== 'json') {
        console.log(chalk.dim(`🔍 Scanning ${source}...`));
      }

      const db = createIndex(getDbPath());
      try {
        const onProgress = format !== 'json'
          ? (msg: string) => console.log(chalk.dim(`   ${msg}`))
          : undefined;

        const { candidates, result, headCommit } = await runIngest({
          source,
          pathFilter: options.path,
          excludePatterns: options.exclude,
          dryRun: options.dryRun,
          type: options.type as EntryType | undefined,
          sourceTag: options.sourceTag,
          maxFiles,
          overwrite: options.overwrite,
          shallow: options.shallow,
          author: config.author,
          onProgress,
        }, config.local, db);

        const importable = candidates.filter(c => !c.skip);
        const skippedCandidates = candidates.filter(c => c.skip);

        if (options.dryRun) {
          if (format === 'json') {
            console.log(JSON.stringify({
              status: 'dry-run',
              source,
              files: candidates.map(c => ({
                path: c.sourcePath,
                title: c.title,
                tags: c.tags,
                freshness: c.freshness,
                skip: c.skip?.reason ?? null,
              })),
              total: importable.length,
              skipped: skippedCandidates.length,
            }, null, 2));
          } else {
            console.log('');
            console.log(chalk.bold(`📋 Dry run — would import ${importable.length} files:`));
            formatPreviewTable(candidates);
            console.log('');
            console.log(chalk.dim('No files written. Run without --dry-run to import.'));
          }
          return;
        }

        if (!result) {
          throw new Error('Import failed: no result returned.');
        }

        // Commit and push imported files
        if (result.imported.length > 0 && config.remote) {
          const entries = await scanEntries(config.local);
          rebuildIndex(db, entries);
          maybeUpdateObsidianLinks(config, db);

          // Compute freshness scores for ingested entries
          const statsMap = buildUsageStatsMap(config.local, '30d');
          updateFreshnessScores(db, statsMap);

          const entryFiles = entries
            .filter(e => e.source_repo === repoName)
            .map(e => e.filePath);

          if (entryFiles.length > 0) {
            await commitAndPush(
              config.local,
              entryFiles,
              `Ingest ${result.imported.length} entries from ${repoName}`,
            );
          }
        } else if (result.imported.length > 0) {
          // Local-only: rebuild index
          const entries = await scanEntries(config.local);
          rebuildIndex(db, entries);
          maybeUpdateObsidianLinks(config, db);

          // Compute freshness scores
          const statsMap = buildUsageStatsMap(config.local, '30d');
          updateFreshnessScores(db, statsMap);
        }

        // Register source for future sync
        if (result.imported.length > 0 && headCommit) {
          upsertSource(repoName, {
            url: source,
            path: options.path,
            exclude: options.exclude,
            lastCommit: headCommit,
            lastSync: new Date().toISOString(),
            entryCount: result.imported.length,
            type: options.type as EntryType | undefined,
            sourceTag: typeof options.sourceTag === 'string' ? options.sourceTag : (options.sourceTag ? true : false),
          });
        }

        if (format === 'json') {
          const staleCount = candidates.filter(c => !c.skip && c.freshness === 'stale').length;
          console.log(JSON.stringify({
            status: 'ingested',
            source,
            sourceRepoName: result.sourceRepoName,
            imported: result.imported.length,
            skipped: result.skipped.length,
            staleCount,
            skippedDetails: result.skipped,
          }, null, 2));
        } else {
          console.log('');
          console.log(chalk.green(`✅ Ingested ${result.imported.length} entries from ${repoName}`));

          if (result.skipped.length > 0) {
            console.log(chalk.yellow(`   ⚠ ${result.skipped.length} skipped:`));
            for (const s of result.skipped.slice(0, 5)) {
              console.log(chalk.dim(`     ${s.path}: ${s.reason}`));
            }
            if (result.skipped.length > 5) {
              console.log(chalk.dim(`     ... and ${result.skipped.length - 5} more`));
            }
          }

          // Check stale ratio and suggest prune
          const staleCount = candidates.filter(c => !c.skip && c.freshness === 'stale').length;
          const importedCount = result.imported.length;
          if (importedCount > 0 && staleCount / importedCount > 0.2) {
            const pct = Math.round((staleCount / importedCount) * 100);
            console.log('');
            console.log(chalk.yellow(`   💡 ${pct}% of imported entries are stale. Run 'brain prune --dry-run' to review.`));
          }

          console.log('');
          console.log(chalk.dim('   Run: brain digest --since 1d'));
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
