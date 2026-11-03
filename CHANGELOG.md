# Changelog

## 0.1.2

- The card shows compactions: `⟳ $2.36 · 2 compactions` is the summed cost of every
  compaction on the branch, and `169k to compact` is how many tokens are left before
  auto-compaction fires (contextWindow minus `compaction.reserveTokens`, with
  `compaction.modelOverrides["provider/id"]` first). The second one turns yellow in
  the last 10%.

## 0.1.1

- Heavy tool results say what the call did: `bash: npm test (turn 2)`,
  `read: src/pricing/discounts.ts (turn 1)`, instead of just the tool name.
- After applying changes, the total no longer sticks to the value from before
  the reload. pi's usage still describes the old prompt until the next reply, so
  pi-xray computes the total on the new configuration and marks it `≈`. Before,
  the removed tokens were spread over the other rows.
- New demo: a long recorded work session in a sample notes app, with
  AGENTS.md / CLAUDE.md files (`demo/setup.sh`, `demo/make-session.mjs`).

## 0.1.0

First release.

- `/xray` command: context usage card (bar + legend) and a tree of groups
  (each package, `~/.pi/agent`, built-in, MCP, memory, messages) sorted by
  tokens, expandable down to single tools.
- Toggle skills, extensions and prompts, or a whole package, and apply with a
  reload. Writes the same `settings.json` entries as `pi config`.
- MCP servers show how they reach the model (`proxy`, `direct`, `disabled`)
  when `pi-mcp-adapter` is installed. Read-only.
- Search (`/`), filters (`f`), expand all (`e`), open a file in a tmux pane (`⏎`).
- Tested with pi 1.2.0.
