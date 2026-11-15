# @marianmeres/mcp-server — Agent Guide

## Quick Reference

- **Stack**: TypeScript (erasable-only), Node LTS (`.node-version`), pnpm, `node:test`, Biome,
  MCP SDK (`@modelcontextprotocol/sdk`), Zod 3
- **Transport**: stdio (JSON-RPC over stdin/stdout)
- **Entry point**: `src/main.ts` (CLI, npm `bin` → `dist/main.js`) | `src/mod.ts` (export
  `@marianmeres/mcp-server/types`)
- **Run**: `node src/main.ts --config ./mcp.config.json`
- **Install**: `pnpm install` | **Test**: `pnpm test` | **Check all**: `pnpm run ci` |
  **Build**: `pnpm run build`
- **Inspect**: `pnpm run inspect` (opens MCP Inspector UI)

## Project Structure

```
src/
  main.ts            # CLI entry — config, discovery, tool registration, stdio
  types.ts           # McpToolDefinition interface (public contract)
  mod.ts             # package export "./types" (re-exports types.ts)
  lib/
    config.ts        # loadConfig() — reads --config file or MM_PACKAGES_ROOT env
    discovery.ts     # discoverPackageTools() — scans roots, imports mcp.ts, namespaces
    builtin-tools.ts # registerBuiltinTools() — 3 ecosystem tools on McpServer
    fs-utils.ts      # fileExists, readTextFileSafe, scanPackageDirs, getPackageInfo
    errors.ts        # getErrorMessage()
tests/
  helpers.ts         # makeTmpDir() — temp dir with cleanup, optional node_modules link
  config.test.ts     # Config loading, validation, path resolution
  discovery.test.ts  # Tool discovery, namespacing, error resilience
  builtin-tools.test.ts # findMatches()
dist/                # tsc build output; gitignored; the only thing published
tmp/                 # scratch, gitignored
```

## Public API

| Export              | Location                                | Type      | Purpose                             |
| ------------------- | --------------------------------------- | --------- | ----------------------------------- |
| `McpToolDefinition` | `src/types.ts` via `src/mod.ts` (types) | interface | Contract for package `mcp.ts` files |

```typescript
interface McpToolDefinition {
	name: string;
	description: string;
	params: Record<string, z.ZodType>;
	handler: (args: Record<string, unknown>) => Promise<string>;
}
```

## Key Behaviors

### Configuration (`src/lib/config.ts`)

- `--config <path>` / `--config=<path>`: reads JSON with
  `packageRoots: (string | PackageRootConfig)[]`
- Arg parsing is lenient (`node:util` `parseArgs`, `strict: false`): unknown flags are
  ignored; a bare `--config` counts as absent
- `MM_PACKAGES_ROOT` env: single-root fallback
- Neither: exits with error
- Plain strings normalized to `{ path: "..." }`
- Relative paths resolved from config file directory
- Non-existent roots are warned and skipped

### Package Filtering

Each root supports three filtering modes (via `PackageRootConfig`):

- `include: string[]` — only scan these directory names
- `exclude: string[]` — skip these directory names
- `marker: string` — only scan dirs containing this file (e.g. `mcp-include.txt`); file
  content, if any, is used as the package description
- `include` and `exclude` are mutually exclusive; `marker` combines with either

### Tool Discovery (`src/lib/discovery.ts`)

- Two-pass: first collects dir names for collision detection, then imports
- Looks for `mcp.ts` in each immediate child of each root
- Imports via `import(pathToFileURL(path).href)`; Node strips the types
- Accepts `export const tools` or `export default` (array of McpToolDefinition)
- Skips hidden dirs (`.`-prefixed) and `node_modules`
- Failed imports log to stderr and are skipped (no crash)

### Plugin Contract Under Node

A package `mcp.ts` loads only if Node can load it from source:

- Bare imports (`zod`) resolve from the plugin's own location, never from the server's
- Zod 3 (`^3.25.76`): zod 4 `.describe()` texts are lost in the JSON schema (per-copy registry)
- Erasable TS only; no `npm:` / `jsr:` / `https:` specifiers; no `Deno.*`
- Deno-era plugins fail to import and are skipped; the server itself keeps no Deno compat

### Namespacing

- Default: `{dirName}_{toolName}` (e.g. `store_describe-api`)
- On collision (same dir name in multiple roots): `{rootName}--{dirName}_{toolName}`

### Built-in Tools (3)

Registered in `src/lib/builtin-tools.ts`:

1. `list-packages` — scans roots, returns JSON array of package info
2. `get-package-docs` — reads AGENTS.md, falls back to README.md
3. `search-docs` — full-text search, max 20 results, ±2 lines context

### stdout is Reserved

All logging uses `console.error`. stdout is exclusively for MCP JSON-RPC protocol. Package
`mcp.ts` authors must also avoid `console.log`.

## Critical Conventions

1. **Runtime policy** — Node at the keyboard and in production, npm as the registry. No
   `Deno.*`, `Bun.*`, `bun:*`, `jsr:` or `npm:` specifiers. Web standards first; `node:*`
   where they don't reach. Nothing is built, tested or documented for Bun or Deno.
2. **Erasable TypeScript** — no `enum`, `namespace`, constructor parameter properties;
   `import type` for types; explicit `.ts` import extensions (rewritten to `.js` on emit).
   Node strips types and never checks them: `pnpm run typecheck` is the only type gate.
3. **Handler returns string** — tool handlers return `Promise<string>`. The server wraps it
   in `{ content: [{ type: "text", text }] }` MCP format.
4. **Errors don't crash** — individual tool import failures or handler errors are caught and
   returned as `isError: true` responses.
5. **No console.log** — use `console.error` for all diagnostic output.
6. **Zod for params** — tool parameters are `Record<string, z.ZodType>`. The SDK's
   `server.registerTool()` converts them to JSON Schema.
7. **Version** — read at runtime from `../package.json` relative to `src/main.ts` /
   `dist/main.js`; keep `main.ts` one level below the package root.
8. **Formatting** — tabs, 4 wide, 90 columns, double quotes (`biome.json`); manifests at 2
   spaces. `pnpm run format` before committing; `pnpm run lint` is the read-only CI check.
9. **Tests** — `node:test` + `node:assert/strict`; fixtures that import `zod` need
   `makeTmpDir(t, { linkNodeModules: true })`.
10. **Publishing** — `dist` only (`files`); `pnpm publish` runs `ci` then `build` via
    `prepublishOnly`; `pnpm run release` (bump, commit, tag, push) is a human action.

## Before Making Changes

- [ ] Read existing patterns in the relevant `src/lib/` file
- [ ] Add or extend a test in `tests/`, then run `pnpm run ci`
- [ ] Test with `pnpm run inspect` for interactive verification
- [ ] Ensure no `console.log` in any source file (only `console.error`)
- [ ] Keep this file and `README.md` in step with the code

## Documentation Index

- [README.md](./README.md) — human-facing docs (install, client registration, plugin
  requirements, configuration)
