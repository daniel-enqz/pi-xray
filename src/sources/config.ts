/**
 * Config layer: what is installed and what loads after a reload, resolved by
 * pi itself (same resolution `pi config` uses). Never installs anything.
 */
import * as os from "node:os";
import { DefaultPackageManager, SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { BUILTIN_EXTENSIONS, type ConfigData, type ConfigResource, type ResourceType, packageLabel } from "../catalog";
import { realpath } from "./live";

export async function readConfig(cwd: string): Promise<ConfigData> {
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const pm = new DefaultPackageManager({ cwd, agentDir, settingsManager, builtinExtensions: BUILTIN_EXTENSIONS });
	// without onMissing, resolve() installs missing packages
	const resolved = await pm.resolve(async () => "skip");
	const packages = pm.listConfiguredPackages().map((p) => ({
		source: p.source,
		label: packageLabel(p.source, p.installedPath),
		installedPath: p.installedPath,
		scope: p.scope,
	}));
	const resources: ConfigResource[] = [];
	for (const type of ["extensions", "skills", "prompts", "themes"] as ResourceType[]) {
		for (const r of resolved[type]) {
			if (r.metadata.scope === "temporary") continue; // `pi -e` extensions are not configuration
			resources.push({
				type,
				path: r.path,
				real: r.path.startsWith("builtin:") ? r.path : realpath(r.path),
				enabled: r.enabled,
				source: r.metadata.source,
				scope: r.metadata.scope,
				origin: r.metadata.origin,
				baseDir: r.metadata.baseDir,
			});
		}
	}
	return { agentDir, home: os.homedir(), packages, resources };
}
