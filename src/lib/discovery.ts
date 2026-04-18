import type { McpToolDefinition } from "../../types.ts";
import type { PackageRootConfig } from "./config.ts";
import { basename, join } from "@std/path";
import { fileExists, scanPackageDirs } from "./fs-utils.ts";
import { getErrorMessage } from "./errors.ts";

/** A tool definition discovered from a package's `mcp.ts` file. */
export interface DiscoveredTool {
	/** Namespaced tool name (e.g. `"my-package_tool-name"`). */
	namespacedName: string;
	/** The original tool definition from the package. */
	tool: McpToolDefinition;
	/** Absolute path to the `mcp.ts` file this tool was loaded from. */
	sourcePath: string;
}

/**
 * Compute a unique short identifier for each package root.
 *
 * Defaults to `basename(path)`. If two roots share the same basename
 * (e.g. `/a/packages` and `/b/packages`), they're disambiguated with a
 * `-2`, `-3`, … suffix in declaration order.
 */
function computeRootNames(roots: PackageRootConfig[]): string[] {
	const counts = new Map<string, number>();
	for (const r of roots) {
		const b = basename(r.path);
		counts.set(b, (counts.get(b) ?? 0) + 1);
	}

	const seen = new Map<string, number>();
	return roots.map((r) => {
		const b = basename(r.path);
		if ((counts.get(b) ?? 0) <= 1) return b;
		const n = (seen.get(b) ?? 0) + 1;
		seen.set(b, n);
		return n === 1 ? b : `${b}-${n}`;
	});
}

/** Validate that a value looks like an `McpToolDefinition`. */
function isValidTool(t: unknown): t is McpToolDefinition {
	if (!t || typeof t !== "object") return false;
	const tool = t as Record<string, unknown>;
	return (
		typeof tool.name === "string" &&
		tool.name.length > 0 &&
		typeof tool.description === "string" &&
		typeof tool.handler === "function" &&
		typeof tool.params === "object" &&
		tool.params !== null
	);
}

/**
 * Scan all package roots for `mcp.ts` files and return discovered tools.
 *
 * Uses a two-pass algorithm:
 * 1. Collect directory names across all roots to detect name collisions
 * 2. Import each `mcp.ts`, validate exports, and namespace tools
 *
 * On collision (same dir name in multiple roots), tools are prefixed with
 * `rootName--dirName_toolName` instead of `dirName_toolName`. If two roots
 * share the same basename, they receive a `-2`, `-3`, … suffix to keep
 * the prefix unique.
 *
 * Import errors are logged to stderr and are skipped (the server does not crash).
 */
export async function discoverPackageTools(
	packageRoots: PackageRootConfig[],
): Promise<DiscoveredTool[]> {
	const results: DiscoveredTool[] = [];
	const rootNames = computeRootNames(packageRoots);

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

	// Track namespaced names across all roots to detect (rare) prefix collisions.
	const seenNamespaced = new Set<string>();

	// Second pass: discover and import tools
	for (let i = 0; i < packageRoots.length; i++) {
		const rootConfig = packageRoots[i];
		const rootName = rootNames[i];
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
				const tools: unknown = Array.isArray(mod.tools)
					? mod.tools
					: Array.isArray(mod.default)
					? mod.default
					: null;

				if (!Array.isArray(tools)) {
					console.error(
						`  Warning: ${mcpPath} does not export a 'tools' array`,
					);
					continue;
				}

				const seenInPackage = new Set<string>();
				let registered = 0;

				for (const tool of tools) {
					if (!isValidTool(tool)) {
						console.error(
							`  Warning: Skipping malformed tool in ${mcpPath} ` +
								`(needs string name, string description, ` +
								`object params, function handler)`,
						);
						continue;
					}

					if (seenInPackage.has(tool.name)) {
						console.error(
							`  Warning: Duplicate tool name "${tool.name}" in ${mcpPath}, skipping duplicate`,
						);
						continue;
					}
					seenInPackage.add(tool.name);

					const namespacedName = `${prefix}_${tool.name}`;
					if (seenNamespaced.has(namespacedName)) {
						console.error(
							`  Warning: Namespaced tool name "${namespacedName}" already registered, skipping`,
						);
						continue;
					}
					seenNamespaced.add(namespacedName);

					results.push({
						namespacedName,
						tool,
						sourcePath: mcpPath,
					});
					registered++;
				}

				console.error(`  ${dir.name}: ${registered} tool(s)`);
			} catch (error) {
				console.error(
					`  Warning: Failed to load ${mcpPath}: ${getErrorMessage(error)}`,
				);
			}
		}
	}

	return results;
}
