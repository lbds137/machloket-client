import {execSync} from "child_process";
import {dirname} from "path";
import {fileURLToPath} from "url";

// Asked of this file's own tree, not the cwd: a run launched from elsewhere still tests this tree.
const here = dirname(fileURLToPath(import.meta.url));

function git(args: string): string {
	try {
		return execSync(`git ${args}`, {
			cwd: here,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "unknown";
	}
}

/** Names the tree a test run exercises, so a run from the wrong worktree shows in its first line. */
export function printTestTree(runner: string): void {
	const branch = git("branch --show-current") || "(detached)";
	// Changes on top of the sha, untracked files included: a new spec runs without being committed.
	// No optional locks: a banner mustn't take the index lock from a git command running beside it.
	const changes = git("--no-optional-locks status --porcelain");
	const dirty = changes && changes !== "unknown" ? "+dirty" : "";
	console.log(
		`${runner}: tree=${git("rev-parse --show-toplevel")} branch=${branch} sha=${git("rev-parse --short HEAD")}${dirty}`,
	);
}
