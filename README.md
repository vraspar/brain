# 🧠 brain

**Agent-native team knowledge hub — CLI + MCP server**

Brain is a shared knowledge base for technical teams. Anyone can push guides, skills, and learnings — and everyone (including AI agents) can discover and search them. It's like a team wiki that lives in git and speaks MCP.

## Three-Beat Demo

### Beat 1: Discover — What's new?

```bash
$ brain digest

🧠 Brain Digest (7d)

✨ New Entries (2)
┌─────────────────────────┬────────┬───────┬──────────────────┬───────┐
│ Title                   │ Author │ Type  │ Tags             │ Reads │
├─────────────────────────┼────────┼───────┼──────────────────┼───────┤
│ K8s Deployment Guide    │ alice  │ guide │ kubernetes, k8s  │ 12    │
│ React Testing Patterns  │ bob    │ skill │ react, testing   │ 8     │
└─────────────────────────┴────────┴───────┴──────────────────┴───────┘

🔥 Most accessed: "K8s Deployment Guide" — 12 reads by 5 people
```

### Beat 2: Push — Share knowledge

```bash
$ brain push --title "Docker Multi-Stage Builds" --type guide --file ./docker-guide.md

✅ Pushed: Docker Multi-Stage Builds
   ID: docker-multi-stage-builds
   Type: guide
   Tags: docker (auto-detected)
```

### Beat 3: Feedback — See your impact

```bash
$ brain stats

📊 Stats for alice (7d)
  📖 Your "K8s Deployment Guide" was accessed 12 times by 5 people.
  📖 Your "CI Pipeline Setup" was accessed 4 times by 3 people.
```

## Installation

```bash
git clone https://github.com/vraspar/brain.git
cd brain
npm install
npm run build
npm link  # makes 'brain' available globally
```

## Quick Start

```bash
# Join a team brain (clone the shared repo)
brain join https://github.com/your-team/brain-repo.git

# See what's new (the hero command)
brain digest

# Push a guide
brain push --title "My Guide" --type guide --file ./guide.md

# Search for knowledge
brain search "kubernetes deployment"

# View a specific entry
brain show k8s-deployment-guide

# List all entries
brain list --type guide

# See your contributor stats
brain stats

# Pull latest changes
brain sync
```

## MCP Server Setup

Brain includes an MCP server so AI agents (Claude, Copilot, etc.) can search your team's knowledge base.

### Configuration

Add to your MCP client config (e.g., Claude Desktop, VS Code):

```json
{
  "mcpServers": {
    "brain": {
      "command": "brain",
      "args": ["serve"]
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `push_knowledge` | Publish a new guide or skill |
| `search_knowledge` | Full-text search across all entries |
| `whats_new` | Get entries from the last N days |
| `get_entry` | Retrieve a specific entry by ID |
| `brain_stats` | View contributor access stats |

### Available MCP Resources

| Resource | Description |
|----------|-------------|
| `brain://digest` | Recent entries digest (last 7 days) |
| `brain://stats` | Contributor stats summary |

## CLI Reference

| Command | Description |
|---------|-------------|
| `brain join <url>` | Join a team brain by cloning its repo |
| `brain push [options]` | Push a new entry (--title, --type, --file, --tags) |
| `brain digest [--since 7d]` | See new and updated entries |
| `brain search <query>` | Full-text search across all entries |
| `brain show <entry-id>` | Display a full entry |
| `brain list [--type] [--author]` | List all entries with filters |
| `brain stats [--period 7d]` | See how your contributions are being used |
| `brain sync` | Pull latest changes and rebuild index |
| `brain serve` | Start MCP server (stdio transport) |

All commands support `--format json` for agent/script consumption.

## Tech Stack

- **TypeScript** — Strict mode, zero `any` types
- **Commander** — CLI framework
- **simple-git** — Git operations
- **better-sqlite3** — FTS5 full-text search index
- **gray-matter** — Markdown frontmatter parsing
- **@modelcontextprotocol/sdk** — MCP server
- **chalk + cli-table3** — Terminal formatting

## Architecture

```
~/.brain/
  config.yaml          # Brain configuration
  cache.db             # SQLite FTS5 search index
  repo/                # Cloned git repository
    guides/            # Guide entries (markdown + frontmatter)
    skills/            # Skill entries
    _analytics/        # Read receipts for stats
      receipts/
        2026-03-21/    # Daily receipt files
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run tests (178 tests)
npm run dev          # Run CLI in dev mode (tsx)
```

## License

MIT — see [LICENSE](LICENSE)
