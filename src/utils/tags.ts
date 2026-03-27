import { KNOWN_TECH_TERMS } from './constants.js';

// Re-export for backward compatibility
export { KNOWN_TECH_TERMS } from './constants.js';

/**
 * Extract technology tags from content by matching against KNOWN_TECH_TERMS.
 * Returns up to 5 matching tags.
 */
export function extractTags(content: string): string[] {
  const words = content.toLowerCase().match(/\b[a-z][a-z0-9/.-]+\b/g) ?? [];
  const found = new Set<string>();
  for (const word of words) {
    if (KNOWN_TECH_TERMS.has(word) && found.size < 5) {
      found.add(word);
    }
  }
  return [...found];
}
