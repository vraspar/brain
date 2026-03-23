/**
 * Strip credentials (user:password) from a git remote URL.
 * Handles HTTPS URLs with embedded tokens like:
 *   https://user:token@github.com/org/repo.git
 *   → https://github.com/org/repo.git
 *
 * SSH URLs and URLs without credentials pass through unchanged.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
    return url;
  } catch {
    // Not a standard URL (e.g. git@github.com:org/repo.git) — return as-is
    return url;
  }
}
