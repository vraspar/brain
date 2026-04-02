import fs from 'node:fs';
import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git';

function createGit(repoPath: string): SimpleGit {
  const options: Partial<SimpleGitOptions> = {
    baseDir: repoPath,
    binary: 'git',
    maxConcurrentProcesses: 1,
  };
  return simpleGit(options);
}

/** Timeout (ms) for network operations: push, pull, fetch. */
const NETWORK_TIMEOUT_MS = 15_000;

/**
 * Create a SimpleGit instance with a timeout for network operations.
 * Use this only for push, pull, fetch, and clone — NOT for log, diff, status, etc.
 */
function createNetworkGit(repoPath: string): SimpleGit {
  const options: Partial<SimpleGitOptions> = {
    baseDir: repoPath,
    binary: 'git',
    maxConcurrentProcesses: 1,
    timeout: { block: NETWORK_TIMEOUT_MS },
  };
  return simpleGit(options);
}

/**
 * Validate a URL is not a git flag injection attempt.
 * URLs starting with '-' would be interpreted as git options.
 */
export function validateUrl(url: string): void {
  if (url.startsWith('-')) {
    throw new Error(`Invalid URL "${url}". URLs must not start with "-".`);
  }
}

export async function cloneRepo(url: string, targetPath: string, shallow = false): Promise<void> {
  validateUrl(url);
  const options = shallow ? ['--depth', '1'] : [];
  try {
    await simpleGit().clone(url, targetPath, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to clone repository "${url}": ${message}`);
  }
}

/**
 * Initialize a new git repository at the target path.
 * Creates the directory if it doesn't exist.
 */
export async function initRepo(targetPath: string): Promise<void> {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
  const git = simpleGit(targetPath);
  try {
    await git.init();
    // Ensure we're on main (some git versions default to master)
    const branches = await git.branchLocal();
    if (branches.current !== 'main' && !branches.all.includes('main')) {
      await git.checkoutLocalBranch('main');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize git repository at "${targetPath}": ${message}`);
  }
}

/**
 * Add a named remote to the repository.
 */
export async function addRemote(repoPath: string, name: string, url: string): Promise<void> {
  validateUrl(url);
  const git = createGit(repoPath);
  try {
    await git.addRemote(name, url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to add remote "${name}" (${url}): ${message}`);
  }
}

/**
 * Stage all files and commit. Used for initial commit in brain init.
 */
export async function commitAll(repoPath: string, commitMessage: string): Promise<void> {
  const git = createGit(repoPath);
  try {
    await git.add('.');
    await git.commit(commitMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to commit in "${repoPath}": ${message}`);
  }
}

/**
 * Push current branch to origin. Separated from commitAndPush
 * so init can handle push failures gracefully.
 */
export async function pushToRemote(repoPath: string): Promise<void> {
  const git = createNetworkGit(repoPath);
  try {
    await git.push(['-u', 'origin', 'main']);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to push to remote: ${message}`);
  }
}

/**
 * Pull latest changes with fast-forward only.
 * Returns list of changed file paths.
 */
export async function pullLatest(repoPath: string): Promise<string[]> {
  const git = createNetworkGit(repoPath);
  try {
    const result = await git.pull(['--ff-only']);
    return result.files;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to pull latest changes in "${repoPath}": ${message}`);
  }
}

export async function commitAndPush(
  repoPath: string,
  files: string[],
  commitMessage: string,
  options?: { skipPush?: boolean },
): Promise<{ pushed: boolean; pushError?: string }> {
  if (files.length === 0) {
    throw new Error('No files specified to commit.');
  }

  const git = createGit(repoPath);

  try {
    await git.add(files);
    await git.commit(commitMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to commit in "${repoPath}": ${message}`);
  }

  if (!options?.skipPush) {
    const networkGit = createNetworkGit(repoPath);
    try {
      await networkGit.push();
      return { pushed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { pushed: false, pushError: message };
    }
  }
  return { pushed: false };
}

export async function getLastCommitDate(repoPath: string): Promise<Date> {
  const git = createGit(repoPath);
  try {
    const log = await git.log({ maxCount: 1 });
    if (!log.latest) {
      throw new Error('No commits found in repository.');
    }
    return new Date(log.latest.date);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get last commit date in "${repoPath}": ${message}`);
  }
}

/**
 * Clone a repo using partial clone (treeless) for ingest.
 * Downloads tree metadata but fetches file content on demand.
 * Much faster than full clone for large repos (~50MB vs 2GB).
 */
export async function cloneForIngest(url: string, targetPath: string): Promise<void> {
  validateUrl(url);
  try {
    await simpleGit().clone(url, targetPath, ['--filter=blob:none']);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to clone repository "${url}": ${message}`);
  }
}

/**
 * Get last modified dates for multiple files in a single git log call.
 * Returns a Map from relative file path to last modified date.
 * Each file maps to the date of its most recent commit.
 */
export async function getBatchFileModifiedDates(
  repoPath: string,
  filePaths: string[],
): Promise<Map<string, Date>> {
  const git = createGit(repoPath);
  const result = new Map<string, Date>();

  if (filePaths.length === 0) return result;

  try {
    const log = await git.raw([
      'log', '--format=%H %aI', '--name-only', '--diff-filter=ACMR', 'HEAD',
    ]);

    const targetSet = new Set(filePaths.map(f => f.replace(/\\/g, '/')));
    let currentDate: string | null = null;

    for (const line of log.split('\n')) {
      const commitMatch = line.match(/^[0-9a-f]{40}\s+(.+)$/);
      if (commitMatch) {
        currentDate = commitMatch[1];
        continue;
      }

      const trimmed = line.trim();
      if (trimmed && currentDate && targetSet.has(trimmed) && !result.has(trimmed)) {
        result.set(trimmed, new Date(currentDate));
      }
    }
  } catch {
    // Git log failed — return empty map, freshness defaults to 'aging'
  }

  return result;
}

export async function getCurrentUser(repoPath: string): Promise<string> {
  const git = createGit(repoPath);
  try {
    const name = await git.getConfig('user.name');
    if (!name.value) {
      throw new Error('Git user.name is not configured. Run: git config user.name "Your Name"');
    }
    return name.value;
  } catch (error) {
    if (error instanceof Error && error.message.includes('user.name')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get git user in "${repoPath}": ${message}`);
  }
}

export async function getHeadCommit(repoPath: string): Promise<string> {
  const git = createGit(repoPath);
  const log = await git.log({ maxCount: 1 });
  if (!log.latest) throw new Error('No commits in repository');
  return log.latest.hash;
}

export async function getChangedFilesSince(
  repoPath: string,
  sinceCommit: string,
  pathFilter?: string,
): Promise<Array<{ status: 'A' | 'M' | 'D' | 'R'; path: string; oldPath?: string }>> {
  const git = createGit(repoPath);
  const args = ['--name-status', sinceCommit, 'HEAD'];
  if (pathFilter) args.push('--', pathFilter);
  const diff = await git.diff(args);
  const changes: Array<{ status: 'A' | 'M' | 'D' | 'R'; path: string; oldPath?: string }> = [];
  for (const line of diff.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const statusChar = parts[0].charAt(0) as 'A' | 'M' | 'D' | 'R';
    if (statusChar === 'R') {
      changes.push({ status: 'R', path: parts[2], oldPath: parts[1] });
    } else {
      changes.push({ status: statusChar, path: parts[1] });
    }
  }
  return changes;
}

export async function getRemoteUrl(repoPath: string): Promise<string> {
  const git = createGit(repoPath);
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    if (!origin) {
      throw new Error('No "origin" remote found. Is this a brain repository?');
    }
    return origin.refs.fetch || origin.refs.push;
  } catch (error) {
    if (error instanceof Error && error.message.includes('origin')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get remote URL in "${repoPath}": ${message}`);
  }
}

export interface UnpushedResult {
  count: number;
  noUpstream: boolean;
}

/**
 * Count local commits not yet pushed to origin.
 * Returns {count, noUpstream} so callers can distinguish between
 * "0 unpushed commits" and "no upstream tracking branch exists".
 */
export async function getUnpushedCommitCount(repoPath: string): Promise<UnpushedResult> {
  const git = createGit(repoPath);
  try {
    // Check if the upstream branch exists
    await git.raw(['rev-parse', '--verify', 'origin/main']);
    const result = await git.raw(['rev-list', '--count', 'origin/main..HEAD']);
    return { count: parseInt(result.trim(), 10) || 0, noUpstream: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // "unknown revision" or "Needed a single revision" = no upstream branch
    if (message.includes('unknown revision') || message.includes('Needed a single revision')) {
      return { count: 0, noUpstream: true };
    }
    return { count: 0, noUpstream: false };
  }
}
