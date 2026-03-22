import { assertEquals, assertRejects } from "@std/assert";
import { loadConfig } from "../src/lib/config.ts";
import { join } from "@std/path";

Deno.test("loadConfig - loads from config file", async () => {
	const tmpDir = await Deno.makeTempDir();
	const root1 = join(tmpDir, "root1");
	const root2 = join(tmpDir, "root2");
	await Deno.mkdir(root1);
	await Deno.mkdir(root2);

	const configPath = join(tmpDir, "mcp.config.json");
	await Deno.writeTextFile(
		configPath,
		JSON.stringify({ packageRoots: [root1, root2] }),
	);

	const config = await loadConfig(["--config", configPath]);
	assertEquals(config.packageRoots.length, 2);
	assertEquals(config.packageRoots[0].path, root1);
	assertEquals(config.packageRoots[1].path, root2);

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("loadConfig - resolves relative paths from config dir", async () => {
	const tmpDir = await Deno.makeTempDir();
	const root = join(tmpDir, "packages");
	await Deno.mkdir(root);

	const configPath = join(tmpDir, "mcp.config.json");
	await Deno.writeTextFile(
		configPath,
		JSON.stringify({ packageRoots: ["./packages"] }),
	);

	const config = await loadConfig(["--config", configPath]);
	assertEquals(config.packageRoots[0].path, root);

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("loadConfig - skips non-existent roots with warning", async () => {
	const tmpDir = await Deno.makeTempDir();
	const validRoot = join(tmpDir, "valid");
	await Deno.mkdir(validRoot);

	const configPath = join(tmpDir, "mcp.config.json");
	await Deno.writeTextFile(
		configPath,
		JSON.stringify({
			packageRoots: [validRoot, "/nonexistent/path"],
		}),
	);

	const config = await loadConfig(["--config", configPath]);
	assertEquals(config.packageRoots.length, 1);
	assertEquals(config.packageRoots[0].path, validRoot);

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("loadConfig - throws on empty packageRoots", async () => {
	const tmpDir = await Deno.makeTempDir();
	const configPath = join(tmpDir, "mcp.config.json");
	await Deno.writeTextFile(
		configPath,
		JSON.stringify({ packageRoots: [] }),
	);

	await assertRejects(
		() => loadConfig(["--config", configPath]),
		Error,
		"non-empty",
	);

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("loadConfig - normalizes mixed string and object roots", async () => {
	const tmpDir = await Deno.makeTempDir();
	const root1 = join(tmpDir, "root1");
	const root2 = join(tmpDir, "root2");
	await Deno.mkdir(root1);
	await Deno.mkdir(root2);

	const configPath = join(tmpDir, "mcp.config.json");
	await Deno.writeTextFile(
		configPath,
		JSON.stringify({
			packageRoots: [
				root1,
				{ path: root2, include: ["pkg-a"], marker: ".mcp" },
			],
		}),
	);

	const config = await loadConfig(["--config", configPath]);
	assertEquals(config.packageRoots.length, 2);
	assertEquals(config.packageRoots[0].path, root1);
	assertEquals(config.packageRoots[0].include, undefined);
	assertEquals(config.packageRoots[1].path, root2);
	assertEquals(config.packageRoots[1].include, ["pkg-a"]);
	assertEquals(config.packageRoots[1].marker, ".mcp");

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("loadConfig - rejects include + exclude on same root", async () => {
	const tmpDir = await Deno.makeTempDir();
	const root = join(tmpDir, "root");
	await Deno.mkdir(root);

	const configPath = join(tmpDir, "mcp.config.json");
	await Deno.writeTextFile(
		configPath,
		JSON.stringify({
			packageRoots: [
				{ path: root, include: ["a"], exclude: ["b"] },
			],
		}),
	);

	await assertRejects(
		() => loadConfig(["--config", configPath]),
		Error,
		"mutually exclusive",
	);

	await Deno.remove(tmpDir, { recursive: true });
});
