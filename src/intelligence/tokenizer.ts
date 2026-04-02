import type { WeightedToken } from './types.js';
import { isStopWord } from './stopwords.js';

const ZONE_WEIGHTS = {
  title: 3.0,
  heading: 2.0,
  code: 1.5,
  inline_code: 1.5,
  body: 1.0,
} as const;

/**
 * Tokenize markdown content with zone awareness.
 * Returns weighted tokens where each token carries its zone's weight multiplier.
 */
export function tokenize(title: string, content: string): WeightedToken[] {
  const tokens: WeightedToken[] = [];

  for (const term of extractTerms(title)) {
    tokens.push({ term, zone: 'title', weight: ZONE_WEIGHTS.title });
  }

  const lines = content.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      for (const term of extractTerms(line)) {
        tokens.push({ term, zone: 'code', weight: ZONE_WEIGHTS.code });
      }
      continue;
    }

    const headingMatch = line.match(/^#{2,6}\s+(.+)$/);
    if (headingMatch) {
      for (const term of extractTerms(headingMatch[1])) {
        tokens.push({ term, zone: 'heading', weight: ZONE_WEIGHTS.heading });
      }
      continue;
    }

    const withoutInlineCode = line.replace(/`([^`]+)`/g, (_, code) => {
      for (const term of extractTerms(code as string)) {
        tokens.push({ term, zone: 'inline_code', weight: ZONE_WEIGHTS.inline_code });
      }
      return ' ';
    });

    for (const term of extractTerms(withoutInlineCode)) {
      tokens.push({ term, zone: 'body', weight: ZONE_WEIGHTS.body });
    }
  }

  return tokens;
}

/**
 * Extract lowercase terms from text, filtering stopwords and short terms.
 */
export function extractTerms(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s/.-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !isStopWord(w));
}

/**
 * Extract PascalCase/camelCase identifiers from code blocks and inline code.
 * Converts to kebab-case tags: GptqQuantizer → gptq-quantizer
 */
export function extractCodeIdentifiers(content: string): string[] {
  const codeBlocks = content.match(/```[\s\S]*?```/g) ?? [];
  const inlineCode = content.match(/`([^`]+)`/g) ?? [];
  const allCode = [...codeBlocks, ...inlineCode].join('\n');

  const identifiers = new Set<string>();

  // PascalCase: InferenceSession, GptqQuantizer
  const pascal = allCode.match(/[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+/g) ?? [];
  // camelCase at word boundary only (avoids matching substrings of PascalCase)
  const camel = allCode.match(/\b[a-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+/g) ?? [];

  for (const id of [...pascal, ...camel]) {
    if (id.length >= 6) {
      // Two-pass split: handles ACRONYM+Word (e.g. CUDAExecution) and camelCase
      const kebab = id
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
      identifiers.add(kebab);
    }
  }

  return [...identifiers];
}
