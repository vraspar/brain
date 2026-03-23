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
): Promise<void> {
  if (files.length === 0) {
    throw new Error('No files specified to commit.');
  }

  const git = createGit(repoPath);
  try {
    await git.add(files);
    await git.commit(message);
    await git.push();
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
