import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { loadConfig } from '../core/config.js';
import { loadSources, removeSource } from '../core/sources.js';
import { syncSource } from '../core/source-sync.js';
import { createIndex, getDbPath } from '../core/index-db.js';

export const sourcesCommand = new Command('sources')
  .description('Manage external source repositories')
  .action(async () => {
    // Default action: list sources
    await listSources(sourcesCommand.parent?.opts().format ?? 'text');
  });

sourcesCommand
  .command('list')
  .description('List all registered sources')
  .action(async () => {
    await listSources(sourcesCommand.parent?.opts().format ?? 'text');
  });

sourcesCommand
  .command('sync [name]')
  .description('Sync entries from source repositories')
  .option('--dry-run', 'Show what would change without applying')
  .option('--force', 'Overwrite local changes on conflict')
  .action(async (name: string | undefined, options: { dryRun?: boolean; force?: boolean }) => {
    const format = sourcesCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();
      const registry = loadSources();
      const sourceNames = name ? [name] : Object.keys(registry.sources);

      if (sourceNames.length === 0) {
        if (format === 'json') {
          console.log(JSON.stringify({ status: 'no-sources', message: 'No sources registered' }));
        } else {
          console.log(chalk.yellow('No sources registered. Use source config to add one.'));
        }
        return;
      }

      if (name && !registry.sources[name]) {
        throw new Error(`Source "${name}" not found in registry.`);
      }

      const db = createIndex(getDbPath());
      try {
        const results: Record<string, unknown> = {};

        for (const sourceName of sourceNames) {
          const sourceConfig = registry.sources[sourceName];
          const result = await syncSource(sourceName, sourceConfig, config.local, db, {
            dryRun: options.dryRun,
            force: options.force,
          });

          results[sourceName] = result;

          if (format !== 'json') {
            if (result.unchanged === -1) {
              console.log(chalk.dim(`${sourceName}: already up to date`));
            } else {
              console.log(chalk.bold(`\n📦 ${sourceName}:`));
              if (result.added.length) {
                console.log(chalk.green(`  + ${result.added.length} added`));
              }
              if (result.updated.length) {
                console.log(chalk.blue(`  ~ ${result.updated.length} updated`));
              }
              if (result.archived.length) {
                console.log(chalk.red(`  - ${result.archived.length} archived`));
              }
              if (result.conflicts.length) {
                console.log(chalk.yellow(`  ⚠ ${result.conflicts.length} conflicts (skipped)`));
                for (const c of result.conflicts) {
                  console.log(chalk.yellow(`    ${c}`));
                }
              }
              if (options.dryRun) {
                console.log(chalk.dim('  (dry run — no changes applied)'));
              }
            }
          }
        }

        if (format === 'json') {
          console.log(JSON.stringify(results, null, 2));
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

sourcesCommand
  .command('remove <name>')
  .description('Remove a source from the registry')
  .action(async (name: string) => {
    const format = sourcesCommand.parent?.opts().format ?? 'text';

    try {
      const removed = removeSource(name);

      if (!removed) {
        throw new Error(`Source "${name}" not found.`);
      }

      if (format === 'json') {
        console.log(JSON.stringify({ status: 'removed', source: name }, null, 2));
      } else {
        console.log(chalk.green(`✅ Source "${name}" removed.`));
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

async function listSources(format: string): Promise<void> {
  try {
    const registry = loadSources();
    const entries = Object.entries(registry.sources);

    if (entries.length === 0) {
      if (format === 'json') {
        console.log(JSON.stringify({ sources: [] }));
      } else {
        console.log(chalk.dim('No sources registered.'));
      }
      return;
    }

    if (format === 'json') {
      console.log(JSON.stringify({ sources: registry.sources }, null, 2));
      return;
    }

    const table = new Table({
      head: ['Name', 'URL', 'Entries', 'Last Sync'],
      style: { head: ['cyan'] },
    });

    for (const [name, config] of entries) {
      const lastSync = config.lastSync
        ? new Date(config.lastSync).toLocaleDateString()
        : chalk.dim('never');
      table.push([name, config.url, config.entryCount, lastSync]);
    }

    console.log(table.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format === 'json') {
      console.error(JSON.stringify({ error: message }));
    } else {
      console.error(chalk.red(`Error: ${message}`));
    }
    process.exitCode = 1;
  }
}
