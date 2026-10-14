import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { allocate } from "../src/view/bar";
import { columns, fit, fitItems, titleBorder } from "../src/view/grid";
import { sanitize } from "../src/view/text";
import { CJK_NAME, EMOJI_NAME, LONG_NAME } from "./fixture";

const id = (_s: string, t: string) => t;
const ansi = (s: string, t: string) => `\x1b[3${s.length % 8}m${t}\x1b[39m`;

test("fit returns exactly w columns for hard inputs", () => {
	const inputs = ["", "abc", LONG_NAME, CJK_NAME, EMOJI_NAME, "tab\there", "line\nbreak", "\x1b[31mred\x1b[0m text", "ｗｉｄｅ全角", "e\u0301 combining"];
	for (const s of inputs)
		for (let w = 0; w <= 30; w++) {
			assert.equal(visibleWidth(fit(s, w)), w, `fit(${JSON.stringify(s)}, ${w})`);
			assert.equal(visibleWidth(fit(s, w, "right")), w);
		}
});

test("fit output is plain: no escape codes ever", () => {
	for (const s of [LONG_NAME, CJK_NAME, EMOJI_NAME, "\x1b[31mred\x1b[0m"]) for (let w = 0; w <= 12; w++) assert.ok(!fit(s, w).includes("\x1b"), `${s} @ ${w}`);
});

test("sanitize removes escapes and control chars", () => {
	assert.equal(sanitize("a\tb\nc\x1b[31md\x1b[0m\x07"), "a b cd");
});

test("columns: breakpoints and exact sum", () => {
	for (let width = 40; width <= 240; width++) {
		const inner = width - 2;
		const c = columns(inner);
		assert.equal(c.marker + c.kind + c.name + c.owner + c.tokens + c.pct + c.state, inner, `width ${width}`);
		assert.equal(c.owner > 0, width >= 100);
		assert.equal(c.pct > 0, width >= 80);
		assert.equal(c.kind > 0, width >= 60);
		assert.ok(c.name >= 10, `name column too small at ${width}`);
	}
});

test("titleBorder is exactly width, with and without room for the right part", () => {
	for (const width of [10, 20, 39, 40, 60, 80, 120]) {
		for (const paint of [id, ansi]) {
			const line = titleBorder(width, [["accent", "─ /xray ─ context · sources "]], [["dim", " filter: warnings ─"]], paint as any);
			assert.equal(visibleWidth(line), width);
		}
	}
});

test("fitItems drops whole items and truncates a single oversized one", () => {
	const items: any = [[["accent", "Esc"], ["dim", " close"]], [["accent", "space"], ["dim", " toggle"]], [["accent", "a"], ["dim", " apply"]]];
	for (let w = 0; w <= 60; w++) {
		const line = fitItems(items, ["dim", " · "], w, ansi as any);
		assert.equal(visibleWidth(line), w);
		assert.ok(!line.includes("…") || w < 10, "multi-item lines never cut an item");
	}
	const long: any = [[["warning", "un mensaje de estado muy largo que no cabe en una terminal angosta"]]];
	for (let w = 1; w <= 20; w++) assert.equal(visibleWidth(fitItems(long, ["dim", ""], w, ansi as any)), w);
});

test("allocate: cells always sum to width, non-empty segments get a cell", () => {
	const cases: Array<[number[], number]> = [
		[[2100, 650, 5800, 14300, 17800], 1_000_000],
		[[2100, 650, 5800, 14300, 17800], 200_000],
		[[1, 1, 1, 1, 1], 1_000_000],
		[[0, 0, 0, 0, 0], 1000],
		[[500, 500], 0],
		[[900, 900], 1000],
		[[NaN, -5, 10], 100],
	];
	for (const [vals, window] of cases)
		for (let w = 0; w <= 120; w += 7) {
			const cells = allocate(vals, window, w);
			assert.equal(cells.length, vals.length + 1);
			assert.equal(cells.reduce((a, c) => a + c, 0), w, `${vals} / ${window} @ ${w}`);
			assert.ok(cells.every((c) => c >= 0));
			const nonEmpty = vals.filter((v) => v > 0).length;
			if (w >= nonEmpty) vals.forEach((v, i) => v > 0 && assert.ok(cells[i] >= 1, `segment ${i} empty at ${w}`));
		}
});
