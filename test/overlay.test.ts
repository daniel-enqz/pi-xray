/**
 * Display contract tests: every render, at every size, returns exactly
 * `rows` lines of exactly `width` columns, with balanced escapes, and the
 * cursor visible on a selectable row.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildCatalog } from "../src/catalog";
import { type SetupResult, SetupView, type ThemeLike } from "../src/view/overlay";
import { MIN_HEIGHT } from "../src/view/grid";
import { FILTERS } from "../src/view/rows";
import { fixture } from "./fixture";

const WIDTHS = [39, 40, 59, 60, 79, 80, 99, 100, 140, 220];
const HEIGHTS = [10, MIN_HEIGHT - 1, MIN_HEIGHT, MIN_HEIGHT + 1, 24, 50];
const PLAIN: ThemeLike = { fg: (_c, t) => t, bg: (_c, t) => t };

function makeTheme(base: number): ThemeLike {
	const code = (c: string) => base + (c.length % 7);
	return {
		fg: (c, t) => `\x1b[${code(c)}m${t}\x1b[39m`,
		bg: (_c, t) => `\x1b[48;5;236m${t}\x1b[49m`,
	};
}

function make(opts: Parameters<typeof fixture>[0] = {}, rows = 24, theme = makeTheme(30)) {
	const { live, config, runtime } = fixture(opts);
	const catalog = buildCatalog(live, config, runtime);
	const tui = { terminal: { rows }, requestRender() {} };
	let result: SetupResult | undefined;
	const opened: string[] = [];
	const view = new SetupView(tui, theme, catalog, (r) => (result = r), { open: (p) => (opened.push(p), `opened ${p}`) });
	return { view, tui, catalog, result: () => result, opened };
}

function check(lines: string[], width: number, height: number, label: string) {
	assert.equal(lines.length, height, `${label}: line count`);
	lines.forEach((l, i) => {
		assert.equal(visibleWidth(l), width, `${label}: line ${i} width`);
		const opens = (l.match(/\x1b\[(3[0-8]|9\d|48;5;236)m/g) ?? []).length;
		const closes = (l.match(/\x1b\[(39|49)m/g) ?? []).length;
		assert.equal(opens, closes, `${label}: unbalanced escapes on line ${i}`);
		assert.ok(!/\x1b(?!\[)/.test(l), `${label}: stray ESC on line ${i}`);
		assert.ok(!l.includes("\x1b[0m"), `${label}: full reset on line ${i} (would cancel the selection background)`);
	});
}

const cursorVisible = (lines: string[]) => lines.some((l) => l.includes("›"));
const KEYS = { down: "\x1b[B", up: "\x1b[A", right: "\x1b[C", left: "\x1b[D", esc: "\x1b", enter: "\r", end: "G", home: "g", pgdn: "\x1b[6~" };
const type = (view: SetupView, text: string) => {
	view.handleInput("/");
	for (const ch of text) view.handleInput(ch);
	view.handleInput(KEYS.enter);
};
const filterTo = (view: SetupView, name: string) => {
	for (let i = 0; i < FILTERS.indexOf(name); i++) view.handleInput("f");
};

test("matrix: every size renders exact lines, collapsed and fully expanded", () => {
	for (const opts of [{}, { extraSkills: 500 }, { empty: true }, { window: 0 }, { usageTokens: 10 }, { hasTurn: false, usageTokens: 0 }])
		for (const height of HEIGHTS)
			for (const width of WIDTHS) {
				const { view } = make(opts, height);
				for (const state of ["collapsed", "expanded"]) {
					const lines = view.render(width);
					check(lines, width, height, `${JSON.stringify(opts)} ${width}x${height} ${state}`);
					if (width >= 40 && height >= MIN_HEIGHT && !(opts as any).empty) assert.ok(cursorVisible(lines), `cursor hidden ${width}x${height} ${state}`);
					view.handleInput("e");
				}
			}
});

test("starts collapsed: one row per group; e expands all groups", () => {
	const { view, catalog } = make({}, 50, PLAIN);
	const rows = () => (view as any).rows as any[];
	assert.equal(rows().length, catalog.groups.length);
	view.handleInput("e");
	assert.ok(rows().length > catalog.groups.length);
	view.handleInput("e");
	assert.equal(rows().length, catalog.groups.length);
});

test("cursor stays visible while walking the whole tree, at small and large heights", () => {
	for (const height of [MIN_HEIGHT, MIN_HEIGHT + 4, 40]) {
		const { view } = make({ extraSkills: 60 }, height);
		view.handleInput("e");
		// open the second level too, so the list gets long
		for (let i = 0; i < 30; i++) {
			view.handleInput(KEYS.right);
			view.handleInput(KEYS.down);
		}
		view.handleInput(KEYS.home);
		for (let i = 0; i < 150; i++) {
			const lines = view.render(100);
			check(lines, 100, height, `walk h${height} step ${i}`);
			assert.ok(cursorVisible(lines), `cursor hidden at step ${i} h${height}`);
			view.handleInput(KEYS.down);
		}
		for (let i = 0; i < 150; i++) {
			view.handleInput(KEYS.up);
			assert.ok(cursorVisible(view.render(100)));
		}
		view.handleInput(KEYS.end);
		assert.ok(cursorVisible(view.render(100)));
		view.handleInput(KEYS.pgdn);
		assert.ok(cursorVisible(view.render(100)));
	}
});

test("resize with the cursor at the bottom keeps it visible and lines exact", () => {
	const { view, tui } = make({ extraSkills: 80 }, 40);
	view.handleInput("e");
	view.handleInput(KEYS.end);
	for (const [w, h] of [
		[140, 40],
		[60, MIN_HEIGHT + 1],
		[140, 40],
		[45, MIN_HEIGHT],
		[220, 50],
	]) {
		tui.terminal.rows = h;
		const lines = view.render(w);
		check(lines, w, h, `resize ${w}x${h}`);
		assert.ok(cursorVisible(lines));
	}
});

test("theme change between renders leaves no old colors", () => {
	const { view } = make({}, 24);
	view.render(100);
	(view as any).theme = { fg: (_c: string, t: string) => `\x1b[95m${t}\x1b[39m`, bg: (_c: string, t: string) => `\x1b[48;5;236m${t}\x1b[49m` };
	assert.ok(view.render(100).every((l) => !/\x1b\[3[0-8]m/.test(l)), "a line kept a color from the previous theme");
});

test("usage card: rounded box with margin and padding; capped bar; blank line before the legend", () => {
	for (const width of [40, 60, 120, 220]) {
		const { view } = make({}, 30, PLAIN);
		const lines = view.render(width);
		const inner = width - 2;
		assert.equal(lines[1], `│${" ".repeat(inner)}│`, "margin above the card");
		assert.equal(lines[2], `│ ╭${"─".repeat(inner - 4)}╮ │`, "rounded top with 1 column of margin");
		assert.equal(lines[7], `│ ╰${"─".repeat(inner - 4)}╯ │`, "rounded bottom");
		assert.equal(lines[8], `│${" ".repeat(inner)}│`, "margin below the card");
		for (let i = 3; i <= 6; i++) assert.match(lines[i], /^│ │ {2}.* {2}│ │$/, `padding on card line ${i}`);
		assert.match(lines[3], /claude-opus-5-5/);
		const cells = (lines[4].match(/[█░]/g) ?? []).length;
		assert.ok(cells <= 48 && cells >= Math.min(48, width - 10), `bar has ${cells} cells at ${width}`);
		assert.match(lines[5], /^│ │ +│ │$/, "blank line after the bar");
		assert.match(lines[6], / base /, "legend after the blank line");
		assert.match(lines[9], /type|name/, "column header right after the margin");
	}
});

test("cursor only lands on selectable rows", () => {
	const { view } = make({}, 30);
	view.handleInput("e");
	for (let i = 0; i < 40; i++) {
		const v = view as any;
		assert.ok(v.rows[v.cursor]?.selectable, `cursor on non-selectable row at step ${i}`);
		view.handleInput(KEYS.down);
	}
});

test("toggle a skill, apply returns the change", () => {
	const { view, result } = make({}, 30, PLAIN);
	type(view, "release-orch");
	view.handleInput(KEYS.home);
	view.handleInput(KEYS.down); // from the package row to the skill
	view.handleInput(" ");
	assert.match(view.render(100).join("\n"), /1 pending change/);
	view.handleInput("a");
	const r = result();
	assert.equal(r?.action, "apply");
	assert.deepEqual((r as any).changes.map((c: any) => c[1]), [false]);
});

test("toggle twice clears the pending change", () => {
	const { view } = make({}, 30, PLAIN);
	type(view, "release-orch");
	view.handleInput(KEYS.home);
	view.handleInput(KEYS.down);
	view.handleInput(" ");
	view.handleInput(" ");
	assert.doesNotMatch(view.render(100).join("\n"), /pending/);
});

test("space on a package cascades; Esc with pending asks first; second Esc closes", () => {
	const { view, result } = make({}, 30, PLAIN);
	type(view, "release-kit");
	view.handleInput(KEYS.home);
	view.handleInput(" ");
	assert.match(view.render(100).join("\n"), /2 pending changes/);
	view.handleInput(KEYS.esc); // clears the search first
	view.handleInput(KEYS.esc);
	assert.equal(result(), undefined);
	assert.match(view.render(100).join("\n"), /unsaved changes/);
	view.handleInput(KEYS.esc);
	assert.equal(result()?.action, "close");
});

test("groups that are not packages cannot be toggled as a whole", () => {
	const { view } = make({}, 30, PLAIN);
	type(view, "~/.pi/agent");
	view.handleInput(KEYS.home);
	view.handleInput(" ");
	assert.match(view.render(120).join("\n"), /can't be toggled as a whole/);
});

test("the /xray extension cannot turn itself off", () => {
	const { view } = make({}, 40, PLAIN);
	type(view, "pi-setup");
	view.handleInput(KEYS.end);
	view.handleInput(" ");
	assert.match(view.render(120).join("\n"), /can't turn itself off/);
});

test("MCP is read-only and Enter hands over to /mcp", () => {
	const { view, result } = make({}, 40, PLAIN);
	filterTo(view, "mcp");
	assert.match(view.render(100)[0], /filter: mcp/);
	view.handleInput(KEYS.down);
	view.handleInput(" ");
	assert.match(view.render(100).join("\n"), /read-only/);
	view.handleInput(KEYS.enter);
	assert.equal(result()?.action, "mcp");
});

test("MCP mode is visible in the origin column, and next to the name when that column is hidden", () => {
	for (const width of [120, 80, 50]) {
		const { view } = make({}, 40, PLAIN);
		filterTo(view, "mcp");
		const lines = view.render(width);
		const row = (name: string) => lines.find((l) => new RegExp(`[ +-] ${name}( |\\()`).test(l)) ?? "";
		assert.match(row("atlassian"), /proxy/, `atlassian @${width}`);
		assert.match(row("databricks-sql"), /direct/, `databricks @${width}`);
		assert.match(row("miro-mcp"), /disabled/, `miro @${width}`);
	}
});

test("tools filter shows tools under their owners", () => {
	const { view } = make({}, 50, PLAIN);
	filterTo(view, "tools");
	const text = view.render(120).join("\n");
	for (const t of ["databricks-sql_execute_sql", "mcp__atlassian", "training", "read"]) assert.match(text, new RegExp(t), t);
	assert.doesNotMatch(text, /anti-slop/);
});

test("Enter opens files without closing; Enter on a group expands it", () => {
	const { view, result, opened } = make({}, 30, PLAIN);
	type(view, "anti-slop");
	view.handleInput(KEYS.home);
	view.handleInput(KEYS.down);
	view.handleInput(KEYS.enter);
	assert.equal(result(), undefined);
	assert.equal(opened.length, 1);
	view.handleInput(KEYS.esc);
	view.handleInput(KEYS.home);
	const before = (view as any).rows.length;
	view.handleInput(KEYS.enter);
	assert.ok((view as any).rows.length > before, "Enter on a collapsed group expands it");
});

test("search with no matches shows a note, Esc clears it", () => {
	const { view } = make({}, 24, PLAIN);
	view.handleInput("/");
	for (const ch of "zzzz-nothing") view.handleInput(ch);
	assert.match(view.render(80).join("\n"), /No matches/);
	view.handleInput(KEYS.esc);
	assert.doesNotMatch(view.render(80).join("\n"), /No matches/);
});

test("too small terminal shows a message instead of the table", () => {
	const { view, tui } = make({}, 8);
	tui.terminal.rows = 8;
	const lines = view.render(30);
	check(lines, 30, 8, "too small");
	assert.match(lines.join("\n"), /needs/);
});
