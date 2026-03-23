import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRepo, getBrainStatus, joinBrain, syncBrain } from '../src/core/repo.js';
import { saveConfig } from '../src/core/config.js';
import type { BrainConfig } from '../src/types.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-repo-test-'));
  // Mock homedir so config operations use tempDir
  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Helper: create a bare repo with an initial commit and standard brain structure.
 */
async function createBrainRemote(): Promise<string> {
  const { simpleGit } = await import('simple-git');

  const bareDir = path.join(tempDir, 'remote.git');
  fs.mkdirSync(bareDir);
  await simpleGit(bareDir).init(true);

  // Clone, add brain structure, push
  const setupDir = path.join(tempDir, 'setup');
  await simpleGit().clone(bareDir, setupDir);
  const git = simpleGit(setupDir);
  await git.addConfig('user.name', 'Setup');
  await git.addConfig('user.email', 'setup@example.com');

  // Create brain directories
  fs.mkdirSync(path.join(setupDir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(setupDir, 'skills'), { recursive: true });

  // Add a guide entry
  const guideContent = `---
title: Setup Guide
author: setup
created: "2026-03-01T00:00:00Z"
updated: "2026-03-01T00:00:00Z"
tags:
  - onboarding
type: guide
status: active
---

How to set up the project.`;

  fs.writeFileSync(path.join(setupDir, 'guides', 'setup-guide.md'), guideContent, 'utf-8');
  fs.writeFileSync(path.join(setupDir, 'README.md'), '# Team Brain\n', 'utf-8');

  await git.add('.');
  await git.commit('Initial brain setup');
  await git.push('origin', 'main');

  return bareDir;
}

describe('joinBrain', () => {
  it('clones repo and creates config', async () => {
    const remoteUrl = await createBrainRemote();
    const config = await joinBrain(remoteUrl);

    expect(config.remote).toBe(remoteUrl);
    expect(config.local).toContain('.brain');
    expect(config.local).toContain('repo');
    expect(config.lastSync).toBeTruthy();

    // Verify repo was cloned
    expect(fs.existsSync(path.join(config.local, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(config.local, 'guides'))).toBe(true);
    expect(fs.existsSync(path.join(config.local, 'skills'))).toBe(true);
  });

  it('throws if brain already exists', async () => {
    const remoteUrl = await createBrainRemote();
    await joinBrain(remoteUrl);
    await expect(joinBrain(remoteUrl)).rejects.toThrow('already exists');
  });
});

describe('syncBrain', () => {
  it('pulls changes and returns diff', async () => {
    const remoteUrl = await createBrainRemote();
    const config = await joinBrain(remoteUrl);
    const { simpleGit } = await import('simple-git');

    // Make changes in another clone
    const otherDir = path.join(tempDir, 'other-clone');
    await simpleGit().clone(remoteUrl, otherDir);
    const otherGit = simpleGit(otherDir);
    await otherGit.addConfig('user.name', 'Other');
    await otherGit.addConfig('user.email', 'other@example.com');

    // Add a new guide
    const newGuide = `---
title: New Feature Guide
author: other
created: "2026-03-20T00:00:00Z"
updated: "2026-03-20T00:00:00Z"
type: guide
status: active
---

New guide content.`;

    fs.writeFileSync(path.join(otherDir, 'guides', 'new-feature-guide.md'), newGuide, 'utf-8');
    await otherGit.add('.');
    await otherGit.commit('Add new guide');
    await otherGit.push();

    // Sync
    const result = await syncBrain(config);
    expect(result.added).toContain('guides/new-feature-guide.md');
  });

  it('returns empty arrays when no changes', async () => {
    const remoteUrl = await createBrainRemote();
    const config = await joinBrain(remoteUrl);
    const result = await syncBrain(config);
    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});

describe('getBrainStatus', () => {
  it('returns entry count and sync info', async () => {
    const remoteUrl = await createBrainRemote();
    const config = await joinBrain(remoteUrl);

    const status = await getBrainStatus(config);
    expect(status.entryCount).toBe(1); // The setup guide
    expect(status.lastSync).toBeTruthy();
    expect(status.remote).toBeTruthy();
  });
});

describe('ensureRepo', () => {
  it('throws if repo path does not exist', () => {
    const config: BrainConfig = {
      remote: 'https://example.com/repo.git',
      local: path.join(tempDir, 'nonexistent'),
      author: 'alice',
    };
    expect(() => ensureRepo(config)).toThrow('Brain repo not found');
  });

  it('throws if path is not a git repo', () => {
    const localDir = path.join(tempDir, 'not-git');
    fs.mkdirSync(localDir);
    const config: BrainConfig = {
      remote: 'https://example.com/repo.git',
      local: localDir,
      author: 'alice',
    };
    expect(() => ensureRepo(config)).toThrow('not a git repository');
  });

  it('succeeds for a valid git repo', async () => {
    const remoteUrl = await createBrainRemote();
    const config = await joinBrain(remoteUrl);
    // Should not throw
    expect(() => ensureRepo(config)).not.toThrow();
  });
});
