# CLI Command Reference

All commands support these global options:

| Flag | Description |
|------|-------------|
| `--format <text\|json>` | Output format. Default: `text`. Use `json` for scripting and agent consumption. |
| `-q, --quiet` | Suppress non-essential output. |
| `--version` | Print version number. |
| `--help` | Print help for any command. |

---

## brain init

Create a new brain hub. Initializes a git repository with the standard directory structure (`guides/`, `skills/`, `_analytics/receipts/`), generates a README, and creates `~/.brain/config.yaml`.

```
brain init [--name <name>] [--remote <url>] [--author <name>] [--obsidian]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--name <name>` | In JSON mode | Brain name. Used in the generated README. If omitted in text mode, triggers interactive prompts. |
| `--remote <url>` | No | Git remote URL. If provided, adds as `origin` and pushes the initial commit. |
| `--author <name>` | No | Override the author identity. Default: `git config user.name`. |
| `--obsidian` | No | Enable Obsidian compatibility. Creates `.obsidian/` config in the repo and enables wikilink footers in entries. |

### Behavior

1. Creates `~/.brain/repo/` with `git init`
2. Scaffolds `guides/`, `skills/`, `_analytics/receipts/` with `.gitkeep` files
3. Generates `.gitignore` (excludes `*.db`, `*.db-wal`, `*.db-shm`)
4. Generates `README.md` with the brain name and connect instructions
5. Creates a seed `guides/getting-started.md` so the brain is not empty on day one
6. Commits everything with message `Initialize brain: <name>`
7. If `--remote` is set: adds the remote and pushes (push failure is non-fatal)
8. Writes `~/.brain/config.yaml`

### Examples

```bash
# Non-interactive, local-only
brain init --name "My Brain"

# Non-interactive with remote
brain init --name "Team Brain" --remote https://github.com/team/brain.git

# Interactive wizard
brain init

# JSON output (for scripts)
brain init --name "CI Brain" --format json

# Obsidian-compatible (adds .obsidian/ and wikilinks)
brain init --name "My Brain" --obsidian
```

JSON output:

```json
{
  "status": "initialized",
  "name": "CI Brain",
  "local": "/home/you/.brain/repo",
  "remote": null,
  "author": "your-name"
}
```

### Errors

- Fails if `~/.brain/repo/` already exists. Remove `~/.brain/` to start over.
- In JSON mode, `--name` is required (no interactive prompts).

---

## brain connect

Clone an existing brain repository and configure the local environment.

```
brain connect <url> [--author <name>]
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<url>` | Yes | Git remote URL to clone. |
| `--author <name>` | No | Override the author identity. Default: `git config user.name`. |

### Behavior

1. Clones the repository to `~/.brain/repo/`
2. Extracts the hub name from the repo's `README.md` (if present)
3. Builds the FTS5 search index from existing entries
4. Writes `~/.brain/config.yaml`

### Example

```bash
brain connect https://github.com/acme/brain-hub.git
```

```
🔗 Connecting to team brain...
   Cloning repository...
   Building search index...

✅ Connected to brain: https://github.com/acme/brain-hub.git
   Local:  /home/you/.brain/repo
   Remote: https://github.com/acme/brain-hub.git
   Author: your-name
   Indexed 14 entries.

   Try: brain digest
```

### Errors

- Fails if `~/.brain/repo/` already exists.

---

## brain push

Push one or more entries to the repository, commit, and push to the remote.

```
brain push <file...>
brain push ./docs/*.md
brain push --file <path> [--title <title>] [--type guide|skill] [--tags <csv>] [--summary <text>]
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<file...>` | Yes (or `--file`) | One or more markdown files, or a glob pattern. |
| `--file <path>` | Yes (or positional) | Single file path (legacy syntax). |
| `--title <title>` | No | Override auto-detected title. Cannot be used with multiple files. |
| `--type <type>` | No | `guide` (default) or `skill`. Auto-detected from frontmatter if present. |
| `--tags <tags>` | No | Comma-separated tags. If omitted, auto-detected from content. |
| `--summary <text>` | No | Short description. |

### Title detection

Title is resolved in this order:
1. `--title` flag
2. `title` field in YAML frontmatter
3. First H1 heading (`# ...`) in content
4. First non-empty line
5. Filename (without extension)

### Auto-tagging

When `--tags` is omitted, Brain scans the content for known tech terms and uses up to 5 as tags. The dictionary includes 56 terms: `typescript`, `javascript`, `python`, `react`, `docker`, `kubernetes`, `aws`, `terraform`, `graphql`, `rust`, `go`, and others. See `src/commands/push.ts` for the full list.

### Entry ID generation

The title is converted to a slug: lowercased, special characters removed, spaces replaced with hyphens. Example: `"Docker Multi-Stage Builds"` becomes `docker-multi-stage-builds`.

### File placement

- Type `guide` → `guides/<slug>.md`
- Type `skill` → `skills/<slug>.md`

### Multi-file push

When pushing multiple files, each file is processed independently. Title, type, and tags are auto-detected per file. Per-file errors are reported but do not stop the batch.

```bash
brain push ./docs/*.md
```

```
  ✅ Docker Guide
  ✅ K8s Patterns
  ✗ broken.md: missing required frontmatter: title
✅ Pushed 2 entries
✗ 1 file(s) failed
```

### Examples

```bash
# Single file (title auto-detected from content)
brain push ./k8s-secrets.md

# Glob pattern
brain push ./docs/*.md

# Directory (all .md files inside)
brain push ./docs/

# With explicit overrides
brain push ./react-testing.md \
  --title "React Testing Patterns" \
  --type skill \
  --tags "react,testing,jest"

# Legacy syntax (still works)
brain push --title "My Guide" --file ./guide.md
```

### Errors

- At least one file path or `--file` is required.
- `--title` cannot be used with multiple files.
- Type must be `guide` or `skill`.

---

## brain digest

Show entries created or updated within a time window.

```
brain digest [--since <period>] [--tag <tag>...] [--type <type>] [--author <name>] [--mine] [--unread] [--summary]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--since <period>` | No | Time window. Format: `Nd` (days), `Nw` (weeks), `Nm` (months). Default: since last digest, or `7d` on first run. |
| `--tag <tag>` | No | Filter by tag. Repeatable (entries matching any tag are included). |
| `--type <type>` | No | Filter by type: `guide` or `skill`. |
| `--author <name>` | No | Filter by author name (exact match). |
| `--mine` | No | Show only your own entries (shorthand for `--author` with your name). |
| `--unread` | No | Show only entries you have not read. |
| `--summary` | No | Compact one-line-per-entry output instead of full table. |

### Behavior

1. Queries the FTS5 index for entries with `created_at` or `updated_at` within the window
2. Enriches each entry with read counts from the receipt system
3. Applies filters (type, author/mine, tag, unread)
4. Separates results into "New" (created in period) and "Updated" (modified in period)
5. Highlights the most-accessed entry (unless `--summary` mode)
6. Records a read receipt for each displayed entry
7. Updates `lastDigest` in config (next run without `--since` picks up from here)

### Examples

```bash
brain digest                        # since last digest, or 7d
brain digest --since 14d            # last 14 days
brain digest --mine                 # only your entries
brain digest --unread               # only entries you haven't read
brain digest --tag docker --tag k8s # entries tagged docker or k8s
brain digest --type skill           # only skills
brain digest --summary              # compact one-line format
brain digest --format json          # machine-readable
```

---

## brain search

Full-text search across all entries using SQLite FTS5 with BM25 ranking. Results include contextual snippets by default.

```
brain search <query> [--limit <n>] [--no-preview] [--no-interactive]
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<query>` | Yes | Search terms. Supports prefix matching (e.g. "kube" matches "kubernetes"). |
| `--limit <n>` | No | Maximum results. Default: 20. |
| `--no-preview` | No | Hide content preview snippets from results. |
| `--no-interactive` | No | Skip the selection prompt (show results only). |

### Interactive mode

In a TTY, search results are followed by a numbered selection prompt. Choose a result to view its full content and related entries. Disable with `--no-interactive` or `--format json`.

### Search behavior

The query is sanitized before being passed to FTS5:
- FTS5 operators (`AND`, `OR`, `NOT`, `NEAR`) are stripped
- Special characters are removed
- Each term is wrapped in double quotes for literal matching

Search covers: `title`, `tags`, `content`, `summary` fields.

If the FTS5 query fails for any reason, the search falls back to a LIKE-based query against `title`, `content`, and `tags`.

### Examples

```bash
brain search "kubernetes"
brain search "CI pipeline setup" --limit 5
brain search "react hooks" --format json
```

---

## brain show

Display the full content of an entry by its ID (slug).

```
brain show <entry-id>
```

### Output includes

- Title, author, type, status
- Tags
- Created and updated dates (with relative time)
- Summary (if set)
- Related repos and tools (if set)
- Full markdown body

Records a read receipt each time an entry is viewed.

### Example

```bash
brain show k8s-deployment-guide
```

To find entry IDs, use `brain search` or `brain list`.

---

## brain list

List all entries, optionally filtered.

```
brain list [--type guide|skill] [--author <name>] [--tag <tag>...] [--mine] [--unread] [--stale] [--fresh]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--type <type>` | No | Filter: `guide` or `skill`. |
| `--author <name>` | No | Filter by author name (exact match). |
| `--tag <tag>` | No | Filter by tag. Repeatable (entries matching any tag are included). |
| `--mine` | No | Show only your own entries. |
| `--unread` | No | Show only entries you have not read. |
| `--stale` | No | Show only stale entries (freshness score below threshold). |
| `--fresh` | No | Show only fresh entries. |

### Examples

```bash
brain list                     # all entries
brain list --type skill        # only skills
brain list --author alice      # only alice's entries
brain list --mine --unread     # your unread entries
brain list --tag docker        # entries tagged 'docker'
brain list --stale             # stale entries needing review
brain list --fresh             # healthy entries
brain list --format json       # JSON array of entries
```

---

## brain stats

Show read activity for entries, aggregated from receipt files.

```
brain stats [--period <period>] [--author <name>]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--period <period>` | No | Time window. Default: `7d`. |
| `--author <name>` | No | Show stats for a specific author. Default: you (from config). |

### Output

For each entry with read activity, shows:
- Entry title
- Total read count
- Unique reader count

Entries are sorted by read count (descending).

### Examples

```bash
brain stats                   # your entries, last 7 days
brain stats --period 1m       # your entries, last 30 days
brain stats --author alice    # alice's entries
brain stats --format json     # JSON array of StatsResult objects
```

---

## brain retract

Remove an entry from the brain. Deletes the file from disk, commits the deletion, and pushes.

```
brain retract <entry-id> [--force]
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<entry-id>` | Yes | Entry ID (slug) to remove. |
| `--force` | No | Skip the confirmation prompt. |

### Behavior

1. Looks up the entry in the index
2. Prompts for confirmation (unless `--force`)
3. Deletes the file from disk
4. Commits with message `Retract <type>: <title>` and pushes
5. Rebuilds the FTS5 index

### Examples

```bash
brain retract old-deployment-guide          # prompts for confirmation
brain retract old-deployment-guide --force  # no prompt
brain retract old-deployment-guide --format json
```

### Errors

- Fails if the entry ID is not found.

---

## brain edit

Edit an entry's metadata without opening the file. Updates frontmatter fields, commits, and pushes.

```
brain edit <entry-id> [--title <title>] [--tags <csv>] [--type <type>] [--add-tag <tag>...] [--remove-tag <tag>...] [--summary <text>]
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<entry-id>` | Yes | Entry ID (slug) to edit. |
| `--title <title>` | No | Set a new title. |
| `--tags <csv>` | No | Replace all tags (comma-separated). |
| `--type <type>` | No | Change type: `guide` or `skill`. Moves the file between directories. |
| `--add-tag <tag>` | No | Add tag(s) without removing existing. Repeatable. |
| `--remove-tag <tag>` | No | Remove specific tag(s). Repeatable. |
| `--summary <text>` | No | Set or update the summary. |

At least one edit flag is required. Updates the `updated` timestamp automatically.

### Examples

```bash
brain edit k8s-guide --add-tag helm --add-tag argocd
brain edit k8s-guide --title "K8s Deployment Runbook"
brain edit k8s-guide --type skill               # moves from guides/ to skills/
brain edit k8s-guide --remove-tag outdated
brain edit k8s-guide --tags "k8s,helm,deploy"    # replace all tags
```

---

## brain status

Show a health dashboard for the brain.

```
brain status
```

No flags. Displays: hub name, local/remote paths, author, entry counts by type, freshness distribution (Fresh/Aging/Stale), archived entry count, ingested source repos, storage sizes, last sync/digest timestamps.

---

## brain open

Open an entry file in your editor for direct content editing.

```
brain open <entry-id>
```

Uses `$EDITOR`, `$VISUAL`, or platform default (`open` on macOS, `xdg-open` on Linux). After editing, run `brain sync` to commit changes.

---

## brain remote

Manage the brain's git remote.

```
brain remote add <url>       # add a remote to a local-only brain
brain remote remove          # disconnect from the current remote
```

### brain remote add

Sets the origin remote, attempts an initial push, and prints a shareable `brain connect` command. Fails if a remote is already configured.

### brain remote remove

Removes the origin remote from git and clears it from config. The brain becomes local-only. Committed entries remain intact.

---

## brain sources

Manage external source repositories for incremental sync.

```
brain sources                        # list registered sources
brain sources list                   # same as above
brain sources sync [name]            # sync from all or one source
brain sources sync --dry-run         # preview changes
brain sources sync --force           # overwrite local changes on conflict
brain sources remove <name>          # unregister a source
```

Sources are registered automatically by `brain ingest` and tracked in `~/.brain/sources.json`. Sync uses `git fetch` against persistent bare mirrors for fast incremental updates.

---

## brain ingest

Import documentation from a git repository or local directory. Solves the cold-start problem by batch-importing existing docs.

```
brain ingest <source> [--path <glob>] [--exclude <glob>...] [--dry-run] [--type <type>] [--source-tag] [--max <n>] [--overwrite]
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<source>` | Yes | Git repo URL or local directory path. |
| `--path <glob>` | No | Restrict scan to paths matching glob (e.g. `docs/**`). |
| `--exclude <glob>` | No | Exclude paths matching glob. Repeatable. |
| `--dry-run` | No | Preview what would be imported without writing. |
| `--type <type>` | No | Force entry type for all imports (`guide` or `skill`). |
| `--source-tag` | No | Auto-tag entries with the source repo name. |
| `--max <n>` | No | Maximum files to import (default: 100). |
| `--overwrite` | No | Overwrite existing entries with the same slug. |

### Behavior

1. Clones the source repo (full clone for accurate file dates) or reads from local directory
2. Scans for `.md` files, applies `--path` and `--exclude` filters
3. Skips non-documentation files (README at root, CHANGELOG, LICENSE) unless `--overwrite`
4. Auto-detects title, type, and tags per file using the standard detection chain
5. Computes freshness score at import time based on file dates from the source
6. Writes entries to the brain repo, commits, and pushes
7. Cleans up temp clone (if remote source)

### Examples

```bash
# Import from a remote repo
brain ingest https://github.com/acme/platform.git

# Restrict to docs/ directory
brain ingest https://github.com/acme/platform.git --path "docs/**"

# Preview without importing
brain ingest https://github.com/acme/platform.git --dry-run

# Import from local directory with source tagging
brain ingest ./path/to/repo --source-tag

# Overwrite existing entries
brain ingest https://github.com/acme/platform.git --overwrite --max 50
```

---

## brain prune

Archive stale entries based on freshness scoring.

```
brain prune [--dry-run] [--threshold <score>] [--force] [--include-type <type>] [--min-age <period>]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--dry-run` | No | Preview what would be pruned without archiving. |
| `--threshold <score>` | No | Freshness score cutoff, 0.0-1.0 (default: 0.3). Entries below this are pruned. |
| `--force` | No | Skip confirmation prompt. |
| `--include-type <type>` | No | Only consider entries of this type. |
| `--min-age <period>` | No | Only prune entries older than this (default: `30d`). |

### Freshness scoring

Entries are scored using a multiplicative formula:
- **Recency** is the base score (decays over time)
- **Usage** is a boost multiplier (1.0-2.0x based on recent reads)
- **Volatility** adjusts decay speed (tags like "k8s" decay faster than "architecture")

Labels: Fresh (score >= 0.6), Aging (0.3-0.6), Stale (< 0.3).

### Behavior

1. Computes freshness scores for all entries
2. Filters by type, min-age, and threshold
3. Shows a preview table with titles, scores, and read counts
4. On confirmation: moves files to `_archive/` with `status: archived` in frontmatter
5. Commits and pushes, rebuilds index

### Examples

```bash
brain prune --dry-run                    # preview
brain prune --threshold 0.2 --force      # aggressive, no prompt
brain prune --include-type guide         # only prune guides
brain prune --min-age 60d               # only entries older than 60 days
```

---

## brain restore

Restore an archived entry back to the brain.

```
brain restore <entry-id> [--force]
brain restore --list
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<entry-id>` | Yes (unless `--list`) | Entry ID (slug) to restore. |
| `--force` | No | Skip confirmation prompt. |
| `--list` | No | List all archived entries instead of restoring. |

### Behavior

1. Finds the entry in `_archive/guides/` or `_archive/skills/`
2. Prompts for confirmation (unless `--force`)
3. Moves the file back to its original location
4. Sets `status` back to `active`, removes `archived_at` and `archived_reason` from frontmatter
5. Commits and pushes, rebuilds index

### Examples

```bash
brain restore --list                       # see what's archived
brain restore old-deployment-guide         # restore with confirmation
brain restore old-deployment-guide --force # no prompt
```

---

## brain trail

Explore connected knowledge entries for a topic.

```
brain trail <topic> [--limit <n>]
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<topic>` | Yes | Topic to explore. |
| `--limit <n>` | No | Maximum entries to show (default: 20). |

### How links are computed

Entry relationships are auto-computed during index rebuild using 4 signals:
- Tag overlap between entries
- Title word similarity
- Same author
- Content cross-references (entry IDs mentioned in other entries)

### Example

```bash
brain trail kubernetes
```

```
🔗 Knowledge trail: kubernetes (4 entries)

  k8s-deployment-guide — K8s Deployment Guide
    guide by alice · kubernetes, k8s
    → related: helm-chart-patterns, ci-pipeline-setup

  helm-chart-patterns — Helm Chart Patterns
    guide by bob · kubernetes, helm
    → related: k8s-deployment-guide
```

---

## brain sync

Pull latest changes from the remote and rebuild the search index.

```
brain sync
```

No flags. Uses `git pull --ff-only`.

### Behavior

1. Records entry list before pull
2. Pulls from remote (fast-forward only)
3. Records entry list after pull
4. Computes added, updated, and removed entries
5. Rebuilds the FTS5 index from disk
6. Updates `lastSync` in config

### Example

```bash
brain sync
```

```
✅ Brain synced successfully.
   ✨ 2 new: guides/docker-guide.md, skills/react-patterns.md
   📝 1 updated: guides/k8s-guide.md
   Already up to date.
   Total entries indexed: 18
```

---

## brain serve

Start the MCP server on stdio transport. Exposes 10 tools and 2 resources.

```
brain serve
```

No flags. This command blocks — it runs until the process is terminated (SIGINT/SIGTERM). Not intended for direct use; configure your MCP client to invoke it. See [MCP Integration](mcp-integration.md).

Handles graceful shutdown by closing the SQLite database to prevent WAL file corruption.
