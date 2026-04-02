import type { RakePhrase } from './types.js';
import { isStopWord } from './stopwords.js';

/**
 * RAKE keyphrase extraction.
 * Discovers multi-word concepts without needing a corpus.
 */
export function extractKeyphrases(
  text: string,
  maxPhrases = 15,
  maxWordsPerPhrase = 4,
): RakePhrase[] {
  const normalized = text.toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[^a-z0-9\s-]/g, ' ');

  const phrases = splitOnStopWords(normalized, maxWordsPerPhrase);
  if (phrases.length === 0) return [];

  const wordFreq = new Map<string, number>();
  const wordDegree = new Map<string, number>();

  for (const phrase of phrases) {
    for (const word of phrase.words) {
      wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
      wordDegree.set(word, (wordDegree.get(word) ?? 0) + phrase.words.length);
    }
  }

  const scored: RakePhrase[] = phrases.map(({ phrase, words }) => {
    const score = words.reduce((sum, word) => {
      const deg = wordDegree.get(word) ?? 0;
      const freq = wordFreq.get(word) ?? 1;
      return sum + deg / freq;
    }, 0);
    return { phrase, score, words };
  });

  const seen = new Set<string>();
  const unique = scored.filter(({ phrase }) => {
    if (seen.has(phrase)) return false;
    seen.add(phrase);
    return true;
  });

  unique.sort((a, b) => b.score - a.score);
  return unique.slice(0, maxPhrases);
}

function splitOnStopWords(
  text: string,
  maxWords: number,
): Array<{ phrase: string; words: string[] }> {
  const words = text.split(/\s+/).filter(w => w.length >= 2);
  const phrases: Array<{ phrase: string; words: string[] }> = [];
  let current: string[] = [];

  for (const word of words) {
    if (isStopWord(word) || word.length < 3) {
      if (current.length > 0 && current.length <= maxWords) {
        phrases.push({ phrase: current.join(' '), words: [...current] });
      }
      current = [];
    } else {
      current.push(word);
    }
  }

  if (current.length > 0 && current.length <= maxWords) {
    phrases.push({ phrase: current.join(' '), words: [...current] });
  }

  return phrases;
}
