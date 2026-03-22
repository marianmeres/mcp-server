# @marianmeres/mcp-server — Agent Guide

## Quick Reference
- **Stack**: Deno, TypeScript, MCP SDK (`@modelcontextprotocol/sdk`), Zod
- **Runtime**: Deno (not Node)
- **Transport**: stdio (JSON-RPC over stdin/stdout)
- **Entry point**: `main.ts` (CLI) | `src/mod.ts` (library export)
- **Run**: `deno run -A main.ts --config ./mcp.config.json`
- **Test**: `deno test -A`
- **Inspect**: `deno task inspect` (opens MCP Inspector UI)

## Project Structure
```
main.ts              # CLI entry — config, discovery, tool registration, stdio
types.ts             # McpToolDefinition interface (public contract)
src/
  mod.ts             # JSR/npm library export (re-exports types.ts)
  lib/
    config.ts        # loadConfig() — reads --config file or MM_PACKAGES_ROOT env
    discovery.ts     # discoverPackageTools() — scans roots, imports mcp.ts, namespaces
    builtin-tools.ts # registerBuiltinTools() — 5 ecosystem tools on McpServer
    fs-utils.ts      # fileExists, readTextFileSafe, scanPackageDirs, getPackageInfo
tests/
  config.test.ts     # Config loading, validation, path resolution
  discovery.test.ts  # Tool discovery, namespacing, error resilience
```

## Public API

| Export | Location | Type | Purpose |
|--------|----------|------|---------|
| `McpToolDefinition` | `types.ts` via `src/mod.ts` | interface | Contract for package `mcp.ts` files |

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
- `--config <path>` flag: reads JSON with `packageRoots: (string | PackageRootConfig)[]`
- `MM_PACKAGES_ROOT` env: single-root fallback
- Neither: exits with error
- Plain strings normalized to `{ path: "..." }`
- Relative paths resolved from config file directory
- Non-existent roots are warned and skipped

### Package Filtering
Each root supports three filtering modes (via `PackageRootConfig`):
- `include: string[]` — only scan these directory names
- `exclude: string[]` — skip these directory names
- `marker: string` — only scan dirs containing this file (e.g. `.mcp-include`)
- `include` and `exclude` are mutually exclusive; `marker` combines with either

### Tool Discovery (`src/lib/discovery.ts`)
- Two-pass: first collects dir names for collision detection, then imports
- Looks for `mcp.ts` in each immediate child of each root
- Accepts `export const tools` or `export default` (array of McpToolDefinition)
- Skips hidden dirs (`.`-prefixed) and `node_modules`
- Failed imports log to stderr and are skipped (no crash)

### Namespacing
- Default: `{dirName}:{toolName}` (e.g. `store:describe-api`)
- On collision (same dir name in multiple roots): `{rootName}--{dirName}:{toolName}`

### Built-in Tools (5)
Registered in `src/lib/builtin-tools.ts`:
1. `list-packages` — scans roots, returns JSON array of package info
2. `get-package-docs` — reads AGENTS.md, falls back to README.md
3. `get-ecosystem-overview` — reads `mm-local-docs/ecosystem.md` from roots
4. `search-docs` — full-text search, max 20 results, ±2 lines context
5. `get-stack-recipe` — reads TEMPLATE.md or AGENTS.md from full-stack-app-template

### stdout is Reserved
All logging uses `console.error`. stdout is exclusively for MCP JSON-RPC protocol.
Package `mcp.ts` authors must also avoid `console.log`.

## Critical Conventions

1. **Handler returns string** — tool handlers return `Promise<string>`. The server wraps
   it in `{ content: [{ type: "text", text }] }` MCP format.
2. **Errors don't crash** — individual tool import failures or handler errors are caught
   and returned as `isError: true` responses.
3. **No console.log** — use `console.error` for all diagnostic output.
4. **Zod for params** — tool parameters are defined as `Record<string, z.ZodType>`.
   The MCP SDK's `server.tool()` converts them to JSON Schema automatically.

## Before Making Changes

- [ ] Read existing patterns in the relevant `src/lib/` file
- [ ] Run `deno check main.ts` after changes
- [ ] Run `deno test -A` — all tests must pass
- [ ] Test with `deno task inspect` for interactive verification
- [ ] Ensure no `console.log` in any source file (only `console.error`)
