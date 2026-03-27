# Configuration

Brain stores all local state under `~/.brain/`. This directory is created automatically by `brain init` or `brain connect`.

## Directory layout

```
~/.brain/
├── config.yaml     # Brain configuration
├── cache.db        # SQLite FTS5 search index
├── cache.db-wal    # SQLite WAL file (when database is in use)
└── repo/           # Cloned or initialized git repository
    ├── guides/     # Guide entries
    ├── skills/     # Skill entries
    └── _analytics/
        └── receipts/
            └── YYYY-MM-DD/
```

## config.yaml

The configuration file is a flat YAML key-value file. Created by `brain init` or `brain connect`, updated by `brain sync` and `brain digest`.

### Full schema

```yaml
# Git remote URL. Omitted for local-only brains (created with brain init without --remote).
remote: "https://github.com/acme/brain-hub.git"

# Absolute path to the local repository clone.
local: "/home/you/.brain/repo"

# Your author identity. Used in entry frontmatter and receipt files.
author: "your-name"

# Human-readable brain name. Set by brain init, or extracted from README on connect.
hubName: "Acme Engineering"

# ISO 8601 timestamp of last brain sync. Updated by brain sync.
lastSync: "2026-03-23T12:00:00.000Z"

# ISO 8601 timestamp of last brain digest. Updated by brain digest.
# Used as the default --since window on the next digest run.
lastDigest: "2026-03-23T12:00:00.000Z"
```

### Field reference

| Field | Required | Type | Set by | Description |
|-------|----------|------|--------|-------------|
| `remote` | No | string | `init --remote`, `connect` | Git remote URL. Absent for local-only brains. |
| `local` | Yes | string | `init`, `connect` | Absolute path to the local repo. |
| `author` | Yes | string | `init`, `connect` | Author identity for entries and receipts. |
| `hubName` | No | string | `init`, `connect` | Human-readable brain name. |
| `lastSync` | No | string | `sync`, `init`, `connect` | ISO 8601 timestamp. |
| `lastDigest` | No | string | `digest` | ISO 8601 timestamp. |

### Validation

On load, Brain checks that `local` and `author` are present. If either is missing, it throws:

```
Invalid brain config: missing required fields (local, author).
Run "brain init" or "brain connect <url>" to set up.
```

If the config file doesn't exist at all:

```
Brain not configured. Run "brain init" or "brain connect <url>" to set up.
Expected config at: /home/you/.brain/config.yaml
```

### Editing manually

The config file is human-editable. Common reasons to edit manually:

- Change your `author` name
- Point `local` to a different repo location
- Update the `remote` URL after a repo migration

After manual edits, run `brain sync` to ensure the index is consistent.

## Search index (cache.db)

The SQLite database at `~/.brain/cache.db` contains:

- `entries` table: all entry metadata and content
- `entries_fts` FTS5 virtual table: full-text search index over `title`, `tags`, `content`, `summary`
- Triggers that keep FTS5 in sync with the entries table on insert/update/delete

The database uses WAL (Write-Ahead Logging) mode for concurrent read access.

This file is a local cache. It can be deleted and rebuilt by running `brain sync`. It is not committed to git (excluded by `.gitignore`).

## Time window format

Several commands accept time windows. The format is `<number><unit>`:

| Unit | Meaning | Example |
|------|---------|---------|
| `d` | days | `7d` = last 7 days |
| `w` | weeks | `2w` = last 14 days |
| `m` | months (30 days) | `1m` = last 30 days |

Used by: `brain digest --since`, `brain stats --period`, MCP tools `whats_new`, `brain_stats`.

## Resetting

To completely reset your brain configuration:

```bash
rm -rf ~/.brain
```

Then run `brain init` or `brain connect <url>` again.

To rebuild just the search index without losing config:

```bash
rm ~/.brain/cache.db
brain sync
```
