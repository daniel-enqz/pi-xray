/**
 * The /xray overlay: one view. Header = context usage; body = tree of groups
 * (sorted by tokens) -> resources -> tools. Owns input, scroll and footer;
 * paints rows with the theme.
 *
 * Render contract (see DESIGN.md):
 *  - returns exactly `tui.terminal.rows` lines, each exactly `width` columns;
 *  - stores no colored strings: everything is painted inside render();
 *  - the cursor only lands on selectable rows.
 */
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Catalog } from "../catalog";
import { allocate } from "./bar";
import {
	type Paint,
	type Segment,
	type Style,
	GLYPHS,
	MIN_HEIGHT,
	MIN_WIDTH,
	columns,
	compose,
	fit,
	fitItems,
	framed,
	plainBorder,
	titleBorder,
} from "./grid";
import { type ResourceRow, type Row, type State, type ViewState, FILTERS, buildRows, toggleEffect } from "./rows";
import { human, percent, sanitize } from "./text";

export type SetupResult = { action: "close" } | { action: "apply"; changes: Array<[string, boolean]> } | { action: "mcp" };

export interface ThemeLike {
	fg(color: any, text: string): string;
	bg(color: any, text: string): string;
}

export interface TuiLike {
	terminal: { rows: number };
	requestRender(): void;
}

export interface ViewDeps {
	/** open a file in an editor pane; returns a message for the status line */
	open(path: string): string;
}

/** usage card: margin above, top border, 4 content lines, bottom border, margin below */
const HEADER_LINES = 8;
const CARD_MARGIN = 1;
const CARD_PADDING = 2;
/** the usage bar does not stretch to the full width: it reads as a gauge, not a rule */
const BAR_MAX = 48;
const CHROME = 1 + HEADER_LINES + 1 + 4; // top + header + column header + (sep, status, keys, bottom)

const CATEGORY_STYLE: Record<string, Style> = {
	base: "muted",
	memory: "syntaxType",
	skills: "accent",
	tools: "warning",
	messages: "success",
};

const STATE_GLYPH: Record<State, [Style, string]> = {
	on: ["success", GLYPHS.ok],
	off: ["dim", " "],
	entering: ["accent", GLYPHS.pending],
	leaving: ["warning", GLYPHS.pending],
	mixed: ["accent", GLYPHS.mixed],
	none: ["dim", " "],
};

export class SetupView {
	focused = false;
	private st: ViewState = { filter: "all", query: "", expanded: new Set(), pending: new Map() };
	private rows: Row[] = [];
	private cursor = -1;
	private top = 0;
	private searching = false;
	private confirmExit = false;
	private flash = "";

	constructor(
		private tui: TuiLike,
		private theme: ThemeLike,
		private catalog: Catalog,
		private done: (r: SetupResult) => void,
		private deps: ViewDeps,
	) {
		this.rebuild();
	}

	// ---------------- state ----------------

	private rebuild(keepKey?: string): void {
		const prevIndex = this.cursor;
		this.rows = buildRows(this.catalog, this.st);
		const selectable = this.selectable();
		if (!selectable.length) {
			this.cursor = -1;
			return;
		}
		if (keepKey) {
			const i = this.rows.findIndex((r) => r.type === "resource" && r.key === keepKey);
			if (i >= 0) {
				this.cursor = i;
				return;
			}
		}
		this.cursor = selectable.find((i) => i >= Math.max(0, prevIndex)) ?? selectable[selectable.length - 1];
	}

	private selectable(): number[] {
		return this.rows.map((r, i) => (r.selectable ? i : -1)).filter((i) => i >= 0);
	}

	private current(): ResourceRow | undefined {
		const r = this.rows[this.cursor];
		return r && r.type === "resource" ? r : undefined;
	}

	private move(delta: number): void {
		const selectable = this.selectable();
		if (!selectable.length) return;
		const pos = Math.max(0, selectable.indexOf(this.cursor));
		this.cursor = selectable[Math.max(0, Math.min(selectable.length - 1, pos + delta))];
	}

	private moveTo(edge: "first" | "last"): void {
		const selectable = this.selectable();
		if (selectable.length) this.cursor = edge === "first" ? selectable[0] : selectable[selectable.length - 1];
	}

	private bodyCapacity(): number {
		return Math.max(1, this.tui.terminal.rows - CHROME);
	}

	private toolsOf(id: string): number {
		return this.catalog.resources.get(id)?.children.length ?? 0;
	}

	private toggle(): void {
		const row = this.current();
		if (!row) return;
		const effect = toggleEffect(this.catalog, row, this.st);
		if (typeof effect === "string") {
			this.flash = effect;
			return;
		}
		let removedTools = 0;
		for (const [id, value] of effect) {
			const r = this.catalog.resources.get(id);
			if (!r) continue;
			if (value === r.enabled) this.st.pending.delete(id);
			else this.st.pending.set(id, value);
			if (!value && r.kind === "extension") removedTools += this.toolsOf(id);
		}
		if (removedTools) this.flash = `applying removes ${removedTools} tools from the context`;
	}

	/** tokens that leave the context after applying (extensions already include their tools) */
	private pendingDelta(): number {
		let delta = 0;
		for (const [id, value] of this.st.pending) {
			const r = this.catalog.resources.get(id);
			if (r && r.loaded && !value) delta -= r.tokens;
		}
		return delta;
	}

	// ---------------- input ----------------

	handleInput(data: string): void {
		if (this.searching) {
			if (matchesKey(data, "escape")) {
				this.st.query = "";
				this.searching = false;
			} else if (matchesKey(data, "return")) {
				this.searching = false;
			} else if (matchesKey(data, "backspace")) {
				this.st.query = Array.from(this.st.query).slice(0, -1).join("");
			} else if (data.length > 0 && sanitize(data) === data) {
				this.st.query += data;
			}
			this.top = 0;
			this.rebuild(this.current()?.key);
			this.tui.requestRender();
			return;
		}

		this.flash = "";
		if (this.confirmExit) {
			this.confirmExit = false;
			if (data === "a") return this.apply();
			if (data === "u") {
				this.st.pending.clear();
				this.rebuild(this.current()?.key);
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "escape") || data === "q") return this.done({ action: "close" });
		}

		const page = Math.max(1, this.bodyCapacity() - 2);
		if (matchesKey(data, "escape") || data === "q") {
			if (this.st.query) this.st.query = "";
			else if (this.st.pending.size) this.confirmExit = true;
			else return this.done({ action: "close" });
		} else if (matchesKey(data, "up") || data === "k") this.move(-1);
		else if (matchesKey(data, "down") || data === "j") this.move(1);
		else if (matchesKey(data, "pageUp")) this.move(-page);
		else if (matchesKey(data, "pageDown")) this.move(page);
		else if (matchesKey(data, "home") || data === "g") this.moveTo("first");
		else if (matchesKey(data, "end") || data === "G") this.moveTo("last");
		else if (matchesKey(data, "right") || data === "l") {
			const row = this.current();
			if (row?.expandable) this.st.expanded.add(row.key);
		} else if (matchesKey(data, "left") || data === "h") {
			const row = this.current();
			if (row?.expandable && row.expanded) this.st.expanded.delete(row.key);
			else if (row?.parentKey) {
				this.rebuild(row.parentKey);
				this.tui.requestRender();
				return;
			}
		} else if (matchesKey(data, "space")) this.toggle();
		else if (data === "a") {
			if (this.st.pending.size) return this.apply();
			this.flash = "no pending changes";
		} else if (data === "u") this.st.pending.clear();
		else if (data === "/") this.searching = true;
		else if (data === "f") {
			this.st.filter = FILTERS[(FILTERS.indexOf(this.st.filter) + 1) % FILTERS.length];
			this.top = 0;
		} else if (data === "e") {
			// expand or collapse every group
			const groups = this.rows.filter((r): r is ResourceRow => r.type === "resource" && r.depth === 0 && r.expandable);
			const allOpen = groups.every((g) => g.expanded);
			for (const g of groups) allOpen ? this.st.expanded.delete(g.key) : this.st.expanded.add(g.key);
		} else if (matchesKey(data, "return")) {
			const row = this.current();
			if (row?.mcp) return this.done({ action: "mcp" });
			if (row?.openPath) this.flash = this.deps.open(row.openPath);
			else if (row?.expandable) {
				if (row.expanded) this.st.expanded.delete(row.key);
				else this.st.expanded.add(row.key);
			}
		} else return;

		this.rebuild(this.current()?.key);
		this.tui.requestRender();
	}

	private apply(): void {
		this.done({ action: "apply", changes: [...this.st.pending.entries()] });
	}

	// ---------------- render ----------------

	render(width: number): string[] {
		const height = Math.max(0, this.tui.terminal.rows);
		if (width < MIN_WIDTH || height < MIN_HEIGHT) return this.tooSmall(width, height);

		const th = this.theme;
		const p: Paint = (s, t) => th.fg(s, t);
		const sel: Paint = (s, t) => th.bg("selectedBg", th.fg(s, t));
		const inner = width - 2;
		const out: string[] = [];

		out.push(this.topBorder(width, p));
		for (const line of this.headerLines(inner, p)) out.push(framed(line, p));
		out.push(framed(this.columnHeader(inner, p), p));

		// ---- body with scroll indicators ----
		const cap = this.bodyCapacity();
		const total = this.rows.length;
		const firstSelectable = this.rows.findIndex((r) => r.selectable);
		let start = Math.max(0, Math.min(this.top, total));
		const windowFor = (s: number) => {
			const up = s > 0;
			let avail = cap - (up ? 1 : 0);
			const down = s + avail < total;
			if (down) avail -= 1;
			return { up, down, avail: Math.max(1, avail) };
		};
		if (total <= cap) start = 0;
		else {
			for (let i = 0; i < 4; i++) {
				const { avail } = windowFor(start);
				if (this.cursor >= 0 && this.cursor < start) start = this.cursor;
				else if (this.cursor >= start + avail) start = this.cursor - avail + 1;
				else break;
			}
			if (this.cursor === firstSelectable) start = 0;
			start = Math.min(start, Math.max(0, total - (cap - 1)));
		}
		this.top = start;
		const win = windowFor(start);
		const body: string[] = [];
		if (win.up) body.push(framed(this.indicator(inner, `${GLYPHS.up} ${start} more`, p), p));
		const end = Math.min(total, start + win.avail);
		for (let i = start; i < end; i++) {
			const isCursor = i === this.cursor;
			body.push(framed(this.renderRow(this.rows[i], inner, isCursor ? sel : p, isCursor), p));
		}
		if (win.down && end < total) body.push(framed(this.indicator(inner, `${GLYPHS.down} ${total - end} more`, p), p));
		while (body.length < cap) body.push(framed(" ".repeat(inner), p));
		out.push(...body.slice(0, cap));

		// ---- footer ----
		out.push(plainBorder(width, "separator", p));
		out.push(framed(" " + fitItems(this.statusItems(), ["dim", "   "], inner - 1, p), p));
		out.push(framed(" " + fitItems(this.keyItems(), ["dim", " · "], inner - 1, p), p));
		out.push(plainBorder(width, "bottom", p));
		return out;
	}

	private tooSmall(width: number, height: number): string[] {
		const w = Math.max(0, width);
		const lines = Array.from({ length: height }, () => " ".repeat(w));
		if (height > 0 && w > 0) {
			const msg = fit(`/xray needs ${MIN_WIDTH}x${MIN_HEIGHT} (got ${width}x${height}) · Esc`, w).trimEnd();
			const left = Math.max(0, Math.floor((w - visibleWidth(msg)) / 2));
			lines[Math.floor(height / 2)] = fit(" ".repeat(left) + msg, w);
		}
		return lines;
	}

	private topBorder(width: number, p: Paint): string {
		const left: Array<[Style, string]> = [
			["border", `${GLYPHS.h} `],
			["accent", "/xray"],
			["border", " "],
		];
		const right: Array<[Style, string]> = [
			["border", " "],
			["dim", "filter: "],
			[this.st.filter === "all" ? "dim" : "accent", this.st.filter],
			["border", ` ${GLYPHS.h}`],
		];
		return titleBorder(width, left, right, p);
	}

	private headerLines(inner: number, p: Paint): string[] {
		const h = this.catalog.header;
		const c = this.catalog.counts;
		const cardW = inner - 2 * CARD_MARGIN;
		const w = Math.max(1, cardW - 2 - 2 * CARD_PADDING); // content width inside the card
		const summary: Array<Array<[Style, string]>> = [
			[["text", h.model]],
			[
				["text", `${h.estimated ? "≈ " : ""}${human(h.total)}`],
				["dim", ` / ${human(h.window)}`],
			],
			[["text", percent(h.total, h.window)]],
			[["dim", `${h.messages.user + h.messages.assistant} msgs`]],
			[["dim", `$${h.messages.cost.toFixed(2)}`]],
		];
		if (h.estimated) summary.push([["warning", "estimate"]]);
		summary.push([["dim", `${c.packages} packages`]], [["dim", `${c.skills} skills`]], [["dim", `${c.extensions} extensions`]]);

		const barW = Math.max(1, Math.min(BAR_MAX, w));
		const cells = allocate(
			h.categories.map((x) => x.tokens),
			h.window,
			barW,
		);
		let bar = "";
		h.categories.forEach((x, i) => {
			if (cells[i] > 0) bar += p(CATEGORY_STYLE[x.key] ?? "text", GLYPHS.full.repeat(cells[i]));
		});
		bar += p("dim", GLYPHS.empty.repeat(cells[cells.length - 1]));

		const legend = h.categories.map(
			(x) =>
				[
					[CATEGORY_STYLE[x.key] ?? "text", GLYPHS.full],
					["dim", ` ${x.label} `],
					["text", human(x.tokens)],
				] as Array<[Style, string]>,
		);
		legend.push([
			["dim", GLYPHS.empty],
			["dim", ` free ${human(Math.max(0, h.window - h.total))}`],
		]);
		const content = [fitItems(summary, ["dim", " · "], w, p), bar + " ".repeat(w - barW), " ".repeat(w), fitItems(legend, ["dim", "  "], w, p)];
		const margin = " ".repeat(CARD_MARGIN);
		const pad = " ".repeat(CARD_PADDING);
		const edge = (l: string, r: string) => margin + p("borderMuted", l + GLYPHS.h.repeat(cardW - 2) + r) + margin;
		return [
			" ".repeat(inner),
			edge(GLYPHS.tl, GLYPHS.tr),
			...content.map((line) => margin + p("borderMuted", GLYPHS.v) + pad + line + pad + p("borderMuted", GLYPHS.v) + margin),
			edge(GLYPHS.bl, GLYPHS.br),
			" ".repeat(inner),
		];
	}

	private columnHeader(inner: number, p: Paint): string {
		const c = columns(inner);
		const segs: Segment[] = [{ text: "", width: c.marker, style: "dim" }];
		if (c.kind) segs.push({ text: "type", width: c.kind, style: "dim" });
		segs.push({ text: "name", width: c.name, style: "dim" });
		if (c.owner) segs.push({ text: "source", width: c.owner, style: "dim" });
		segs.push({ text: "tokens ", width: c.tokens, style: "dim", align: "right" });
		if (c.pct) segs.push({ text: "% ", width: c.pct, style: "dim", align: "right" });
		segs.push({ text: "", width: c.state, style: "dim" });
		return compose(segs, p);
	}

	private indicator(inner: number, text: string, p: Paint): string {
		return compose([{ text: `  ${text}`, width: inner, style: "dim" }], p);
	}

	private renderRow(row: Row, inner: number, paint: Paint, isCursor: boolean): string {
		if (row.type !== "resource") return compose([{ text: ` ${row.text}`, width: inner, style: "dim" }], paint);
		const c = columns(inner);
		const indent = "  ".repeat(row.depth);
		const fold = row.expandable ? (row.expanded ? "- " : "+ ") : row.depth > 0 ? "  " : "";
		const nameText = indent + fold + row.name;
		const nameStyle: Style = row.pending ? "accent" : row.dim ? "dim" : "text";
		const [stStyle, stGlyph] = STATE_GLYPH[row.state];
		const segs: Segment[] = [{ text: isCursor ? `${GLYPHS.cursor} ` : "  ", width: c.marker, style: "accent" }];
		if (c.kind) segs.push({ text: row.kind, width: c.kind, style: row.depth === 0 ? "accent" : "dim" });
		if (!c.owner && row.detail) {
			// origin column hidden: keep the detail next to the name
			const nameW = Math.min(visibleWidth(sanitize(nameText)), c.name - 1);
			segs.push({ text: nameText, width: nameW, style: nameStyle });
			segs.push({ text: `  ${row.detail}`, width: c.name - 1 - nameW, style: "muted" });
		} else segs.push({ text: nameText, width: c.name - 1, style: nameStyle });
		segs.push({ text: " ", width: 1, style: "dim" });
		if (c.owner) segs.push({ text: row.detail ?? row.owner, width: c.owner, style: "muted" });
		segs.push({ text: row.tokens != null ? `${human(row.tokens)} ` : "", width: c.tokens, style: row.dim ? "dim" : "text", align: "right" });
		if (c.pct) segs.push({ text: row.pct != null ? `${percent(row.pct, 1)} ` : "", width: c.pct, style: "dim", align: "right" });
		segs.push({ text: " ", width: 1, style: "dim" });
		segs.push({ text: row.warn ? GLYPHS.warn : " ", width: 1, style: "warning" });
		segs.push({ text: " ", width: 1, style: "dim" });
		segs.push({ text: stGlyph, width: 1, style: stStyle });
		return compose(segs, paint);
	}

	private statusItems(): Array<Array<[Style, string]>> {
		if (this.confirmExit)
			return [
				[
					["warning", "unsaved changes · "],
					["accent", "a"],
					["dim", " apply · "],
					["accent", "u"],
					["dim", " discard · "],
					["accent", "Esc"],
					["dim", " quit without applying"],
				],
			];
		if (this.searching)
			return [
				[
					["accent", "/ "],
					["text", this.st.query],
					["accent", "_"],
					["dim", "   ⏎ keep · Esc clear"],
				],
			];
		if (this.flash) return [[["warning", this.flash]]];
		if (this.st.pending.size) {
			const n = this.st.pending.size;
			const delta = this.pendingDelta();
			const parts: Array<[Style, string]> = [["accent", `${n} ${n === 1 ? "pending change" : "pending changes"}`]];
			if (delta) parts.push(["dim", ` · ≈ -${human(Math.abs(delta))} tokens after reload`]);
			parts.push(["dim", ` · a writes ${this.catalog.settingsPath} and reloads · u discards`]);
			return [parts];
		}
		if (this.st.query) return [[["dim", `search: "${this.st.query}" · Esc clears`]]];
		// default: state legend, dropped from the right when it does not fit
		return [
			[
				["success", GLYPHS.ok],
				["dim", " active"],
			],
			[
				["accent", GLYPHS.pending],
				["dim", " changes after reload"],
			],
			[
				["accent", GLYPHS.mixed],
				["dim", " partial"],
			],
			[
				["warning", GLYPHS.warn],
				["dim", " warning"],
			],
			[["dim", `changes go to ${this.catalog.settingsPath}`]],
		];
	}

	private keyItems(): Array<Array<[Style, string]>> {
		const k = (key: string, label: string): Array<[Style, string]> => [
			["accent", key],
			["dim", ` ${label}`],
		];
		return [k("Esc", "close"), k("space", "toggle"), k("a", "apply"), k("→←", "expand"), k("/", "search"), k("f", "filter"), k("⏎", "open"), k("e", "expand all"), k("j k", "move")];
	}

	invalidate(): void {}
	dispose(): void {}
}
