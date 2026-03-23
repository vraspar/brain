import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initBrain, extractHubName } from '../src/core/repo.js';
import { loadConfig } from '../src/core/config.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-init-test-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('initBrain', () => {
  it('creates repo with correct directory structure', async () => {
    const config = await initBrain({ name: 'test-brain' });
    const repoDir = config.local;

    expect(fs.existsSync(repoDir)).toBe(true);
    expect(fs.existsSync(path.join(repoDir, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, 'guides'))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, 'skills'))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, '_analytics', 'receipts'))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, '.gitignore'))).toBe(true);

    // .gitkeep files
    expect(fs.existsSync(path.join(repoDir, 'guides', '.gitkeep'))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, 'skills', '.gitkeep'))).toBe(true);
    expect(fs.existsSync(path.join(repoDir, '_analytics', 'receipts', '.gitkeep'))).toBe(true);

    // Seed guide
    expect(fs.existsSync(path.join(repoDir, 'guides', 'getting-started.md'))).toBe(true);
  });

  it('creates seed getting-started guide with valid frontmatter', async () => {
    const config = await initBrain({ name: 'seed-test', author: 'alice' });
    const guidePath = path.join(config.local, 'guides', 'getting-started.md');
    const content = fs.readFileSync(guidePath, 'utf-8');

    expect(content).toContain('title: Getting Started with Brain');
    expect(content).toContain('author: alice');
    expect(content).toContain('type: guide');
    expect(content).toContain('status: active');
    expect(content).toContain('tags:');
    expect(content).toContain('brain push');
    expect(content).toContain('brain digest');
    expect(content).toContain('brain connect');
  });

  it('generates README with brain name', async () => {
    const config = await initBrain({ name: 'my-awesome-brain' });
    const readme = fs.readFileSync(path.join(config.local, 'README.md'), 'utf-8');

    expect(readme).toContain('# 🧠 my-awesome-brain');
    expect(readme).toContain('brain connect');
    expect(readme).toContain('brain digest');
    expect(readme).toContain('brain push');
  });

  it('generates README with remote URL when provided', async () => {
    const { simpleGit } = await import('simple-git');

    // Create a bare remote to push to
    const bareDir = path.join(tempDir, 'remote.git');
    fs.mkdirSync(bareDir);
    await simpleGit(bareDir).init(true);

    const config = await initBrain({ name: 'team-brain', remote: bareDir });
    const readme = fs.readFileSync(path.join(config.local, 'README.md'), 'utf-8');

    expect(readme).toContain(`brain connect ${bareDir}`);
  });

  it('generates README with placeholder when no remote', async () => {
    const config = await initBrain({ name: 'local-brain' });
    const readme = fs.readFileSync(path.join(config.local, 'README.md'), 'utf-8');

    expect(readme).toContain('brain connect <your-remote-url>');
  });

  it('creates valid config', async () => {
    const config = await initBrain({ name: 'cfg-test' });

    expect(config.local).toContain('.brain');
    expect(config.local).toContain('repo');
    expect(config.hubName).toBe('cfg-test');
    expect(config.lastSync).toBeTruthy();

    // Verify config file was written and can be loaded
    const loaded = loadConfig();
    expect(loaded.local).toBe(config.local);
    expect(loaded.hubName).toBe('cfg-test');
    expect(loaded.author).toBe(config.author);
  });

  it('creates local-only config when no remote', async () => {
    const config = await initBrain({ name: 'local-only' });

    expect(config.remote).toBeUndefined();

    const loaded = loadConfig();
    expect(loaded.remote).toBeUndefined();
  });

  it('sets origin remote when URL provided', async () => {
    const { simpleGit } = await import('simple-git');

    const bareDir = path.join(tempDir, 'remote.git');
    fs.mkdirSync(bareDir);
    await simpleGit(bareDir).init(true);

    const config = await initBrain({ name: 'remote-test', remote: bareDir });

    expect(config.remote).toBe(bareDir);

    // Verify git remote was set
    const git = simpleGit(config.local);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    expect(origin).toBeTruthy();
    expect(origin!.refs.fetch).toBe(bareDir);
  });

  it('fails if brain already exists', async () => {
    await initBrain({ name: 'first-brain' });

    await expect(initBrain({ name: 'second-brain' })).rejects.toThrow(
      'A brain already exists',
    );
  });

  it('uses author override', async () => {
    const config = await initBrain({ name: 'author-test', author: 'custom-author' });

    expect(config.author).toBe('custom-author');

    const loaded = loadConfig();
    expect(loaded.author).toBe('custom-author');
  });

  it('creates initial commit', async () => {
    const { simpleGit } = await import('simple-git');

    const config = await initBrain({ name: 'commit-test' });
    const git = simpleGit(config.local);

    const log = await git.log();
    expect(log.total).toBe(1);
    expect(log.latest?.message).toBe('Initialize brain: commit-test');
  });

  it('generates .gitignore with correct content', async () => {
    const config = await initBrain({ name: 'gitignore-test' });
    const gitignore = fs.readFileSync(path.join(config.local, '.gitignore'), 'utf-8');

    expect(gitignore).toContain('*.db');
    expect(gitignore).toContain('*.db-wal');
    expect(gitignore).toContain('*.db-shm');
    expect(gitignore).toContain('.DS_Store');
    expect(gitignore).toContain('Thumbs.db');
  });

  it('pushes to remote when URL is valid', async () => {
    const { simpleGit } = await import('simple-git');

    const bareDir = path.join(tempDir, 'remote.git');
    fs.mkdirSync(bareDir);
    await simpleGit(bareDir).init(true);

    await initBrain({ name: 'push-test', remote: bareDir });

    // Verify push succeeded by cloning the remote
    const verifyDir = path.join(tempDir, 'verify');
    await simpleGit().clone(bareDir, verifyDir);
    expect(fs.existsSync(path.join(verifyDir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(verifyDir, 'guides', '.gitkeep'))).toBe(true);
  });

  it('handles push failure gracefully', async () => {
    // Use a non-existent remote — push will fail but init should succeed
    const config = await initBrain({
      name: 'push-fail-test',
      remote: 'https://example.com/nonexistent-repo.git',
    });

    // Brain should still be created locally
    expect(fs.existsSync(config.local)).toBe(true);
    expect(config.hubName).toBe('push-fail-test');
    expect(config.remote).toBe('https://example.com/nonexistent-repo.git');
  });
});

describe('extractHubName', () => {
  it('extracts name from standard brain README', () => {
    const dir = path.join(tempDir, 'readme-test');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# 🧠 my-team-brain\n\nSome content.', 'utf-8');

    expect(extractHubName(dir)).toBe('my-team-brain');
  });

  it('extracts name from plain README without emoji', () => {
    const dir = path.join(tempDir, 'readme-plain');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# Team Knowledge\n\nContent.', 'utf-8');

    expect(extractHubName(dir)).toBe('Team Knowledge');
  });

  it('returns undefined for missing README', () => {
    const dir = path.join(tempDir, 'no-readme');
    fs.mkdirSync(dir, { recursive: true });

    expect(extractHubName(dir)).toBeUndefined();
  });

  it('returns undefined for README without H1', () => {
    const dir = path.join(tempDir, 'no-h1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), 'Some text without a heading.', 'utf-8');

    expect(extractHubName(dir)).toBeUndefined();
  });
});
