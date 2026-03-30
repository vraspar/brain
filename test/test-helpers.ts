import fs from 'node:fs';

/**
 * Remove a directory with retry logic for Windows EBUSY/EPERM errors.
 *
 * On Windows, git processes and file watchers may hold locks on .git
 * directories briefly after tests complete. This helper retries removal
 * with exponential backoff to avoid flaky test failures.
 */
export async function safeCleanup(dirPath: string, retries = 5): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      const isRetryable = code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY';

      if (!isRetryable || attempt === retries) {
        // Final attempt or non-retryable error — swallow to avoid crashing afterEach
        return;
      }

      // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
      await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
    }
  }
}
