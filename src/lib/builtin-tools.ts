import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join, basename } from "@std/path";
import type { PackageRootConfig } from "./config.ts";
import {
	fileExists,
	readTextFileSafe,
	scanPackageDirs,
	getPackageInfo,
} from "./fs-utils.ts";

/** Find all matching lines in `content` and return each with ±2 lines of context. */
export function findMatches(
	content: string,
	query: string,
	caseSensitive: boolean,
): string[] {
	const lines = content.split("\n");
	const needle = caseSensitive ? query : query.toLowerCase();
	const matches: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const haystack = caseSensitive ? lines[i] : lines[i].toLowerCase();
		if (!haystack.includes(needle)) continue;
		const start = Math.max(0, i - 2);
		const end = Math.min(lines.length - 1, i + 2);
		const context = lines
			.slice(start, end + 1)
			.map(
				(l, idx) =>
					`${start + idx === i ? ">" : " "} ${start + idx + 1}: ${l}`,
			)
			.join("\n");
		matches.push(context);
	}
	return matches;
}

/**
 * Register the built-in ecosystem tools on the MCP server.
 *
 * These tools (`list-packages`, `get-package-docs`, `search-docs`) provide
 * ecosystem-level introspection — listing packages, reading docs, searching
 * across documentation — and are always available regardless of whether any
 * packages ship their own `mcp.ts` tools.
 */
export function registerBuiltinTools(
	server: McpServer,
	packageRoots: PackageRootConfig[],
): void {
	// 1. list-packages
	server.registerTool(
		"list-packages",
		{
			description:
				"List all packages across all configured roots, with names, descriptions, and available MCP tools",
			inputSchema: {
				root: z
					.string()
					.optional()
					.describe(
						"Filter to a specific root by its directory name",
					),
			},
		},
		async ({ root }: { root?: string }) => {
			const results: Record<string, unknown>[] = [];

			for (const rootConfig of packageRoots) {
				const rootName = basename(rootConfig.path);
				if (root && rootName !== root) continue;

				for await (const dir of scanPackageDirs(rootConfig)) {
					const info = await getPackageInfo(dir.path, dir.name, dir.markerContent);
					const hasAgentsDocs = await fileExists(
						join(dir.path, "AGENTS.md"),
					);
					const hasMcpTs = await fileExists(
						join(dir.path, "mcp.ts"),
					);

					results.push({
						root: rootName,
						name: info.name,
						dirName: dir.name,
						description: info.description,
						hasAgentsDocs,
						hasMcpTs,
					});
				}
			}

			results.sort((a, b) =>
				`${a.root}/${a.dirName}`.localeCompare(
					`${b.root}/${b.dirName}`,
				),
			);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(results, null, 2),
					},
				],
			};
		},
	);

	// 2. get-package-docs
	server.registerTool(
		"get-package-docs",
		{
			description:
				"Get the AGENTS.md (or README.md) documentation for a specific package",
			inputSchema: {
				packageName: z
					.string()
					.describe(
						"The package directory name (e.g. 'collection', 'demino', 'store')",
					),
			},
		},
		async ({ packageName }: { packageName: string }) => {
			for (const rootConfig of packageRoots) {
				for await (const dir of scanPackageDirs(rootConfig)) {
					if (dir.name !== packageName) continue;

					const agentsDocs = await readTextFileSafe(
						join(dir.path, "AGENTS.md"),
					);
					if (agentsDocs) {
						return {
							content: [
								{
									type: "text" as const,
									text: agentsDocs,
								},
							],
						};
					}

					const readme = await readTextFileSafe(
						join(dir.path, "README.md"),
					);
					if (readme) {
						return {
							content: [
								{
									type: "text" as const,
									text: readme,
								},
							],
						};
					}

					return {
						content: [
							{
								type: "text" as const,
								text: `No documentation found for "${packageName}" (no AGENTS.md or README.md)`,
							},
						],
					};
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `Package "${packageName}" not found in any configured root`,
					},
				],
				isError: true,
			};
		},
	);

	// 3. search-docs
	server.registerTool(
		"search-docs",
		{
			description:
				"Full-text search across all AGENTS.md and README.md files in all configured package roots",
			inputSchema: {
				query: z.string().describe("The search term or phrase"),
				caseSensitive: z.boolean().optional().default(false),
			},
		},
		async (
			{ query, caseSensitive }: { query: string; caseSensitive?: boolean },
		) => {
			const results: {
				root: string;
				package: string;
				file: string;
				matches: string[];
				totalMatches: number;
				truncated: boolean;
			}[] = [];
			const MAX_RESULTS = 20;
			const MAX_MATCHES_PER_FILE = 5;

			outer: for (const rootConfig of packageRoots) {
				const rootName = basename(rootConfig.path);

				for await (const dir of scanPackageDirs(rootConfig)) {
					if (results.length >= MAX_RESULTS) break outer;

					// Prefer AGENTS.md if present; only fall back to README.md
					// when AGENTS.md does not exist for this package.
					const candidates = ["AGENTS.md", "README.md"];
					let docFile: string | null = null;
					let content: string | null = null;
					for (const candidate of candidates) {
						const c = await readTextFileSafe(
							join(dir.path, candidate),
						);
						if (c !== null) {
							docFile = candidate;
							content = c;
							break;
						}
					}
					if (!docFile || content === null) continue;

					const matchingLines = findMatches(
						content,
						query,
						caseSensitive ?? false,
					);
					if (matchingLines.length === 0) continue;

					results.push({
						root: rootName,
						package: dir.name,
						file: docFile,
						matches: matchingLines.slice(0, MAX_MATCHES_PER_FILE),
						totalMatches: matchingLines.length,
						truncated:
							matchingLines.length > MAX_MATCHES_PER_FILE,
					});
				}
			}

			if (results.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No results found for "${query}"`,
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(results, null, 2),
					},
				],
			};
		},
	);

}
