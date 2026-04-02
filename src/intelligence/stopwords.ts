import { STOP_WORDS } from '../utils/constants.js';

/**
 * Comprehensive stopword list for content analysis.
 * Extends the search-focused STOP_WORDS with broader content analysis terms.
 */
export const CONTENT_STOP_WORDS: ReadonlySet<string> = new Set([
  ...STOP_WORDS,

  // --- Additional English common words ---
  'able', 'across', 'actually', 'along', 'already', 'although',
  'always', 'another', 'anything', 'around', 'back', 'because', 'become',
  'began', 'behind', 'below', 'besides', 'better', 'came', 'certain',
  'change', 'come', 'consider', 'currently', 'different', 'done',
  'during', 'either', 'else', 'enough', 'even', 'example', 'far',
  'first', 'following', 'found', 'gave', 'get', 'give', 'given', 'goes',
  'going', 'gone', 'got', 'great', 'however', 'instead', 'keep',
  'kept', 'last', 'least', 'left', 'let', 'long', 'made', 'make',
  'many', 'much', 'must', 'never', 'new', 'next', 'now', 'often',
  'old', 'once', 'part', 'place', 'point', 'put', 'quite', 'rather',
  'right', 'said', 'same', 'second', 'see', 'seem', 'set', 'several',
  'since', 'small', 'something', 'still', 'take', 'thing', 'think',
  'three', 'time', 'took', 'turn', 'two', 'under', 'upon', 'use',
  'used', 'well', 'went', 'while', 'whole', 'within', 'without',
  'work', 'would', 'year', 'really', 'way',
  'ever', 'down', 'until', 'though', 'whether', 'likely',
  'maybe', 'perhaps', 'simply', 'sometimes', 'usually', 'typically',
  'basically', 'essentially', 'generally', 'mainly', 'mostly',

  // --- Code/markdown noise ---
  'const', 'let', 'var', 'function', 'return', 'import', 'export',
  'default', 'class', 'extends', 'implements', 'interface', 'type',
  'string', 'number', 'boolean', 'null', 'undefined', 'true', 'false',
  'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'super',
  'public', 'private', 'protected', 'static', 'readonly', 'void',
  'console', 'log', 'error', 'warn', 'require', 'module', 'exports',
  'todo', 'fixme', 'hack', 'note', 'xxx',
  'param', 'returns', 'throws', 'typedef', 'callback',

  // --- Common action/helper verbs ---
  'allows', 'based', 'build', 'called', 'configure', 'contains',
  'creates', 'define', 'deploy', 'describes', 'ensure', 'ensures',
  'handle', 'handles', 'includes', 'manage', 'manages', 'provides',
  'requires', 'run', 'running', 'shows', 'supports', 'updates',
  'uses', 'using', 'works', 'writes',

  // --- Markdown structural noise ---
  'example', 'note', 'warning', 'tip', 'important', 'table',
  'contents', 'overview', 'introduction', 'conclusion', 'summary',
  'section', 'chapter', 'figure', 'image', 'link', 'reference',
  'appendix', 'index', 'page',
]);

export function isStopWord(word: string): boolean {
  return CONTENT_STOP_WORDS.has(word.toLowerCase());
}
