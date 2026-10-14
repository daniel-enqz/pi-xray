/**
 * Layout primitives. Pure functions of (plain text, width): no theme, no state.
 *
 * Contract:
 *  - every cell is plain text, truncated and padded to an exact visible width
 *    BEFORE it is painted, so ANSI sequences are never cut;
 *  - every line returned by a helper here measures exactly `width` columns;
 *  - only glyphs from GLYPHS are used for chrome.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { sanitize } from "./text";

export type Style =
	| "text"
	| "dim"
	| "muted"
	| "accent"
	| "success"
	| "warning"
	| "error"
	| "border"
	| "borderMuted"
	| "syntaxType"
	| "syntaxString";

/** Paints one already-sized plain segment. Must not change its visible width. */
export type Paint = (style: Style, text: string) => string;

export const GLYPHS = {
	tl: "╭",
	tr: "╮",
	bl: "╰",
	br: "╯",
	v: "│",
	h: "─",
	lt: "├",
	rt: "┤",
	full: "█",
	empty: "░",
	cursor: "›",
	ellipsis: "…",
	pending: "↻",
	ok: "✓",
	warn: "!",
	mixed: "~",
	up: "↑",
	down: "↓",
} as const;

export const MIN_WIDTH = 40;
/** chrome is 14 lines; 17 leaves room for one row plus both scroll indicators */
export const MIN_HEIGHT = 17;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Keep whole graphemes while they fit in `w` columns. Plain in, plain out. */
function cut(s: string, w: number): string {
	let out = "";
	let used = 0;
	for (const { segment } of graphemes.segment(s)) {
		const gw = visibleWidth(segment);
		if (used + gw > w) break;
		out += segment;
		used += gw;
	}
	return out;
}

/**
 * Truncate + pad plain text to exactly `w` columns. Never emits escape codes
 * (pi-tui's truncateToWidth adds full resets around the ellipsis, which would
 * cancel the selected-row background).
 */
export function fit(text: string, w: number, align: "left" | "right" = "left"): string {
	if (w <= 0) return "";
	let s = sanitize(text);
	if (visibleWidth(s) > w) s = cut(s, w - 1) + GLYPHS.ellipsis;
	const pad = " ".repeat(Math.max(0, w - visibleWidth(s)));
	return align === "right" ? pad + s : s + pad;
}

export interface Segment {
	text: string;
	width: number;
	style: Style;
	align?: "left" | "right";
}

/** Compose sized segments into one painted string of exactly sum(widths). */
export function compose(segments: Segment[], paint: Paint): string {
	return segments.map((s) => paint(s.style, fit(s.text, s.width, s.align))).join("");
}

export interface Columns {
	marker: number;
	kind: number;
	name: number;
	owner: number;
	tokens: number;
	pct: number;
	state: number;
}

/**
 * Responsive columns for an inner width (frame excluded). Breakpoints are
 * expressed on the full width: >=100 all, 80-99 no owner, 60-79 no owner/pct,
 * 40-59 marker+name+tokens+state.
 */
export function columns(inner: number): Columns {
	const full = inner + 2;
	const marker = 2;
	const tokens = 7;
	const state = 4;
	const kind = full >= 60 ? 8 : 0;
	const pct = full >= 80 ? 7 : 0;
	let name = Math.max(1, inner - marker - kind - tokens - pct - state);
	let owner = 0;
	if (full >= 100) {
		owner = Math.min(26, Math.floor(name * 0.4));
		name -= owner;
	}
	return { marker, kind, name, owner, tokens, pct, state };
}

/** "╭─ left ───────── right ─╮" of exactly `width`. Parts are [style, plain]. */
export function titleBorder(width: number, left: Array<[Style, string]>, right: Array<[Style, string]>, paint: Paint): string {
	const inner = Math.max(0, width - 2);
	const lw = left.reduce((a, [, t]) => a + visibleWidth(sanitize(t)), 0);
	const rw = right.reduce((a, [, t]) => a + visibleWidth(sanitize(t)), 0);
	const paintParts = (parts: Array<[Style, string]>, budget: number) => {
		let out = "";
		let used = 0;
		for (const [style, t] of parts) {
			const plain = sanitize(t);
			const w = Math.min(visibleWidth(plain), budget - used);
			if (w <= 0) break;
			out += paint(style, fit(plain, w));
			used += w;
		}
		return { out, used };
	};
	let body: string;
	if (lw + rw + 1 <= inner) {
		const l = paintParts(left, lw);
		const r = paintParts(right, rw);
		body = l.out + paint("border", GLYPHS.h.repeat(inner - lw - rw)) + r.out;
	} else {
		const l = paintParts(left, inner);
		body = l.out + paint("border", GLYPHS.h.repeat(inner - l.used));
	}
	return paint("border", GLYPHS.tl) + body + paint("border", GLYPHS.tr);
}

export function plainBorder(width: number, kind: "bottom" | "separator", paint: Paint): string {
	const inner = Math.max(0, width - 2);
	const [l, r] = kind === "bottom" ? [GLYPHS.bl, GLYPHS.br] : [GLYPHS.lt, GLYPHS.rt];
	return paint("border", l + GLYPHS.h.repeat(inner) + r);
}

/** Wrap an inner string (already exactly inner wide) with the side borders. */
export function framed(content: string, paint: Paint): string {
	return paint("border", GLYPHS.v) + content + paint("border", GLYPHS.v);
}

/**
 * Join items ("key label") with a separator, dropping items from the end until
 * the whole line fits `width`. Items are never cut in half.
 */
export function fitItems(items: Array<Array<[Style, string]>>, sep: [Style, string], width: number, paint: Paint): string {
	const widthOf = (parts: Array<[Style, string]>) => parts.reduce((a, [, t]) => a + visibleWidth(sanitize(t)), 0);
	const sepW = visibleWidth(sep[1]);
	let kept = items.length;
	const total = (n: number) => items.slice(0, n).reduce((a, it) => a + widthOf(it), 0) + Math.max(0, n - 1) * sepW;
	while (kept > 0 && total(kept) > width) kept--;
	if (kept === 0 && items.length && width > 0) {
		// not even the first item fits: truncate it instead of dropping it
		let out = "";
		let used = 0;
		for (const [style, t] of items[0]) {
			const plain = sanitize(t);
			const w = Math.min(visibleWidth(plain), width - used);
			if (w <= 0) break;
			const cut = used + visibleWidth(plain) > width;
			out += paint(style, fit(plain, w));
			used += w;
			if (cut) break;
		}
		return out + " ".repeat(Math.max(0, width - used));
	}
	let out = "";
	items.slice(0, kept).forEach((parts, i) => {
		if (i > 0) out += paint(sep[0], sep[1]);
		for (const [style, t] of parts) out += paint(style, sanitize(t));
	});
	return out + " ".repeat(Math.max(0, width - total(kept)));
}
