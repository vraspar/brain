import type Database from 'better-sqlite3';
import type { TagCandidate, TagResult } from './types.js';
import { tokenize, extractCodeIdentifiers } from './tokenizer.js';
import { extractKeyphrases } from './rake.js';
import { KNOWN_TECH_TERMS } from '../utils/constants.js';

const MAX_TAGS = 8;
const MAX_TAG_WORDS = 3;
const CODE_ID_SCORE = 0.7;
const KNOWN_TERM_SCORE = 0.3;
const KNOWN_TERM_BOOST = 1.5;
const RAKE_WORD_EXTRACTION_THRESHOLD = 2.0;
const RAKE_WORD_SCORE_DECAY = 0.5;

/**
 * Extract intelligent tags for a single entry.
 *
 * Pipeline:
 * 1. Tokenize content with zone weights
 * 2. RAKE: extract multi-word keyphrases from prose
 * 3. Code identifiers: PascalCase/camelCase from code blocks
 * 4. Known tech terms: boost if present
 * 5. Merge, deduplicate, rank, return top 8
 */
export function rankTags(
  title: string,
  content: string,
  // Reserved for Phase 2 TF-IDF corpus lookup — callers pass db now for future compatibility
  _db: Database.Database | null,
): TagResult {
  const candidates: TagCandidate[] = [];

  // 1. Tokenize with zone weights
  const tokens = tokenize(title, content);

  // 2. RAKE keyphrases
  const keyphrases = extractKeyphrases(content);
  for (const kp of keyphrases.slice(0, 10)) {
    const tag = kp.words.join('-');
    if (tag.length >= 3 && tag.length <= 40 && kp.words.length <= MAX_TAG_WORDS) {
      candidates.push({
        tag,
        score: normalizeRakeScore(kp.score),
        source: 'rake',
      });
    }
    if (kp.score > RAKE_WORD_EXTRACTION_THRESHOLD) {
      for (const word of kp.words) {
        if (word.length >= 4) {
          candidates.push({ tag: word, score: normalizeRakeScore(kp.score) * RAKE_WORD_SCORE_DECAY, source: 'rake' });
        }
      }
    }
  }

  // 3. Code identifier extraction
  const codeIds = extractCodeIdentifiers(content);
  for (const id of codeIds) {
    candidates.push({ tag: id, score: CODE_ID_SCORE, source: 'code_id' });
  }

  // 4. Known tech terms boost
  const allTerms = new Set(tokens.map(t => t.term));
  for (const term of allTerms) {
    if (KNOWN_TECH_TERMS.has(term)) {
      const existing = candidates.find(c => c.tag === term);
      if (existing) {
        existing.score *= KNOWN_TERM_BOOST;
      } else {
        candidates.push({ tag: term, score: KNOWN_TERM_SCORE, source: 'keyword' });
      }
    }
  }

  // 5. Deduplicate (keep highest score per tag)
  const tagMap = new Map<string, TagCandidate>();
  for (const candidate of candidates) {
    const existing = tagMap.get(candidate.tag);
    if (!existing || candidate.score > existing.score) {
      tagMap.set(candidate.tag, candidate);
    }
  }

  // 6. Sort by score, take top MAX_TAGS
  const ranked = [...tagMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TAGS);

  return { tags: ranked, keyphrases: keyphrases.slice(0, 5) };
}

function normalizeRakeScore(score: number): number {
  return 1 - 1 / (1 + score * 0.3);
}
