import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath } from '../core/index-db.js';
import { getTrailEntries } from '../core/links.js';

export const trailCommand = new Command('trail')
  .description('Explore connected knowledge entries for a topic')
  .argument('<topic>', 'Topic to explore')
  .option('--limit <n>', 'Maximum entries to show', '20')
  .action(async (topic: string, options: { limit: string }) => {
    const format = trailCommand.parent?.opts().format ?? 'text';
    const limit = parseInt(options.limit, 10) || 20;

    try {
      const config = loadConfig();
      const db = createIndex(getDbPath());

      try {
        const trail = getTrailEntries(db, topic, limit);

        if (format === 'json') {
          console.log(JSON.stringify({
            topic,
            count: trail.length,
            entries: trail.map(({ entry, related }) => ({
              id: entry.id,
              title: entry.title,
              type: entry.type,
              author: entry.author,
              tags: entry.tags,
              related: related.map((r) => ({ id: r.id, title: r.title, score: r.score })),
            })),
          }, null, 2));
        } else {
          if (trail.length === 0) {
            console.log(chalk.dim(`No entries found for topic "${topic}".`));
            return;
          }

          console.log(chalk.bold(`🔗 Knowledge trail: ${topic} (${trail.length} entries)`));
          console.log('');

          for (const { entry, related } of trail) {
            console.log(`  ${chalk.cyan(entry.id)} — ${entry.title}`);
            console.log(chalk.dim(`    ${entry.type} by ${entry.author} · ${entry.tags.join(', ') || 'no tags'}`));

            if (related.length > 0) {
              const relatedText = related.map((r) => r.id).join(', ');
              console.log(chalk.dim(`    → related: ${relatedText}`));
            }
            console.log('');
          }
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
