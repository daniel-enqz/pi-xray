// Writes a sample pi session (JSONL) for the demo recording: a short debugging
// session in a made-up project, with real-looking tool calls and some heavy
// tool results, so /xray has a conversation to show.
// Usage: [DEMO_MODEL=provider/model] node demo/make-session.mjs <project-dir> > session.jsonl
// DEMO_MODEL should be a model your pi can use, or pi warns that it cannot restore it.
import { randomUUID } from "node:crypto";

const cwd = process.argv[2] ?? process.cwd();
const [provider, ...modelParts] = (process.env.DEMO_MODEL ?? "anthropic/claude-sonnet-4-5").split("/");
const model = modelParts.join("/");
const api = provider === "google" ? "google-generative-ai" : provider === "openai" ? "openai-responses" : "anthropic-messages";
const start = Date.parse("2026-10-14T15:00:00Z");
let clock = start;
let parent = null;
let callN = 0;
const lines = [];
const hex = () => randomUUID().replace(/-/g, "").slice(0, 8);
const tick = (s = 7) => (clock += s * 1000);

lines.push({ type: "session", version: 3, id: randomUUID(), timestamp: new Date(start).toISOString(), cwd });

function entry(message) {
	const id = hex();
	lines.push({ type: "message", id, parentId: parent, timestamp: new Date(tick()).toISOString(), message: { ...message, timestamp: clock } });
	parent = id;
}

const user = (text) => entry({ role: "user", content: text });

let contextTokens = 9_000;
function assistant(blocks, stopReason = "toolUse") {
	const content = blocks.map((b) => (typeof b === "string" ? { type: "text", text: b } : b));
	const output = 120 + Math.round(JSON.stringify(content).length / 4);
	contextTokens += output;
	entry({
		role: "assistant",
		content,
		api,
		provider,
		model,
		usage: {
			input: 600,
			output,
			cacheRead: contextTokens - 600 - output,
			cacheWrite: 0,
			totalTokens: contextTokens,
			cost: { input: 0.0018, output: output * 0.000015, cacheRead: contextTokens * 0.0000003, cacheWrite: 0, total: 0.0018 + output * 0.000015 + contextTokens * 0.0000003 },
		},
		stopReason,
	});
}

function call(name, args, result, text) {
	const id = `toolu_demo_${++callN}`;
	assistant([...(text ? [text] : []), { type: "toolCall", id, name, arguments: args }]);
	entry({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: result }], isError: false });
	contextTokens += Math.round(result.length / 4);
}

// ---------- fake but plausible tool output ----------

function testRun(failing) {
	const suites = ["cart", "checkout", "discounts", "inventory", "orders", "payments", "shipping", "taxes", "users", "webhooks"];
	let out = "> acme-api@2.4.0 test\n> jest --ci\n\n";
	for (const s of suites) {
		const bad = failing && (s === "checkout" || s === "discounts");
		out += `${bad ? "FAIL" : "PASS"} src/${s}/${s}.test.ts (${(1 + s.length / 7).toFixed(2)} s)\n`;
		for (let i = 1; i <= 12; i++) {
			const fail = bad && i % 4 === 1;
			out += `  ${fail ? "✕" : "✓"} ${s}: handles case ${i} (${3 + ((i * 7) % 40)} ms)\n`;
			if (fail)
				out += `\n  ● ${s} › handles case ${i}\n\n    expect(received).toBe(expected)\n\n    Expected: 4250\n    Received: 42.5\n\n      at Object.<anonymous> (src/${s}/${s}.test.ts:${40 + i}:31)\n      at applyDiscount (src/pricing/discounts.ts:58:12)\n      at priceOrder (src/checkout/price-order.ts:27:18)\n\n`;
		}
	}
	out += failing
		? "\nTest Suites: 2 failed, 8 passed, 10 total\nTests:       6 failed, 114 passed, 120 total\nTime:        14.82 s\n"
		: "\nTest Suites: 10 passed, 10 total\nTests:       120 passed, 120 total\nTime:        13.97 s\n";
	return out;
}

function sourceFile() {
	let out = 'import { Money, toCents } from "../money";\nimport type { Discount, Order } from "../types";\n\n';
	const fns = ["percentOff", "fixedOff", "buyXGetY", "tiered", "bundle", "loyalty", "seasonal", "firstOrder", "referral", "clearance"];
	for (const f of fns) {
		out += `/** ${f} discount: see docs/pricing.md#${f} */\nexport function ${f}(order: Order, d: Discount): Money {\n`;
		out += `  const base = order.lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);\n`;
		out += `  if (base <= 0 || !d.active) return 0;\n  const capped = Math.min(base, d.maxAmount ?? base);\n`;
		out += `  // amounts are in cents since the pricing refactor (#412)\n  return Math.round(capped * (d.rate ?? 0));\n}\n\n`;
	}
	out += "export function applyDiscount(order: Order, discounts: Discount[]): Money {\n  let total = 0;\n  for (const d of discounts) total += DISCOUNTS[d.kind](order, d);\n  return total / 100; // <- still converts to dollars\n}\n";
	return out;
}

function gitLog() {
	const msgs = ["refactor(pricing): store every amount in cents", "feat(discounts): tiered discounts", "fix(taxes): round per line", "chore: bump jest", "feat(checkout): bundle pricing", "fix(discounts): cap loyalty discount", "test(pricing): money fixtures", "refactor(money): Money type"];
	let out = "";
	for (let i = 0; i < 36; i++) out += `${(0x9a3f12c + i * 7919).toString(16).slice(0, 7)} ${msgs[i % msgs.length]}${i ? "" : " (#412)"}\n`;
	return out;
}

function grep() {
	let out = "";
	const files = ["checkout/price-order.ts", "checkout/summary.ts", "orders/create.ts", "orders/refund.ts", "pricing/discounts.ts", "pricing/quote.ts", "cart/totals.ts", "webhooks/stripe.ts"];
	for (const f of files) for (let l = 1; l <= 6; l++) out += `src/${f}:${l * 13}:    const discount = applyDiscount(order, order.discounts); // ${l % 2 ? "cents" : "dollars?"}\n`;
	return out;
}

// ---------- the session ----------

user("The checkout tests started failing after the pricing refactor. Can you find out why?");
call("bash", { command: "npm test" }, testRun(true), "Let me run the test suite first to see what is failing.");
call("read", { path: "src/pricing/discounts.ts" }, sourceFile());
call("bash", { command: "git log --oneline -36 -- src/pricing" }, gitLog());
call("bash", { command: "rg -n 'applyDiscount\\(' src" }, grep());
assistant(
	[
		"Found it. The pricing refactor in #412 moved every amount to cents, but `applyDiscount` in `src/pricing/discounts.ts` still divides the total by 100 before returning it. Checkout now receives `42.5` where it expects `4250` cents, which is exactly what the six failing tests report. The other callers already expect cents, so the fix is to drop that division.",
	],
	"stop",
);
user("Makes sense. Fix it and run the tests again.");
call("edit", { path: "src/pricing/discounts.ts", edits: [{ oldText: "  return total / 100; // <- still converts to dollars", newText: "  return total;" }] }, "Successfully replaced 1 block(s) in src/pricing/discounts.ts.");
call("bash", { command: "npm test" }, testRun(false));
assistant(["Fixed. `applyDiscount` now returns cents like the rest of the pricing module, and all 120 tests pass."], "stop");

for (const l of lines) process.stdout.write(`${JSON.stringify(l)}\n`);
