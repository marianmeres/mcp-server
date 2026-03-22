import type { McpToolDefinition } from "../../types.ts";
import type { PackageRootConfig } from "./config.ts";
import { basename } from "@std/path";
import { fileExists, scanPackageDirs } from "./fs-utils.ts";
import { join } from "@std/path";

/** A tool definition discovered from a package's `mcp.ts` file. */
export interface DiscoveredTool {
	/** Namespaced tool name (e.g. `"my-package:tool-name"`). */
	namespacedName: string;
	/** The original tool definition from the package. */
	tool: McpToolDefinition;
	/** Absolute path to the `mcp.ts` file this tool was loaded from. */
	sourcePath: string;
}

/**
 * Scan all package roots for `mcp.ts` files and return discovered tools.
 *
 * Uses a two-pass algorithm:
 * 1. Collect directory names across all roots to detect name collisions
 * 2. Import each `mcp.ts`, validate exports, and namespace tools
 *
 * On collision (same dir name in multiple roots), tools are prefixed with
 * `rootName--dirName:toolName` instead of `dirName:toolName`.
 *
 * Import errors are logged to stderr and skipped (the server does not crash).
 */
export async function discoverPackageTools(
	packageRoots: PackageRootConfig[],
): Promise<DiscoveredTool[]> {
	const results: DiscoveredTool[] = [];

	// First pass: collect all package dir names to detect collisions
	const dirNameCounts = new Map<string, number>();

	for (const rootConfig of packageRoots) {
		for await (const dir of scanPackageDirs(rootConfig)) {
			dirNameCounts.set(
				dir.name,
				(dirNameCounts.get(dir.name) ?? 0) + 1,
			);
		}
	}

	// Second pass: discover and import tools
	for (const rootConfig of packageRoots) {
		const rootName = basename(rootConfig.path);
		console.error(`Scanning: ${rootConfig.path}`);

		for await (const dir of scanPackageDirs(rootConfig)) {
			const mcpPath = join(dir.path, "mcp.ts");
			if (!(await fileExists(mcpPath))) {
				continue;
			}

			// determine namespace prefix
			const hasCollision =
				(dirNameCounts.get(dir.name) ?? 0) > 1;
			const prefix = hasCollision
				? `${rootName}--${dir.name}`
				: dir.name;

			try {
				const mod = await import(`file://${mcpPath}`);
				const tools: McpToolDefinition[] | null =
					Array.isArray(mod.tools)
						? mod.tools
						: Array.isArray(mod.default)
						? mod.default
						: null;

				if (!tools) {
					console.error(
						`  Warning: ${mcpPath} does not export a 'tools' array`,
					);
					continue;
				}

				for (const tool of tools) {
					if (!tool.name || !tool.handler) {
						console.error(
							`  Warning: Skipping malformed tool in ${mcpPath}`,
						);
						continue;
					}
					results.push({
						namespacedName: `${prefix}:${tool.name}`,
						tool,
						sourcePath: mcpPath,
					});
				}

				console.error(
					`  ${dir.name}: ${tools.length} tool(s)`,
				);
			} catch (error) {
				console.error(
					`  Warning: Failed to load ${mcpPath}: ${(error as Error).message}`,
				);
			}
		}
	}

	return results;
}
