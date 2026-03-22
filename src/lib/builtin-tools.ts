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

/**
 * Register the 5 built-in ecosystem tools on the MCP server.
 *
 * These tools provide ecosystem-level introspection (listing packages,
 * reading docs, searching, etc.) and are always available regardless of
 * whether any packages ship their own `mcp.ts` tools.
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
		async ({ root }) => {
			const results: Record<string, unknown>[] = [];

			for (const rootConfig of packageRoots) {
				const rootName = basename(rootConfig.path);
				if (root && rootName !== root) continue;

				for await (const dir of scanPackageDirs(rootConfig)) {
					const info = await getPackageInfo(dir.path, dir.name);
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
		async ({ packageName }) => {
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

	// 3. get-ecosystem-overview
	server.registerTool(
		"get-ecosystem-overview",
		{
			description:
				"Get the high-level ecosystem overview document that describes how all packages fit together",
		},
		async () => {
			for (const rootConfig of packageRoots) {
				const ecosystemPath = join(
					rootConfig.path,
					"mm-local-docs",
					"ecosystem.md",
				);
				const content = await readTextFileSafe(ecosystemPath);
				if (content) {
					return {
						content: [
							{
								type: "text" as const,
								text: content,
							},
						],
					};
				}

				const altPath = join(
					rootConfig.path,
					"marianmeres",
					"mm-local-docs",
					"ecosystem.md",
				);
				const altContent = await readTextFileSafe(altPath);
				if (altContent) {
					return {
						content: [
							{
								type: "text" as const,
								text: altContent,
							},
						],
					};
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text: "Ecosystem overview document not found",
					},
				],
				isError: true,
			};
		},
	);

	// 4. search-docs
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
		async ({ query, caseSensitive }) => {
			const results: {
				root: string;
				package: string;
				file: string;
				matches: string[];
			}[] = [];
			let totalMatches = 0;
			const MAX_RESULTS = 20;

			for (const rootConfig of packageRoots) {
				const rootName = basename(rootConfig.path);

				for await (const dir of scanPackageDirs(rootConfig)) {
					if (totalMatches >= MAX_RESULTS) break;

					for (const docFile of ["AGENTS.md", "README.md"]) {
						const content = await readTextFileSafe(
							join(dir.path, docFile),
						);
						if (!content) continue;

						const lines = content.split("\n");
						const matchingLines: string[] = [];

						for (let i = 0; i < lines.length; i++) {
							const line = lines[i];
							const matches = caseSensitive
								? line.includes(query)
								: line
										.toLowerCase()
										.includes(query.toLowerCase());

							if (matches) {
								const start = Math.max(0, i - 2);
								const end = Math.min(
									lines.length - 1,
									i + 2,
								);
								const context = lines
									.slice(start, end + 1)
									.map(
										(l, idx) =>
											`${
												start + idx + 1 === i + 1
													? ">"
													: " "
											} ${start + idx + 1}: ${l}`,
									)
									.join("\n");
								matchingLines.push(context);
							}
						}

						if (matchingLines.length > 0) {
							results.push({
								root: rootName,
								package: dir.name,
								file: docFile,
								matches: matchingLines.slice(0, 5),
							});
							totalMatches++;
						}

						// if we found AGENTS.md, don't also search README.md
						if (content) break;
					}
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

	// 5. get-stack-recipe
	server.registerTool(
		"get-stack-recipe",
		{
			description:
				"Get the project template/recipe document for scaffolding a new full-stack application",
		},
		async () => {
			for (const rootConfig of packageRoots) {
				const templatePath = join(
					rootConfig.path,
					"full-stack-app-template",
					"TEMPLATE.md",
				);
				const template = await readTextFileSafe(templatePath);
				if (template) {
					return {
						content: [
							{
								type: "text" as const,
								text: template,
							},
						],
					};
				}

				const agentsPath = join(
					rootConfig.path,
					"full-stack-app-template",
					"AGENTS.md",
				);
				const agents = await readTextFileSafe(agentsPath);
				if (agents) {
					return {
						content: [
							{
								type: "text" as const,
								text: agents,
							},
						],
					};
				}
			}

			return {
				content: [
					{
						type: "text" as const,
						text: "Stack recipe/template not found. The full-stack-app-template package may not exist yet.",
					},
				],
				isError: true,
			};
		},
	);
}
