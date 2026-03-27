# Architecture Decisions

Decisions made during Brain CLI development, with context and rationale.

## ADR-001: Git as storage layer

**Decision**: Store entries as markdown files in a git repository, not a database or API.

**Context**: Needed a storage layer that works without infrastructure, supports versioning, and integrates with existing developer workflows.

**Rationale**: Git provides version history, access control, and collaboration for free. Entries are plain markdown files that work in any editor, including Obsidian. No server, no accounts, no SaaS dependency.

**Trade-off**: Sync is eventually consistent (requires `brain sync`), not real-time. Acceptable for knowledge sharing where minutes of delay don't matter.

## ADR-002: SQLite FTS5 for search

**Decision**: Use SQLite FTS5 virtual tables for full-text search with BM25 ranking.

**Context**: Needed fast, offline search across all entries without external services.

**Rationale**: FTS5 ships with better-sqlite3, requires no infrastructure, supports BM25 relevance ranking, and handles prefix matching. Sub-millisecond for typical brain sizes. The index is a disposable cache rebuilt from git on every sync.

**Trade-off**: No semantic search (query "deployment" won't match "rollout"). Mitigated by prefix matching and the planned TF-IDF similarity scoring.

## ADR-003: MCP as agent interface

**Decision**: Expose brain functionality via Model Context Protocol (stdio transport), not a REST API.

**Context**: AI agents (Claude, Copilot, Cursor) need to access team knowledge. MCP is the emerging standard for agent-tool communication.

**Rationale**: MCP provides both tools (agent-initiated actions) and resources (ambient context). Stdio transport means no port management. Works with all major AI agents.

**Trade-off**: Limited to agents that support MCP. No web API for custom integrations yet.

## ADR-004: JSON receipt files for analytics

**Decision**: Track read activity as JSON files in `_analytics/receipts/YYYY-MM-DD/`, committed to git.

**Context**: Needed usage analytics without a server-side database.

**Rationale**: Receipts sync with git, so the whole team sees aggregate stats. No server needed. The file-per-read approach avoids merge conflicts.

**Trade-off**: Eventually consistent (teammate reads appear after next sync). File accumulation at scale (~1500 files/month for a 10-person team). Mitigatable with periodic aggregation.

## ADR-005: Freshness scoring (multiplicative formula)

**Decision**: Score entries using `recency * usageBoost * volatilityModifier`, not an additive formula.

**Context**: Need to identify stale content for pruning. Initial additive formula (`recency * 0.3 + usage * 0.6`) was incorrect: new unread content scored as stale, old heavily-read content scored as fresh.

**Rationale**: Multiplicative model ensures recency is the base (can only decay), usage is a boost (1.0-2.0x, cannot resurrect dead content alone), and volatility adjusts decay speed by content type. New content defaults to "aging" not "fresh" (conservative).

## ADR-006: Reversible archival with _archive/

**Decision**: `brain prune` moves files to `_archive/` with status metadata, not deletion.

**Context**: Stale content should be removed from search but recoverable.

**Rationale**: Archived entries keep their frontmatter with `archived_at` and `archived_reason` fields. `brain restore` moves them back. The `_archive/` directory is committed to git so archival decisions are team-visible.

## ADR-007: Hand-rolled YAML parser for config

**Decision**: Use a simple key-value YAML parser for `~/.brain/config.yaml`, not a full YAML library.

**Context**: Config has 6 flat fields. Adding js-yaml for this is overkill.

**Rationale**: The hand-rolled parser handles the flat key-value structure correctly. It supports comments, quoted values, and optional fields. Upgrade to js-yaml when config becomes nested (planned for multi-brain support in v1.0).

**Convention**: Entry files use gray-matter (full YAML frontmatter). Machine-managed files (sources.json) use JSON.parse/stringify. User-edited config uses the hand-rolled parser.

## ADR-008: Sources registry as JSON

**Decision**: Store source repository registry at `~/.brain/sources.json` using JSON, not YAML.

**Context**: The source registry is machine-managed (created by `brain ingest`, updated by `brain sources sync`). Nested structure with per-source metadata.

**Rationale**: JSON.parse/stringify is zero-dependency, handles nested structures without parsing ambiguity, and is the right format for machine-managed config. No reason to introduce a YAML parser for a file users rarely edit.

## ADR-009: execFileSync for brain open

**Decision**: Use `execFileSync(editor, [fullPath])` instead of `execSync` with string interpolation.

**Context**: `brain open` launches the user's editor. `$EDITOR` and file paths could contain shell metacharacters.

**Rationale**: `execFileSync` bypasses the shell entirely, preventing command injection via `$EDITOR` values or filenames with special characters. This is the standard mitigation for this class of vulnerability.

## ADR-010: Partial clone for ingest

**Decision**: Use `git clone --filter=blob:none` (partial clone) by default for `brain ingest`, with `--shallow` as an opt-in faster alternative.

**Context**: Full clone of large repos (e.g. onnxruntime) downloads entire history. Shallow clone breaks freshness dating because file modification dates are unavailable.

**Rationale**: Partial clone downloads commit history (needed for `git log` file dates) but defers blob downloads until needed. Combined with batch `git log` (single process for all file dates), this reduces ingest time from ~15 minutes to ~30 seconds for large repos.

## ADR-011: Intelligent tagging (TF-IDF + RAKE)

**Decision**: Replace the 56-term hardcoded dictionary with RAKE keyphrase extraction and TF-IDF corpus-aware scoring.

**Context**: The keyword dictionary cannot discover domain-specific terms, extract multi-word concepts, or understand what makes an entry distinctive within the corpus.

**Rationale**: RAKE extracts meaningful multi-word keyphrases per-document without a corpus. TF-IDF scores terms by distinctiveness within the corpus (common terms score low, distinctive terms score high). Both are zero-dependency implementations. See [INTELLIGENT_TAGGING_DESIGN.md](INTELLIGENT_TAGGING_DESIGN.md) for full design.

**Trade-off**: More code (8 files in `src/intelligence/`) and a corpus index in SQLite. Performance budget: <5ms per entry, <2s for 5000-entry corpus rebuild.

## ADR-012: Local-always-wins sync model

**Decision**: For multi-repo source sync, local changes always win. Upstream changes surface as suggestions, never automatic overwrites.

**Context**: `brain sources sync` pulls updates from ingested repos. Need a conflict resolution strategy.

**Rationale**: Local edits represent intentional team decisions. Upstream changes are informational. The sync model shows "upstream updated 2 days ago" and lets users explicitly accept with `brain sources pull <entry>`. This eliminates conflict resolution complexity entirely.
