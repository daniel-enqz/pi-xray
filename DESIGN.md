# Design notes

## Data

`/xray` builds one catalog from three layers and joins them by realpath, since most of `~/.pi/agent` tends to be symlinks:

| Layer | Source | Answers |
|---|---|---|
| live | `ctx.getSystemPromptOptions()`, `ctx.getSystemPrompt()`, active tools, `ctx.getContextUsage()`, session context entries | what is in the context window now, and how big it is |
| config | `DefaultPackageManager.resolve()` with `onMissing: "skip"` | what is installed and what loads after a reload |
| runtime | `pi-mcp-adapter/status/v1` event, `loadSkills().diagnostics` | MCP state, load warnings |

`resolve()` installs missing packages unless `onMissing` returns `"skip"`. Never call it without that callback.

The catalog is a tree: group, then resource, then tool. Every token belongs to exactly one group. Tools of an MCP server hang from the server, and `pi-mcp-adapter` keeps only its `mcp` gateway, so the groups plus the base prompt add up to the total. `test/catalog.test.ts` checks that invariant.

## Writing settings

`src/writer.ts` reproduces what `pi config` writes:

- a string package entry becomes `{ source }`;
- earlier `+`, `-` or `!` entries for the same pattern are removed;
- `+pattern` or `-pattern` is appended;
- the object goes back to a string when no filters remain.

`test/writer.test.ts` drives pi's own `ConfigSelectorComponent` and compares both results, so a change in pi's format fails CI. Writes go through `SettingsManager`, which locks the file and only persists the keys it changed, and keeps `settings.json` a symlink when it is one.

## Rendering rules

Each rule has a test in `test/overlay.test.ts` or `test/grid.test.ts`.

1. The overlay opens with `width: "100%"`, `maxHeight: "100%"`, `margin: 0`, and renders exactly the `width` pi-tui passes to `render()`. It never reads `process.stdout.columns`. A margin leaves columns where the transcript shows through.
2. `render()` returns exactly `tui.terminal.rows` lines, recomputed every frame, so resizing with the overlay open works.
3. Every line measures exactly `width`. Rows are built from cells; each cell is plain text truncated and padded before it is painted.
4. Truncation is done by graphemes on plain text. pi-tui's `truncateToWidth` with an ellipsis inserts full `\x1b[0m` resets, which cancel the selected-row background. No line may contain `\x1b[0m`.
5. Data carries no colors. The theme is applied inside `render()`, so a theme change never leaves old colors behind.
6. The selected row is painted per cell with the `selectedBg` background, plus a marker in a fixed two-column slot every row has.
7. Only resource rows can hold the cursor.
8. Chrome uses glyphs that are one column wide everywhere. No `⚠` or `▶`: both have emoji variants that take two columns in some terminals.
9. Columns hide by priority: below 100 columns the source column goes (its text moves next to the name for MCP rows), below 80 the percentage, below 60 the type.
10. The bar splits its cells with the largest remainder method, so segments always add up to the bar width, and every non-empty segment gets at least one cell.
11. Hidden rows are announced inside the frame (`↑ 3 more`, `↓ 12 more`).
12. Footer hints are dropped whole, from the right, when they do not fit.

Tabs count as three columns in pi-tui, so all text goes through `sanitize()` first: escapes and control characters are removed, and tabs and newlines become spaces.
