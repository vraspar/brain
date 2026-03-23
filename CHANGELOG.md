# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-23

### Added

- `brain retract <entry-id>` command to remove entries (with confirmation prompt and `--force` flag)
- Flexible push: `brain push ./file.md` with auto-detected title, type, and tags from content
- Multi-file push: `brain push ./docs/*.md` with glob support and per-file error reporting
- Directory push: `brain push ./docs/` pushes all `.md` files inside
- Title auto-detection chain: frontmatter title, H1 heading, first non-empty line, filename
- Search result snippets: contextual preview text shown by default, disable with `--no-preview`
- Prefix search: partial terms match (e.g. "kube" matches "kubernetes")
- Digest filters: `--tag`, `--type`, `--author`, `--mine`, `--unread`, `--summary`
- List filters: `--tag`, `--mine`, `--unread`
- Compact digest output with `--summary` flag

## [0.1.0] - 2026-03-23

### Added

- CLI with 11 commands: `init`, `connect`, `join`, `push`, `digest`, `search`, `show`, `list`, `stats`, `sync`, `serve`
- `brain init` command with interactive wizard for creating new brain hubs
- `brain connect` command for joining an existing brain (clones repo, builds index)
- `brain join` as alias for `brain connect`
- `brain push` with auto-tagging from a 56-term tech dictionary
- `brain digest` with configurable time windows and last-digest tracking
- `brain search` using SQLite FTS5 full-text search with BM25 ranking
- `brain show` for reading individual entries with receipt tracking
- `brain list` with type and author filters
- `brain stats` for read activity analytics
- `brain sync` for pulling latest changes and rebuilding the index
- MCP server (`brain serve`) with stdio transport
- 5 MCP tools: `push_knowledge`, `search_knowledge`, `whats_new`, `get_entry`, `brain_stats`
- 2 MCP resources: `brain://digest`, `brain://stats`
- Git-backed storage with markdown + YAML frontmatter entries
- SQLite FTS5 search index with automatic sync triggers
- Read receipt system for usage analytics (`_analytics/receipts/`)
- Seed content (`getting-started.md`) generated on `brain init`
- JSON output mode (`--format json`) for all commands
- URL sanitization for credentials in git remote URLs
- Git option injection prevention for URLs starting with `-`
- Graceful MCP server shutdown (SIGINT/SIGTERM handlers)
- FTS5 query sanitization with LIKE fallback for malformed queries
- 228 tests
