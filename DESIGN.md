# Design

How and why Brain CLI is built the way it is. For contributors who want to understand the architecture before making changes.

## Design Principles

**CLI-first.** The terminal is the primary interface. Every feature works from the command line before it works anywhere else. Commands output both human-readable text and `--format json` for scripts and agents. No web UI, no portal, no dashboard.

**Git as storage.** A private Git repo is the database. Entries are markdown files with YAML frontmatter. Version history, access control, offline support, and collaboration come free from Git. No servers to deploy, no databases to manage, no cloud services to pay for.

**Zero infrastructure.** Running `brain init` or `brain connect <url>` is the entire setup. No API keys, no hosted services, no Docker containers. The CLI is the server. The Git repo is the database. The MCP protocol is the agent API.

**Agent-native.** AI agents are first-class consumers via the MCP server (`brain serve`). MCP Tools handle interactive operations (push, search). MCP Resources provide ambient context (digest, stats) that agents can access without explicit tool calls. The `--format json` flag on every command makes the CLI itself agent-friendly.

**Feedback drives contribution.** Every read is tracked via receipts. Contributors see how their knowledge is being used ("your guide was accessed 12 times by 5 people"). This feedback loop is what makes the system self-sustaining — it's the difference between a living knowledge base and a wiki graveyard.

## Key Decisions

### Why Git, not a database?

| Concern | Git | Hosted DB |
|---------|-----|-----------|
| Setup cost | `brain connect <url>` | Deploy API, provision DB, manage auth |
| Version history | Built in | Must build |
| Offline support | Local clone works offline | Needs queue infrastructure |
| Access control | Repo permissions | Custom auth system |
| Cost | Free (GitHub private repos) | $25+/month |
| Content format | Markdown files (human-readable, Obsidian-compatible) | Opaque storage |
| Operational burden | Zero | Ongoing |

Git wins on 6 of 7 criteria. The one tradeoff: real-time collaboration requires sync (pull/push), not instant propagation. For a knowledge base that updates a few times per day, this is fine.

### Why SQLite FTS5 for search?

The search index is a local SQLite database at `~/.brain/cache.db`. It's rebuilt from the markdown files on every `brain sync`.

- **FTS5** provides full-text search with BM25 ranking out of the box
- **Content-sync triggers** keep the FTS index in lockstep with the entries table — no manual index management
- **Sub-millisecond queries** on the scale we operate at (tens to hundreds of entries)
- **No network dependency** — search works offline
- **Disposable** — the DB is a cache, not the source of truth. Delete it and `brain sync` rebuilds it

The index stores denormalized entry data (title, content, tags, metadata) for fast retrieval without hitting the filesystem.

### Why markdown + YAML frontmatter?

Entries are markdown files with YAML frontmatter (parsed by `gray-matter`):

```markdown
---
title: Kubernetes Deployment Guide
author: alice
created: 2026-03-20T10:00:00Z
updated: 2026-03-21T14:30:00Z
tags: [kubernetes, deployment, helm]
type: guide
status: active
---

Step-by-step instructions for deploying to our K8s cluster...
```

This format is:
- **Human-readable** without any tooling
- **Git-friendly** — clean diffs, easy merging
- **Obsidian-compatible** — the repo doubles as an Obsidian vault
- **Parseable** — structured metadata in frontmatter, free-form content in the body
- **Standard** — used by Jekyll, Hugo, Docusaurus, and every other static site generator

### Why MCP for agent integration?

The [Model Context Protocol](https://modelcontextprotocol.io/) is the standard for AI agent tool integration, supported by Claude, Copilot, Cursor, and others.

Brain exposes two types of MCP interfaces:

**Tools** (agent-initiated actions):
- `push_knowledge` — publish an entry
- `search_knowledge` — full-text search
- `whats_new` — recent entries digest
- `get_entry` — retrieve full entry content
- `brain_stats` — contributor analytics

**Resources** (ambient context):
- `brain://digest` — recent entries summary
- `brain://stats` — contributor stats

The distinction matters: Tools require the agent to explicitly call them. Resources are structurally available — agents can include them in their context without the user asking. This means an agent can silently know what the team has published recently.

### Why receipt-based analytics?

Read receipts are JSON files in `_analytics/receipts/`, one file per read event:

```
_analytics/receipts/2026-03-21/alice-k8s-deployment-a1b2c3.json
```

This design choice:
- **Zero merge conflicts** — unique filenames mean concurrent writes never collide
- **Zero infrastructure** — no analytics backend, no event pipeline
- **Git-transported** — receipts sync via the same `git push/pull` as entries
- **Auditable** — every read event is a file you can inspect
- **Eventually consistent** — stats update on sync, not in real-time. For weekly feedback ("your guide was used 8 times this week"), eventual consistency is sufficient

The tradeoff: receipt files accumulate over time. At team scale (10 people, 5 reads/day), that's ~1,500 files/month. This is manageable for the first year; at scale, periodic aggregation (squashing daily receipts into weekly summaries) keeps it bounded.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    DEVELOPER'S MACHINE                       │
│                                                              │
│  ┌──────────┐    ┌────────────┐    ┌──────────────────────┐ │
│  │ AI Agent │◄──►│ MCP Server │◄──►│ Local Git Clone      │ │
│  │ (Copilot,│    │ (brain     │    │ + SQLite FTS5 Cache  │ │
│  │  Claude) │    │  serve)    │    │ + Receipt Files      │ │
│  └──────────┘    └────────────┘    └──────────┬───────────┘ │
│                   ┌──────────┐                │             │
│                   │ CLI      │────────────────►│             │
│                   │ (brain)  │                │             │
│                   └──────────┘                │             │
└───────────────────────────────────────────────│─────────────┘
                                                │
                                           git push/pull
                                                │
                                      ┌─────────▼──────────┐
                                      │ GitHub / DevOps    │
                                      │ Private Repository │
                                      │                    │
                                      │  guides/           │
                                      │  skills/           │
                                      │  _analytics/       │
                                      │    receipts/       │
                                      └────────────────────┘
```

### Layers

**Commands** (`src/commands/`) — User-facing CLI. Each command is a separate file exporting a Commander `Command` object, registered in `src/index.ts`. Commands handle argument parsing, output formatting (text/JSON), and error display. They delegate all logic to core modules.

**Core** (`src/core/`) — Business logic. Config management, entry parsing/serialization, SQLite index operations, receipt analytics, repository lifecycle. No CLI or MCP dependencies — testable in isolation.

**MCP** (`src/mcp/`) — Agent interface. Server creation, tool handlers, resource handlers. Depends on core modules. Uses stdio transport.

**Utils** (`src/utils/`) — Shared utilities. Git operations (via `simple-git`), terminal formatting (via `chalk` + `cli-table3`), slug generation, time parsing, URL sanitization.

### Data Flow

**Push:** User/agent provides content → `createEntry()` builds an Entry with frontmatter → `writeEntry()` writes markdown to `guides/` or `skills/` → `commitAndPush()` commits and pushes to remote → index is rebuilt from disk.

**Search:** Query comes in → `sanitizeFtsQuery()` strips special characters → FTS5 `MATCH` with BM25 ranking → results returned as Entry objects. Falls back to `LIKE` search if FTS5 query fails.

**Sync:** `pullLatest()` does `git pull --ff-only` → `scanEntries()` reads all markdown files → `rebuildIndex()` clears and repopulates the SQLite tables → receipts are committed if present.

**Digest:** `getRecentEntries()` queries entries created/updated since a date → `getTopEntries()` scans receipt files for access counts → results merged into `DigestEntry` objects with access stats.

## Content Types

Two content types, deliberately constrained:

| Type | Directory | Purpose |
|------|-----------|---------|
| `guide` | `guides/` | How-tos, references, decision records, tool documentation |
| `skill` | `skills/` | Agent-consumable playbooks (structured instructions for AI) |

We chose two types over five because fewer categories = less decision friction = more contributions. A guide about a CI pipeline and a guide about coding standards are both `guide` type — the difference is in the tags, not the category.

## Trade-offs

### What we chose

| Decision | Tradeoff | Why we accepted it |
|----------|----------|-------------------|
| Git as storage | No real-time sync | Knowledge bases update a few times/day, not per-second |
| SQLite as cache | Rebuilt on every sync | Sync is infrequent; rebuild is fast (<100ms for hundreds of entries) |
| Receipt files | Filesystem accumulation | Manageable at team scale; aggregation can be added later |
| Hand-rolled YAML config parser | Fragile for complex YAML | Config has 6 flat fields; a full YAML parser adds a dependency for no benefit |
| FTS5 over semantic search | Keyword-only, no embeddings | Works well for technical content; semantic search requires an LLM and adds latency/cost |
| Two content types | Less granular classification | Reduces contribution friction; tags provide the granularity |
| Single-hub config | One brain per machine | Multi-hub adds complexity without MVP value; clean V1 extension |

### What we chose NOT to do

**No web UI.** The CLI is the interface. Adding a web layer means a server, a build pipeline, a hosting decision, and a second codebase to maintain. If someone wants to browse entries visually, the repo is an Obsidian vault.

**No ML-powered features.** No embeddings, no semantic search, no LLM-powered auto-tagging. Simple keyword extraction (`KNOWN_TECH_TERMS` set) and FTS5 search work well at team scale (50-500 entries). ML features can be layered on later without changing the storage format.

**No auto-capture.** The system doesn't watch what you do and automatically create entries. Push is always explicit. Auto-capture has privacy and quality concerns that require a consent model we haven't built yet.

**No real-time sync.** Changes propagate via `git push/pull`, not WebSockets or polling. `brain sync` is the manual trigger. This is a deliberate simplification — real-time adds infrastructure (webhooks, a sync daemon) for minimal benefit at our update frequency.

**No multi-hub support.** `~/.brain/config.yaml` points to one brain. Supporting multiple brains requires config restructuring and a hub-selection UX. Deferred to V1.

## Security Considerations

- **URL validation** — Git URLs are validated to prevent option injection (URLs starting with `-` are rejected)
- **Credential sanitization** — Embedded credentials (`user:token@host`) are stripped from URLs before storing in config or displaying in output (`src/utils/url.ts`)
- **No secrets in content** — Entries are markdown in a shared git repo. The CLI does not encrypt content. Access control is Git repo permissions.
- **Local-only cache** — The SQLite database and config file are stored at `~/.brain/` and are not committed to the shared repo

## Future Considerations

These are known gaps and extension points, roughly prioritized:

1. **GitHub Actions** — Auto-index generation, staleness detection, receipt aggregation on a schedule
2. **Auto-decay** — Entries not referenced in 60 days auto-archive to prevent knowledge rot
3. **Multi-hub** — Support multiple brains per machine via config restructuring
4. **`brain retract <id>`** — Archive an entry (reversible deletion without git knowledge)
5. **Filename collision resistance** — Use `{slug}-{short-hash}.md` pattern for entries
6. **Receipt aggregation** — Periodic squashing of daily receipt files into weekly/monthly summaries
7. **Semantic search** — Optional embedding-based search for larger knowledge bases
8. **Auto-capture suggestions** — Agent notices solved problems and offers to publish (with user consent)
9. **MCP auto-configuration** — Detect AI clients and offer to write MCP config entries
