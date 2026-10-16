import type { ConfigData, ConfigResource, LiveData, RuntimeData } from "../src/catalog";

export const AGENT = "/home/u/.pi/agent";
const NPM = `${AGENT}/npm/node_modules`;
const HARNESS = "/home/u/dev/release-kit";
const EK = "/home/u/dev/docs-search/.pi-plugin";
export const SELF = `${AGENT}/extensions/pi-setup/index.ts`;

export const LONG_NAME = "a-really-long-skill-name-that-goes-on-and-on-to-sixty-four-chars";
export const CJK_NAME = "スキル-テスト-日本語";
export const EMOJI_NAME = "rocket-🚀-skill";

function res(type: ConfigResource["type"], path: string, source: string, origin: ConfigResource["origin"], baseDir?: string, enabled = true): ConfigResource {
	return { type, path, real: path, enabled, source, scope: "user", origin, baseDir };
}

export interface FixtureOptions {
	extraSkills?: number;
	usageTokens?: number;
	window?: number;
	hasTurn?: boolean;
	empty?: boolean;
}

export function fixture(opts: FixtureOptions = {}): { live: LiveData; config: ConfigData; runtime: RuntimeData } {
	if (opts.empty) {
		return {
			live: { model: "m", contextWindow: opts.window ?? 0, usageTokens: 0, hasTurn: false, systemPromptChars: 0, contextFiles: [], skills: [], tools: [], messages: { chars: 0, user: 0, assistant: 0, cost: 0, heavy: [] } },
			config: { agentDir: AGENT, packages: [], resources: [] },
			runtime: { mcpServers: null, diagnostics: [] },
		};
	}
	const resources: ConfigResource[] = [
		res("extensions", `${NPM}/pi-mcp-adapter/index.ts`, "npm:pi-mcp-adapter", "package", `${NPM}/pi-mcp-adapter`),
		res("skills", `${HARNESS}/skills/release-orchestrator/SKILL.md`, "../../dev/release-kit", "package", HARNESS),
		res("skills", `${HARNESS}/skills/changelog-sync/SKILL.md`, "../../dev/release-kit", "package", HARNESS),
		res("skills", `${EK}/../skills/search/SKILL.md`, "../../dev/docs-search/.pi-plugin", "package", EK),
		res("skills", `${EK}/../skills/${LONG_NAME}/SKILL.md`, "../../dev/docs-search/.pi-plugin", "package", EK),
		res("skills", `${EK}/../skills/${CJK_NAME}/SKILL.md`, "../../dev/docs-search/.pi-plugin", "package", EK),
		res("skills", `${EK}/../skills/${EMOJI_NAME}/SKILL.md`, "../../dev/docs-search/.pi-plugin", "package", EK),
		res("extensions", `${AGENT}/extensions/training.ts`, "auto", "top-level", AGENT),
		res("extensions", SELF, "auto", "top-level", AGENT),
		res("skills", `${AGENT}/skills/anti-slop/SKILL.md`, "auto", "top-level", AGENT),
		res("prompts", `${AGENT}/prompts/review.md`, "auto", "top-level", AGENT),
		res("extensions", "builtin:mcp", "builtin", "top-level", undefined, false),
		res("extensions", "builtin:codemode", "builtin", "top-level"),
	];
	for (let i = 0; i < (opts.extraSkills ?? 0); i++) resources.push(res("skills", `${HARNESS}/skills/extra-${i}/SKILL.md`, "../../dev/release-kit", "package", HARNESS));

	const loadedSkills = resources.filter((r) => r.type === "skills");
	const live: LiveData = {
		model: "claude-opus-5-5",
		contextWindow: opts.window ?? 1_000_000,
		usageTokens: opts.usageTokens ?? 41_200,
		hasTurn: opts.hasTurn ?? true,
		systemPromptChars: 40_000,
		contextFiles: [{ path: `${AGENT}/AGENTS.md`, real: "/home/u/dotfiles/AGENTS.md", chars: 2_600 }],
		skills: loadedSkills.map((r, i) => ({ name: r.path.split("/").at(-2)!, filePath: r.path, real: r.real, chars: 400 + ((i * 97) % 1800) })),
		tools: [
			{ name: "read", chars: 630, source: "builtin", path: "builtin:read", real: "builtin:read" },
			{ name: "bash", chars: 490, source: "builtin", path: "builtin:bash", real: "builtin:bash" },
			{ name: "training", chars: 445, source: "auto", path: `${AGENT}/extensions/training.ts`, real: `${AGENT}/extensions/training.ts` },
			{ name: "databricks-sql_execute_sql", chars: 1_900, source: "npm:pi-mcp-adapter", path: `${NPM}/pi-mcp-adapter/index.ts`, real: `${NPM}/pi-mcp-adapter/index.ts` },
			{ name: "mcp__atlassian", chars: 700, source: "npm:pi-mcp-adapter", path: `${NPM}/pi-mcp-adapter/index.ts`, real: `${NPM}/pi-mcp-adapter/index.ts` },
			{ name: "mcp", chars: 3_000, source: "npm:pi-mcp-adapter", path: `${NPM}/pi-mcp-adapter/index.ts`, real: `${NPM}/pi-mcp-adapter/index.ts` },
		],
		messages: {
			chars: 70_000,
			user: 6,
			assistant: 9,
			cost: 1.82,
			heavy: [
				{ tool: "bash", detail: "npm test", turn: 4, chars: 32_000 },
				{ tool: "read", turn: 2, chars: 9_000 },
				{ tool: "bash\twith\ttabs\nand newline", turn: 5, chars: 100 },
			],
		},
	};
	const config: ConfigData = {
		agentDir: AGENT,
		home: "/home/u",
		packages: [
			{ source: "npm:pi-mcp-adapter", label: "pi-mcp-adapter", scope: "user" },
			{ source: "../../dev/release-kit", label: "release-kit", scope: "user" },
			{ source: "../../dev/docs-search/.pi-plugin", label: "docs-search", scope: "user" },
		],
		resources,
	};
	const runtime: RuntimeData = {
		mcpServers: [
			{ name: "databricks-sql", status: "connected", toolCount: 3, directToolCount: 3, disabled: false },
			{ name: "atlassian", status: "cached", toolCount: 45, directToolCount: 0, disabled: false },
			{ name: "glean", status: "failed", toolCount: 0, directToolCount: 0, disabled: false },
			{ name: "miro-mcp", status: "not-connected", toolCount: 22, directToolCount: 0, disabled: true },
		],
		diagnostics: [{ path: `${HARNESS}/skills/release-orchestrator/SKILL.md`, real: `${HARNESS}/skills/release-orchestrator/SKILL.md`, message: "description exceeds 1024 characters (2068)" }],
		selfReal: SELF,
	};
	return { live, config, runtime };
}
