import { KNOWN_TECH_TERMS, STOP_WORDS } from './constants.js';

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

/**
 * Extract significant words from text for search queries.
 * Strips punctuation, filters stop words, deduplicates, and caps at 10 terms.
 */
export function extractSignificantWords(text: string): string[] {
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 10);
}
