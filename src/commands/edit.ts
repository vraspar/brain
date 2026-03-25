import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../core/config.js';
import { createIndex, getDbPath, getEntryById, rebuildIndex } from '../core/index-db.js';
import { parseEntry, serializeEntry, scanEntries } from '../core/entry.js';
import { commitAndPush } from '../utils/git.js';
import type { EntryType } from '../types.js';

interface EditOptions {
  title?: string;
  tags?: string;
  type?: string;
  addTag?: string[];
  removeTag?: string[];
  summary?: string;
}

export const editCommand = new Command('edit')
  .description('Edit an entry\'s metadata')
  .argument('<entry-id>', 'Entry ID (slug) to edit')
  .option('--title <title>', 'Set new title')
  .option('--tags <tags>', 'Replace all tags (comma-separated)')
  .option('--type <type>', 'Change type: guide or skill')
  .option('--add-tag <tag...>', 'Add tag(s) without removing existing')
  .option('--remove-tag <tag...>', 'Remove specific tag(s)')
  .option('--summary <summary>', 'Set or update summary')
  .action(async (entryId: string, options: EditOptions) => {
    const format = editCommand.parent?.opts().format ?? 'text';

    try {
      const config = loadConfig();
      const db = createIndex(getDbPath());

      let entry;
      try {
        entry = getEntryById(db, entryId);
      } finally {
        db.close();
      }

      if (!entry) {
        throw new Error(
          `Entry "${entryId}" not found. Run "brain search" to find entries, or "brain list" to see all.`,
        );
      }

      // Check that at least one edit option was provided
      const hasEdits = options.title || options.tags || options.type
        || options.addTag?.length || options.removeTag?.length || options.summary;
      if (!hasEdits) {
        throw new Error(
          'No edits specified. Use --title, --tags, --type, --add-tag, --remove-tag, or --summary.',
        );
      }

      // Validate type if provided
      if (options.type && options.type !== 'guide' && options.type !== 'skill') {
        throw new Error(`Invalid type "${options.type}". Must be "guide" or "skill".`);
      }

      // Read the current file from disk to preserve exact content
      const fullPath = path.join(config.local, entry.filePath);
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      const current = parseEntry(entry.filePath, fileContent);

      // Apply edits
      const changes: string[] = [];

      if (options.title) {
        current.title = options.title;
        changes.push(`title → "${options.title}"`);
      }

      if (options.type) {
        current.type = options.type as EntryType;
        changes.push(`type → ${options.type}`);
      }

      if (options.tags) {
        current.tags = options.tags.split(',').map((t) => t.trim()).filter(Boolean);
        changes.push(`tags → [${current.tags.join(', ')}]`);
      }

      if (options.addTag?.length) {
        const existing = new Set(current.tags.map((t) => t.toLowerCase()));
        for (const tag of options.addTag) {
          const trimmed = tag.trim();
          if (trimmed && !existing.has(trimmed.toLowerCase())) {
            current.tags.push(trimmed);
            existing.add(trimmed.toLowerCase());
          }
        }
        changes.push(`+tags: ${options.addTag.join(', ')}`);
      }

      if (options.removeTag?.length) {
        const toRemove = new Set(options.removeTag.map((t) => t.trim().toLowerCase()));
        current.tags = current.tags.filter((t) => !toRemove.has(t.toLowerCase()));
        changes.push(`-tags: ${options.removeTag.join(', ')}`);
      }

      if (options.summary) {
        current.summary = options.summary;
        changes.push(`summary → "${options.summary}"`);
      }

      // Update timestamp
      current.updated = new Date().toISOString();

      // Handle type change — file needs to move directories
      let newFilePath = entry.filePath;
      const filesToCommit: string[] = [];

      if (options.type && options.type !== entry.type) {
        const newDir = options.type === 'guide' ? 'guides' : 'skills';
        newFilePath = `${newDir}/${entry.id}.md`;
        const newFullPath = path.join(config.local, newFilePath);

        // Ensure target directory exists
        fs.mkdirSync(path.dirname(newFullPath), { recursive: true });

        // Write to new location, remove old
        const serialized = serializeEntry(current);
        fs.writeFileSync(newFullPath, serialized, 'utf-8');
        fs.unlinkSync(fullPath);

        filesToCommit.push(entry.filePath, newFilePath);
      } else {
        // Write in place
        const serialized = serializeEntry(current);
        fs.writeFileSync(fullPath, serialized, 'utf-8');
        filesToCommit.push(entry.filePath);
      }

      // Commit
      const commitMessage = `Edit ${current.type}: ${current.title}`;
      if (config.remote) {
        await commitAndPush(config.local, filesToCommit, commitMessage);
      } else {
        await commitAndPush(config.local, filesToCommit, commitMessage, { skipPush: true });
        if (format !== 'json') {
          console.log(chalk.yellow('   ⚠ Committed locally (no remote configured).'));
        }
      }

      // Rebuild index
      const entries = await scanEntries(config.local);
      const db2 = createIndex(getDbPath());
      try {
        rebuildIndex(db2, entries);

        // Clear source_content_hash since the entry was locally edited.
        // This tells source-sync the entry diverged from its source.
        try {
          db2.prepare('UPDATE entries SET source_content_hash = NULL WHERE id = ?').run(entry.id);
        } catch {
          // Column may not exist in older schemas
        }
      } finally {
        db2.close();
      }

      if (format === 'json') {
        console.log(JSON.stringify({
          status: 'edited',
          id: entry.id,
          title: current.title,
          type: current.type,
          tags: current.tags,
          changes,
          filePath: newFilePath,
        }, null, 2));
      } else {
        console.log(chalk.green(`✅ Edited: ${current.title}`));
        console.log(chalk.dim(`   ID: ${entry.id}`));
        for (const change of changes) {
          console.log(chalk.dim(`   ${change}`));
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
