# Changelog

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
