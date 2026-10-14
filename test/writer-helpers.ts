import { toggleTarget } from "../src/catalog";

/** Build the toggle target the catalog would compute for a pi ResolvedResource-like item. */
export function catalogTarget(it: { path: string; type: string; meta: any; enabled?: boolean }, agentDir: string) {
	const t = toggleTarget(
		{ type: it.type as any, path: it.path, real: it.path, enabled: it.enabled ?? true, source: it.meta.source, scope: it.meta.scope, origin: it.meta.origin, baseDir: it.meta.baseDir },
		agentDir,
	);
	if (!t) throw new Error("no target");
	return t;
}
