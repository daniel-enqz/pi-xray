/**
 * Plain-text helpers. Everything that reaches the grid goes through sanitize():
 * ANSI escapes and control characters are removed, and tabs/newlines become
 * spaces (pi-tui counts a tab as 3 columns, which would break fixed widths).
 */

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export function sanitize(input: unknown): string {
	return String(input ?? "")
		.replace(ANSI, "")
		.replace(/[\t\n\r\v\f]+/g, " ")
		.replace(CONTROL, "");
}

/** 950 -> "950", 2100 -> "2.1k", 1_000_000 -> "1.0M" */
export function human(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "?";
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${Math.round(n)}`;
}

export function percent(part: number, whole: number): string {
	if (!whole || !Number.isFinite(part)) return "0.0%";
	const p = (part / whole) * 100;
	return `${p >= 99.95 ? "100" : p.toFixed(1)}%`;
}

/** Characters -> estimated tokens (pi's own heuristic is chars/4). */
export const charsToTokens = (chars: number) => Math.max(0, chars / 4);
