/**
 * Live layer: what is in the context window of this session.
 *  - structure from ctx.getSystemPromptOptions() (works before the first turn)
 *  - sizes from the real prompt text, ctx.getSystemPrompt()
 *  - messages from the compaction-aware context entries
 */
import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { LiveData } from "../catalog";

export function realpath(p: string): string {
	try {
		return fs.realpathSync(p);
	} catch {
		return p;
	}
}

const unescapeXml = (s: string) =>
	s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** chars of each `<skill>…</skill>` element in the real prompt, keyed by <location>. */
export function skillElementSizes(systemPrompt: string): Map<string, number> {
	const out = new Map<string, number>();
	for (const m of systemPrompt.matchAll(/ {2}<skill>\n[\s\S]*?<\/skill>\n?/g)) {
		const loc = m[0].match(/<location>([\s\S]*?)<\/location>/)?.[1];
		if (loc) out.set(unescapeXml(loc), m[0].length);
	}
	return out;
}

function textChars(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let n = 0;
	for (const c of content as any[]) {
		if (!c || typeof c !== "object") continue;
		if (c.type === "text") n += String(c.text ?? "").length;
		else if (c.type === "thinking") n += String(c.thinking ?? "").length;
		else if (c.type === "toolCall" || c.type === "tool_call" || c.type === "tool_use")
			n += JSON.stringify(c.arguments ?? c.input ?? c.args ?? {}).length + String(c.name ?? "").length;
		else if (c.type === "image") n += 3200; // ~800 tokens per image block
	}
	return n;
}

export function readLive(ctx: ExtensionCommandContext, pi: ExtensionAPI): LiveData {
	const safe = <T>(fn: () => T, fallback: T): T => {
		try {
			return fn() ?? fallback;
		} catch {
			return fallback;
		}
	};
	const sp = safe(() => ctx.getSystemPrompt(), "");
	const opts: any = safe(() => ctx.getSystemPromptOptions(), {});
	const sizes = skillElementSizes(sp);
	const usage = safe(() => ctx.getContextUsage(), undefined as any);
	const model: any = ctx.model;

	const contextFiles = (opts.contextFiles ?? []).map((f: any) => ({ path: f.path, real: realpath(f.path), chars: String(f.content ?? "").length }));
	const skills = (opts.skills ?? [])
		.filter((s: any) => !s.disableModelInvocation)
		.map((s: any) => ({ name: s.name, filePath: s.filePath, real: realpath(s.filePath), chars: sizes.get(s.filePath) ?? 0 }));

	const active = new Set(safe(() => pi.getActiveTools(), [] as string[]));
	const tools = safe(() => pi.getAllTools(), [] as any[])
		.filter((t: any) => active.has(t.name))
		.map((t: any) => {
			const p = String(t.sourceInfo?.path ?? "");
			let chars = 0;
			try {
				chars = JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length;
			} catch {
				chars = String(t.description ?? "").length;
			}
			return { name: t.name, chars, source: String(t.sourceInfo?.source ?? "builtin"), path: p, real: p.startsWith("builtin:") ? p : realpath(p) };
		});

	const sm: any = ctx.sessionManager;
	const entries: any[] = safe(() => sm.buildContextEntries?.() ?? sm.getBranch?.() ?? sm.getEntries?.() ?? [], []);
	let chars = 0;
	let user = 0;
	let assistant = 0;
	let cost = 0;
	let turn = 0;
	const heavy: LiveData["messages"]["heavy"] = [];
	for (const e of entries) {
		if (!e || e.type !== "message") {
			if (e?.type === "compaction") chars += String(e.summary ?? "").length;
			continue;
		}
		const m = e.message ?? {};
		const n = textChars(m.content);
		chars += n;
		if (m.role === "user") {
			user++;
			turn++;
		} else if (m.role === "assistant") {
			assistant++;
			cost += Number(m.usage?.cost?.total ?? 0);
		} else if (m.role === "toolResult") heavy.push({ tool: String(m.toolName ?? "tool"), turn, chars: n });
	}

	const tokens = Number(usage?.tokens ?? 0);
	return {
		model: String(model?.id ?? model?.name ?? "?"),
		contextWindow: Number(usage?.contextWindow ?? model?.contextWindow ?? 0),
		usageTokens: tokens,
		hasTurn: tokens > 0 && assistant > 0,
		systemPromptChars: sp.length,
		contextFiles,
		skills,
		tools,
		messages: { chars, user, assistant, cost, heavy },
	};
}
