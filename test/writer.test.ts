import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { applyChanges } from "../src/writer";
import { catalogTarget } from "./writer-helpers";

const PI: string = (globalThis as any).__PI_PKG;

test("string package entry becomes an object with a -pattern", () => {
	const out = applyChanges({ packages: ["npm:a", "../local"] }, [{ target: { kind: "package", source: "../local", type: "skills", pattern: "skills/x/SKILL.md" }, enabled: false }]);
	assert.deepEqual(out.packages, ["npm:a", { source: "../local", skills: ["-skills/x/SKILL.md"] }]);
	assert.equal(out.skills, undefined, "only touched keys are returned");
});

test("toggling twice keeps a single entry for the pattern", () => {
	const t = { kind: "package", source: "npm:a", type: "skills", pattern: "skills/x/SKILL.md" } as const;
	const once = applyChanges({ packages: ["npm:a"] }, [{ target: t, enabled: false }]);
	const twice = applyChanges(once, [{ target: t, enabled: true }]);
	assert.deepEqual(twice.packages, [{ source: "npm:a", skills: ["+skills/x/SKILL.md"] }]);
});

test("existing ! and other patterns are preserved", () => {
	const out = applyChanges({ packages: [{ source: "npm:a", skills: ["!skills/old/**", "-skills/y/SKILL.md"], extensions: ["x.ts"] }] }, [
		{ target: { kind: "package", source: "npm:a", type: "skills", pattern: "skills/y/SKILL.md" }, enabled: true },
	]);
	assert.deepEqual(out.packages, [{ source: "npm:a", skills: ["!skills/old/**", "+skills/y/SKILL.md"], extensions: ["x.ts"] }]);
});

test("top-level and built-in toggles", () => {
	const out = applyChanges({ extensions: ["-builtin:mcp"] }, [
		{ target: { kind: "top", type: "extensions", pattern: "builtin:mcp" }, enabled: true },
		{ target: { kind: "top", type: "skills", pattern: "skills/anti-slop/SKILL.md" }, enabled: false },
	]);
	assert.deepEqual(out.extensions, ["+builtin:mcp"]);
	assert.deepEqual(out.skills, ["-skills/anti-slop/SKILL.md"]);
});

test("input is not mutated", () => {
	const input = { packages: [{ source: "npm:a", skills: ["-s"] }] as any[] };
	const copy = structuredClone(input);
	applyChanges(input, [{ target: { kind: "package", source: "npm:a", type: "skills", pattern: "t" }, enabled: false }]);
	assert.deepEqual(input, copy);
});

test("unknown package throws instead of writing garbage", () => {
	assert.throws(() => applyChanges({ packages: [] }, [{ target: { kind: "package", source: "npm:nope", type: "skills", pattern: "x" }, enabled: false }]));
});

// ---- same result as pi config (drives pi's own ConfigSelector toggle) ----
test("matches pi config for package and top-level toggles", async () => {
	const jiti = (globalThis as any).__JITI;
	const sm = await jiti.import(path.join(PI, "dist/core/settings-manager.js"));
	const themeMod = await jiti.import(path.join(PI, "dist/modes/interactive/theme/theme.js"));
	const cfg = await jiti.import(path.join(PI, "dist/modes/interactive/components/config-selector.js"));
	themeMod.initTheme("dark", false);

	const agentDir = "/home/u/.pi/agent";
	const pkgRoot = "/home/u/dev/harness";
	const initial = { packages: ["npm:pi-web-access", "../../dev/harness"], extensions: ["-builtin:mcp"] };
	const items = [
		{ path: `${pkgRoot}/skills/release-orchestrator/SKILL.md`, type: "skills", meta: { source: "../../dev/harness", scope: "user", origin: "package", baseDir: pkgRoot } },
		{ path: `${agentDir}/skills/anti-slop/SKILL.md`, type: "skills", meta: { source: "auto", scope: "user", origin: "top-level", baseDir: agentDir } },
		{ path: "builtin:mcp", type: "extensions", meta: { source: "builtin", scope: "user", origin: "top-level" }, enabled: false },
	];

	for (const it of items) {
		const storage = new sm.InMemorySettingsStorage();
		storage.withLock("global", () => JSON.stringify(initial));
		const manager = sm.SettingsManager.fromStorage(storage);
		const empty = { extensions: [], skills: [], prompts: [], themes: [] };
		const resolved = { ...empty, [it.type]: [{ path: it.path, enabled: it.enabled ?? true, metadata: it.meta }] };
		const selector = new cfg.ConfigSelectorComponent({ global: resolved, project: empty }, manager, "/home/u", agentDir, () => {}, () => {}, () => {}, 40, "global", false);
		const list = selector.getResourceList();
		const entry = (list as any).flatItems.find((e: any) => e.type === "item");
		list.toggleResource(entry.item);
		await manager.flush();
		const piResult = manager.getGlobalSettings();

		const ours = applyChanges(structuredClone(initial) as any, [{ target: catalogTarget(it, agentDir), enabled: !(it.enabled ?? true) }]);
		const key = it.meta.origin === "package" ? "packages" : it.type;
		assert.deepEqual((ours as any)[key], (piResult as any)[key], `${it.path}`);
	}
});

test("writing through SettingsManager keeps settings.json a symlink", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-setup-"));
	const agentDir = path.join(dir, "agent");
	fs.mkdirSync(agentDir);
	const target = path.join(dir, "dotfiles-settings.json");
	fs.writeFileSync(target, JSON.stringify({ packages: ["npm:a"], theme: "dark" }, null, 2));
	fs.symlinkSync(target, path.join(agentDir, "settings.json"));
	const sm = SettingsManager.create(dir, agentDir);
	const out = applyChanges({ packages: sm.getGlobalSettings().packages as any }, [{ target: { kind: "package", source: "npm:a", type: "skills", pattern: "skills/x/SKILL.md" }, enabled: false }]);
	sm.setPackages(out.packages as any);
	await sm.flush();
	assert.ok(fs.lstatSync(path.join(agentDir, "settings.json")).isSymbolicLink(), "still a symlink");
	const written = JSON.parse(fs.readFileSync(target, "utf8"));
	assert.deepEqual(written.packages, [{ source: "npm:a", skills: ["-skills/x/SKILL.md"] }]);
	assert.equal(written.theme, "dark", "untouched fields survive");
});
