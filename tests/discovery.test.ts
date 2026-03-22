import { assertEquals } from "@std/assert";
import { discoverPackageTools } from "../src/lib/discovery.ts";
import { join } from "@std/path";

Deno.test("discoverPackageTools - discovers tools from mcp.ts", async () => {
	const tmpDir = await Deno.makeTempDir();
	const pkgDir = join(tmpDir, "test-pkg");
	await Deno.mkdir(pkgDir);

	await Deno.writeTextFile(
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
	assertEquals(tools.length, 1);
	assertEquals(tools[0].namespacedName, "test-pkg:hello");
	assertEquals(tools[0].tool.description, "Says hello");

	const result = await tools[0].tool.handler({ name: "World" });
	assertEquals(result, "Hello, World!");

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("discoverPackageTools - skips dirs without mcp.ts", async () => {
	const tmpDir = await Deno.makeTempDir();
	await Deno.mkdir(join(tmpDir, "has-mcp"));
	await Deno.mkdir(join(tmpDir, "no-mcp"));

	await Deno.writeTextFile(
		join(tmpDir, "has-mcp", "mcp.ts"),
		`export const tools = [{ name: "test", description: "test", params: {}, handler: async () => "ok" }];`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assertEquals(tools.length, 1);
	assertEquals(tools[0].namespacedName, "has-mcp:test");

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("discoverPackageTools - skips hidden directories", async () => {
	const tmpDir = await Deno.makeTempDir();
	await Deno.mkdir(join(tmpDir, ".hidden"));

	await Deno.writeTextFile(
		join(tmpDir, ".hidden", "mcp.ts"),
		`export const tools = [{ name: "test", description: "test", params: {}, handler: async () => "ok" }];`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assertEquals(tools.length, 0);

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("discoverPackageTools - handles import errors gracefully", async () => {
	const tmpDir = await Deno.makeTempDir();
	await Deno.mkdir(join(tmpDir, "broken"));

	await Deno.writeTextFile(
		join(tmpDir, "broken", "mcp.ts"),
		`throw new Error("intentional test error");`,
	);

	const tools = await discoverPackageTools([{ path: tmpDir }]);
	assertEquals(tools.length, 0);

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("discoverPackageTools - include filter", async () => {
	const tmpDir = await Deno.makeTempDir();
	for (const name of ["pkg-a", "pkg-b", "pkg-c"]) {
		await Deno.mkdir(join(tmpDir, name));
		await Deno.writeTextFile(
			join(tmpDir, name, "mcp.ts"),
			`export const tools = [{ name: "t", description: "t", params: {}, handler: async () => "${name}" }];`,
		);
	}

	const tools = await discoverPackageTools([
		{ path: tmpDir, include: ["pkg-a", "pkg-c"] },
	]);
	assertEquals(tools.length, 2);
	const names = tools.map((t) => t.namespacedName).sort();
	assertEquals(names, ["pkg-a:t", "pkg-c:t"]);

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("discoverPackageTools - exclude filter", async () => {
	const tmpDir = await Deno.makeTempDir();
	for (const name of ["pkg-a", "pkg-b", "pkg-c"]) {
		await Deno.mkdir(join(tmpDir, name));
		await Deno.writeTextFile(
			join(tmpDir, name, "mcp.ts"),
			`export const tools = [{ name: "t", description: "t", params: {}, handler: async () => "${name}" }];`,
		);
	}

	const tools = await discoverPackageTools([
		{ path: tmpDir, exclude: ["pkg-b"] },
	]);
	assertEquals(tools.length, 2);
	const names = tools.map((t) => t.namespacedName).sort();
	assertEquals(names, ["pkg-a:t", "pkg-c:t"]);

	await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("discoverPackageTools - marker file filter", async () => {
	const tmpDir = await Deno.makeTempDir();
	for (const name of ["pkg-a", "pkg-b", "pkg-c"]) {
		await Deno.mkdir(join(tmpDir, name));
		await Deno.writeTextFile(
			join(tmpDir, name, "mcp.ts"),
			`export const tools = [{ name: "t", description: "t", params: {}, handler: async () => "${name}" }];`,
		);
	}

	// only pkg-b has the marker
	await Deno.writeTextFile(join(tmpDir, "pkg-b", ".mcp-include"), "");

	const tools = await discoverPackageTools([
		{ path: tmpDir, marker: ".mcp-include" },
	]);
	assertEquals(tools.length, 1);
	assertEquals(tools[0].namespacedName, "pkg-b:t");

	await Deno.remove(tmpDir, { recursive: true });
});
