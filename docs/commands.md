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
brain init [--name <name>] [--remote <url>] [--author <name>]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--name <name>` | In JSON mode | Brain name. Used in the generated README. If omitted in text mode, triggers interactive prompts. |
| `--remote <url>` | No | GitHub remote URL. If provided, adds as `origin` and pushes the initial commit. |
| `--author <name>` | No | Override the author identity. Default: `git config user.name`. |

### Behavior

1. Creates `~/.brain/repo/` with `git init`
2. Scaffolds `guides/`, `skills/`, `_analytics/receipts/` with `.gitkeep` files
3. Generates `.gitignore` (excludes `*.db`, `*.db-wal`, `*.db-shm`)
4. Generates `README.md` with the brain name and connect instructions
5. Commits everything with message `Initialize brain: <name>`
6. If `--remote` is set: adds the remote and pushes (push failure is non-fatal)
7. Writes `~/.brain/config.yaml`

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

## brain join

Alias for `brain connect`. Accepts the same arguments.

```
brain join <url>
```

Note: `brain join` does not support `--author`. Use `brain connect` for the full flag set.

---

## brain push

Write a new entry to the repository, commit, and push to the remote.

```
brain push --title <title> --file <path> [--type guide|skill] [--tags <csv>] [--summary <text>]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--title <title>` | Yes | Entry title. Slugified to produce the entry ID and filename. |
| `--file <path>` | Yes | Path to a markdown file containing the entry body. |
| `--type <type>` | No | `guide` (default) or `skill`. |
| `--tags <tags>` | No | Comma-separated tags. If omitted, auto-detected from content. |
| `--summary <text>` | No | Short description. |

### Auto-tagging

When `--tags` is omitted, Brain scans the content for known tech terms and uses up to 5 as tags. The dictionary includes 56 terms: `typescript`, `javascript`, `python`, `react`, `docker`, `kubernetes`, `aws`, `terraform`, `graphql`, `rust`, `go`, and others. See `src/commands/push.ts` for the full list.

### Entry ID generation

The title is converted to a slug: lowercased, special characters removed, spaces replaced with hyphens. Example: `"Docker Multi-Stage Builds"` becomes `docker-multi-stage-builds`.

### File placement

- Type `guide` → `guides/<slug>.md`
- Type `skill` → `skills/<slug>.md`

### Commit behavior

The entry file is committed with message `Add <type>: <title>` and pushed to the remote. A read receipt is recorded for the author.

### Examples

```bash
# Minimal
brain push --title "K8s Secrets Management" --file ./k8s-secrets.md

# Full options
brain push \
  --title "React Testing Patterns" \
  --type skill \
  --file ./react-testing.md \
  --tags "react,testing,jest" \
  --summary "Patterns for testing React components with Jest and RTL"

# JSON output
brain push --title "My Guide" --file ./guide.md --format json
```

JSON output:

```json
{
  "status": "pushed",
  "id": "my-guide",
  "title": "My Guide",
  "type": "guide",
  "filePath": "guides/my-guide.md",
  "tags": ["react", "testing"]
}
```

### Errors

- `--title` and `--file` are both required.
- File must exist at the given path.
- Type must be `guide` or `skill`.

---

## brain digest

Show entries created or updated within a time window.

```
brain digest [--since <period>]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--since <period>` | No | Time window. Format: `Nd` (days), `Nw` (weeks), `Nm` (months). Default: since last digest, or `7d` on first run. |

### Behavior

1. Queries the FTS5 index for entries with `created_at` or `updated_at` within the window
2. Enriches each entry with read counts from the receipt system
3. Separates results into "New" (created in period) and "Updated" (modified in period)
4. Highlights the most-accessed entry
5. Records a read receipt for each displayed entry
6. Updates `lastDigest` in config (next run without `--since` picks up from here)

### Examples

```bash
brain digest                 # since last digest, or 7d
brain digest --since 14d     # last 14 days
brain digest --since 1m      # last 30 days
brain digest --format json   # machine-readable
```

---

## brain search

Full-text search across all entries using SQLite FTS5 with BM25 ranking.

```
brain search <query> [--limit <n>]
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<query>` | Yes | Search terms. |
| `--limit <n>` | No | Maximum results. Default: 20. |

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

List all entries, optionally filtered by type or author.

```
brain list [--type guide|skill] [--author <name>]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--type <type>` | No | Filter: `guide` or `skill`. |
| `--author <name>` | No | Filter by author name (exact match). |

### Examples

```bash
brain list                     # all entries
brain list --type skill        # only skills
brain list --author alice      # only alice's entries
brain list --type guide --author bob  # combined filters
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

Start the MCP server on stdio transport.

```
brain serve
```

No flags. This command blocks — it runs until the process is terminated (SIGINT/SIGTERM). Not intended for direct use; configure your MCP client to invoke it. See [MCP Integration](mcp-integration.md).

Handles graceful shutdown by closing the SQLite database to prevent WAL file corruption.
