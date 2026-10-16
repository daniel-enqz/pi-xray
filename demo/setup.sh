#!/usr/bin/env bash
# Builds a throwaway pi setup for recording the demo, so no personal
# configuration shows up in it:
#   $DIR            agent dir: 3 sample skills, 3 packages, a global AGENTS.md
#   $WORK/          workspace with a CLAUDE.md
#   $WORK/notes-app sample project with its own AGENTS.md
#   a long work session with heavy tool results, opened with `pi --continue`
# Usage: [DEMO_MODEL=provider/model] [DEMO_TARGET_TOKENS=420000] demo/setup.sh [agent-dir] [workspace-dir]
set -euo pipefail
DIR="${1:-/tmp/pi-xray-demo}"
WORK="${2:-/tmp/pi-xray-demo-work}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$DIR" "$WORK"
mkdir -p "$DIR/skills" "$WORK/notes-app"

skill() {
	mkdir -p "$DIR/skills/$1"
	printf -- '---\nname: %s\ndescription: %s\n---\n\n# %s\n' "$1" "$2" "$1" >"$DIR/skills/$1/SKILL.md"
}
skill pdf-tools "Extract text and tables from PDF files. Use when reading, converting, or inspecting PDFs."
skill changelog-writer "Write release notes from git history. Use when preparing a release or a changelog entry."
skill sql-review "Review SQL queries for correctness and performance. Use when a query is slow or returns wrong rows."

cat >"$DIR/settings.json" <<JSON
{
  "packages": ["npm:pi-web-access", "npm:pi-subagents", "$REPO"],
  "quietStartup": true
}
JSON

cat >"$DIR/AGENTS.md" <<'MD'
# Personal preferences

- Answer in short paragraphs. Lead with the conclusion, then the evidence.
- Prefer small, reviewable diffs. Never reformat code you did not change.
- Run the relevant tests before saying something is fixed.
- Ask before running anything that deletes files or rewrites git history.
- Use conventional commits: type(scope): subject, imperative, under 60 chars.
MD

cat >"$WORK/CLAUDE.md" <<'MD'
# Workspace rules

All projects in this workspace are TypeScript apps that share one toolchain.

- Node 22, npm, strict TypeScript. No `any` in new code.
- Dates are stored as ISO instants plus an IANA time zone. Format them only when rendering.
- Tests use vitest. A change is done when `npm test` and `npx tsc --noEmit` both pass.
- Keep dependencies small: check what an existing package already does before adding one.
- Never commit generated files under dist/ or coverage/.
MD

cat >"$WORK/notes-app/AGENTS.md" <<'MD'
# notes-app

A local-first markdown notes app with full-text search and sync between devices.

## Layout

- src/notes: note model, front matter, file storage.
- src/search: index and ranking. Results sort by relevance, then by the note's local time.
- src/sync: merges edits from other devices; the newest copy of a note wins.
- src/dates: the only place that parses or compares dates (Temporal).
- src/export: markdown, HTML and PDF export.

## Working here

- `npm test` runs the whole suite (about 12 s). `npm test -- search` runs one area.
- Ranking rules are documented in docs/search.md; keep both in sync.
MD

# the session goes where pi looks for it: sessions/--<project path>--/, keyed by the
# real path (on macOS /tmp is a symlink to /private/tmp, and pi compares real paths)
PROJECT="$(cd "$WORK/notes-app" && pwd -P)"
SESSIONS="$DIR/sessions/--$(printf '%s' "${PROJECT#/}" | tr '/\\:' '---')--"
mkdir -p "$SESSIONS"
node "$REPO/demo/make-session.mjs" "$PROJECT" >"$SESSIONS/2026-10-14T15-00-00-000Z_demo.jsonl"

# reuse your provider login so the header shows a real model
[ -f "$HOME/.pi/agent/auth.json" ] && cp "$HOME/.pi/agent/auth.json" "$DIR/auth.json"
echo "demo ready. Run pi once so it installs the packages, then record:"
echo "  cd $PROJECT && PI_CODING_AGENT_DIR=$DIR pi --continue"
echo "  vhs demo/xray.tape"
