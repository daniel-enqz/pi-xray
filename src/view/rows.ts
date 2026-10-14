/**
 * Catalog + view state -> flat rows of one tree: group -> resource -> tool.
 * Plain data only (no theme, no ANSI). Only rows with `selectable: true` can
 * hold the cursor. Row keys are paths ("group/resource/tool"), so they stay
 * unique even if a resource could appear under two parents.
 */
import type { Catalog, Group, Resource } from "../catalog";

export const FILTERS = ["all", "skills", "extensions", "tools", "prompts", "memory", "mcp", "warnings"];

/** effective state shown for a row, after pending changes */
export type State = "on" | "off" | "entering" | "leaving" | "mixed" | "none";

export interface ResourceRow {
	type: "resource";
	key: string;
	/** resource id the toggle acts on */
	toggleId?: string;
	/** group key for group rows */
	groupKey?: string;
	depth: number;
	kind: string;
	name: string;
	owner: string;
	/** shown in the origin column instead of owner; appended to the name when that column is hidden */
	detail?: string;
	tokens?: number;
	pct?: number;
	state: State;
	warn: boolean;
	expandable: boolean;
	expanded: boolean;
	toggleable: boolean;
	openPath?: string;
	mcp?: boolean;
	pending: boolean;
	dim: boolean;
	parentKey?: string;
	selectable: true;
}

export interface TextRow {
	type: "note";
	text: string;
	selectable: false;
}

export type Row = ResourceRow | TextRow;

export interface ViewState {
	filter: string;
	query: string;
	/** row keys the user expanded */
	expanded: Set<string>;
	/** resource id -> desired enabled */
	pending: Map<string, boolean>;
}

export function effectiveEnabled(r: Resource, pending: Map<string, boolean>): boolean {
	return pending.has(r.id) ? pending.get(r.id)! : r.enabled;
}

export function stateOf(r: Resource, pending: Map<string, boolean>): State {
	if (r.kind === "result") return "none";
	if (r.kind === "mcp") return r.enabled ? (r.loaded ? "on" : "none") : "off";
	const on = effectiveEnabled(r, pending);
	if (on && r.loaded) return "on";
	if (on && !r.loaded) return "entering";
	if (!on && r.loaded) return "leaving";
	return "off";
}

const KIND_LABEL: Record<string, string> = {
	memory: "file",
	skill: "skill",
	tool: "tool",
	extension: "ext",
	prompt: "prompt",
	theme: "theme",
	mcp: "server",
	result: "result",
};

const GROUP_LABEL: Record<Group["kind"], string> = {
	package: "pkg",
	user: "user",
	builtin: "pi",
	mcp: "mcp",
	memory: "memory",
	messages: "msgs",
	other: "other",
};

function matchesQuery(r: { name: string; owner: string; detail?: string }, q: string): boolean {
	if (!q) return true;
	const s = q.toLowerCase();
	return r.name.toLowerCase().includes(s) || r.owner.toLowerCase().includes(s) || !!r.detail?.toLowerCase().includes(s);
}

function matchesFilter(r: Resource, g: Group, filter: string): boolean {
	switch (filter) {
		case "skills":
			return r.kind === "skill";
		case "extensions":
			return r.kind === "extension";
		case "tools":
			return r.kind === "tool";
		case "prompts":
			return r.kind === "prompt";
		case "memory":
			return r.kind === "memory";
		case "mcp":
			return g.kind === "mcp";
		case "warnings":
			return r.diagnostics.length > 0;
		default:
			return true;
	}
}

function groupState(items: Resource[], pending: Map<string, boolean>): State {
	const toggleable = items.filter((r) => r.toggleable);
	if (!toggleable.length) return items.length ? "on" : "none";
	const on = toggleable.filter((r) => effectiveEnabled(r, pending)).length;
	if (on === toggleable.length) return "on";
	if (on === 0) return "off";
	return "mixed";
}

function resourceRow(c: Catalog, r: Resource, st: ViewState, key: string, depth: number, parentKey: string, expanded: boolean): ResourceRow {
	const state = stateOf(r, st.pending);
	return {
		type: "resource",
		key,
		toggleId: r.toggleable ? r.id : undefined,
		depth,
		kind: KIND_LABEL[r.kind] ?? r.kind,
		name: r.children.length ? `${r.name} (${r.children.length})` : r.name,
		// the parent row already says where a child comes from
		owner: depth > 0 ? "" : r.owner,
		detail: r.detail,
		tokens: r.tokens > 0 ? r.tokens : undefined,
		pct: r.tokens > 0 && c.header.window ? r.tokens / c.header.window : undefined,
		state,
		warn: r.diagnostics.length > 0,
		expandable: r.children.length > 0,
		expanded,
		toggleable: r.toggleable,
		openPath: r.path,
		mcp: r.kind === "mcp",
		pending: st.pending.has(r.id),
		dim: state === "off",
		parentKey,
		selectable: true,
	};
}

export function buildRows(c: Catalog, st: ViewState): Row[] {
	const rows: Row[] = [];
	const narrowing = st.filter !== "all" || !!st.query;
	const leaf = (r: Resource, g: Group) => matchesFilter(r, g, st.filter) && matchesQuery(r, st.query);

	for (const g of c.groups) {
		const items = g.children.map((k) => c.resources.get(k)!).filter(Boolean);
		// the whole group counts as a match when the search names it, or when the filter is about it
		const queryNamesGroup = !!st.query && matchesQuery({ name: g.label, owner: g.owner }, st.query);
		const filterIsGroup = st.filter === "mcp" && g.kind === "mcp";
		const groupMatch = (st.filter === "all" && queryNamesGroup) || (filterIsGroup && (!st.query || queryNamesGroup));
		// a resource is shown if it matches, or if one of its tools matches
		const shown = items.filter((r) => groupMatch || leaf(r, g) || r.children.some((k) => leaf(c.resources.get(k)!, g)));
		if (narrowing && !shown.length) continue;

		const expanded = st.expanded.has(g.key) || (narrowing && shown.length > 0);
		const state = g.kind === "messages" ? "none" : g.kind === "mcp" ? (items.some((r) => r.enabled) ? "on" : "off") : groupState(items, st.pending);
		rows.push({
			type: "resource",
			key: g.key,
			groupKey: g.key,
			depth: 0,
			kind: GROUP_LABEL[g.kind],
			name: items.length ? `${g.label} (${items.length})` : g.label,
			owner: g.owner,
			tokens: g.tokens > 0 ? g.tokens : undefined,
			pct: g.tokens > 0 && c.header.window ? g.tokens / c.header.window : undefined,
			state,
			warn: items.some((r) => r.diagnostics.length > 0),
			expandable: items.length > 0,
			expanded,
			toggleable: g.toggleable && items.some((r) => r.toggleable),
			mcp: g.kind === "mcp",
			pending: items.some((r) => st.pending.has(r.id)),
			dim: state === "off",
			selectable: true,
		});
		if (!expanded) continue;

		for (const r of shown) {
			const key = `${g.key}/${r.id}`;
			const selfMatch = groupMatch || leaf(r, g);
			const kids = r.children.map((k) => c.resources.get(k)!).filter(Boolean);
			const matchingKids = kids.filter((k) => leaf(k, g));
			const open = st.expanded.has(key) || (narrowing && !selfMatch && matchingKids.length > 0) || (st.filter === "tools" && kids.length > 0);
			rows.push(resourceRow(c, r, st, key, 1, g.key, open));
			if (!open) continue;
			for (const t of selfMatch && st.filter !== "tools" ? kids : matchingKids) rows.push(resourceRow(c, t, st, `${key}/${t.id}`, 2, key, false));
		}
	}
	if (!rows.length) rows.push({ type: "note", text: "No matches", selectable: false });
	return rows;
}

/** Ids a toggle on this row affects, and the value they move to (or why it can't). */
export function toggleEffect(c: Catalog, row: ResourceRow, st: ViewState): Map<string, boolean> | string {
	if (row.groupKey) {
		const g = c.groups.find((x) => x.key === row.groupKey);
		if (!g) return "unknown group";
		if (g.kind === "mcp") return "MCP is read-only here: ⏎ opens /mcp";
		if (!g.toggleable) return "this group can't be toggled as a whole: open it with → and toggle each item";
		const items = g.children.map((k) => c.resources.get(k)!).filter((r) => r?.toggleable && !r.isSelf);
		if (!items.length) return "nothing to toggle in this group";
		const anyOn = items.some((r) => effectiveEnabled(r, st.pending));
		return new Map(items.map((r) => [r.id, !anyOn]));
	}
	if (row.mcp) return "MCP is read-only here: ⏎ opens /mcp";
	if (!row.toggleId) return "this item can't be toggled from here";
	const r = c.resources.get(row.toggleId);
	if (!r) return "unknown item";
	if (r.isSelf) return "/xray can't turn itself off";
	return new Map([[r.id, !effectiveEnabled(r, st.pending)]]);
}
