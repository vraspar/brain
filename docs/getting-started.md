# Getting Started

This guide walks through installing Brain CLI, creating or joining a brain, and using basic commands.

## Prerequisites

- Node.js 20 or later
- git configured with `user.name` (used as your author identity)

## Install

```bash
git clone https://github.com/vraspar/brain.git
cd brain
npm install
npm run build
npm link
```

After `npm link`, the `brain` command is available globally.

## Option A: Create a new brain

Use `brain init` to create a fresh knowledge hub. This initializes a local git repo with the standard directory structure.

```bash
brain init --name "Acme Engineering"
```

Output:

```
Creating brain "Acme Engineering"...
✅ Brain "Acme Engineering" is ready! (local-only)
   Local:  /home/you/.brain/repo
   Author: your-name

   ⚠ No remote configured. Knowledge stays on this machine.

   Next steps:
     brain push --title "My First Guide" --file ./guide.md
     brain digest
```

To share with a team, create an empty GitHub repo first, then pass `--remote`:

```bash
brain init --name "Acme Engineering" --remote https://github.com/acme/brain-hub.git
```

This adds the remote as `origin` and pushes the initial commit.

### Interactive mode

Run `brain init` without flags for a guided wizard:

```bash
brain init
```

It prompts for the brain name and (optionally) a remote URL.

## Option B: Join an existing brain

If a teammate already created a brain, use `brain connect` to clone it:

```bash
brain connect https://github.com/acme/brain-hub.git
```

Output:

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

## Push your first entry

Write a markdown file with your knowledge, then push it:

```bash
cat > my-guide.md << 'EOF'
# CI Pipeline Setup

This guide explains how to set up our CI pipeline using GitHub Actions.

## Steps

1. Create `.github/workflows/ci.yml`
2. Configure the build matrix
3. Add test and lint steps
EOF

brain push ./my-guide.md
```

Output:

```
✅ Pushed: CI Pipeline Setup
   ID: ci-pipeline-setup
   Type: guide
   File: guides/ci-pipeline-setup.md
   Tags: github (auto-detected)
```

The title is auto-detected from the H1 heading. Tags are auto-detected from content. To push multiple files at once:

```bash
brain push ./docs/*.md
```

## Search

```bash
brain search "CI pipeline"
```

Returns matching entries ranked by relevance with contextual snippets. Use `--no-preview` to hide snippets.

## Read an entry

```bash
brain show ci-pipeline-setup
```

Displays the full entry content including metadata. Records a read receipt for analytics.

## See what's new

```bash
brain digest
```

Shows entries created or updated since your last digest (or last 7 days on first run). Filter with `--mine`, `--unread`, `--tag`, `--type`, or `--author`:

```bash
brain digest --unread             # only entries you haven't read
brain digest --mine --since 1m    # your entries from last 30 days
brain digest --tag docker         # entries tagged 'docker'
brain digest --summary            # compact one-line format
```

## Stay in sync

Pull the latest entries from the team:

```bash
brain sync
```

```
✅ Brain synced successfully.
   ✨ 2 new: guides/docker-guide.md, skills/react-patterns.md
   Total entries indexed: 16
```

## Import existing docs

If your team already has documentation in other repos, import it in one command:

```bash
brain ingest https://github.com/acme/platform.git --path "docs/**"
```

Preview first with `--dry-run`:

```bash
brain ingest https://github.com/acme/platform.git --dry-run
```

Each file gets a freshness score based on its age and content type.

## Prune stale content

Over time, some entries become outdated. Check what's stale:

```bash
brain prune --dry-run
```

Archive stale entries (they move to `_archive/` and can be restored later):

```bash
brain prune
```

Restore a pruned entry if you need it back:

```bash
brain restore --list                   # see what's archived
brain restore old-deployment-guide     # bring it back
```

## Explore connected knowledge

Follow a topic across related entries:

```bash
brain trail kubernetes
```

## Edit entries

Update metadata without opening the file:

```bash
brain edit k8s-guide --add-tag helm
brain edit k8s-guide --title "K8s Deployment Runbook"
```

Or open the file directly in your editor:

```bash
brain open k8s-guide
```

## Check brain health

See entry counts, freshness distribution, and sync state:

```bash
brain status
```

## Next steps

- [Full CLI reference](commands.md) — all commands, flags, and edge cases
- [MCP integration](mcp-integration.md) — set up AI agent access
- [Configuration](configuration.md) — config file reference
- [Architecture](architecture.md) — how it works under the hood
