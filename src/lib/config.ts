import { parseArgs } from "@std/cli/parse-args";
import { resolve, dirname } from "@std/path";
import { fileExists } from "./fs-utils.ts";
import { getErrorMessage } from "./errors.ts";

/**
 * Configuration for a single package root directory.
 *
 * Supports three filtering modes (combinable):
 * - `include` — only scan these specific directory names
 * - `exclude` — scan everything except these directory names
 * - `marker` — only scan directories containing this marker file
 *
 * `include` and `exclude` are mutually exclusive.
 * `marker` can be combined with either `include` or `exclude`.
 */
export interface PackageRootConfig {
	/** Absolute path to the directory containing packages. */
	path: string;
	/** If set, only scan directories with these names. Mutually exclusive with `exclude`. */
	include?: string[];
	/** If set, skip directories with these names. Mutually exclusive with `include`. */
	exclude?: string[];
	/** If set, only scan directories that contain a file with this name (e.g. `mcp-include.txt`). */
	marker?: string;
}

/** Server configuration specifying which package roots to scan. */
export interface McpServerConfig {
	/** Package root configurations. */
	packageRoots: PackageRootConfig[];
}

/** Raw config entry: either a plain path string or a full config object. */
type RawPackageRoot = string | {
	path: string;
	include?: string[];
	exclude?: string[];
	marker?: string;
};

/**
 * Load server configuration from CLI args or environment.
 *
 * Resolution order:
 * 1. `--config <path>` — reads a JSON file with `{ packageRoots: (string | object)[] }`
 * 2. `MM_PACKAGES_ROOT` env var — used as a single package root
 * 3. Exits with error if neither is provided
 *
 * Plain strings in `packageRoots` are normalized to `{ path: "..." }`.
 * Relative paths are resolved from the config file's directory.
 * Non-existent roots are warned and skipped.
 */
export async function loadConfig(
	args: string[],
): Promise<McpServerConfig> {
	const parsed = parseArgs(args, { string: ["config"] });

	// Option 1: Config file provided via --config
	if (parsed.config) {
		const configPath = resolve(parsed.config);
		const raw = await Deno.readTextFile(configPath);
		let data: { packageRoots?: unknown };
		try {
			data = JSON.parse(raw);
		} catch (error) {
			throw new Error(
				`Invalid JSON in ${configPath}: ${getErrorMessage(error)}`,
			);
		}

		if (
			!Array.isArray(data.packageRoots) ||
			data.packageRoots.length === 0
		) {
			throw new Error(
				"mcp.config.json must have a non-empty 'packageRoots' array",
			);
		}

		const configDir = dirname(configPath);
		const roots = (data.packageRoots as RawPackageRoot[]).map(
			(r) => normalizeRoot(r, configDir),
		);

		return { packageRoots: await validateRoots(roots) };
	}

	// Option 2: Single root via env variable
	const envRoot = Deno.env.get("MM_PACKAGES_ROOT");
	if (envRoot) {
		const roots = [{ path: resolve(envRoot) }];
		return { packageRoots: await validateRoots(roots) };
	}

	// No config provided
	console.error(
		"Error: Provide --config <path> or set MM_PACKAGES_ROOT env variable",
	);
	Deno.exit(1);
}

/** Normalize a raw config entry (string or object) into a PackageRootConfig. */
function normalizeRoot(
	raw: RawPackageRoot,
	configDir: string,
): PackageRootConfig {
	if (typeof raw === "string") {
		return { path: resolve(configDir, raw) };
	}

	const config: PackageRootConfig = {
		path: resolve(configDir, raw.path),
	};

	if (raw.include) config.include = raw.include;
	if (raw.exclude) config.exclude = raw.exclude;
	if (raw.marker) config.marker = raw.marker;

	if (config.include && config.exclude) {
		throw new Error(
			`Package root "${config.path}": 'include' and 'exclude' are mutually exclusive`,
		);
	}

	return config;
}

/** Validate that root paths exist on disk; warn and skip missing ones. */
async function validateRoots(
	roots: PackageRootConfig[],
): Promise<PackageRootConfig[]> {
	const valid: PackageRootConfig[] = [];
	for (const root of roots) {
		if (await fileExists(root.path)) {
			valid.push(root);
		} else {
			console.error(
				`Warning: Package root does not exist, skipping: ${root.path}`,
			);
		}
	}
	if (valid.length === 0) {
		console.error("Error: No valid package roots found");
		Deno.exit(1);
	}
	return valid;
}
