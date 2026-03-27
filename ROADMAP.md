# Roadmap

## Current (v0.1.0-alpha.5)

- 20 CLI commands: `init`, `connect`, `push`, `digest`, `search`, `show`, `list`, `stats`, `retract`, `sync`, `serve`, `ingest`, `prune`, `restore`, `trail`, `edit`, `open`, `remote`, `sources`, `status`
- 10 MCP tools: `push_knowledge`, `search_knowledge`, `whats_new`, `get_entry`, `brain_stats`, `get_recommendations`, `update_entry`, `list_entries`, `explore_topic`, `retract_entry`
- 2 MCP resources: `brain://digest`, `brain://stats`
- Git-backed markdown storage with YAML frontmatter
- SQLite FTS5 search with BM25 ranking, prefix matching, contextual snippets
- Repo ingest with partial clone, freshness scoring at import, source registry
- Freshness scoring (multiplicative: recency * usage boost * volatility modifier)
- Knowledge pruning with reversible archival (`_archive/`)
- Knowledge trails via auto-computed entry links
- Flexible push (positional args, globs, title/type/tag auto-detection)
- Interactive search with entry selection and related entries
- Digest and list filters (`--tag`, `--type`, `--author`, `--mine`, `--unread`, `--stale`, `--fresh`)
- Metadata editing (`brain edit` with `--add-tag`, `--remove-tag`, type changes)
- Health dashboard (`brain status`)
- Remote management (`brain remote add/remove`)
- Multi-repo source sync (`brain sources list/sync/remove`)
- CI/CD pipeline (GitHub Actions, Node 20 + 22)
- Read receipt analytics (CLI and MCP)
- URL validation and credential sanitization
- JSON output for all commands

## Next Sprint (v0.2.0)

1. **Intelligent tagging** -- RAKE keyphrase extraction + TF-IDF corpus-aware scoring. Replaces the 56-term keyword dictionary. See [docs/INTELLIGENT_TAGGING_DESIGN.md](docs/INTELLIGENT_TAGGING_DESIGN.md).
2. **Better auto-linking** -- TF-IDF cosine similarity replaces the 4-signal heuristic linker. Mathematically principled relationship scoring.
3. **Entity extraction** -- Regex-based extraction of CLI commands, file paths, URLs, and tools for richer cross-entry connections.
4. **Project restructure** -- New `src/intelligence/` module with clean boundaries. Tokenizer, TF-IDF, bigrams, RAKE, similarity, clustering.
5. **Improved Obsidian integration** -- Better wikilinks, graph quality, vault compatibility.
6. **Website redesign** -- Update with new features, remove remaining slop.
7. **Full QA pass** -- Usability study v3 with new tagging system.
8. **Docs consistency pass** -- Verify all docs match implementation after tagging changes.

## v1.0 Planning

- **Multi-brain support** -- Multiple brains per machine via config restructuring. Switch between brains or query across all.
- **Auto-archive on schedule** -- Entries stale for 30 consecutive days auto-transition. Authors notified in digest.
- **`brain health`** -- HEART metrics (Happiness, Engagement, Adoption, Retention, Task success) computed from receipt data.
- **Teams/permissions** -- Role-based access for larger organizations.
- **Config migration** -- Versioned config schema with automatic migration between releases.
- **Dev blog / design writeups** -- Public technical writing about Brain's design decisions.

## Exploring

- **VS Code extension** -- Sidebar panel for search, digest, push without leaving the editor.
- **Agent auto-capture** -- Agents publish learnings via MCP, tagged `agent-drafted`, surfaced for human review.
- **Brain federations** -- Query across multiple team brains without merging repos.
- **AI-enhanced workflows** -- Better MCP tool descriptions, example prompts, `brain suggest` command.
- **Simulated user studies** -- AI persona-based usability testing before shipping features.

## Not Planned

- **Web UI** -- CLI-first. Git hosting provides a web view for free.
- **Semantic search (LLM-based)** -- TF-IDF with RAKE covers the use case without API keys or model dependencies.
- **Graph database** -- SQLite FTS5 handles current scale.
- **Real-time sync** -- Git pull/push is sufficient. Real-time requires a server.
