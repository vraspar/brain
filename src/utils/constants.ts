/**
 * Shared constants used across the brain codebase.
 * Centralised here for discoverability and reuse.
 */

/** Known tech terms for auto-tag extraction. */
export const KNOWN_TECH_TERMS = new Set([
  'typescript', 'javascript', 'python', 'react', 'node', 'docker',
  'kubernetes', 'k8s', 'aws', 'azure', 'gcp', 'terraform', 'ci/cd',
  'cicd', 'git', 'api', 'rest', 'graphql', 'sql', 'nosql', 'redis',
  'postgres', 'mongodb', 'nginx', 'linux', 'bash', 'helm', 'jenkins',
  'github', 'gitlab', 'vscode', 'eslint', 'prettier', 'vitest', 'jest',
  'webpack', 'vite', 'nextjs', 'express', 'fastify', 'rust', 'go',
  'java', 'csharp', 'dotnet', 'angular', 'vue', 'svelte', 'tailwind',
  'css', 'html', 'npm', 'yarn', 'pnpm', 'deno', 'bun',
]);

/** Root-level meta files excluded from ingest. */
export const META_FILES = new Set([
  'readme.md', 'changelog.md', 'changes.md', 'license.md', 'licence.md',
  'contributing.md', 'code_of_conduct.md', 'security.md',
  'pull_request_template.md', 'issue_template.md',
]);

/** Directories always excluded from ingest scanning. */
export const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.github', '.vscode', 'dist', 'build',
  'coverage', '__pycache__', '.tox', 'vendor', 'target',
]);

/** Additional dirs excluded only when scanning the brain's own repo. */
export const BRAIN_ONLY_EXCLUDED_DIRS = new Set([
  'docs', '_archive',
]);

/** Tags indicating volatile (fast-changing) content — decay faster. */
export const VOLATILE_TAGS = new Set([
  'api', 'docker', 'kubernetes', 'cicd', 'deployment', 'config',
]);

/** Tags indicating stable (long-lived) content — decay slower. */
export const STABLE_TAGS = new Set([
  'architecture', 'design', 'principles', 'patterns', 'conventions',
]);

/** Common English stop words filtered from natural language queries before FTS5 search. */
export const STOP_WORDS = new Set([
  // Question words
  'what', 'which', 'where', 'when', 'how', 'why', 'who', 'whom',
  // Articles & determiners
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  // Pronouns
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'ours', 'theirs',
  // Prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'into',
  'about', 'over', 'after', 'before', 'between', 'under', 'above', 'through',
  // Conjunctions
  'and', 'but', 'or', 'nor', 'so', 'yet',
  // Common verbs
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could', 'must',
  // Adverbs & filler words
  'not', 'no', 'there', 'here', 'then', 'than', 'also', 'just', 'only',
  'very', 'too', 'some', 'any', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'such', 'own',
  // Query-intent words: terms that express *how* the user is asking, not *what*
  // they're asking about. Filtered because they pollute FTS5 AND queries without
  // adding topical signal (e.g., "What approaches for caching?" → keep "caching").
  'approaches', 'ways', 'best', 'good', 'like', 'using', 'used',
  'need', 'want', 'help', 'looking', 'find', 'know', 'tell',
]);
