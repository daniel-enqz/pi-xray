// Writes a sample pi session (JSONL) for the demo recording: a long afternoon of
// work on a made-up markdown notes app, with real-looking tool calls and heavy
// tool results, so /xray has a big conversation to show.
//
// Usage: [DEMO_MODEL=provider/model] [DEMO_TARGET_TOKENS=420000] \
//          node demo/make-session.mjs <project-dir> > session.jsonl
// DEMO_MODEL should be a model your pi can use, or pi warns that it cannot restore it.
import { randomUUID } from "node:crypto";

const cwd = process.argv[2] ?? process.cwd();
const [provider, ...modelParts] = (process.env.DEMO_MODEL ?? "anthropic/claude-sonnet-4-5").split("/");
const model = modelParts.join("/");
const api = provider === "google" ? "google-generative-ai" : provider === "openai" ? "openai-responses" : "anthropic-messages";
const target = Number(process.env.DEMO_TARGET_TOKENS ?? 420_000);

// ---------- deterministic filler ----------

let seed = 7;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
const pick = (a) => a[rnd(a.length)];
/** two different words, so filler never reads "note note" */
const two = () => {
	const a = pick(words);
	let b = pick(words);
	while (b === a) b = pick(words);
	return `${a} ${b}`;
};
const words = ["note", "tag", "index", "query", "token", "link", "backlink", "folder", "draft", "title", "body", "slug", "vault", "attachment", "snippet", "heading"];
const verbs = ["parse", "build", "rank", "merge", "render", "resolve", "load", "save", "sync", "match", "split", "normalize"];
const ident = () => `${pick(verbs)}${pick(words)[0].toUpperCase()}${pick(words).slice(1)}`;

/** Every generator takes `scale` so the session can be sized to DEMO_TARGET_TOKENS. */
const gen = {
	testRun(scale, failing = []) {
		const suites = ["notes", "search", "sync", "tags", "editor", "export", "import", "links", "backlinks", "attachments", "settings", "dates"];
		let out = "> notes-app@3.2.0 test\n> vitest run\n\n";
		let failed = 0;
		for (const s of suites) {
			const bad = failing.includes(s);
			out += ` ${bad ? "❯" : "✓"} src/${s}/${s}.test.ts (${8 + rnd(30)} tests) ${200 + rnd(900)}ms\n`;
			for (let i = 1; i <= Math.round(8 * scale); i++) {
				const f = bad && i % 5 === 2;
				failed += f ? 1 : 0;
				out += `   ${f ? "×" : "✓"} ${s} › ${ident()} handles ${two()} ${i}\n`;
				if (f)
					out += `     → expected [ 'n-${i}a', 'n-${i}b' ] to deeply equal [ 'n-${i}b', 'n-${i}a' ]\n       at src/search/rank.ts:${40 + i}:18\n       at src/dates/parse.ts:${12 + i}:9\n`;
			}
		}
		out += failed ? `\n Test Files  ${failing.length} failed | ${12 - failing.length} passed (12)\n      Tests  ${failed} failed | ${300 - failed} passed (300)\n` : "\n Test Files  12 passed (12)\n      Tests  300 passed (300)\n";
		return out + `   Duration  ${(9 + rnd(6)).toFixed(2)}s\n`;
	},
	source(scale, file) {
		let out = `// ${file}\nimport { Temporal } from "@js-temporal/polyfill";\nimport type { Note, Query } from "../types";\n\n`;
		for (let i = 0; i < Math.round(14 * scale); i++) {
			const fn = ident();
			out += `/** ${fn}: ${pick(verbs)}s a ${pick(words)} before ${pick(verbs)}ing its ${pick(words)}s. */\nexport function ${fn}(note: Note, q: Query): number {\n`;
			out += `  const created = Temporal.Instant.from(note.createdAt);\n  const ${pick(words)} = q.terms.filter((t) => note.body.includes(t)).length;\n`;
			out += `  if (!note.timeZone) return created.epochMilliseconds; // legacy notes have no zone\n`;
			out += `  return created.toZonedDateTimeISO(note.timeZone).epochMilliseconds + ${rnd(500)};\n}\n\n`;
		}
		return out;
	},
	grep(scale, pattern) {
		let out = "";
		for (let i = 0; i < Math.round(30 * scale); i++) out += `src/${pick(words)}/${ident()}.ts:${1 + rnd(400)}:  const t = ${pattern}(note.${pick(["createdAt", "updatedAt", "syncedAt"])}); // ${pick(words)}\n`;
		return out;
	},
	diff(scale) {
		let out = "";
		for (let f = 0; f < Math.round(10 * scale); f++) {
			const file = `src/${pick(words)}/${ident()}.ts`;
			out += `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${10 + rnd(200)},12 +${10 + rnd(200)},14 @@\n`;
			for (let l = 0; l < 14; l++) out += `${l % 4 === 0 ? "-" : l % 4 === 1 ? "+" : " "}  const ${pick(words)} = ${ident()}(note, q); // ${two()}\n`;
		}
		return out;
	},
	deps(scale) {
		let out = "notes-app@3.2.0 /work/notes-app\n";
		const pkgs = ["vitest", "typescript", "@js-temporal/polyfill", "date-fns", "markdown-it", "minisearch", "zod", "esbuild", "prettier", "eslint", "chokidar", "fast-glob", "yaml", "picocolors"];
		for (let i = 0; i < Math.round(60 * scale); i++) out += `${"│ ".repeat(rnd(4))}├── ${pick(pkgs)}@${1 + rnd(9)}.${rnd(20)}.${rnd(10)}${rnd(5) ? "" : " deduped"}\n`;
		return out;
	},
	lint(scale) {
		let out = "";
		for (let i = 0; i < Math.round(12 * scale); i++) out += `src/${pick(words)}/${ident()}.ts\n  ${1 + rnd(300)}:${1 + rnd(40)}  warning  '${pick(words)}' is assigned a value but never used  no-unused-vars\n`;
		return out + `\n✖ ${Math.round(12 * scale)} problems (0 errors, ${Math.round(12 * scale)} warnings)\n`;
	},
	doc(scale, title) {
		let out = `# ${title}\n\n`;
		for (let i = 0; i < Math.round(10 * scale); i++) out += `## ${two()}\n\nWhen you ${pick(verbs)} a ${pick(words)}, the app ${pick(verbs)}s its ${pick(words)}s and ${pick(verbs)}s the ${pick(words)} index. Dates are stored as ISO instants with the note's time zone.\n\n`;
		return out;
	},
};

// ---------- the conversation ----------

function script(scale) {
	const T = [];
	const turn = (text, steps, reply) => T.push({ text, steps, reply });
	turn(
		"Search results come back in the wrong order since we moved date parsing to Temporal. Can you look into it?",
		[
			["bash", { command: "npm test" }, gen.testRun(scale, ["search", "sync", "dates"]), "Let me run the tests first to see what fails."],
			["read", { path: "src/search/rank.ts" }, gen.source(scale * 2.2, "src/search/rank.ts")],
			["read", { path: "src/dates/parse.ts" }, gen.source(scale * 1.2, "src/dates/parse.ts")],
			["bash", { command: "rg -n 'toEpoch|epochMilliseconds' src" }, gen.grep(scale, "toEpoch")],
		],
		"Found it. `rank.ts` sorts by `epochMilliseconds`, but since the Temporal migration notes without a time zone fall back to the raw instant while zoned notes are shifted, so the two kinds of notes no longer sort together.",
	);
	turn("Is sync affected too?", [
		["read", { path: "src/sync/merge.ts" }, gen.source(scale * 1.8, "src/sync/merge.ts")],
		["bash", { command: "npm test -- sync" }, gen.testRun(scale * 0.6, ["sync"])],
	], "Yes. `merge.ts` uses the same helper to decide which copy of a note is newer, so conflicts resolve in the wrong direction across time zones.");
	turn("Fix both and keep the old behavior for notes without a time zone.", [
		["edit", { path: "src/dates/parse.ts" }, "Successfully replaced 2 block(s) in src/dates/parse.ts."],
		["edit", { path: "src/search/rank.ts" }, "Successfully replaced 1 block(s) in src/search/rank.ts."],
		["bash", { command: "npm test" }, gen.testRun(scale, ["sync"])],
		["edit", { path: "src/sync/merge.ts" }, "Successfully replaced 1 block(s) in src/sync/merge.ts."],
		["bash", { command: "npm test" }, gen.testRun(scale)],
	], "Both fixed. Every comparison now goes through one `toInstant()` helper, and notes without a zone keep the old UTC behavior. All 300 tests pass.");
	turn("Add regression tests for notes created across DST changes.", [
		["write", { path: "src/dates/dst.test.ts" }, "Wrote 2.1 KB to src/dates/dst.test.ts."],
		["bash", { command: "npm test -- dates" }, gen.testRun(scale * 0.5)],
	], "Added eight cases around the March and November DST switches, in three time zones. They pass.");
	turn("Run the linter and the type checker.", [
		["bash", { command: "npm run lint" }, gen.lint(scale * 2)],
		["bash", { command: "npx tsc --noEmit" }, gen.lint(scale).replace(/warning/g, "error TS2345")],
		["edit", { path: "src/sync/merge.ts" }, "Successfully replaced 1 block(s) in src/sync/merge.ts."],
		["bash", { command: "npx tsc --noEmit" }, ""],
	], "The type errors came from the old `Date` signature in two callers; fixed. The lint warnings are pre-existing unused variables, I left them alone.");
	turn("Show me the full diff before I commit.", [["bash", { command: "git diff" }, gen.diff(scale * 2.5)]], "The diff touches the date helper, the two callers and adds the DST tests. Nothing else changed.");
	turn("Update the changelog and the docs page about search.", [
		["read", { path: "docs/search.md" }, gen.doc(scale * 2, "Search")],
		["edit", { path: "docs/search.md" }, "Successfully replaced 1 block(s) in docs/search.md."],
		["read", { path: "CHANGELOG.md" }, gen.doc(scale * 2.4, "Changelog")],
		["edit", { path: "CHANGELOG.md" }, "Successfully replaced 1 block(s) in CHANGELOG.md."],
	], "Docs and changelog updated: search order now follows each note's local time.");
	turn("Why is the export test so slow?", [
		["bash", { command: "npm test -- export --reporter verbose" }, gen.testRun(scale * 1.4)],
		["read", { path: "src/export/pdf.ts" }, gen.source(scale * 2, "src/export/pdf.ts")],
	], "The PDF export renders every attachment at full size before scaling it down. Caching the scaled versions would cut most of the time.");
	turn("Leave that for later. Which date libraries do we still depend on?", [
		["bash", { command: "npm ls --all" }, gen.deps(scale * 3)],
		["bash", { command: "rg -n 'date-fns|Temporal' src" }, gen.grep(scale, "parseISO")],
	], "Only `@js-temporal/polyfill` is used now. `date-fns` is still installed but nothing imports it.");
	turn("Remove date-fns then.", [
		["edit", { path: "package.json" }, "Successfully replaced 1 block(s) in package.json."],
		["bash", { command: "npm install" }, "removed 1 package, and audited 412 packages in 3s\n\nfound 0 vulnerabilities\n"],
		["bash", { command: "npm test" }, gen.testRun(scale)],
	], "Removed. All tests still pass.");
	turn("Write a short summary for the PR.", [], "**Fix search and sync order across time zones.** Since the Temporal migration, notes without a time zone sorted apart from zoned ones. All comparisons now use one helper; legacy notes keep UTC. Adds DST regression tests, updates the search docs and the changelog, and drops the unused `date-fns`.");
	return T;
}

// ---------- write the session ----------

function render(scale) {
	const start = Date.parse("2026-10-14T13:00:00Z");
	let clock = start;
	let parent = null;
	let callN = 0;
	let context = 12_000; // system prompt + tools, roughly
	const lines = [{ type: "session", version: 3, id: randomUUID(), timestamp: new Date(start).toISOString(), cwd }];
	const id8 = () => randomUUID().replace(/-/g, "").slice(0, 8);
	const entry = (message) => {
		clock += 4000 + rnd(9000);
		const id = id8();
		lines.push({ type: "message", id, parentId: parent, timestamp: new Date(clock).toISOString(), message: { ...message, timestamp: clock } });
		parent = id;
	};
	const assistant = (content, stopReason) => {
		const output = 80 + Math.round(JSON.stringify(content).length / 4);
		context += output;
		const cost = 0.0015 + output * 0.000015 + context * 0.0000003;
		entry({
			role: "assistant",
			content,
			api,
			provider,
			model,
			usage: { input: 500, output, cacheRead: Math.max(0, context - 500 - output), cacheWrite: 0, totalTokens: context, cost: { input: 0.0015, output: output * 0.000015, cacheRead: context * 0.0000003, cacheWrite: 0, total: cost } },
			stopReason,
		});
	};
	for (const t of script(scale)) {
		entry({ role: "user", content: t.text });
		context += Math.round(t.text.length / 4);
		for (const [name, args, result, text] of t.steps) {
			const id = `toolu_demo_${++callN}`;
			assistant([...(text ? [{ type: "text", text }] : []), { type: "toolCall", id, name, arguments: args }], "toolUse");
			entry({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: result }], isError: false });
			context += Math.round(result.length / 4);
		}
		assistant([{ type: "text", text: t.reply }], "stop");
	}
	return { lines, context };
}

// size the session: the tool output scales roughly linearly
seed = 7;
let { context } = render(1);
const scale = Math.max(0.2, (target - 12_000) / Math.max(1, context - 12_000));
seed = 7;
const out = render(scale);
for (const l of out.lines) process.stdout.write(`${JSON.stringify(l)}\n`);
process.stderr.write(`demo session: ${out.lines.length - 1} entries, ~${Math.round(out.context / 1000)}k context tokens\n`);
