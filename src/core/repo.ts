import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig } from './config.js';
import { scanEntries } from './entry.js';
import type { BrainConfig } from '../types.js';
import {
  cloneRepo,
  getCurrentUser,
  getRemoteUrl,
  pullLatest,
} from '../utils/git.js';
import { getBrainDir } from './config.js';

/**
 * Join a brain by cloning its repo and creating a local config.
 */
export async function joinBrain(url: string): Promise<BrainConfig> {
  const brainDir = getBrainDir();
  const repoDir = path.join(brainDir, 'repo');

  if (fs.existsSync(repoDir)) {
    throw new Error(
      `Brain repo already exists at "${repoDir}". Run "brain sync" to update, or remove it to re-join.`,
    );
  }

  await cloneRepo(url, repoDir);

  let author: string;
  try {
    author = await getCurrentUser(repoDir);
  } catch {
    author = 'unknown';
  }

  const config: BrainConfig = {
    remote: url,
    local: repoDir,
    author,
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

export interface SyncResult {
  added: string[];
  updated: string[];
  removed: string[];
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

  return { added, updated, removed };
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
    remote = config.remote;
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
      `Brain repo not found at "${config.local}". Run "brain join <url>" to set up.`,
    );
  }

  const gitDir = path.join(config.local, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error(
      `Directory "${config.local}" is not a git repository. Run "brain join <url>" to set up.`,
    );
  }
}
