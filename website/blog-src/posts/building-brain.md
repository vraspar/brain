---
title: "Building Brain: A CLI for Team Knowledge Sharing"
date: 2026-03-28
author: Vivek Parikh
summary: "How I built a CLI tool that stores team knowledge in git, searches it with FTS5, and exposes it to AI agents through MCP."
---

## The problem

I use AI agents for most of my development work. They produce a lot of markdown: guides, runbooks, patterns, context files. Over months, this accumulates into a personal knowledge base that's genuinely useful.

The problem is sharing it. I tried Obsidian, which works well for personal use but doesn't solve team knowledge sharing. There's no good way for a teammate's agent to access what my agent has already figured out. The pattern I kept seeing: I'd ask a teammate a question, they'd ask their agent, the agent would answer from scratch. That knowledge existed somewhere, but nobody could find it.

Wikis don't solve this either. They require manual curation, they rot without maintenance, and AI agents can't interact with them programmatically. I wanted something that fits how developers already work: command line, git, markdown.

## Architecture

Brain is a CLI tool that stores knowledge as markdown files in a git repository. Three design decisions define the architecture:

**Git as storage.** Entries are markdown files with YAML frontmatter, committed to a shared repo. No server to run, no database to manage, no accounts to create. Version history and access control come from git. A team joins by cloning the repo.

**SQLite FTS5 for search.** Each machine maintains a local search index using SQLite's FTS5 virtual table with BM25 ranking. The index is a disposable cache, rebuilt from git on every sync. This gives sub-millisecond full-text search with prefix matching and contextual snippets, without requiring any external service.

**MCP as the agent interface.** Brain exposes 10 tools and 2 resources via the Model Context Protocol over stdio. An AI agent connected to Brain can search team knowledge, read entries, publish findings, and check what's new. The agent doesn't need the CLI; it talks MCP directly. This is the key differentiator: the agent is a first-class user, not an afterthought.

The rest follows from these three decisions. Read receipts are JSON files in the repo (so they sync with git). Freshness scoring uses a multiplicative formula over recency and read frequency. Pruning moves stale entries to `_archive/` (reversible). Everything runs locally, everything syncs through git.

## The tagging problem

Brain's first auto-tagger was a 56-term hardcoded dictionary. It matched words like "docker" and "kubernetes" in entry content and used them as tags. This works for the obvious cases but misses everything else. A guide about "payment service deployment patterns" gets tagged `docker` but not `payments`, `deployment-pipeline`, or `microservices`. The dictionary doesn't know your domain.

The relationship system had the same issue: four heuristic signals (shared tags, title overlap, same author, content cross-references) that miss connections between entries with different vocabulary. Two entries about Redis timeouts and connection pooling aren't linked because they happen to use different words.

We're replacing this with a two-algorithm approach, both zero-dependency:

**RAKE (Rapid Automatic Keyword Extraction)** extracts multi-word keyphrases per document. Instead of matching "docker" from a dictionary, it extracts "multi-stage docker builds" as a meaningful phrase. About 60 lines of TypeScript, no corpus needed.

**TF-IDF with zone weighting** scores terms by how distinctive they are within the corpus. A term that appears in one entry but rarely across the brain scores high. A term that appears everywhere (like "the" or even "guide") scores low. Markdown structure matters: title tokens get 3x weight, headings get 2x, code blocks 1.5x. The corpus index lives in SQLite and improves as the brain grows.

For relationships, TF-IDF cosine similarity replaces the heuristic linker. Two entries with high overlap in distinctive terms are related, regardless of whether they share tags or title words. This catches the Redis timeout / connection pooling case: both score high on `redis`, `connection`, `timeout`, `pool` relative to the rest of the corpus.

## Obsidian compatibility

Every brain works as an Obsidian vault. The directory structure (`guides/`, `skills/`) maps to folders. Entries are standard markdown with YAML frontmatter. Open `~/.brain/repo` in Obsidian and you get a visual graph of your team's knowledge for free.

This matters because it meets people where they are. Some team members prefer a visual editor. Some want a graph view. Brain doesn't force a choice between CLI and GUI; the same data works in both.

## What's next

The intelligent tagging system is the next major feature. After that:

- Better auto-linking via TF-IDF cosine similarity and entity extraction (CLI commands, file paths, URLs as link signals)
- Louvain clustering for auto-discovered topic groups
- Multi-brain support (multiple knowledge bases per machine)
- Auto-archive for entries that stay stale for 30+ days

Brain is open source and in alpha. If you're interested, the repo is at [github.com/vraspar/brain](https://github.com/vraspar/brain) and the project site is at [brain.vraspar.com](https://brain.vraspar.com).
