import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRemote,
  cloneRepo,
  commitAll,
  commitAndPush,
  getCurrentUser,
  getLastCommitDate,
  getRemoteUrl,
  initRepo,
  pullLatest,
  pushToRemote,
} from '../src/utils/git.js';

// We test git utility functions against real temporary git repos
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-git-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Helper: create a bare git repo and a working clone for testing.
 */
async function setupTestRepo(): Promise<{ bareDir: string; workDir: string }> {
  const { simpleGit } = await import('simple-git');

  const bareDir = path.join(tempDir, 'bare.git');
  fs.mkdirSync(bareDir);
  const bareGit = simpleGit(bareDir);
  await bareGit.init(true);

  // Clone the bare repo to a working directory
  const workDir = path.join(tempDir, 'work');
  const cloneGit = simpleGit();
  await cloneGit.clone(bareDir, workDir);

  // Configure user for commits
  const workGit = simpleGit(workDir);
  await workGit.addConfig('user.name', 'Test User');
  await workGit.addConfig('user.email', 'test@example.com');

  // Create initial commit so we have a branch
  const readmePath = path.join(workDir, 'README.md');
  fs.writeFileSync(readmePath, '# Test Brain\n', 'utf-8');
  await workGit.add('README.md');
  await workGit.commit('Initial commit');
  await workGit.push('origin', 'main');

  return { bareDir, workDir };
}

describe('cloneRepo', () => {
  it('clones a repository to target path', async () => {
    const { bareDir } = await setupTestRepo();
    const cloneTarget = path.join(tempDir, 'clone-target');

    await cloneRepo(bareDir, cloneTarget);

    expect(fs.existsSync(path.join(cloneTarget, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(cloneTarget, 'README.md'))).toBe(true);
  });

  it('supports shallow clone', async () => {
    const { bareDir } = await setupTestRepo();
    const cloneTarget = path.join(tempDir, 'shallow-clone');

    await cloneRepo(bareDir, cloneTarget, true);

    expect(fs.existsSync(path.join(cloneTarget, '.git'))).toBe(true);
  });

  it('throws meaningful error for invalid URL', async () => {
    const target = path.join(tempDir, 'invalid-clone');
    await expect(cloneRepo('not-a-valid-repo-url', target)).rejects.toThrow('Failed to clone');
  });

  it('rejects URLs starting with dash (flag injection)', async () => {
    const target = path.join(tempDir, 'injection-clone');
    await expect(cloneRepo('--upload-pack=evil', target)).rejects.toThrow('must not start with "-"');
  });
});

describe('pullLatest', () => {
  it('pulls changes and returns changed files', async () => {
    const { bareDir, workDir } = await setupTestRepo();
    const { simpleGit } = await import('simple-git');

    // Make a second clone, commit a change, push it
    const otherDir = path.join(tempDir, 'other');
    await simpleGit().clone(bareDir, otherDir);
    const otherGit = simpleGit(otherDir);
    await otherGit.addConfig('user.name', 'Other User');
    await otherGit.addConfig('user.email', 'other@example.com');

    fs.writeFileSync(path.join(otherDir, 'new-file.md'), '# New\n');
    await otherGit.add('new-file.md');
    await otherGit.commit('Add new file');
    await otherGit.push();

    // Pull from original working directory
    const changedFiles = await pullLatest(workDir);
    expect(changedFiles).toContain('new-file.md');
    expect(fs.existsSync(path.join(workDir, 'new-file.md'))).toBe(true);
  });

  it('returns empty array when already up to date', async () => {
    const { workDir } = await setupTestRepo();
    const changedFiles = await pullLatest(workDir);
    expect(changedFiles).toEqual([]);
  });
});

describe('commitAndPush', () => {
  it('commits and pushes specified files', async () => {
    const { bareDir, workDir } = await setupTestRepo();
    const { simpleGit } = await import('simple-git');

    // Create a new file in workDir
    fs.writeFileSync(path.join(workDir, 'guide.md'), '# Guide\n');

    await commitAndPush(workDir, ['guide.md'], 'Add guide');

    // Verify by cloning fresh and checking for the file
    const verifyDir = path.join(tempDir, 'verify');
    await simpleGit().clone(bareDir, verifyDir);
    expect(fs.existsSync(path.join(verifyDir, 'guide.md'))).toBe(true);
  });

  it('throws when no files specified', async () => {
    const { workDir } = await setupTestRepo();
    await expect(commitAndPush(workDir, [], 'Empty')).rejects.toThrow('No files specified');
  });
});

describe('getLastCommitDate', () => {
  it('returns date of the most recent commit', async () => {
    const { workDir } = await setupTestRepo();
    const date = await getLastCommitDate(workDir);
    expect(date).toBeInstanceOf(Date);
    // Should be very recent (within the last minute)
    expect(Date.now() - date.getTime()).toBeLessThan(60_000);
  });
});

describe('getCurrentUser', () => {
  it('returns configured git user name', async () => {
    const { workDir } = await setupTestRepo();
    const user = await getCurrentUser(workDir);
    expect(user).toBe('Test User');
  });
});

describe('getRemoteUrl', () => {
  it('returns the origin remote URL', async () => {
    const { bareDir, workDir } = await setupTestRepo();
    const url = await getRemoteUrl(workDir);
    // Normalize path separators for cross-platform comparison
    expect(url.replace(/\\/g, '/')).toContain(bareDir.replace(/\\/g, '/'));
  });
});

describe('initRepo', () => {
  it('initializes a new git repository', async () => {
    const repoDir = path.join(tempDir, 'new-repo');
    await initRepo(repoDir);

    expect(fs.existsSync(repoDir)).toBe(true);
    expect(fs.existsSync(path.join(repoDir, '.git'))).toBe(true);
  });

  it('creates the directory if it does not exist', async () => {
    const repoDir = path.join(tempDir, 'nested', 'deep', 'repo');
    expect(fs.existsSync(repoDir)).toBe(false);

    await initRepo(repoDir);

    expect(fs.existsSync(repoDir)).toBe(true);
    expect(fs.existsSync(path.join(repoDir, '.git'))).toBe(true);
  });

  it('sets branch to main', async () => {
    const { simpleGit } = await import('simple-git');
    const repoDir = path.join(tempDir, 'branch-test');
    await initRepo(repoDir);

    // Need a commit to have a branch
    const git = simpleGit(repoDir);
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@test.com');
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'test', 'utf-8');
    await git.add('.');
    await git.commit('initial');

    const branches = await git.branchLocal();
    expect(branches.current).toBe('main');
  });
});

describe('addRemote', () => {
  it('adds a named remote to the repository', async () => {
    const { simpleGit } = await import('simple-git');
    const repoDir = path.join(tempDir, 'remote-test');
    await initRepo(repoDir);

    await addRemote(repoDir, 'origin', 'https://example.com/repo.git');

    const git = simpleGit(repoDir);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    expect(origin).toBeTruthy();
    expect(origin!.refs.fetch).toBe('https://example.com/repo.git');
  });

  it('throws for duplicate remote name', async () => {
    const repoDir = path.join(tempDir, 'dup-remote');
    await initRepo(repoDir);
    await addRemote(repoDir, 'origin', 'https://example.com/a.git');

    await expect(
      addRemote(repoDir, 'origin', 'https://example.com/b.git'),
    ).rejects.toThrow('Failed to add remote');
  });

  it('rejects URLs starting with dash (flag injection)', async () => {
    const repoDir = path.join(tempDir, 'inject-remote');
    await initRepo(repoDir);

    await expect(
      addRemote(repoDir, 'origin', '--upload-pack=evil'),
    ).rejects.toThrow('must not start with "-"');
  });
});

describe('commitAll', () => {
  it('stages all files and commits', async () => {
    const { simpleGit } = await import('simple-git');
    const repoDir = path.join(tempDir, 'commit-all-test');
    await initRepo(repoDir);

    const git = simpleGit(repoDir);
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@test.com');

    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'aaa', 'utf-8');
    fs.writeFileSync(path.join(repoDir, 'b.txt'), 'bbb', 'utf-8');

    await commitAll(repoDir, 'Add files');

    const log = await git.log();
    expect(log.total).toBe(1);
    expect(log.latest?.message).toBe('Add files');

    // Both files should be tracked
    const status = await git.status();
    expect(status.not_added).toHaveLength(0);
    expect(status.modified).toHaveLength(0);
  });
});

describe('pushToRemote', () => {
  it('pushes to origin', async () => {
    const { simpleGit } = await import('simple-git');
    const bareDir = path.join(tempDir, 'push-bare.git');
    fs.mkdirSync(bareDir);
    await simpleGit(bareDir).init(true);

    const repoDir = path.join(tempDir, 'push-repo');
    await initRepo(repoDir);
    await addRemote(repoDir, 'origin', bareDir);

    const git = simpleGit(repoDir);
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@test.com');
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'content', 'utf-8');
    await commitAll(repoDir, 'Initial');

    await pushToRemote(repoDir);

    // Verify by cloning the bare repo
    const verifyDir = path.join(tempDir, 'verify');
    await simpleGit().clone(bareDir, verifyDir);
    expect(fs.existsSync(path.join(verifyDir, 'file.txt'))).toBe(true);
  });

  it('throws for unreachable remote', async () => {
    const repoDir = path.join(tempDir, 'bad-push');
    await initRepo(repoDir);
    await addRemote(repoDir, 'origin', 'https://example.com/nonexistent.git');

    const { simpleGit } = await import('simple-git');
    const git = simpleGit(repoDir);
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@test.com');
    fs.writeFileSync(path.join(repoDir, 'f.txt'), 'x', 'utf-8');
    await commitAll(repoDir, 'Init');

    await expect(pushToRemote(repoDir)).rejects.toThrow('Failed to push');
  });
});
