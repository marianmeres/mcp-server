import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

const REPO_NODE_MODULES = join(import.meta.dirname, "..", "node_modules");

/**
 * Create a fresh temp directory, removed when the test ends.
 *
 * With `linkNodeModules`, the directory gets a `node_modules` symlink to this repo's
 * own, so fixture `mcp.ts` files can `import { z } from "zod"`. Node resolves a
 * plugin's bare imports from the plugin's location, never from the server's, so this
 * stands in for the package's own installed dependencies.
 */
export async function makeTmpDir(
	t: TestContext,
	options: { linkNodeModules?: boolean } = {},
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "mcp-server-test-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	if (options.linkNodeModules) {
		await symlink(REPO_NODE_MODULES, join(dir, "node_modules"), "dir");
	}
	return dir;
}
