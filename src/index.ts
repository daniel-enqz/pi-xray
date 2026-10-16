/**
 * pi-xray: one view of what fills the pi context window, where each piece
 * comes from, and a way to turn package resources on or off.
 *
 * Header: context usage (bar + legend). Body: groups (each package,
 * ~/.pi/agent, built-in, MCP, memory, messages) sorted by tokens, expandable
 * down to single tools. Toggles are written to the user settings.json in the
 * same format `pi config` uses, then pi reloads. Runs locally, never through
 * the model.
 */
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { buildCatalog } from "./catalog";
import { openInPane } from "./open";
import { readConfig } from "./sources/config";
import { CALIBRATION_TYPE, readLive } from "./sources/live";
import { readRuntime, watchMcp } from "./sources/runtime";
import { type SetupResult, SetupView } from "./view/overlay";
import { type Change, applyChanges } from "./writer";

function selfPath(): string | undefined {
	try {
		return fileURLToPath(import.meta.url);
	} catch {
		try {
			return typeof __filename === "string" ? __filename : undefined;
		} catch {
			return undefined;
		}
	}
}

async function applyAndReload(ctx: ExtensionCommandContext, changes: Change[]): Promise<void> {
	const sm = SettingsManager.create(ctx.cwd, getAgentDir());
	const g: any = sm.getGlobalSettings();
	const slice = applyChanges({ packages: g.packages, extensions: g.extensions, skills: g.skills, prompts: g.prompts, themes: g.themes }, changes);
	if (slice.packages) sm.setPackages(slice.packages as any);
	if (slice.extensions) sm.setExtensionPaths(slice.extensions);
	if (slice.skills) sm.setSkillPaths(slice.skills);
	if (slice.prompts) sm.setPromptTemplatePaths(slice.prompts);
	if (slice.themes) sm.setThemePaths(slice.themes);
	await sm.flush();
	ctx.ui.notify(`/xray: ${changes.length} ${changes.length === 1 ? "change" : "changes"} saved, reloading…`, "info");
	await ctx.reload();
}

export default function piXray(pi: ExtensionAPI) {
	watchMcp(pi);

	pi.registerCommand("xray", {
		description: "What fills your context window, where it comes from, and toggles (local, no token cost)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;
			let catalog;
			try {
				const live = readLive(ctx, pi);
				const config = await readConfig(ctx.cwd);
				const runtime = readRuntime(ctx.cwd, config, selfPath());
				catalog = buildCatalog(live, config, runtime);
			} catch (e: any) {
				ctx.ui.notify(`/xray: could not read the configuration: ${e?.message ?? e}`, "error");
				return;
			}
			const result = await ctx.ui.custom<SetupResult>((tui, theme, _kb, done) => new SetupView(tui, theme, catalog, done, { open: openInPane }), {
				overlay: true,
				overlayOptions: () => ({ width: "100%", maxHeight: "100%", margin: 0 }),
			});
			if (result?.action === "mcp") {
				ctx.ui.setEditorText("/mcp");
				return;
			}
			if (result?.action !== "apply" || !result.changes.length) return;
			const changes: Change[] = [];
			for (const [id, enabled] of result.changes) {
				const target = catalog.resources.get(id)?.target;
				if (target) changes.push({ target, enabled });
			}
			try {
				// remember how estimates map to real tokens right now: after the reload,
				// pi's usage total still describes the old prompt until the next reply
				pi.appendEntry(CALIBRATION_TYPE, { kind: "calibration", scale: catalog.header.scale });
				await applyAndReload(ctx, changes);
			} catch (e: any) {
				ctx.ui.notify(`/xray: could not write settings.json: ${e?.message ?? e}`, "error");
			}
		},
	});
}

