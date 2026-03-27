# Roadmap

## Current (v0.3.0)

- 21 CLI commands: `init`, `connect`, `push`, `digest`, `search`, `show`, `list`, `stats`, `retract`, `sync`, `serve`, `ingest`, `prune`, `restore`, `trail`, `edit`, `open`, `remote`, `sources`, `status`, plus `help`
- Obsidian compatibility: `brain init --obsidian` creates `.obsidian/` config and enables wikilink footers
- Repo ingest: `brain ingest` imports docs from remote repos or local directories with freshness scoring at import time
- Freshness scoring: multiplicative formula (recency base, usage boost, volatility modifier) with Fresh/Aging/Stale labels
- Knowledge pruning: `brain prune` archives stale entries to `_archive/`, reversible with `brain restore`
- Knowledge trails: `brain trail` explores connected entries via auto-computed links
- Flexible push with positional args, glob patterns, directory input, multi-file batch
- Title/type/tag auto-detection from content (frontmatter, H1, filename fallback chain)
- SQLite FTS5 full-text search with BM25 ranking, prefix matching, contextual snippets
- Digest and list filters: `--tag`, `--type`, `--author`, `--mine`, `--unread`, `--summary`
- MCP server with 5 tools and 2 resources (stdio transport)
- Read receipt analytics tracking CLI and MCP reads
- Git-backed storage with markdown + YAML frontmatter
- URL validation (option injection prevention) and credential sanitization
- JSON output mode for all commands

## In Progress

- **CI/CD pipeline** -- GitHub Actions for build, test, and lint on every PR.
- **Levenshtein fuzzy search** -- Typo-tolerant search for on-call scenarios where exact phrasing is unknown.

## Planned (v1.0)

- **Multi-brain support** -- Multiple brains per machine via config restructuring. Switch between brains or query across all.
- **Auto-archive** -- Entries stale for 30 consecutive days auto-transition to `stale` status. Authors notified in their next digest.
- **`brain edit <entry-id>`** -- Modify existing entries in-place. Resets freshness scoring.
- **`brain status`** -- Show brain health: entry counts by type/status, sync state, freshness distribution.
- **`brain review`** -- Surface content needing attention: your stale entries, most-read entries worth updating, zero-read entries.
- **`get_recommendations` MCP tool** -- Proactive knowledge surfacing. Extract keywords from agent context and return relevant entries without explicit search.
- **`update_entry` MCP tool** -- Partial field updates (title, tags, status) so agents can maintain entries.
- **`brain health`** -- HEART metrics (Happiness, Engagement, Adoption, Retention, Task success) computed from receipt data.

## Exploring

- **Knowledge graph visualization** -- Visual map of entries and their relationships.
- **Agent auto-capture** -- Agents publish learnings via MCP, tagged `agent-drafted`, surfaced in `brain review` for human approval.
- **Brain federations** -- Query across multiple team brains without merging repos.
- **Slack/Discord integration** -- Push and search from messaging platforms.
- **AI-enhanced workflows** -- Improved MCP tool descriptions for agents, example prompts for ingest/push/search workflows, `brain suggest` command for workflow recommendations. Philosophy: the agent is already smart, we just surface what's possible.

## Not Planned

- **Web UI** -- Brain is CLI-first. Git hosting (GitHub, GitLab) provides a web view of entries for free.
- **Semantic search (LLM-based)** -- FTS5 with prefix matching and fuzzy search covers the use case without requiring an API key or model dependency.
- **Graph database** -- SQLite FTS5 handles current scale. No need for Neo4j/similar infrastructure.
- **Real-time sync** -- Git pull/push is sufficient. Real-time would require a server, which contradicts zero-infrastructure design.
- **System redesign** -- Architecture is sound. All planned features fit within the existing module structure.
