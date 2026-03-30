import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig } from './config.js';
import { scanEntries } from './entry.js';
import type { BrainConfig } from '../types.js';
import {
  addRemote,
  cloneRepo,
  commitAll,
  getCurrentUser,
  getRemoteUrl,
  initRepo,
  pullLatest,
  pushToRemote,
} from '../utils/git.js';
import { sanitizeUrl } from '../utils/url.js';
import { getBrainDir } from './config.js';

const HUB_GITIGNORE = `# Brain local cache
*.db
*.db-wal
*.db-shm

# OS files
.DS_Store
Thumbs.db

# Obsidian workspace (local only)
.obsidian/
`;

function generateHubReadme(name: string, remoteUrl?: string): string {
  const connectCmd = remoteUrl
    ? `brain connect ${remoteUrl}`
    : 'brain connect <your-remote-url>';

  return `# 🧠 ${name}

A shared knowledge hub for the team. Powered by [brain](https://github.com/vraspar/brain).

## Quick Start

\`\`\`bash
# Join this brain
${connectCmd}

# See what's new
brain digest

# Share knowledge
brain push --title "My Guide" --type guide --file ./guide.md

# Search
brain search "kubernetes deployment"
\`\`\`

## Entries

_No entries yet. Be the first to contribute!_
`;
}

function generateGettingStartedGuide(author: string): string {
  const now = new Date().toISOString();
  return `---
title: Getting Started with Brain
author: ${author}
created: "${now}"
updated: "${now}"
tags:
  - onboarding
  - getting-started
type: guide
status: active
summary: How to use this team brain to share and discover knowledge.
---

Welcome to your team's shared brain! Here's how to get started.

## Sharing Knowledge

Write a markdown file and push it:

\`\`\`bash
brain push --title "How to Deploy" --type guide --file ./deploy-guide.md
\`\`\`

Tags are auto-detected from content, or add them manually:

\`\`\`bash
brain push --title "Docker Tips" --tags "docker,containers" --file ./tips.md
\`\`\`

## Discovering Knowledge

See what's new since your last check:

\`\`\`bash
brain digest
\`\`\`

Search for specific topics:

\`\`\`bash
brain search "kubernetes deployment"
\`\`\`

List all entries:

\`\`\`bash
brain list
\`\`\`

## Entry Types

- **guide** — How-to docs, tutorials, runbooks
- **skill** — Reusable patterns, snippets, techniques

## Inviting Teammates

Share the remote URL and have them run:

\`\`\`bash
brain connect <remote-url>
\`\`\`

They'll get a full clone with search index built automatically.
`;
}

export interface InitBrainOptions {
  name: string;
  remote?: string;
  author?: string;
}

export interface InitBrainResult {
  config: BrainConfig;
  pushFailed: boolean;
}

/**
 * Initialize a new brain hub: create repo, scaffold directories,
 * generate README, commit, optionally push to remote.
 * Rolls back (removes repo dir) on failure to prevent stuck state.
 */
export async function initBrain(options: InitBrainOptions): Promise<InitBrainResult> {
  const brainDir = getBrainDir();
  const repoDir = path.join(brainDir, 'repo');

  if (fs.existsSync(repoDir)) {
    throw new Error(
      `A brain already exists at "${repoDir}". ` +
      'Run "brain sync" to update, or remove ~/.brain/ to start over.',
    );
  }

  try {
    // 1. Initialize git repo
    await initRepo(repoDir);

    // 2. Create directory structure
    for (const dir of ['guides', 'skills', '_analytics/receipts']) {
      fs.mkdirSync(path.join(repoDir, dir), { recursive: true });
      fs.writeFileSync(path.join(repoDir, dir, '.gitkeep'), '', 'utf-8');
    }

    // 3. Generate .gitignore
    fs.writeFileSync(path.join(repoDir, '.gitignore'), HUB_GITIGNORE, 'utf-8');

    // 4. Generate README.md
    const readmeContent = generateHubReadme(options.name, options.remote);
    fs.writeFileSync(path.join(repoDir, 'README.md'), readmeContent, 'utf-8');

    // 5. Determine author
    let author: string;
    if (options.author) {
      author = options.author;
    } else {
      try {
        author = await getCurrentUser(repoDir);
      } catch {
        author = 'unknown';
      }
    }

    // 6. Create seed getting-started guide
    const guideContent = generateGettingStartedGuide(author);
    fs.writeFileSync(path.join(repoDir, 'guides', 'getting-started.md'), guideContent, 'utf-8');

    // 7. Initial commit
    await commitAll(repoDir, `Initialize brain: ${options.name}`);

    // 8. Set up remote and push (if URL provided)
    let pushFailed = false;
    if (options.remote) {
      await addRemote(repoDir, 'origin', options.remote);
      try {
        await pushToRemote(repoDir);
      } catch {
        pushFailed = true;
      }
    }

    // 9. Save config (saveConfig auto-redacts credentials from remote URL)
    const config: BrainConfig = {
      remote: options.remote ? sanitizeUrl(options.remote) : undefined,
      local: repoDir,
      author,
      hubName: options.name,
      lastSync: new Date().toISOString(),
    };
    saveConfig(config);

    return { config, pushFailed };
  } catch (error) {
    // Rollback: remove partially created repo so user isn't stuck
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * Join a brain by cloning its repo and creating a local config.
 */
export async function joinBrain(url: string, authorOverride?: string): Promise<BrainConfig> {
  const brainDir = getBrainDir();
  const repoDir = path.join(brainDir, 'repo');

  if (fs.existsSync(repoDir)) {
    throw new Error(
      `A brain already exists at "${repoDir}". ` +
      'Run "brain sync" to update, or remove ~/.brain/ to start over.',
    );
  }

  await cloneRepo(url, repoDir);

  let author: string;
  if (authorOverride) {
    author = authorOverride;
  } else {
    try {
      author = await getCurrentUser(repoDir);
    } catch {
      author = 'unknown';
    }
  }

  // Try to extract hub name from README
  const hubName = extractHubName(repoDir);

  const config: BrainConfig = {
    remote: sanitizeUrl(url),
    local: repoDir,
    author,
    hubName,
    lastSync: new Date().toISOString(),
  };

  saveConfig(config);

  // Ensure guides/ and skills/ directories exist
  for (const dir of ['guides', 'skills']) {
    const dirPath = path.join(repoDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  return config;
}

/**
 * Extract the brain name from the README's H1 heading.
 * Matches "# 🧠 Name" or "# Name" patterns.
 * Returns undefined if README is missing or has no H1.
 */
export function extractHubName(repoDir: string): string | undefined {
  const readmePath = path.join(repoDir, 'README.md');
  if (!fs.existsSync(readmePath)) return undefined;

  const content = fs.readFileSync(readmePath, 'utf-8');
  const match = content.match(/^#\s+(?:🧠\s+)?(.+)$/m);
  return match?.[1]?.trim();
}

export interface SyncResult {
  added: string[];
  updated: string[];
  removed: string[];
  pushed: boolean;
}

/**
 * Sync the local brain repo with remote.
 * Returns lists of added, updated, and removed files.
 */
export async function syncBrain(config: BrainConfig): Promise<SyncResult> {
  ensureRepo(config);

  const entriesBefore = await scanEntries(config.local);
  const beforeIds = new Set(entriesBefore.map((e) => e.id));

  const changedFiles = await pullLatest(config.local);

  const entriesAfter = await scanEntries(config.local);
  const afterIds = new Set(entriesAfter.map((e) => e.id));

  const added = entriesAfter
    .filter((e) => !beforeIds.has(e.id))
    .map((e) => e.filePath);

  const removed = entriesBefore
    .filter((e) => !afterIds.has(e.id))
    .map((e) => e.filePath);

  // Updated = files that changed but existed both before and after
  const updated = changedFiles.filter((f) => {
    const isEntry = f.endsWith('.md') && (f.startsWith('guides/') || f.startsWith('skills/'));
    if (!isEntry) return false;
    // Not newly added or removed
    return !added.includes(f) && !removed.includes(f);
  });

  // Update config with sync timestamp
  const updatedConfig: BrainConfig = {
    ...config,
    lastSync: new Date().toISOString(),
  };
  saveConfig(updatedConfig);

  // Push local commits to remote
  let pushed = false;
  try {
    await pushToRemote(config.local);
    pushed = true;
  } catch {
    // Push failed — local commits remain unpushed
  }

  return { added, updated, removed, pushed };
}

export interface BrainStatus {
  entryCount: number;
  lastSync: string;
  remote: string;
}

/**
 * Get the current status of the brain repo.
 */
export async function getBrainStatus(config: BrainConfig): Promise<BrainStatus> {
  ensureRepo(config);

  const entries = await scanEntries(config.local);

  let remote: string;
  try {
    remote = await getRemoteUrl(config.local);
  } catch {
    remote = config.remote ?? 'local-only';
  }

  return {
    entryCount: entries.length,
    lastSync: config.lastSync ?? 'never',
    remote,
  };
}

/**
 * Validate that the repo exists and looks like a brain repo.
 * Throws with a clear message if not.
 */
export function ensureRepo(config: BrainConfig): void {
  if (!fs.existsSync(config.local)) {
    throw new Error(
      `Brain repo not found at "${config.local}". Run "brain init" or "brain connect <url>" to set up.`,
    );
  }

  const gitDir = path.join(config.local, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error(
      `Directory "${config.local}" is not a git repository. Run "brain init" or "brain connect <url>" to set up.`,
    );
  }
}
