import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalog, mcpMode, packageLabel, toggleTarget } from "../src/catalog";
import { AGENT, SELF, fixture } from "./fixture";

const build = (opts: Parameters<typeof fixture>[0] = {}) => {
	const { live, config, runtime } = fixture(opts);
	return buildCatalog(live, config, runtime);
};

test("joins live skills with config by realpath and marks them loaded", () => {
	const c = build();
	const skills = [...c.resources.values()].filter((r) => r.kind === "skill");
	assert.equal(skills.length, 7);
	assert.ok(skills.every((s) => s.loaded && s.tokens > 0));
	assert.ok(skills.every((s) => s.owner !== "?"), "every live skill found its package");
});

test("header categories add up to the authoritative total", () => {
	const c = build({ usageTokens: 41_200 });
	const sum = c.header.categories.reduce((a, x) => a + x.tokens, 0);
	assert.ok(Math.abs(sum - 41_200) < 1, `sum ${sum}`);
	assert.equal(c.header.total, 41_200);
});

test("groups + pi base add up to the total: every token counted once", () => {
	const c = build({ usageTokens: 41_200 });
	const base = c.header.categories.find((x) => x.key === "base")!.tokens;
	const groups = c.groups.reduce((a, g) => a + g.tokens, 0);
	assert.ok(Math.abs(groups + base - 41_200) < 1, `groups ${groups} + base ${base}`);
});

test("before the first turn the header is an estimate", () => {
	const c = build({ usageTokens: 0, hasTurn: false });
	assert.equal(c.header.estimated, true);
	assert.ok(c.header.total > 0);
});

test("every tool hangs from exactly one owner", () => {
	const c = build();
	const parents = new Map<string, string[]>();
	for (const r of c.resources.values()) for (const k of r.children) parents.set(k, [...(parents.get(k) ?? []), r.id]);
	for (const g of c.groups) for (const k of g.children) if (k.startsWith("tool:")) parents.set(k, [...(parents.get(k) ?? []), g.key]);
	const tools = [...c.resources.values()].filter((r) => r.kind === "tool");
	for (const t of tools) assert.equal(parents.get(t.id)?.length, 1, `${t.id} parents: ${parents.get(t.id)}`);
	assert.deepEqual(parents.get("tool:databricks-sql_execute_sql"), ["mcp:databricks-sql"]);
	assert.deepEqual(parents.get("tool:mcp__atlassian"), ["mcp:atlassian"]);
	assert.deepEqual(parents.get("tool:mcp"), [`${AGENT}/npm/node_modules/pi-mcp-adapter/index.ts`], "the gateway belongs to the adapter");
	assert.deepEqual(parents.get("tool:read"), ["builtin"]);
	assert.deepEqual(parents.get("tool:training"), [`${AGENT}/extensions/training.ts`]);
});

test("groups are sorted by tokens, biggest first", () => {
	const c = build();
	const tokens = c.groups.map((g) => g.tokens);
	assert.deepEqual(tokens, [...tokens].sort((a, b) => b - a));
	assert.ok(c.groups.some((g) => g.kind === "messages"));
	assert.ok(c.groups.some((g) => g.kind === "memory"));
});

test("only packages are toggleable as a whole", () => {
	const c = build();
	for (const g of c.groups) assert.equal(g.toggleable, g.kind === "package", g.key);
});

test("the /xray extension itself is flagged", () => {
	assert.equal(build().resources.get(SELF)!.isSelf, true);
});

test("diagnostics attach to the right resource", () => {
	const warned = [...build().resources.values()].filter((r) => r.diagnostics.length);
	assert.ok(warned.some((r) => r.name === "release-orchestrator"));
	assert.ok(warned.some((r) => r.kind === "mcp" && r.name === "glean"));
});

test("toggle targets use the same patterns as pi config", () => {
	const pkg = toggleTarget({ type: "skills", path: "/p/skills/x/SKILL.md", real: "", enabled: true, source: "npm:p", scope: "user", origin: "package", baseDir: "/p" }, AGENT);
	assert.deepEqual(pkg, { kind: "package", source: "npm:p", type: "skills", pattern: "skills/x/SKILL.md" });
	const top = toggleTarget({ type: "extensions", path: `${AGENT}/extensions/a.ts`, real: "", enabled: true, source: "auto", scope: "user", origin: "top-level", baseDir: AGENT }, AGENT);
	assert.deepEqual(top, { kind: "top", type: "extensions", pattern: "extensions/a.ts" });
	const builtin = toggleTarget({ type: "extensions", path: "builtin:mcp", real: "", enabled: false, source: "builtin", scope: "user", origin: "top-level" }, AGENT);
	assert.deepEqual(builtin, { kind: "top", type: "extensions", pattern: "builtin:mcp" });
	const project = toggleTarget({ type: "skills", path: "/x/SKILL.md", real: "", enabled: true, source: "auto", scope: "project", origin: "top-level" }, AGENT);
	assert.equal(project, undefined, "v1 does not write project scope");
});

test("extensions carry the cost of their tools; memory paths use ~", () => {
	const c = build();
	const training = c.resources.get(`${AGENT}/extensions/training.ts`)!;
	assert.ok(training.tokens > 0 && training.children.length === 1);
	assert.ok([...c.resources.values()].some((r) => r.kind === "memory" && r.name === "~/.pi/agent/AGENTS.md"));
	assert.equal(c.settingsPath, "~/.pi/agent/settings.json");
});

test("MCP mode: proxy, direct, partial, disabled, and state only when it matters", () => {
	const base = { name: "s", status: "cached", toolCount: 45, directToolCount: 0, disabled: false };
	assert.equal(mcpMode(base), "proxy · 45 tools");
	assert.equal(mcpMode({ ...base, toolCount: 3, directToolCount: 3, status: "connected" }), "direct · 3 tools");
	assert.equal(mcpMode({ ...base, directToolCount: 5 }), "direct 5/45");
	assert.equal(mcpMode({ ...base, toolCount: 1 }), "proxy · 1 tool");
	assert.equal(mcpMode({ ...base, disabled: true, status: "not-connected" }), "disabled");
	assert.equal(mcpMode({ ...base, toolCount: 0, status: "not-connected" }), "not-connected");
	assert.equal(mcpMode({ ...base, toolCount: 0, status: "connected" }), "proxy · 0 tools");
	assert.equal(mcpMode({ ...base, status: "failed" }), "proxy · 45 tools · failed");
	assert.equal(mcpMode({ ...base, blockedReason: "untrusted" }), "proxy · 45 tools · blocked");
});

test("MCP servers carry their mode and the cost of their tools", () => {
	const c = build();
	assert.equal(c.resources.get("mcp:atlassian")!.detail, "proxy · 45 tools");
	assert.equal(c.resources.get("mcp:databricks-sql")!.detail, "direct · 3 tools");
	assert.equal(c.resources.get("mcp:miro-mcp")!.detail, "disabled");
	assert.ok(c.resources.get("mcp:databricks-sql")!.tokens > 0);
});

test("extensions are named after their package, not their source folder", () => {
	const { live, config, runtime } = fixture();
	const ext = (p: string) => ({ type: "extensions" as const, path: p, real: p, enabled: true, source: "npm:x", scope: "user", origin: "package" as const, baseDir: "/n" });
	config.resources.push(
		ext("/n/node_modules/pi-xray/src/index.ts"),
		ext("/n/node_modules/pi-web-access/dist/index.js"),
		ext("/n/node_modules/pi-loadout/extensions/index.ts"),
		ext("/n/dev/tool/.pi-plugin/extension.ts"),
		ext("/n/node_modules/pi-mcp-adapter/index.ts"),
	);
	const names = [...buildCatalog(live, config, runtime).resources.values()].filter((r) => r.path?.startsWith("/n/")).map((r) => r.name);
	assert.deepEqual(names, ["pi-xray", "pi-web-access", "pi-loadout", "tool", "pi-mcp-adapter"]);
});

test("package labels", () => {
	assert.equal(packageLabel("npm:@scope/pkg@1.2.3"), "@scope/pkg");
	assert.equal(packageLabel("npm:pi-subagents"), "pi-subagents");
	assert.equal(packageLabel("../../dev/x/docs-search/.pi-plugin", "/u/dev/x/docs-search/.pi-plugin"), "docs-search");
	assert.equal(packageLabel("git:github.com/a/b@v1"), "github.com/a/b@v1");
});

test("empty inputs do not throw", () => {
	const c = build({ empty: true });
	assert.equal(c.groups.length, 0);
	assert.equal(c.header.total, 0);
});
