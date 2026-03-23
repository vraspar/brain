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

export async function cloneRepo(url: string, targetPath: string, shallow = false): Promise<void> {
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
export async function commitAll(repoPath: string, message: string): Promise<void> {
  const git = createGit(repoPath);
  try {
    await git.add('.');
    await git.commit(message);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to commit in "${repoPath}": ${msg}`);
  }
}

/**
 * Push current branch to origin. Separated from commitAndPush
 * so init can handle push failures gracefully.
 */
export async function pushToRemote(repoPath: string): Promise<void> {
  const git = createGit(repoPath);
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
  const git = createGit(repoPath);
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
  message: string,
  options?: { skipPush?: boolean },
): Promise<{ pushed: boolean }> {
  if (files.length === 0) {
    throw new Error('No files specified to commit.');
  }

  const git = createGit(repoPath);
  try {
    await git.add(files);
    await git.commit(message);

    if (!options?.skipPush) {
      await git.push();
      return { pushed: true };
    }
    return { pushed: false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to commit and push in "${repoPath}": ${msg}`);
  }
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
