import type { z } from "zod";

/**
 * Defines a tool that a package exposes via its `mcp.ts` file.
 *
 * Each package that wants to provide MCP tools exports an array of these
 * definitions. The central server handles namespacing, registration, and
 * MCP protocol wrapping.
 *
 * @example
 * ```typescript
 * import { z } from "npm:zod";
 * import type { McpToolDefinition } from "jsr:@marianmeres/mcp-server/types";
 *
 * export const tools: McpToolDefinition[] = [
 *   {
 *     name: "health-check",
 *     description: "Check if the service is running",
 *     params: { url: z.string().describe("Service URL") },
 *     handler: async ({ url }) => {
 *       const res = await fetch(`${url}/health`);
 *       return `Status: ${res.status}`;
 *     },
 *   },
 * ];
 * ```
 */
export interface McpToolDefinition {
	/** Tool name (will be namespaced by the server as `packageName.toolName`). */
	name: string;
	/** Human-readable description shown to AI agents. */
	description: string;
	/** Zod schemas for tool parameters. */
	params: Record<string, z.ZodType>;
	/** Async handler that receives validated params and returns a plain text result. */
	handler: (args: Record<string, unknown>) => Promise<string>;
}
