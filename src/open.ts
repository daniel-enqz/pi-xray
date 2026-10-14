/** Open a file in an editor in a tmux side pane. Returns a status message. */
import { spawn } from "node:child_process";

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function openInPane(file: string): string {
	if (!process.env.TMUX) return `not inside tmux, open it yourself: ${file}`;
	const editor = process.env.VISUAL || process.env.EDITOR || "vim";
	try {
		const child = spawn("tmux", ["split-window", "-h", `${editor} ${quote(file)}`], { detached: true, stdio: "ignore" });
		child.on("error", () => {});
		child.unref();
		return `opened in a tmux pane: ${file}`;
	} catch (e: any) {
		return `could not open: ${e?.message ?? e}`;
	}
}
