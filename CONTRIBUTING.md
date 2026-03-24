# Contributing to Brain CLI

## Prerequisites

- Node.js 20 or later
- git
- npm

## Development setup

```bash
git clone https://github.com/vraspar/brain.git
cd brain
npm install
npm run build
npm test
```

All 228 tests should pass. If any fail, check your Node.js version.

## Project structure

```
src/
├── index.ts              # CLI entry point (Commander)
├── types.ts              # Shared TypeScript interfaces
├── commands/             # One file per CLI command (11 commands)
├── core/                 # Business logic (config, entries, search, receipts, repo)
├── mcp/                  # MCP server (tools, resources)
└── utils/                # Pure utilities (git, output formatting, slugs, time)
test/                     # Test files (vitest)
docs/                     # Technical documentation
```

See [docs/architecture.md](docs/architecture.md) for a detailed breakdown.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run dev` | Run CLI without building (via tsx) |
| `npm run lint` | Run ESLint |

## Coding conventions

- **TypeScript strict mode**. No `any` types.
- **ESM modules** with `NodeNext` resolution. Use `.js` extensions in imports.
- **One command per file** in `src/commands/`. Each exports a Commander `Command`.
- **Core layer has no CLI/MCP dependencies**. Commands and MCP handlers call into core, not the other way around.
- **Error handling**: catch errors, format for the current output mode (`text` or `json`), set `process.exitCode = 1` instead of `process.exit(1)` (except in `serve`).
- **Database access**: always close the database in a `try/finally` block.
- Comments explain "why", not "what".

## Adding a new CLI command

1. Create `src/commands/<name>.ts` exporting a `Command`
2. Add business logic in `src/core/` if needed
3. Register the command in `src/index.ts`
4. Add tests in `test/<name>.test.ts`
5. Document in `docs/commands.md` and update the README CLI reference

## Adding a new MCP tool

1. Add a registration function in `src/mcp/tools.ts`
2. Call it from `registerTools()`
3. Add tests
4. Document in `docs/mcp-integration.md`

## Testing

Tests use [vitest](https://vitest.dev/). Run with `npm test`.

- Test files live in `test/` and mirror the source structure
- Tests should not require network access or a real git remote
- Use temp directories for filesystem tests and clean up in `afterEach`

All PRs must pass the existing test suite. New features should include tests.

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run build && npm test` and confirm everything passes
4. Run `npm run lint` and fix any issues
5. Update documentation if your change affects user-facing behavior
6. Open a PR against `main`

## Commit messages

Use conventional-style messages:

```
feat: add brain export command
fix: handle empty search query without crashing
docs: update MCP integration guide
test: add edge case tests for FTS5 sanitizer
refactor: extract URL validation to utils
```

Keep the subject line under 72 characters. Add a body if the change needs explanation.

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include your Node.js version, OS, and steps to reproduce.

## Requesting features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).
