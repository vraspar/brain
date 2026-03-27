# Product Principles

Guidelines for building and maintaining Brain CLI.

## Product

- **CLI-first, zero infrastructure.** No servers, no accounts, no SaaS. Git and SQLite handle storage and search. If a feature requires running a service, it doesn't belong in core.
- **Tags and linking are the differentiator.** Brain is a brain, not a filing cabinet. Auto-discovered connections between entries are the core value. Every feature should make the knowledge graph richer or more accurate.
- **The agent is the UI.** The MCP interface should be rich enough that an AI agent can use the full brain without human intervention. If something requires the CLI but not MCP, add an MCP tool for it.
- **Features should be discoverable without reading docs.** `--help` output, error messages, and command suggestions should guide users. If someone needs to read a doc to use a feature, the feature's UX is wrong.
- **Error messages tell users how to fix the problem.** Not just "Error: config not found" but "Error: config not found. Run brain init or brain connect <url> to set up."
- **Obsidian compatibility by default.** Every brain should work as an Obsidian vault. Wikilinks, graph compatibility, and vault config should be built in, not bolted on.

## Quality

- **Quality over speed.** Test everything, review everything. No `any` types, no skipped tests, no "fix later" comments. With AI agents building, quality and speed are not trade-offs.
- **Test with real-world repos, not toy examples.** Ingest should work on onnxruntime, not just a 3-file test directory. Search should handle messy markdown, not just clean templates.
- **Branch protection, PRs required, CI must pass.** No direct pushes to main. No `--admin` bypasses. Every change goes through the same process.
- **Publish early, iterate fast.** Ship alpha releases. Get real usage data. Fix what breaks. A shipped feature with rough edges beats a perfect feature in a branch.

## Writing

- **No AI slop.** Technical substance, not marketing. No "revolutionary," no "game-changing," no "seamless." If a sentence sounds like it came from a press release, rewrite it.
- **No em dashes in copy.** Use commas, periods, or parentheses instead.
- **Concise and scannable.** README under 80 lines. Docs link out instead of duplicating. Feature descriptions are one sentence, not one paragraph.
