import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getAllEntries, getDbPath, getEntriesByAuthor, getEntriesWithFreshness } from '../core/index-db.js';
import { getReadEntryIds } from '../core/receipts.js';
import { formatSearchResults } from '../utils/output.js';
import type { Entry, FreshnessLabel } from '../types.js';

interface ListOptions {
  type?: string;
  author?: string;
  tag?: string[];
  mine?: boolean;
  unread?: boolean;
  stale?: boolean;
  fresh?: boolean;
  showId?: boolean;
}

export const listCommand = new Command('list')
  .description('List all entries in the team brain')
  .option('--type <type>', 'Filter by type: guide or skill')
  .option('--author <author>', 'Filter by author name')
  .option('--tag <tag...>', 'Filter by tag (repeatable)')
  .option('--mine', 'Show only your own entries')
  .option('--unread', 'Show only entries you have not read')
  .option('--stale', 'Show only stale entries (🔴)')
  .option('--fresh', 'Show only fresh entries (🟢)')
  .option('--show-id', 'Show entry ID column')
  .action(async (options: ListOptions) => {
    const format = listCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();
      const db = createIndex(getDbPath());

      let entries: Entry[];
      let freshnessMap: Map<string, FreshnessLabel> | undefined;

      try {
        // Resolve --mine to --author with current user
        const authorFilter = options.mine ? config.author : options.author;

        // Use freshness-aware query if stale/fresh filter is active
        const useFreshness = options.stale || options.fresh;

        if (useFreshness) {
          const withFreshness = getEntriesWithFreshness(db);

          // Build freshness map for display
          freshnessMap = new Map<string, FreshnessLabel>();
          for (const e of withFreshness) {
            if (e.freshnessLabel) {
              freshnessMap.set(e.id, e.freshnessLabel as FreshnessLabel);
            }
          }

          // Apply freshness filter
          if (options.stale) {
            entries = withFreshness.filter((e) => e.freshnessLabel === 'stale');
          } else {
            entries = withFreshness.filter((e) => e.freshnessLabel === 'fresh');
          }

          // Apply author filter
          if (authorFilter) {
            entries = entries.filter((e) => e.author === authorFilter);
          }
        } else if (authorFilter) {
          entries = getEntriesByAuthor(db, authorFilter);
        } else {
          entries = getAllEntries(db);
        }

        // Try to populate freshness map for display even without filter
        if (!freshnessMap) {
          try {
            const withFreshness = getEntriesWithFreshness(db);
            const hasScores = withFreshness.some((e) => e.freshnessLabel !== null);
            if (hasScores) {
              freshnessMap = new Map<string, FreshnessLabel>();
              for (const e of withFreshness) {
                if (e.freshnessLabel) {
                  freshnessMap.set(e.id, e.freshnessLabel as FreshnessLabel);
                }
              }
            }
          } catch {
            // Freshness columns may not exist yet
          }
        }

        // Apply type filter
        if (options.type) {
          if (options.type !== 'guide' && options.type !== 'skill') {
            throw new Error(`Invalid type "${options.type}". Must be "guide" or "skill".`);
          }
          entries = entries.filter((e) => e.type === options.type);
        }

        // Apply tag filter
        if (options.tag?.length) {
          const filterTags = new Set(options.tag.map((t) => t.toLowerCase()));
          entries = entries.filter((e) =>
            e.tags.some((t) => filterTags.has(t.toLowerCase())),
          );
        }

        // Apply unread filter
        if (options.unread) {
          const readIds = getReadEntryIds(config.local, config.author);
          entries = entries.filter((e) => !readIds.has(e.id));
        }
      } finally {
        db.close();
      }

      console.log(formatSearchResults(entries, { format, freshness: freshnessMap, showId: options.showId }));
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
