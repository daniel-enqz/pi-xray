#!/usr/bin/env bash
# Builds a throwaway pi setup for recording the demo, so no personal
# configuration shows up in it:
#   $DIR            agent dir: 3 sample skills, 3 packages, a global AGENTS.md
#   $WORK/          workspace with a CLAUDE.md
#   $WORK/acme-api  sample project with its own AGENTS.md
#   a short debugging session with heavy tool results, opened with `pi --continue`
# Usage: [DEMO_MODEL=provider/model] demo/setup.sh [agent-dir] [workspace-dir]
set -euo pipefail
DIR="${1:-/tmp/pi-xray-demo}"
WORK="${2:-/tmp/pi-xray-demo-work}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$DIR" "$WORK"
mkdir -p "$DIR/skills" "$WORK/acme-api"

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

All projects in this workspace are TypeScript services deployed on the same platform.

- Node 22, pnpm or npm, strict TypeScript. No `any` in new code.
- Money is always integer cents. Convert to display units only at the edge (API responses, emails).
- Every service exposes /health and /ready and logs JSON to stdout.
- Feature flags live in config/flags.ts; never read env vars for flags directly.
- Secrets come from the secret manager; .env files are for local development only and are never committed.
MD

cat >"$WORK/acme-api/AGENTS.md" <<'MD'
# acme-api

Checkout and order API for the Acme store.

## Layout

- src/pricing: discounts, quotes and money helpers. Amounts in cents since #412.
- src/checkout: turns a cart into a priced order.
- src/orders, src/payments, src/shipping, src/taxes: one folder per domain.
- src/webhooks: Stripe and carrier callbacks.

## Working here

- `npm test` runs the whole suite (about 15 s). `npm test -- checkout` runs one domain.
- Discount rules are documented in docs/pricing.md; keep both in sync.
- Do not touch src/payments without a second reviewer.
MD

# the session goes where pi looks for it: sessions/--<project path>--/, keyed by the
# real path (on macOS /tmp is a symlink to /private/tmp, and pi compares real paths)
PROJECT="$(cd "$WORK/acme-api" && pwd -P)"
SESSIONS="$DIR/sessions/--$(printf '%s' "${PROJECT#/}" | tr '/\\:' '---')--"
mkdir -p "$SESSIONS"
node "$REPO/demo/make-session.mjs" "$PROJECT" >"$SESSIONS/2026-10-14T15-00-00-000Z_demo.jsonl"

# reuse your provider login so the header shows a real model
[ -f "$HOME/.pi/agent/auth.json" ] && cp "$HOME/.pi/agent/auth.json" "$DIR/auth.json"
echo "demo ready. Run pi once so it installs the packages, then record:"
echo "  cd $PROJECT && PI_CODING_AGENT_DIR=$DIR pi --continue"
echo "  vhs demo/xray.tape"
