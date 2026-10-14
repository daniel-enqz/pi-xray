// Test runner: loads the TypeScript tests with pi's own jiti and aliases the
// host packages to a real pi install. Resolution order:
//   1. PI_PKG env var (path to @earendil-works/pi-coding-agent)
//   2. node_modules of this repo (devDependency, what CI uses)
//   3. the `pi` binary on PATH (a global install)
// Usage: node test/run.mjs [filter]
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const NAME = "@earendil-works/pi-coding-agent";
const isPi = (dir) => {
	const pj = join(dir, "package.json");
	return existsSync(pj) && JSON.parse(readFileSync(pj, "utf8")).name === NAME;
};
function walkUp(start) {
	let dir = start;
	while (dir !== dirname(dir)) {
		if (isPi(dir)) return dir;
		dir = dirname(dir);
	}
	return undefined;
}
function piPackageDir() {
	if (process.env.PI_PKG) return process.env.PI_PKG;
	try {
		const found = walkUp(dirname(fileURLToPath(import.meta.resolve(NAME))));
		if (found) return found;
	} catch {
		// not installed locally
	}
	const bin = execSync("command -v pi", { shell: "/bin/sh" }).toString().trim();
	const found = bin && walkUp(dirname(realpathSync(bin)));
	if (found) return found;
	throw new Error(`${NAME} not found: run npm install, or set PI_PKG`);
}
/** a dependency of pi: nested under pi, or hoisted next to it */
function piDep(pi, name) {
	for (const dir of [join(pi, "node_modules", name), join(pi, "..", "..", name), join(pi, "..", name)]) if (existsSync(join(dir, "package.json"))) return dir;
	throw new Error(`${name} not found next to ${pi}`);
}

const PI = piPackageDir();
const TUI = piDep(PI, "@earendil-works/pi-tui");
const JITI = piDep(PI, "jiti");
const { createJiti } = await import(pathToFileURL(join(JITI, "lib/jiti.mjs")).href);
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-tui": join(TUI, "dist/index.js"),
		[NAME]: join(PI, "dist/index.js"),
	},
	interopDefault: true,
});
globalThis.__PI_PKG = PI;
globalThis.__JITI = jiti;
console.log(`# pi ${JSON.parse(readFileSync(join(PI, "package.json"), "utf8")).version} from ${PI}`);

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] ?? "";
for (const f of readdirSync(here).filter((f) => f.endsWith(".test.ts") && f.includes(filter)).sort()) {
	await jiti.import(join(here, f));
}
