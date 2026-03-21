/**
 * Convert a title string into a URL/filename-safe slug.
 * Examples: "My Cool Guide!" → "my-cool-guide", "  Hello   World  " → "hello-world"
 */
export function toSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // remove special characters
    .replace(/\s+/g, '-') // collapse whitespace to hyphens
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-|-$/g, ''); // trim leading/trailing hyphens
}

/**
 * Extract a slug from a file path by removing the directory and extension.
 * Example: "guides/my-cool-guide.md" → "my-cool-guide"
 */
export function slugFromPath(filePath: string): string {
  const basename = filePath.split('/').pop() ?? filePath;
  return basename.replace(/\.md$/i, '');
}
