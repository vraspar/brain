# brain

**Agent-native team knowledge hub — CLI + MCP server**

brain bridges the gap between team knowledge and AI agents. It lets you capture team decisions, context, and best practices into a unified knowledge base that AI agents can search, digest, and build upon. Perfect for technical teams that want their AI tools to have real institutional memory.

## Features

- **Capture team context** — Store decisions, learnings, and best practices
- **Agent-searchable** — MCP server lets Claude and other AI agents access your knowledge base
- **CLI-first workflow** — Simple commands to manage your knowledge hub
- **Fast local storage** — SQLite for speed; no external services needed
- **Markdown-first** — All knowledge stored as human-readable markdown

## Installation

```bash
npm install -g brain
```

## Quick Start

```bash
# Initialize and join a team knowledge base
brain join

# Digest recent activity and add to knowledge base
brain digest

# Share knowledge with the team
brain push

# Search across all knowledge
brain search "deployment strategy"

# View stats and usage
brain stats
```

## MCP Setup

### VS Code or Cursor

Add this to your MCP configuration to let Claude and other agents search your brain:

```json
{
  "mcpServers": {
    "brain": {
      "command": "brain",
      "args": ["mcp"],
      "env": {
        "BRAIN_PATH": "/path/to/your/brain"
      }
    }
  }
}
```

Then in Claude:
1. Open the MCP inspector
2. Select "brain" and search your knowledge base directly from chat

## CLI Reference

| Command | Description |
|---------|-------------|
| `brain init` | Initialize a new brain knowledge base |
| `brain join [url]` | Join an existing team brain (optionally sync from remote) |
| `brain digest [input]` | Digest input and add to knowledge base |
| `brain push [remote]` | Push local changes to remote repository |
| `brain pull [remote]` | Pull updates from remote repository |
| `brain search <query>` | Search across all knowledge entries |
| `brain stats` | View knowledge base statistics |
| `brain list` | List all knowledge entries |
| `brain show <id>` | Show a specific knowledge entry |
| `brain mcp` | Start MCP server for agent integration |
| `brain help [command]` | Show help for a command |

## Tech Stack

- **Language**: TypeScript
- **CLI Framework**: commander
- **Git Integration**: simple-git
- **Database**: better-sqlite3
- **Markdown Parsing**: gray-matter
- **Agent Protocol**: MCP SDK

## License

MIT
