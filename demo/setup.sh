#!/usr/bin/env bash
# Builds a throwaway pi agent dir for recording the demo, so no personal
# configuration shows up in it. Usage: demo/setup.sh [dir]
set -euo pipefail
DIR="${1:-/tmp/pi-xray-demo}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$DIR"
mkdir -p "$DIR/skills"
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
# reuse your provider login so the header shows a real model
[ -f "$HOME/.pi/agent/auth.json" ] && cp "$HOME/.pi/agent/auth.json" "$DIR/auth.json"
echo "demo agent dir ready: PI_CODING_AGENT_DIR=$DIR pi --no-session"
