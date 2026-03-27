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
