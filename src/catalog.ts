/**
 * The catalog: one list of everything pi loads, built by joining three plain
 * data layers. Pure: no fs, no pi APIs, so it is testable with fixtures.
 *
 *   live    -> what is in the context window right now (and its size)
 *   config  -> what is installed and what will load after a reload (enabled)
 *   runtime -> MCP status and load diagnostics
 *
 * Output is a tree: group (package, ~/.pi/agent, built-in, MCP, memory,
 * messages) -> resource (skill, extension, prompt, MCP server, file) -> tool.
 * Every token is counted in exactly one group, so group totals add up.
 * Resources are joined by realpath, because most of ~/.pi/agent is symlinks.
 */
import * as path from "node:path";
import { charsToTokens } from "./view/text";

export type ResourceType = "extensions" | "skills" | "prompts" | "themes";
export type Kind = "memory" | "skill" | "tool" | "extension" | "prompt" | "theme" | "mcp" | "result";
export type GroupKind = "package" | "user" | "builtin" | "mcp" | "memory" | "messages" | "other";

export type ToggleTarget =
	| { kind: "package"; source: string; type: ResourceType; pattern: string }
	| { kind: "top"; type: ResourceType; pattern: string };

// ---------- input layers ----------

export interface LiveData {
	model: string;
	contextWindow: number;
	usageTokens: number;
	hasTurn: boolean;
	systemPromptChars: number;
	contextFiles: Array<{ path: string; real: string; chars: number }>;
	skills: Array<{ name: string; filePath: string; real: string; chars: number }>;
	tools: Array<{ name: string; chars: number; source: string; path: string; real: string }>;
	messages: {
		chars: number;
		user: number;
		assistant: number;
		cost: number;
		heavy: Array<{ tool: string; turn: number; chars: number }>;
	};
}

export interface ConfigResource {
	type: ResourceType;
	path: string;
	real: string;
	enabled: boolean;
	source: string;
	scope: string;
	origin: "package" | "top-level";
	baseDir?: string;
}

export interface ConfigData {
	agentDir: string;
	home?: string;
	packages: Array<{ source: string; label: string; installedPath?: string; scope: string }>;
	resources: ConfigResource[];
}

export interface McpServerInfo {
	name: string;
	status: string;
	toolCount: number;
	directToolCount: number;
	disabled: boolean;
	blockedReason?: string;
}

export interface RuntimeData {
	mcpServers: McpServerInfo[] | null;
	diagnostics: Array<{ path?: string; real?: string; message: string }>;
	selfReal?: string;
}

// ---------- output ----------

export interface Resource {
	id: string;
	kind: Kind;
	name: string;
	owner: string;
	path?: string;
	loaded: boolean;
	enabled: boolean;
	toggleable: boolean;
	tokens: number;
	diagnostics: string[];
	target?: ToggleTarget;
	/** ids of nested resources (an extension's or MCP server's tools) */
	children: string[];
	isSelf?: boolean;
	/** extra info shown in the origin column (e.g. MCP exposure mode) */
	detail?: string;
}

export interface Group {
	key: string;
	kind: GroupKind;
	label: string;
	owner: string;
	/** packages only: space toggles every resource of the group */
	toggleable: boolean;
	children: string[];
	tokens: number;
}

export interface Header {
	model: string;
	window: number;
	total: number;
	estimated: boolean;
	categories: Array<{ key: string; label: string; tokens: number }>;
	messages: { user: number; assistant: number; cost: number };
}

export interface Catalog {
	header: Header;
	settingsPath: string;
	resources: Map<string, Resource>;
	/** sorted by tokens, biggest first */
	groups: Group[];
	counts: { packages: number; extensions: number; skills: number; prompts: number };
}

export const BUILTIN_EXTENSIONS = ["mcp", "llama.cpp", "codemode", "tool-search"];

const CODE_DIRS = new Set(["src", "dist", "lib", "build", "out", "extensions", "extension"]);
const KIND_OF: Record<ResourceType, Kind> = { extensions: "extension", skills: "skill", prompts: "prompt", themes: "theme" };
const KIND_ORDER: Kind[] = ["extension", "mcp", "skill", "prompt", "theme", "memory", "tool", "result"];

/**
 * How an MCP server reaches the model: "proxy · 108 tools", "direct · 3 tools",
 * "direct 3/45", "disabled". The connection state is appended only when the
 * server is not usable right now (cached and connected both mean available).
 */
export function mcpMode(s: McpServerInfo): string {
	if (s.disabled) return "disabled";
	const n = Math.max(0, s.toolCount);
	const tools = `${n} ${n === 1 ? "tool" : "tools"}`;
	let mode = s.directToolCount <= 0 ? `proxy · ${tools}` : s.directToolCount >= n ? `direct · ${tools}` : `direct ${s.directToolCount}/${n}`;
	const state = s.blockedReason ? "blocked" : s.status;
	const available = !state || state === "connected" || state === "cached";
	// no catalog yet: a tool count of 0 says nothing, the state says everything
	if (n === 0 && !available) return state;
	if (!available) mode += ` · ${state}`;
	return mode;
}

export function packageLabel(source: string, installedPath?: string): string {
	if (source.startsWith("npm:")) return source.slice(4).replace(/(?<=.)@[^/]*$/, "");
	if (/^(git:|https?:)/.test(source)) return source.replace(/^(git:|https?:\/\/)/, "").replace(/\.git$/, "");
	const p = installedPath ?? source;
	const base = path.basename(p);
	return base.startsWith(".") ? path.basename(path.dirname(p)) : base;
}

function resourceName(r: ConfigResource): string {
	if (r.path.startsWith("builtin:")) return r.path;
	if (r.type === "skills") return path.basename(path.dirname(r.path));
	const base = path.basename(r.path).replace(/\.(ts|js|mjs|cjs|md|json)$/, "");
	if (r.type === "extensions" && (base === "index" || base === "extension")) {
		// name it after the package, not after its source or build folder
		let dir = path.dirname(r.path);
		while (CODE_DIRS.has(path.basename(dir)) && path.dirname(dir) !== dir) dir = path.dirname(dir);
		const name = path.basename(dir);
		return name.startsWith(".") ? path.basename(path.dirname(dir)) : name;
	}
	return base;
}

export function toggleTarget(r: ConfigResource, agentDir: string): ToggleTarget | undefined {
	if (r.scope !== "user") return undefined; // v1 writes user scope only
	if (r.origin === "package") {
		const base = r.baseDir ?? path.dirname(r.path);
		return { kind: "package", source: r.source, type: r.type, pattern: path.relative(base, r.path) };
	}
	if (r.path.startsWith("builtin:")) return { kind: "top", type: r.type, pattern: r.path };
	return { kind: "top", type: r.type, pattern: path.relative(r.baseDir ?? agentDir, r.path) };
}

function mcpServerOf(toolName: string, servers: string[]): string | undefined {
	for (const s of servers) {
		if (toolName === `mcp__${s.replace(/[^a-zA-Z0-9]/g, "_")}`) return s;
		if (toolName.startsWith(`${s}_`)) return s;
	}
	return undefined;
}

export function buildCatalog(live: LiveData, config: ConfigData, runtime: RuntimeData): Catalog {
	const resources = new Map<string, Resource>();
	const diagByReal = new Map<string, string[]>();
	for (const d of runtime.diagnostics) {
		const key = d.real ?? d.path;
		if (!key) continue;
		diagByReal.set(key, [...(diagByReal.get(key) ?? []), d.message]);
	}
	const pkgLabel = new Map(config.packages.map((p) => [p.source, p.label]));
	const ownerLabel = (source: string) => (source === "auto" ? "user" : source === "builtin" ? "built-in" : (pkgLabel.get(source) ?? source));
	const tilde = (p: string) => (config.home && p.startsWith(config.home + "/") ? `~${p.slice(config.home.length)}` : p);

	// ---- sizes, scaled so that rows add up to the authoritative total ----
	const memChars = live.contextFiles.reduce((a, f) => a + f.chars, 0);
	const skillChars = live.skills.reduce((a, s) => a + s.chars, 0);
	const toolChars = live.tools.reduce((a, t) => a + t.chars, 0);
	const baseChars = Math.max(0, live.systemPromptChars - memChars - skillChars);
	const estTotal = charsToTokens(baseChars + memChars + skillChars + toolChars + live.messages.chars);
	const authoritative = live.hasTurn && live.usageTokens > 0;
	const scale = authoritative && estTotal > 0 ? live.usageTokens / estTotal : 1;
	const tok = (chars: number) => charsToTokens(chars) * scale;
	const total = authoritative ? live.usageTokens : estTotal;

	const add = (r: Omit<Resource, "diagnostics" | "children"> & Partial<Pick<Resource, "diagnostics" | "children">>) => {
		const full: Resource = { diagnostics: [], children: [], ...r };
		resources.set(full.id, full);
		return full;
	};

	// ---- config resources ----
	const groupOf = new Map<string, string>(); // resource id -> group key
	for (const r of config.resources) {
		const id = r.real || r.path;
		const target = toggleTarget(r, config.agentDir);
		const builtin = r.path.startsWith("builtin:");
		add({
			id,
			kind: KIND_OF[r.type],
			name: resourceName(r),
			owner: ownerLabel(r.source),
			path: builtin ? undefined : r.path,
			// pi loads every enabled extension and prompt; skills are confirmed by the live layer
			loaded: r.type !== "skills" && r.enabled,
			enabled: r.enabled,
			toggleable: !!target,
			tokens: 0,
			diagnostics: diagByReal.get(id) ?? diagByReal.get(r.path) ?? [],
			target,
			isSelf: !!runtime.selfReal && id === runtime.selfReal,
		});
		const key = builtin ? "builtin" : r.source === "auto" ? "user" : config.packages.some((p) => p.source === r.source) ? `pkg:${r.source}` : "other";
		groupOf.set(id, key);
	}

	// ---- live: skills (join with config by realpath) ----
	for (const s of live.skills) {
		const id = s.real || s.filePath;
		const existing = resources.get(id);
		if (existing) {
			existing.loaded = true;
			existing.tokens = tok(s.chars);
			existing.name = s.name;
		} else {
			add({ id, kind: "skill", name: s.name, owner: "?", path: s.filePath, loaded: true, enabled: true, toggleable: false, tokens: tok(s.chars), diagnostics: diagByReal.get(id) ?? [] });
			groupOf.set(id, "other");
		}
	}

	// ---- live: memory ----
	const memoryIds: string[] = [];
	for (const f of live.contextFiles) {
		const id = `memory:${f.real || f.path}`;
		add({ id, kind: "memory", name: tilde(f.path), owner: "user", path: f.path, loaded: true, enabled: true, toggleable: false, tokens: tok(f.chars) });
		memoryIds.push(id);
	}

	// ---- MCP servers ----
	const serverNames = (runtime.mcpServers ?? []).map((s) => s.name).sort((a, b) => b.length - a.length);
	const mcpIds: string[] = [];
	for (const s of runtime.mcpServers ?? []) {
		const id = `mcp:${s.name}`;
		add({
			id,
			kind: "mcp",
			name: s.name,
			owner: "mcp",
			loaded: false,
			enabled: !s.disabled,
			toggleable: false,
			tokens: 0,
			diagnostics: s.status === "failed" ? ["failed to connect"] : s.blockedReason ? [`blocked: ${s.blockedReason}`] : [],
			detail: mcpMode(s),
		});
		mcpIds.push(id);
	}

	// ---- live: tools, each attached to exactly one owner ----
	const builtinToolIds: string[] = [];
	const otherToolIds: string[] = [];
	for (const t of live.tools) {
		const toolId = `tool:${t.name}`;
		const server = t.source === "builtin" ? undefined : mcpServerOf(t.name, serverNames);
		const ext = t.source === "builtin" ? undefined : resources.get(t.real);
		const owner = server ? resources.get(`mcp:${server}`) : ext;
		add({ id: toolId, kind: "tool", name: t.name, owner: server ? `mcp ${server}` : (ext?.name ?? ownerLabel(t.source)), loaded: true, enabled: true, toggleable: false, tokens: tok(t.chars) });
		if (t.source === "builtin") builtinToolIds.push(toolId);
		else if (owner) {
			owner.children.push(toolId);
			owner.tokens += tok(t.chars);
			owner.loaded = true;
		} else otherToolIds.push(toolId);
	}

	// ---- messages: the heaviest tool results ----
	const heavyIds = [...live.messages.heavy]
		.sort((a, b) => b.chars - a.chars)
		.slice(0, 5)
		.map((h, i) => add({ id: `result:${i}`, kind: "result", name: `${h.tool} (turn ${h.turn})`, owner: "", loaded: true, enabled: true, toggleable: false, tokens: tok(h.chars) }).id);

	// ---- groups ----
	const byTokens = (ids: string[]) =>
		[...ids].sort((a, b) => {
			const ra = resources.get(a)!;
			const rb = resources.get(b)!;
			return rb.tokens - ra.tokens || KIND_ORDER.indexOf(ra.kind) - KIND_ORDER.indexOf(rb.kind) || ra.name.localeCompare(rb.name);
		});
	for (const r of resources.values()) if (r.children.length) r.children = byTokens(r.children);
	const members = (key: string) => [...groupOf.entries()].filter(([, k]) => k === key).map(([id]) => id);
	const sum = (ids: string[]) => ids.reduce((a, id) => a + (resources.get(id)!.loaded ? resources.get(id)!.tokens : 0), 0);

	const groups: Group[] = [];
	const push = (g: Omit<Group, "tokens"> & { tokens?: number }) => {
		if (!g.children.length && g.tokens === undefined) return;
		groups.push({ ...g, children: byTokens(g.children), tokens: g.tokens ?? sum(g.children) });
	};
	for (const p of config.packages) {
		push({ key: `pkg:${p.source}`, kind: "package", label: p.label, owner: p.source.startsWith("npm:") ? "npm" : /^(git:|https?:)/.test(p.source) ? "git" : "local", toggleable: p.scope === "user", children: members(`pkg:${p.source}`) });
	}
	push({ key: "user", kind: "user", label: "~/.pi/agent", owner: "", toggleable: false, children: members("user") });
	push({ key: "builtin", kind: "builtin", label: "built-in", owner: "", toggleable: false, children: [...members("builtin"), ...builtinToolIds] });
	push({ key: "mcp", kind: "mcp", label: "MCP", owner: "/mcp", toggleable: false, children: mcpIds });
	push({ key: "memory", kind: "memory", label: "AGENTS.md / CLAUDE.md", owner: "", toggleable: false, children: memoryIds });
	if (live.messages.chars > 0)
		push({ key: "messages", kind: "messages", label: "messages", owner: "", toggleable: false, children: heavyIds, tokens: tok(live.messages.chars) });
	push({ key: "other", kind: "other", label: "other", owner: "", toggleable: false, children: [...members("other"), ...otherToolIds] });
	// biggest first; stable for ties, so packages keep their settings order
	const order = new Map(groups.map((g, i) => [g.key, i]));
	groups.sort((a, b) => b.tokens - a.tokens || order.get(a.key)! - order.get(b.key)!);

	const count = (type: ResourceType) => config.resources.filter((r) => r.type === type && r.enabled).length;
	return {
		header: {
			model: live.model,
			window: live.contextWindow,
			total,
			estimated: !authoritative,
			categories: [
				{ key: "base", label: "base", tokens: tok(baseChars) },
				{ key: "memory", label: "memory", tokens: tok(memChars) },
				{ key: "skills", label: "skills", tokens: tok(skillChars) },
				{ key: "tools", label: "tools", tokens: tok(toolChars) },
				{ key: "messages", label: "msgs", tokens: tok(live.messages.chars) },
			],
			messages: { user: live.messages.user, assistant: live.messages.assistant, cost: live.messages.cost },
		},
		settingsPath: tilde(path.join(config.agentDir, "settings.json")),
		resources,
		groups,
		counts: { packages: config.packages.length, extensions: count("extensions"), skills: count("skills"), prompts: count("prompts") },
	};
}
