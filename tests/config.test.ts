import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/lib/config.ts";
import { makeTmpDir } from "./helpers.ts";

test("loadConfig - loads from config file", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const root1 = join(tmpDir, "root1");
	const root2 = join(tmpDir, "root2");
	await mkdir(root1);
	await mkdir(root2);

	const configPath = join(tmpDir, "mcp.config.json");
	await writeFile(configPath, JSON.stringify({ packageRoots: [root1, root2] }));

	const config = await loadConfig(["--config", configPath]);
	assert.deepEqual(
		config.packageRoots.map((r) => r.path),
		[root1, root2],
	);
});

test("loadConfig - accepts --config=<path>", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const root = join(tmpDir, "root");
	await mkdir(root);

	const configPath = join(tmpDir, "mcp.config.json");
	await writeFile(configPath, JSON.stringify({ packageRoots: [root] }));

	const config = await loadConfig([`--config=${configPath}`]);
	assert.deepEqual(
		config.packageRoots.map((r) => r.path),
		[root],
	);
});

test("loadConfig - resolves relative paths from config dir", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const root = join(tmpDir, "packages");
	await mkdir(root);

	const configPath = join(tmpDir, "mcp.config.json");
	await writeFile(configPath, JSON.stringify({ packageRoots: ["./packages"] }));

	const config = await loadConfig(["--config", configPath]);
	assert.equal(config.packageRoots[0]?.path, root);
});

test("loadConfig - skips non-existent roots with warning", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const validRoot = join(tmpDir, "valid");
	await mkdir(validRoot);

	const configPath = join(tmpDir, "mcp.config.json");
	await writeFile(
		configPath,
		JSON.stringify({
			packageRoots: [validRoot, "/nonexistent/path"],
		}),
	);

	const config = await loadConfig(["--config", configPath]);
	assert.deepEqual(
		config.packageRoots.map((r) => r.path),
		[validRoot],
	);
});

test("loadConfig - throws on empty packageRoots", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const configPath = join(tmpDir, "mcp.config.json");
	await writeFile(configPath, JSON.stringify({ packageRoots: [] }));

	await assert.rejects(() => loadConfig(["--config", configPath]), {
		message: /non-empty/,
	});
});

test("loadConfig - normalizes mixed string and object roots", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const root1 = join(tmpDir, "root1");
	const root2 = join(tmpDir, "root2");
	await mkdir(root1);
	await mkdir(root2);

	const configPath = join(tmpDir, "mcp.config.json");
	await writeFile(
		configPath,
		JSON.stringify({
			packageRoots: [root1, { path: root2, include: ["pkg-a"], marker: ".mcp" }],
		}),
	);

	const config = await loadConfig(["--config", configPath]);
	assert.deepEqual(config.packageRoots, [
		{ path: root1 },
		{ path: root2, include: ["pkg-a"], marker: ".mcp" },
	]);
});

test("loadConfig - throws on malformed JSON with file path in message", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const configPath = join(tmpDir, "mcp.config.json");
	await writeFile(configPath, "{ this is not json }");

	await assert.rejects(() => loadConfig(["--config", configPath]), {
		message: /Invalid JSON in/,
	});
});

test("loadConfig - rejects include + exclude on same root", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const root = join(tmpDir, "root");
	await mkdir(root);

	const configPath = join(tmpDir, "mcp.config.json");
	await writeFile(
		configPath,
		JSON.stringify({
			packageRoots: [{ path: root, include: ["a"], exclude: ["b"] }],
		}),
	);

	await assert.rejects(() => loadConfig(["--config", configPath]), {
		message: /mutually exclusive/,
	});
});
