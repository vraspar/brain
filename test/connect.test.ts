import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinBrain, extractHubName } from '../src/core/repo.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-connect-test-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Helper: create a bare repo with brain structure and optional README.
 */
async function createBrainRemote(options?: {
  readmeContent?: string;
  skipReadme?: boolean;
}): Promise<string> {
  const { simpleGit } = await import('simple-git');

  const bareDir = path.join(tempDir, 'remote.git');
  fs.mkdirSync(bareDir);
  await simpleGit(bareDir).init(true);

  const setupDir = path.join(tempDir, 'setup');
  await simpleGit().clone(bareDir, setupDir);
  const git = simpleGit(setupDir);
  await git.addConfig('user.name', 'TestUser');
  await git.addConfig('user.email', 'test@example.com');

  // Create brain directories
  fs.mkdirSync(path.join(setupDir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(setupDir, 'skills'), { recursive: true });

  // Add a guide entry
  const guideContent = `---
title: Getting Started
author: testuser
created: "2026-03-01T00:00:00Z"
updated: "2026-03-01T00:00:00Z"
tags:
  - onboarding
type: guide
status: active
---

Welcome to the team brain.`;

  fs.writeFileSync(path.join(setupDir, 'guides', 'getting-started.md'), guideContent, 'utf-8');

  if (!options?.skipReadme) {
    const readme = options?.readmeContent ?? '# 🧠 my-team-knowledge\n\nA shared knowledge hub.\n';
    fs.writeFileSync(path.join(setupDir, 'README.md'), readme, 'utf-8');
  }

  await git.add('.');
  await git.commit('Initial brain setup');
  await git.push('origin', 'main');

  return bareDir;
}

describe('joinBrain with author override', () => {
  it('uses provided author name instead of git config', async () => {
    const remoteUrl = await createBrainRemote();
    const config = await joinBrain(remoteUrl, 'custom-author');

    expect(config.author).toBe('custom-author');
    expect(config.remote).toBe(remoteUrl);
    expect(config.local).toContain('.brain');
  });

  it('falls back to git user.name when no override', async () => {
    const remoteUrl = await createBrainRemote();
    const config = await joinBrain(remoteUrl);

    // The cloned repo inherits global git config — TestUser is only local to setup
    // so it may fall back to the system user or 'unknown'
    expect(config.author).toBeTruthy();
    expect(config.remote).toBe(remoteUrl);
  });
});

describe('joinBrain extracts hub name', () => {
  it('extracts hub name from README with brain emoji', async () => {
    const remoteUrl = await createBrainRemote({
      readmeContent: '# 🧠 my-team-knowledge\n\nA shared hub.\n',
    });
    const config = await joinBrain(remoteUrl);

    expect(config.hubName).toBe('my-team-knowledge');
  });

  it('extracts hub name from README without emoji', async () => {
    const remoteUrl = await createBrainRemote({
      readmeContent: '# Team Brain Hub\n\nDescription.\n',
    });
    const config = await joinBrain(remoteUrl);

    expect(config.hubName).toBe('Team Brain Hub');
  });

  it('returns undefined hubName when no README exists', async () => {
    const remoteUrl = await createBrainRemote({ skipReadme: true });
    const config = await joinBrain(remoteUrl);

    expect(config.hubName).toBeUndefined();
  });

  it('returns undefined hubName when README has no H1', async () => {
    const remoteUrl = await createBrainRemote({
      readmeContent: 'Just some text without a heading.\n',
    });
    const config = await joinBrain(remoteUrl);

    expect(config.hubName).toBeUndefined();
  });
});

describe('joinBrain error message', () => {
  it('throws with clear message when brain already exists', async () => {
    const remoteUrl = await createBrainRemote();
    await joinBrain(remoteUrl);

    await expect(joinBrain(remoteUrl)).rejects.toThrow('already exists');
    await expect(joinBrain(remoteUrl)).rejects.toThrow('brain sync');
  });
});

describe('extractHubName', () => {
  it('extracts name with brain emoji prefix', () => {
    const dir = path.join(tempDir, 'test-repo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# 🧠 Engineering Knowledge\n\nContent.\n');

    expect(extractHubName(dir)).toBe('Engineering Knowledge');
  });

  it('extracts plain H1 name', () => {
    const dir = path.join(tempDir, 'test-repo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# My Brain\n\nContent.\n');

    expect(extractHubName(dir)).toBe('My Brain');
  });

  it('returns undefined for missing README', () => {
    const dir = path.join(tempDir, 'empty-repo');
    fs.mkdirSync(dir, { recursive: true });

    expect(extractHubName(dir)).toBeUndefined();
  });

  it('returns undefined for README without H1', () => {
    const dir = path.join(tempDir, 'test-repo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '## Secondary heading only\n');

    expect(extractHubName(dir)).toBeUndefined();
  });

  it('handles multiline README and picks first H1', () => {
    const dir = path.join(tempDir, 'test-repo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      'Some preamble text\n\n# 🧠 The Brain\n\n## Section\n\nMore content.\n',
    );

    expect(extractHubName(dir)).toBe('The Brain');
  });
});
