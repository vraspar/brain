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
import { extractTags } from '../utils/tags.js';
import { extractIntelligentTags } from '../intelligence/index.js';
import { maybeUpdateObsidianLinks } from '../core/obsidian.js';
import { createLogger } from '../utils/log.js';
import type { EntryType } from '../types.js';

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
  isNew: boolean;
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
    : parsed.tags ?? extractIntelligentTags(title, parsed.content);

  const summary = overrides.summary ?? parsed.summary ?? undefined;

  const entry = createEntry({
    title,
    type: typeStr as EntryType,
    content: parsed.content,
    author: config.author,
    tags,
    summary,
  });

  // Check if entry already exists (for create vs update feedback)
  const existingPath = path.join(config.local, entry.filePath);
  const isNew = !fs.existsSync(existingPath);

  const filePath = await writeEntry(config.local, entry);

  await recordReceipt(config.local, entry.id, config.author, 'cli');

  return {
    id: entry.id,
    title: entry.title,
    type: entry.type,
    filePath,
    tags: entry.tags,
    isNew,
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
  .option('--dry-run', 'Preview what would be pushed without writing')
  .action(async (fileArgs: string[], options: {
    file?: string;
    title?: string;
    type?: string;
    tags?: string;
    summary?: string;
    dryRun?: boolean;
  }) => {
    const format = pushCommand.parent?.opts().format ?? 'text';
    const log = createLogger(pushCommand.parent?.opts().quiet);

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

      // Dry run: preview without writing
      if (options.dryRun) {
        const previews: { file: string; title: string; type: string; tags: string[] }[] = [];
        for (const fp of filePaths) {
          const raw = fs.readFileSync(fp, 'utf-8');
          const parsed = parseInputContent(raw);
          const title = options.title ?? parsed.title ?? extractTitle(raw) ?? titleFromFilename(fp);
          const typeStr = options.type ?? parsed.type ?? 'guide';
          const tags = options.tags
            ? options.tags.split(',').map((t) => t.trim()).filter(Boolean)
            : parsed.tags ?? extractIntelligentTags(title, parsed.content);
          previews.push({ file: path.basename(fp), title, type: typeStr, tags });
        }

        if (format === 'json') {
          log.data(JSON.stringify({ status: 'dry-run', entries: previews }, null, 2));
        } else {
          log.info(chalk.bold(`📋 Dry run — would push ${previews.length} entries:`));
          for (const p of previews) {
            const tagStr = p.tags.length > 0 ? chalk.dim(` [${p.tags.join(', ')}]`) : '';
            log.info(`   ${p.file} → "${p.title}" (${p.type})${tagStr}`);
          }
          log.info('');
          log.info(chalk.dim('No files written. Run without --dry-run to push.'));
        }
        return;
      }

      const results: PushResult[] = [];
      const errors: { file: string; error: string }[] = [];
      let skipPush = !config.remote;
      let pushed = false;

      for (const filePath of filePaths) {
        try {
          const result = await writeSingleEntry(filePath, config, options);
          results.push(result);

          if (format !== 'json' && filePaths.length > 1) {
            log.success(chalk.green(`  ✅ ${result.title}`));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ file: filePath, error: message });

          if (format !== 'json' && filePaths.length > 1) {
            log.warn(chalk.red(`  ✗ ${path.basename(filePath)}: ${message}`));
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

        const pushResult = await commitAndPush(config.local, allFilePaths, commitMsg, { skipPush });
        pushed = pushResult.pushed;

        if (skipPush && format !== 'json') {
          log.warn(chalk.yellow('   ⚠ Committed locally (no remote configured).'));
        } else if (!skipPush && !pushed && format !== 'json') {
          const reason = pushResult.pushError ? `: ${pushResult.pushError}` : '';
          log.warn(chalk.yellow(`   ⚠ Committed locally. Push failed${reason} — run "brain sync" to retry.`));
        }
      }

      // Rebuild index once after all files pushed
      const entries = await scanEntries(config.local);
      const db = createIndex(getDbPath());
      try {
        rebuildIndex(db, entries);
        maybeUpdateObsidianLinks(config, db);
      } finally {
        db.close();
      }

      if (format === 'json') {
        const pushStatus = skipPush ? 'local-only' : (pushed ? 'pushed' : 'push-failed');
        const output = results.length === 1 && errors.length === 0
          ? { status: pushStatus, ...results[0] }
          : { status: errors.length > 0 ? 'partial' : pushStatus, succeeded: results.length, failed: errors.length, entries: results, errors };
        log.data(JSON.stringify(output, null, 2));
      } else if (results.length === 1 && errors.length === 0) {
        const r = results[0];
        const verb = r.isNew ? 'Created' : 'Updated';
        log.success(chalk.green(`✅ ${verb}: ${r.title}`));
        log.info(chalk.dim(`   ID: ${r.id}`));
        log.info(chalk.dim(`   Type: ${r.type}`));
        log.info(chalk.dim(`   File: ${r.filePath}`));
        log.info(chalk.dim(`   Tags: ${r.tags.join(', ') || 'none'}`));
      } else {
        log.success(chalk.green(`✅ Pushed ${results.length} entries`));
        if (errors.length > 0) {
          log.warn(chalk.red(`✗ ${errors.length} file(s) failed`));
          process.exitCode = 1;
        }
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
