/**
 * Main entrypoint for the @marianmeres/mcp-server.
 *
 * Starts a stdio-based MCP server that discovers and registers tools
 * from configured package roots.
 *
 * @module
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./src/lib/config.ts";
import { discoverPackageTools } from "./src/lib/discovery.ts";
import { registerBuiltinTools } from "./src/lib/builtin-tools.ts";
import { getErrorMessage } from "./src/lib/errors.ts";
import denoJson from "./deno.json" with { type: "json" };

// Load config
const config = await loadConfig(Deno.args);

const VERSION = denoJson.version;
console.error(`@marianmeres/mcp-server v${VERSION}`);
console.error(
	`Package roots: ${config.packageRoots.map((r) => r.path).join(", ")}`,
);

// Create MCP server
const server = new McpServer({
	name: "@marianmeres/mcp-server",
	version: VERSION,
});

// 1. Register built-in ecosystem tools
registerBuiltinTools(server, config.packageRoots);
console.error(
	"Built-in tools: list-packages, get-package-docs, search-docs",
);

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
					content: [{
						type: "text" as const,
						text: `Error: ${getErrorMessage(error)}`,
					}],
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
