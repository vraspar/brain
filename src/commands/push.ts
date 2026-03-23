import fs from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createEntry, writeEntry } from '../core/entry.js';
import { createIndex, rebuildIndex, getDbPath } from '../core/index-db.js';
import { scanEntries } from '../core/entry.js';
import { commitAndPush } from '../utils/git.js';
import { recordReceipt } from '../core/receipts.js';
import type { EntryType } from '../types.js';

const KNOWN_TECH_TERMS = new Set([
  'typescript', 'javascript', 'python', 'react', 'node', 'docker',
  'kubernetes', 'k8s', 'aws', 'azure', 'gcp', 'terraform', 'ci/cd',
  'cicd', 'git', 'api', 'rest', 'graphql', 'sql', 'nosql', 'redis',
  'postgres', 'mongodb', 'nginx', 'linux', 'bash', 'helm', 'jenkins',
  'github', 'gitlab', 'vscode', 'eslint', 'prettier', 'vitest', 'jest',
  'webpack', 'vite', 'nextjs', 'express', 'fastify', 'rust', 'go',
  'java', 'csharp', 'dotnet', 'angular', 'vue', 'svelte', 'tailwind',
  'css', 'html', 'npm', 'yarn', 'pnpm', 'deno', 'bun',
]);

function extractTags(content: string): string[] {
  const words = content.toLowerCase().match(/\b[a-z][a-z0-9/.-]+\b/g) ?? [];
  const found = new Set<string>();
  for (const word of words) {
    if (KNOWN_TECH_TERMS.has(word) && found.size < 5) {
      found.add(word);
    }
  }
  return [...found];
}

export const pushCommand = new Command('push')
  .description('Push a new entry to the team brain')
  .option('--file <path>', 'Read content from a file')
  .option('--title <title>', 'Entry title')
  .option('--type <type>', 'Entry type (guide or skill)', 'guide')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--summary <summary>', 'Short summary of the entry')
  .action(async (options: {
    file?: string;
    title?: string;
    type: string;
    tags?: string;
    summary?: string;
  }) => {
    const format = pushCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();

      // Validate type
      if (options.type !== 'guide' && options.type !== 'skill') {
        throw new Error(`Invalid type "${options.type}". Must be "guide" or "skill".`);
      }

      // Get content
      let content: string;
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          throw new Error(`File not found: ${options.file}`);
        }
        content = fs.readFileSync(options.file, 'utf-8');
      } else {
        throw new Error(
          'Content required. Use --file <path> to provide content from a file.\n' +
          'Example: brain push --title "My Guide" --file ./guide.md',
        );
      }

      // Get title
      const title = options.title;
      if (!title) {
        throw new Error('Title required. Use --title "..." to provide a title.');
      }

      // Parse or auto-generate tags
      const tags = options.tags
        ? options.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : extractTags(content);

      // Create entry
      const entry = createEntry({
        title,
        type: options.type as EntryType,
        content,
        author: config.author,
        tags,
        summary: options.summary,
      });

      // Write to repo
      const filePath = await writeEntry(config.local, entry);

      // Commit and push
      await commitAndPush(config.local, [filePath], `Add ${entry.type}: ${entry.title}`);

      // Rebuild index
      const entries = await scanEntries(config.local);
      const db = createIndex(getDbPath());
      try {
        rebuildIndex(db, entries);
      } finally {
        db.close();
      }

      // Record receipt
      await recordReceipt(config.local, entry.id, config.author, 'cli');

      if (format === 'json') {
        console.log(JSON.stringify({
          status: 'pushed',
          id: entry.id,
          title: entry.title,
          type: entry.type,
          filePath,
          tags: entry.tags,
        }, null, 2));
      } else {
        console.log(chalk.green(`✅ Pushed: ${entry.title}`));
        console.log(chalk.dim(`   ID: ${entry.id}`));
        console.log(chalk.dim(`   Type: ${entry.type}`));
        console.log(chalk.dim(`   File: ${filePath}`));
        console.log(chalk.dim(`   Tags: ${entry.tags.join(', ') || 'none'}`));
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
