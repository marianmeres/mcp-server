import { join } from "@std/path";
import type { PackageRootConfig } from "./config.ts";

/** Check whether a file or directory exists at the given path. */
export async function fileExists(path: string): Promise<boolean> {
	try {
		await Deno.stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Read a text file, returning `null` instead of throwing on error. */
export async function readTextFileSafe(
	path: string,
): Promise<string | null> {
	try {
		return await Deno.readTextFile(path);
	} catch {
		return null;
	}
}

/** Basic metadata extracted from a package's config file. */
export interface PackageInfo {
	/** The directory name of the package. */
	dirName: string;
	/** The package name from deno.json/package.json (falls back to dirName). */
	name: string;
	/** The package description from deno.json/package.json. */
	description: string;
}

/**
 * Extract package name and description from deno.json, deno.jsonc,
 * or package.json. Falls back to the directory name if no config is found.
 */
export async function getPackageInfo(
	dirPath: string,
	dirName: string,
	markerContent?: string,
): Promise<PackageInfo> {
	const info: PackageInfo = { dirName, name: dirName, description: "" };

	for (const configFile of ["deno.json", "deno.jsonc", "package.json"]) {
		const raw = await readTextFileSafe(join(dirPath, configFile));
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				if (parsed.name) {
					info.name = parsed.name;
				}
				if (parsed.description) {
					info.description = parsed.description;
				}
				break;
			} catch {
				// malformed json, skip
			}
		}
	}

	// Fall back to marker file content as description
	if (!info.description && markerContent) {
		info.description = markerContent;
	}

	return info;
}

/**
 * Yield immediate child directories of a package root, applying filters.
 *
 * Always skips hidden directories (`.`-prefixed) and `node_modules`.
 * Additionally filters based on the root config:
 * - `include` — only yield directories with these names
 * - `exclude` — skip directories with these names
 * - `marker` — only yield directories containing this marker file
 */
export async function* scanPackageDirs(
	rootConfig: PackageRootConfig,
): AsyncGenerator<{ name: string; path: string; markerContent?: string }> {
	const { path: root, include, exclude, marker } = rootConfig;

	try {
		for await (const entry of Deno.readDir(root)) {
			if (
				!entry.isDirectory ||
				entry.name.startsWith(".") ||
				entry.name === "node_modules"
			) {
				continue;
			}

			// include filter
			if (include && !include.includes(entry.name)) {
				continue;
			}

			// exclude filter
			if (exclude && exclude.includes(entry.name)) {
				continue;
			}

			const dirPath = join(root, entry.name);

			// marker file filter — also reads content for use as package description
			if (marker) {
				const content = await readTextFileSafe(join(dirPath, marker));
				if (content === null) continue;
				yield {
					name: entry.name,
					path: dirPath,
					markerContent: content.trim() || undefined,
				};
			} else {
				yield { name: entry.name, path: dirPath };
			}
		}
	} catch (error) {
		console.error(
			`Warning: Could not scan root "${root}": ${(error as Error).message}`,
		);
	}
}
