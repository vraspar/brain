# brain

[![CI](https://github.com/vraspar/brain/actions/workflows/ci.yml/badge.svg)](https://github.com/vraspar/brain/actions/workflows/ci.yml)

A CLI for sharing knowledge across a dev team. Entries are markdown in a git repo, searchable via SQLite FTS5, and accessible to AI agents through MCP.

## Install

```
git clone https://github.com/vraspar/brain.git
cd brain && npm install && npm run build && npm link
```

Requires Node.js 18+ and git.

## Usage

```
brain init --name "My Team"                  # create a brain
brain connect <url>                          # or join an existing one
brain push ./guide.md                        # publish an entry
brain push ./docs/*.md                       # batch import
brain ingest https://github.com/team/repo    # import from another repo
brain search "kubernetes"                    # full-text search
brain digest                                 # what's new
brain trail kubernetes                       # follow connected entries
brain prune --dry-run                        # find stale content
```

All commands support `--format json`. Run `brain <command> --help` for flags.

## Features

- **Git-backed** — entries are markdown with YAML frontmatter, stored in a shared repo
- **FTS5 search** — SQLite full-text search with BM25 ranking, prefix matching, snippets
- **Repo ingest** — import docs from external repos with freshness scoring
- **Freshness** — entries scored Fresh/Aging/Stale; `brain prune` archives stale ones
- **Knowledge trails** — auto-linked entries via tag overlap, title similarity, cross-references
- **MCP server** — 5 tools + 2 resources, works with Claude, Copilot, Cursor, Windsurf
- **Read analytics** — per-entry read tracking across CLI and MCP
- **Auto-detection** — title, type, and tags inferred from content on push

## MCP setup

```json
{
  "mcpServers": {
    "brain": { "command": "brain", "args": ["serve"] }
  }
}
```

## Documentation

- [Getting started](docs/getting-started.md) — install, setup, first entry
- [Command reference](docs/commands.md) — all commands with flags and examples
- [MCP integration](docs/mcp-integration.md) — tools, resources, client setup
- [Configuration](docs/configuration.md) — config file, cache, data layout
- [Architecture](docs/architecture.md) — storage, FTS5, sync, receipts, MCP server
- [Changelog](CHANGELOG.md) — release history
- [Roadmap](ROADMAP.md) — what's shipped, what's next

## Development

```
npm install && npm run build && npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, conventions, and PR process.

## License

MIT
