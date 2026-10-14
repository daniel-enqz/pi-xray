/**
 * Runtime layer: MCP status (published by pi-mcp-adapter on pi.events) and
 * load diagnostics (skill warnings + dangling skill symlinks).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import type { ConfigData, RuntimeData } from "../catalog";
import { realpath } from "./live";

export const MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";

let lastMcp: any = null;

/** Call once from the extension factory. */
export function watchMcp(pi: ExtensionAPI): void {
	pi.events.on(MCP_STATUS_EVENT, (snapshot: unknown) => {
		lastMcp = snapshot;
	});
}

export function readRuntime(cwd: string, config: ConfigData, selfPath?: string): RuntimeData {
	const diagnostics: RuntimeData["diagnostics"] = [];
	try {
		const enabledSkills = config.resources.filter((r) => r.type === "skills" && r.enabled).map((r) => r.path);
		const res = loadSkills({ cwd, agentDir: config.agentDir, skillPaths: enabledSkills, includeDefaults: false });
		for (const d of res.diagnostics as any[]) diagnostics.push({ path: d.path, real: d.path ? realpath(d.path) : undefined, message: String(d.message ?? d.type) });
	} catch {
		// diagnostics are best effort
	}
	const skillsDir = path.join(config.agentDir, "skills");
	try {
		for (const name of fs.readdirSync(skillsDir)) {
			if (name.startsWith(".")) continue;
			const p = path.join(skillsDir, name);
			if (!fs.existsSync(path.join(p, "SKILL.md"))) diagnostics.push({ path: p, real: p, message: "broken symlink or folder without SKILL.md" });
		}
	} catch {
		// no skills dir
	}
	const servers = Array.isArray(lastMcp?.servers)
		? lastMcp.servers.map((s: any) => ({
				name: String(s.name),
				status: String(s.status ?? "?"),
				toolCount: Number(s.toolCount ?? 0),
				directToolCount: Number(s.directToolCount ?? 0),
				disabled: !!s.disabled,
				blockedReason: s.blockedReason ? String(s.blockedReason) : undefined,
			}))
		: null;
	return { mcpServers: servers, diagnostics, selfReal: selfPath ? realpath(selfPath) : undefined };
}
