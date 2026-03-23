import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import {
  createEntry,
  extractTitle,
  parseInputContent,
  scanEntries,
  titleFromFilename,
  writeEntry,
} from '../core/entry.js';
import { createIndex, rebuildIndex, getDbPath } from '../core/index-db.js';
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

/**
 * Resolve file paths from arguments, supporting glob patterns.
 * Returns an array of absolute file paths.
 */
function resolveFilePaths(args: string[]): string[] {
  const resolved: string[] = [];
  for (const arg of args) {
    if (arg.includes('*')) {
      // Glob pattern — expand, match all files (not just .md)
      const dir = path.dirname(arg);
      const pattern = path.basename(arg);
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir)
          .filter((f) => regex.test(f))
          .map((f) => path.resolve(dir, f));
        resolved.push(...files);
      }
    } else if (!fs.existsSync(arg)) {
      throw new Error(`File or directory not found: ${arg}`);
    } else if (fs.statSync(arg).isDirectory()) {
      // Directory — push all .md files inside
      const files = fs.readdirSync(arg)
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.resolve(arg, f));
      resolved.push(...files);
    } else {
      resolved.push(path.resolve(arg));
    }
  }
  return resolved;
}

interface PushResult {
  id: string;
  title: string;
  type: string;
  filePath: string;
  tags: string[];
}

/**
 * Write a single file to the brain repo. Returns metadata.
 * Does NOT commit — caller batches commits for efficiency.
 */
async function writeSingleEntry(
  absolutePath: string,
  config: { local: string; author: string },
  overrides: { title?: string; type?: string; tags?: string; summary?: string },
): Promise<PushResult> {
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf-8');
  const parsed = parseInputContent(raw);

  // Resolve title: flag > frontmatter > H1 > first line > filename
  const title = overrides.title
    ?? parsed.title
    ?? extractTitle(raw)
    ?? titleFromFilename(absolutePath);

  // Resolve type: flag > frontmatter > default 'guide'
  const typeStr = overrides.type ?? parsed.type ?? 'guide';
  if (typeStr !== 'guide' && typeStr !== 'skill') {
    throw new Error(`Invalid type "${typeStr}". Must be "guide" or "skill".`);
  }

  // Resolve tags: flag > frontmatter > auto-extract
  const tags = overrides.tags
    ? overrides.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : parsed.tags ?? extractTags(parsed.content);

  const summary = overrides.summary ?? parsed.summary ?? undefined;

  const entry = createEntry({
    title,
    type: typeStr as EntryType,
    content: parsed.content,
    author: config.author,
    tags,
    summary,
  });

  const filePath = await writeEntry(config.local, entry);

  await recordReceipt(config.local, entry.id, config.author, 'cli');

  return {
    id: entry.id,
    title: entry.title,
    type: entry.type,
    filePath,
    tags: entry.tags,
  };
}

export const pushCommand = new Command('push')
  .description('Push entries to the team brain')
  .argument('[files...]', 'Markdown file(s) or glob pattern (e.g., ./docs/*.md)')
  .option('--file <path>', 'Read content from a file (alternative to positional arg)')
  .option('--title <title>', 'Entry title (auto-detected from content if omitted)')
  .option('--type <type>', 'Entry type: guide or skill (default: auto-detect or guide)')
  .option('--tags <tags>', 'Comma-separated tags (auto-extracted if omitted)')
  .option('--summary <summary>', 'Short summary of the entry')
  .action(async (fileArgs: string[], options: {
    file?: string;
    title?: string;
    type?: string;
    tags?: string;
    summary?: string;
  }) => {
    const format = pushCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();

      // Collect file paths from positional args and --file flag
      const filePaths: string[] = [];
      if (fileArgs.length > 0) {
        filePaths.push(...resolveFilePaths(fileArgs));
      }
      if (options.file) {
        filePaths.push(path.resolve(options.file));
      }

      if (filePaths.length === 0) {
        throw new Error(
          'Content required. Provide a file path or glob pattern.\n' +
          'Examples:\n' +
          '  brain push ./guide.md\n' +
          '  brain push ./docs/*.md\n' +
          '  brain push --title "My Guide" --file ./guide.md',
        );
      }

      // For multi-file push, --title override only applies to single file
      if (filePaths.length > 1 && options.title) {
        throw new Error('--title cannot be used with multiple files. Each file\'s title is auto-detected.');
      }

      const results: PushResult[] = [];
      const errors: { file: string; error: string }[] = [];

      for (const filePath of filePaths) {
        try {
          const result = await writeSingleEntry(filePath, config, options);
          results.push(result);

          if (format !== 'json' && filePaths.length > 1) {
            console.log(chalk.green(`  ✅ ${result.title}`));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ file: filePath, error: message });

          if (format !== 'json' && filePaths.length > 1) {
            console.log(chalk.red(`  ✗ ${path.basename(filePath)}: ${message}`));
          } else if (filePaths.length === 1) {
            throw error;
          }
        }
      }

      // Batch commit all written entries in one commit + push
      if (results.length > 0) {
        const allFilePaths = results.map((r) => r.filePath);
        const commitMsg = results.length === 1
          ? `Add ${results[0].type}: ${results[0].title}`
          : `Add ${results.length} entries`;
        const skipPush = !config.remote;

        await commitAndPush(config.local, allFilePaths, commitMsg, { skipPush });

        if (skipPush && format !== 'json') {
          console.log(chalk.yellow('   ⚠ Committed locally (no remote configured).'));
        }
      }

      // Rebuild index once after all files pushed
      const entries = await scanEntries(config.local);
      const db = createIndex(getDbPath());
      try {
        rebuildIndex(db, entries);
      } finally {
        db.close();
      }

      if (format === 'json') {
        const output = results.length === 1 && errors.length === 0
          ? { status: 'pushed', ...results[0] }
          : { status: errors.length > 0 ? 'partial' : 'pushed', succeeded: results.length, failed: errors.length, entries: results, errors };
        console.log(JSON.stringify(output, null, 2));
      } else if (results.length === 1 && errors.length === 0) {
        const r = results[0];
        console.log(chalk.green(`✅ Pushed: ${r.title}`));
        console.log(chalk.dim(`   ID: ${r.id}`));
        console.log(chalk.dim(`   Type: ${r.type}`));
        console.log(chalk.dim(`   File: ${r.filePath}`));
        console.log(chalk.dim(`   Tags: ${r.tags.join(', ') || 'none'}`));
      } else {
        console.log(chalk.green(`✅ Pushed ${results.length} entries`));
        if (errors.length > 0) {
          console.log(chalk.red(`✗ ${errors.length} file(s) failed`));
          process.exitCode = 1;
        }
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
