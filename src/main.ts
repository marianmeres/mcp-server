#!/usr/bin/env node

/**
 * Main entrypoint for the @marianmeres/mcp-server.
 *
 * Starts a stdio-based MCP server that discovers and registers tools
 * from configured package roots.
 *
 */

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerBuiltinTools } from "./lib/builtin-tools.ts";
import { loadConfig } from "./lib/config.ts";
import { discoverPackageTools } from "./lib/discovery.ts";
import { getErrorMessage } from "./lib/errors.ts";

// Load config
const config = await loadConfig(process.argv.slice(2));

// package.json sits one level up from both src/main.ts and dist/main.js
const { version: VERSION } = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
console.error(`@marianmeres/mcp-server v${VERSION}`);
console.error(`Package roots: ${config.packageRoots.map((r) => r.path).join(", ")}`);

// Create MCP server
const server = new McpServer({
	name: "@marianmeres/mcp-server",
	version: VERSION,
});

// 1. Register built-in ecosystem tools
registerBuiltinTools(server, config.packageRoots);
console.error("Built-in tools: list-packages, get-package-docs, search-docs");

// 2. Discover and register package-provided tools
const packageTools = await discoverPackageTools(config.packageRoots);
for (const { namespacedName, tool } of packageTools) {
	server.registerTool(
		namespacedName,
		{
			description: tool.description,
			inputSchema: tool.params,
		},
		async (params: Record<string, unknown>) => {
			try {
				const result = await tool.handler(params);
				return {
					content: [{ type: "text" as const, text: result }],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${getErrorMessage(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}

const totalTools = 3 + packageTools.length;
console.error(`Total: ${totalTools} tools registered`);

// 3. Start
const transport = new StdioServerTransport();
await server.connect(transport);
