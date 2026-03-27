import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import matter from 'gray-matter';
import type { BrainConfig } from '../types.js';
import { getAllEntries } from './index-db.js';
import { getRelatedEntries } from './links.js';

const BRAIN_LINKS_SENTINEL = '<!-- brain:links (auto-generated, do not edit) -->';

export function generateLinksFooter(links: string[]): string {
  if (links.length === 0) return '';
  return `\n---\n${BRAIN_LINKS_SENTINEL}\n**Related:** ${links.join(', ')}\n`;
}

export function stripLinksFooter(content: string): string {
  const sentinelIndex = content.indexOf(BRAIN_LINKS_SENTINEL);
  if (sentinelIndex === -1) return content;
  const beforeSentinel = content.substring(0, sentinelIndex);
  const lastSeparator = beforeSentinel.lastIndexOf('\n---\n');
  if (lastSeparator !== -1) {
    return content.substring(0, lastSeparator).trimEnd();
  }
  return beforeSentinel.trimEnd();
}

function getObsidianLinks(db: Database.Database, entryId: string): string[] {
  const related = getRelatedEntries(db, entryId, 5);
  return related
    .filter((r) => r.score >= 0.3)
    .map((r) => `[[${r.entry.id}|${r.entry.title}]]`);
}

export function updateObsidianLinks(db: Database.Database, repoPath: string): void {
  const entries = getAllEntries(db);

  for (const entry of entries) {
    const links = getObsidianLinks(db, entry.id);
    const footer = generateLinksFooter(links);

    const fullPath = path.join(repoPath, entry.filePath);
    if (!fs.existsSync(fullPath)) continue;

    const raw = fs.readFileSync(fullPath, 'utf-8');
    const parsed = matter(raw);
    const cleanContent = stripLinksFooter(parsed.content.trim());
    const newContent = cleanContent + footer;

    const newData = { ...parsed.data };
    const newRaw = matter.stringify(newContent, newData);
    if (newRaw !== raw) {
      fs.writeFileSync(fullPath, newRaw, 'utf-8');
    }
  }
}

export function ensureObsidianConfig(repoPath: string): void {
  const obsidianDir = path.join(repoPath, '.obsidian');
  if (!fs.existsSync(obsidianDir)) {
    fs.mkdirSync(obsidianDir, { recursive: true });
  }

  const appConfigPath = path.join(obsidianDir, 'app.json');
  if (!fs.existsSync(appConfigPath)) {
    const config = {
      userIgnoreFilters: [
        '_analytics/',
        '_archive/',
        '.git/',
        '.gitkeep',
      ],
      showFrontmatter: true,
      readableLineLength: true,
    };
    fs.writeFileSync(appConfigPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }
}

export function removeObsidianLinks(repoPath: string): void {
  for (const dirName of ['guides', 'skills']) {
    const dirPath = path.join(repoPath, dirName);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const raw = fs.readFileSync(fullPath, 'utf-8');
      if (!raw.includes(BRAIN_LINKS_SENTINEL)) continue;

      const parsed = matter(raw);
      const cleanContent = stripLinksFooter(parsed.content.trim());
      const newRaw = matter.stringify(cleanContent, { ...parsed.data });
      fs.writeFileSync(fullPath, newRaw, 'utf-8');
    }
  }
}

/**
 * Convenience: update Obsidian wikilinks if obsidian mode is enabled.
 * Call after rebuildIndex in any command that modifies entries.
 */
export function maybeUpdateObsidianLinks(
  config: BrainConfig,
  db: Database.Database,
): void {
  if (!config.obsidian) return;
  ensureObsidianConfig(config.local);
  updateObsidianLinks(db, config.local);
}
