/**
 * settings.json writer. Pure: (settings slice, changes) -> new slice with only
 * the keys that changed. Produces the same shape `pi config` writes:
 *
 *  - package resource: the string entry becomes { source }, previous +/-/!
 *    entries for the same pattern are removed, "+pattern" or "-pattern" is
 *    appended, and the object collapses back to a string when no filters remain;
 *  - top-level resource: same algorithm on settings.<type>.
 */
import type { ResourceType, ToggleTarget } from "./catalog";

export interface SettingsSlice {
	packages?: Array<string | Record<string, unknown>>;
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
}

export interface Change {
	target: ToggleTarget;
	enabled: boolean;
}

const TYPES: ResourceType[] = ["extensions", "skills", "prompts", "themes"];
const strip = (p: string) => (p.startsWith("!") || p.startsWith("+") || p.startsWith("-") ? p.slice(1) : p);

function withPattern(current: unknown, pattern: string, enabled: boolean): string[] {
	const list = Array.isArray(current) ? (current as string[]).filter((p) => typeof p === "string") : [];
	return [...list.filter((p) => strip(p) !== pattern), `${enabled ? "+" : "-"}${pattern}`];
}

export function applyChanges(settings: SettingsSlice, changes: Change[]): SettingsSlice {
	const out: SettingsSlice = {};
	let packages: Array<string | Record<string, unknown>> | undefined;

	for (const { target, enabled } of changes) {
		if (target.kind === "package") {
			packages ??= (settings.packages ?? []).map((p) => (typeof p === "string" ? p : structuredClone(p)));
			const idx = packages.findIndex((p) => (typeof p === "string" ? p : p.source) === target.source);
			if (idx < 0) throw new Error(`package not found in settings: ${target.source}`);
			const entry = packages[idx];
			const pkg: Record<string, unknown> = typeof entry === "string" ? { source: entry } : entry;
			const updated = withPattern(pkg[target.type], target.pattern, enabled);
			if (updated.length) pkg[target.type] = updated;
			else delete pkg[target.type];
			packages[idx] = TYPES.some((t) => pkg[t] !== undefined) ? pkg : (pkg.source as string);
			out.packages = packages;
		} else {
			const current = out[target.type] ?? settings[target.type];
			out[target.type] = withPattern(current, target.pattern, enabled);
		}
	}
	return out;
}
