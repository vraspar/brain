# MCP Integration

Brain exposes a [Model Context Protocol](https://modelcontextprotocol.io/) server so AI agents can search, read, and publish to the team knowledge base. The server communicates over stdio transport.

## Client setup

The MCP server is started via `brain serve`. Configure your MCP client to invoke it as a subprocess.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

### VS Code (GitHub Copilot)

Add to your VS Code `settings.json` or `.vscode/mcp.json`:

```json
{
  "mcp": {
    "servers": {
      "brain": {
        "command": "brain",
        "args": ["serve"]
      }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

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

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

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

### Using npx (without global install)

If you haven't run `npm link`, point the command to the built entry point:

```json
{
  "mcpServers": {
    "brain": {
      "command": "node",
      "args": ["/path/to/brain/dist/index.js", "serve"]
    }
  }
}
```

## Prerequisites

The MCP server requires a configured brain (`~/.brain/config.yaml`). Run `brain init` or `brain connect <url>` before starting the server. The server loads the config and rebuilds the FTS5 index on startup.

## Tools

Tools are agent-initiated actions. Each tool accepts a JSON object of parameters and returns a response with `content` (array of text blocks) and an optional `isError` flag.

### push_knowledge

Publish a new entry to the brain. Commits to git and pushes to remote (push failure is non-fatal — the entry is still saved locally).

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `title` | string | yes | — | Entry title |
| `content` | string | yes | — | Markdown body |
| `type` | `"guide"` \| `"skill"` | no | `"guide"` | Entry type |
| `tags` | string[] | no | `[]` | Categorization tags |
| `summary` | string | no | — | Brief description |

**Example request:**

```json
{
  "title": "Docker Multi-Stage Builds",
  "content": "## Overview\n\nMulti-stage builds reduce image size by...",
  "type": "guide",
  "tags": ["docker"],
  "summary": "How to use multi-stage builds to optimize Docker images"
}
```

**Example response:**

```
✅ Published "Docker Multi-Stage Builds" (guide)
ID: docker-multi-stage-builds
Path: guides/docker-multi-stage-builds.md
Tags: docker
```

### search_knowledge

Full-text search across all entries. Uses FTS5 BM25 ranking. Records a read receipt for each result returned.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | string | yes | — | Search query |
| `type` | `"guide"` \| `"skill"` | no | — | Filter by entry type |
| `limit` | number | no | `10` | Maximum results |

**Example request:**

```json
{
  "query": "kubernetes deployment",
  "type": "guide",
  "limit": 5
}
```

**Example response:**

```
Found 2 results:

**K8s Deployment Guide** (guide) by alice [kubernetes, k8s]
  Step-by-step guide for deploying to our K8s cluster
  ID: k8s-deployment-guide | Updated: 2026-03-22T14:30:00.000Z

**Helm Chart Patterns** (guide) by bob [kubernetes, helm]
  ID: helm-chart-patterns | Updated: 2026-03-20T09:00:00.000Z
```

### whats_new

Get entries created or updated within a time window.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `since` | string | no | `"7d"` | Time window: `Nd`, `Nw`, `Nm` |
| `type` | `"guide"` \| `"skill"` | no | — | Filter by entry type |

**Example request:**

```json
{
  "since": "14d",
  "type": "skill"
}
```

**Example response:**

```
📋 3 entries from the last 14d:

**React Testing Patterns** (skill) by bob [react, testing]
  ID: react-testing-patterns | Updated: 2026-03-21T10:00:00.000Z

...
```

### get_entry

Retrieve a specific entry by ID. Records a read receipt.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `id` | string | yes | — | Entry ID (slug) |

**Example request:**

```json
{
  "id": "k8s-deployment-guide"
}
```

**Example response:**

```markdown
# K8s Deployment Guide
**Author:** alice | **Type:** guide | **Status:** active
**Tags:** kubernetes, k8s
**Created:** 2026-03-20T10:00:00.000Z | **Updated:** 2026-03-22T14:30:00.000Z
**Summary:** Step-by-step guide for deploying to our K8s cluster

---

## Overview

This guide covers deploying applications to our Kubernetes cluster...
```

### brain_stats

View read activity stats for a specific author.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `author` | string | no | current user | Author to filter stats for |
| `period` | string | no | `"7d"` | Time window: `Nd`, `Nw`, `Nm` |

**Example request:**

```json
{
  "author": "alice",
  "period": "1m"
}
```

**Example response:**

```
📊 Stats for alice (1m):

- **K8s Deployment Guide**: 24 reads, 8 unique readers
- **CI Pipeline Setup**: 12 reads, 5 unique readers
```

### get_recommendations

Get relevant entries for a topic using FTS5 search, tag overlap, and freshness scoring. Filters out archived entries.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `topic` | string | yes | — | Topic or keywords to get recommendations for |
| `limit` | number | no | `5` | Maximum recommendations |

**Example request:**

```json
{
  "topic": "kubernetes deployment",
  "limit": 3
}
```

### update_entry

Update an existing entry's fields. Commits changes automatically.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `id` | string | yes | — | Entry ID (slug) |
| `title` | string | no | — | New title |
| `tags` | string[] | no | — | Replace tags |
| `type` | `"guide"` \| `"skill"` | no | — | Change type |
| `summary` | string | no | — | Update summary |
| `content` | string | no | — | Replace content body |
| `status` | `"active"` \| `"stale"` \| `"archived"` | no | — | Set status |

Only provided fields are updated. Updates the `updated` timestamp. Setting status to `"archived"` hides the entry from search, digest, and recommendations.

## Resources

Resources provide ambient context that MCP clients can read without an explicit tool call. Both return `text/markdown` content.

### brain://digest

Recent entries digest (last 7 days). Returns a markdown document listing all entries created or updated in the period, grouped with metadata.

**Example content:**

```markdown
# Brain Digest (3 entries)

## K8s Deployment Guide
*guide* by **alice** — 2026-03-22T14:30:00.000Z `kubernetes` `k8s`

Step-by-step guide for deploying to our K8s cluster

## React Testing Patterns
*skill* by **bob** — 2026-03-21T10:00:00.000Z `react` `testing`
```

### brain://stats

Contributor stats summary for the current user (last 7 days). Returns a markdown table.

**Example content:**

```markdown
# Brain Stats for alice

**Entries with activity:** 2 | **Total reads:** 36

| Entry | Reads | Unique Readers |
|-------|-------|----------------|
| K8s Deployment Guide | 24 | 8 |
| CI Pipeline Setup | 12 | 5 |
```

## Read receipts

Both tools and resources that access entries record read receipts with `source: "mcp"`. This means AI agent reads are tracked in the same analytics system as CLI reads, and show up in `brain stats` output.

## Error handling

On error, tools return `isError: true` with a text message describing the failure. Common errors:

| Error | Cause |
|-------|-------|
| `Brain not configured` | No `~/.brain/config.yaml`. Run `brain init` or `brain connect`. |
| `Entry "x" not found` | Invalid entry ID passed to `get_entry`. |
| `Invalid time window "x"` | Bad format for `since`/`period`. Use `Nd`, `Nw`, or `Nm`. |
| `Failed to push knowledge` | Git commit or write failure. |

## Server lifecycle

The MCP server:
1. Loads config from `~/.brain/config.yaml`
2. Opens (or creates) the SQLite database at `~/.brain/cache.db`
3. Rebuilds the FTS5 index from entry files on disk
4. Registers all tools and resources
5. Connects to stdio transport
6. Handles SIGINT/SIGTERM by closing the database before exit
