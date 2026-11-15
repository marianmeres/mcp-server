import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { discoverPackageTools } from "../src/lib/discovery.ts";
import { getPackageInfo, scanPackageDirs } from "../src/lib/fs-utils.ts";
import { makeTmpDir } from "./helpers.ts";

test("discoverPackageTools - discovers tools from mcp.ts", async (t) => {
	const tmpDir = await makeTmpDir(t, { linkNodeModules: true });
	const pkgDir = join(tmpDir, "test-pkg");
	await mkdir(pkgDir);

	await writeFile(
		join(pkgDir, "mcp.ts"),
		`
import { z } from "zod";
export const tools = [
	{
		name: "hello",
		description: "Says hello",
		params: { name: z.string() },
		handler: async ({ name }) => \`Hello, \${name}!\`,
	},
];
`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assert.equal(tools.length, 1);
	assert.equal(tools[0]?.namespacedName, "test-pkg_hello");
	assert.equal(tools[0]?.tool.description, "Says hello");

	const result = await tools[0]?.tool.handler({ name: "World" });
	assert.equal(result, "Hello, World!");
});

test("discoverPackageTools - loads a typed mcp.ts (types stripped)", async (t) => {
	const tmpDir = await makeTmpDir(t, { linkNodeModules: true });
	const pkgDir = join(tmpDir, "typed-pkg");
	await mkdir(pkgDir);

	// The shape of a real plugin: a value import resolved from the package's own
	// node_modules, plus type-only imports and annotations that Node erases.
	await writeFile(
		join(pkgDir, "mcp.ts"),
		`
import { z } from "zod";
import type { McpToolDefinition } from "@marianmeres/mcp-server/types";

export const tools: McpToolDefinition[] = [
	{
		name: "add",
		description: "Adds two numbers",
		params: { a: z.number(), b: z.number() },
		handler: async ({ a, b }): Promise<string> => String((a as number) + (b as number)),
	},
];
`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assert.equal(tools.length, 1);
	assert.equal(tools[0]?.namespacedName, "typed-pkg_add");
	assert.equal(await tools[0]?.tool.handler({ a: 2, b: 3 }), "5");
});

test("discoverPackageTools - skips dirs without mcp.ts", async (t) => {
	const tmpDir = await makeTmpDir(t);
	await mkdir(join(tmpDir, "has-mcp"));
	await mkdir(join(tmpDir, "no-mcp"));

	await writeFile(
		join(tmpDir, "has-mcp", "mcp.ts"),
		`export const tools = [{ name: "test", description: "test", params: {}, handler: async () => "ok" }];`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assert.equal(tools.length, 1);
	assert.equal(tools[0]?.namespacedName, "has-mcp_test");
});

test("discoverPackageTools - skips hidden directories", async (t) => {
	const tmpDir = await makeTmpDir(t);
	await mkdir(join(tmpDir, ".hidden"));

	await writeFile(
		join(tmpDir, ".hidden", "mcp.ts"),
		`export const tools = [{ name: "test", description: "test", params: {}, handler: async () => "ok" }];`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assert.equal(tools.length, 0);
});

test("discoverPackageTools - handles import errors gracefully", async (t) => {
	const tmpDir = await makeTmpDir(t);
	await mkdir(join(tmpDir, "broken"));

	await writeFile(
		join(tmpDir, "broken", "mcp.ts"),
		`throw new Error("intentional test error");`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assert.equal(tools.length, 0);
});

test("discoverPackageTools - unresolvable imports are skipped, not fatal", async (t) => {
	const tmpDir = await makeTmpDir(t);
	await mkdir(join(tmpDir, "deno-style"));
	await mkdir(join(tmpDir, "fine"));

	// A Deno-era plugin: Node has no `npm:` scheme, so this import fails.
	await writeFile(
		join(tmpDir, "deno-style", "mcp.ts"),
		`import { z } from "npm:zod";\nexport const tools = [{ name: "t", description: "t", params: { a: z.string() }, handler: async () => "x" }];`,
	);
	await writeFile(
		join(tmpDir, "fine", "mcp.ts"),
		`export const tools = [{ name: "t", description: "t", params: {}, handler: async () => "ok" }];`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assert.deepEqual(
		tools.map((x) => x.namespacedName),
		["fine_t"],
	);
});

test("discoverPackageTools - include filter", async (t) => {
	const tmpDir = await makeTmpDir(t);
	for (const name of ["pkg-a", "pkg-b", "pkg-c"]) {
		await mkdir(join(tmpDir, name));
		await writeFile(
			join(tmpDir, name, "mcp.ts"),
			`export const tools = [{ name: "t", description: "t", params: {}, handler: async () => "${name}" }];`,
		);
	}

	const tools = await discoverPackageTools([
		{ path: tmpDir, include: ["pkg-a", "pkg-c"] },
	]);
	assert.equal(tools.length, 2);
	const names = tools.map((t) => t.namespacedName).sort();
	assert.deepEqual(names, ["pkg-a_t", "pkg-c_t"]);
});

test("discoverPackageTools - exclude filter", async (t) => {
	const tmpDir = await makeTmpDir(t);
	for (const name of ["pkg-a", "pkg-b", "pkg-c"]) {
		await mkdir(join(tmpDir, name));
		await writeFile(
			join(tmpDir, name, "mcp.ts"),
			`export const tools = [{ name: "t", description: "t", params: {}, handler: async () => "${name}" }];`,
		);
	}

	const tools = await discoverPackageTools([{ path: tmpDir, exclude: ["pkg-b"] }]);
	assert.equal(tools.length, 2);
	const names = tools.map((t) => t.namespacedName).sort();
	assert.deepEqual(names, ["pkg-a_t", "pkg-c_t"]);
});

test("discoverPackageTools - marker file filter", async (t) => {
	const tmpDir = await makeTmpDir(t);
	for (const name of ["pkg-a", "pkg-b", "pkg-c"]) {
		await mkdir(join(tmpDir, name));
		await writeFile(
			join(tmpDir, name, "mcp.ts"),
			`export const tools = [{ name: "t", description: "t", params: {}, handler: async () => "${name}" }];`,
		);
	}

	// only pkg-b has the marker
	await writeFile(join(tmpDir, "pkg-b", "mcp-include.txt"), "");

	const tools = await discoverPackageTools([
		{ path: tmpDir, marker: "mcp-include.txt" },
	]);
	assert.equal(tools.length, 1);
	assert.equal(tools[0]?.namespacedName, "pkg-b_t");
});

test("scanPackageDirs - marker file content is yielded as markerContent", async (t) => {
	const tmpDir = await makeTmpDir(t);
	await mkdir(join(tmpDir, "pkg-a"));
	await mkdir(join(tmpDir, "pkg-b"));

	// pkg-a: marker with description content
	await writeFile(
		join(tmpDir, "pkg-a", "mcp-include.txt"),
		"A useful package for doing things",
	);
	// pkg-b: empty marker (still opts in, but no description)
	await writeFile(join(tmpDir, "pkg-b", "mcp-include.txt"), "");

	const results: { name: string; markerContent?: string }[] = [];
	for await (const dir of scanPackageDirs({
		path: tmpDir,
		marker: "mcp-include.txt",
	})) {
		results.push({ name: dir.name, markerContent: dir.markerContent });
	}

	results.sort((a, b) => a.name.localeCompare(b.name));
	assert.deepEqual(results, [
		{ name: "pkg-a", markerContent: "A useful package for doing things" },
		{ name: "pkg-b", markerContent: undefined },
	]);
});

test("discoverPackageTools - dedupes duplicate tool names within a package", async (t) => {
	const tmpDir = await makeTmpDir(t, { linkNodeModules: true });
	const pkgDir = join(tmpDir, "dup-pkg");
	await mkdir(pkgDir);

	await writeFile(
		join(pkgDir, "mcp.ts"),
		`
import { z } from "zod";
export const tools = [
	{ name: "echo", description: "first", params: {}, handler: async () => "first" },
	{ name: "echo", description: "second", params: {}, handler: async () => "second" },
	{ name: "other", description: "third", params: {}, handler: async () => "third" },
];
`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assert.equal(tools.length, 2);
	const names = tools.map((t) => t.namespacedName).sort();
	assert.deepEqual(names, ["dup-pkg_echo", "dup-pkg_other"]);
});

test("discoverPackageTools - skips malformed tool definitions", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const pkgDir = join(tmpDir, "bad-pkg");
	await mkdir(pkgDir);

	// Mix of valid + several malformed entries
	await writeFile(
		join(pkgDir, "mcp.ts"),
		`
export const tools = [
	{ name: "good", description: "ok", params: {}, handler: async () => "ok" },
	{ name: "missing-handler", description: "x", params: {} },
	{ description: "no name", params: {}, handler: async () => "x" },
	{ name: "bad-params", description: "x", params: null, handler: async () => "x" },
	{ name: "bad-desc", description: 42, params: {}, handler: async () => "x" },
];
`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assert.equal(tools.length, 1);
	assert.equal(tools[0]?.namespacedName, "bad-pkg_good");
});

test("discoverPackageTools - disambiguates roots with the same basename", async (t) => {
	const tmpDir = await makeTmpDir(t);
	const rootA = join(tmpDir, "a", "packages");
	const rootB = join(tmpDir, "b", "packages");
	await mkdir(rootA, { recursive: true });
	await mkdir(rootB, { recursive: true });

	// Same dir name in both roots → collision triggers prefixed naming
	for (const root of [rootA, rootB]) {
		await mkdir(join(root, "shared-pkg"));
		await writeFile(
			join(root, "shared-pkg", "mcp.ts"),
			`export const tools = [{ name: "t", description: "t", params: {}, handler: async () => "ok" }];`,
		);
	}

	const tools = await discoverPackageTools([{ path: rootA }, { path: rootB }]);
	assert.equal(tools.length, 2);
	const names = tools.map((t) => t.namespacedName).sort();
	// Both roots have basename "packages"; second should be disambiguated.
	assert.deepEqual(names, ["packages--shared-pkg_t", "packages-2--shared-pkg_t"]);
});

test("getPackageInfo - markerContent used as fallback description", async (t) => {
	const tmpDir = await makeTmpDir(t);
	await mkdir(join(tmpDir, "my-pkg"));

	// no deno.json, so description would be empty without marker content
	const info = await getPackageInfo(
		join(tmpDir, "my-pkg"),
		"my-pkg",
		"Description from marker",
	);
	assert.equal(info.description, "Description from marker");
	assert.equal(info.name, "my-pkg");

	// now add a deno.json with description — it should take precedence
	await writeFile(
		join(tmpDir, "my-pkg", "deno.json"),
		JSON.stringify({ name: "my-pkg", description: "From deno.json" }),
	);
	const info2 = await getPackageInfo(
		join(tmpDir, "my-pkg"),
		"my-pkg",
		"Description from marker",
	);
	assert.equal(info2.description, "From deno.json");
});
