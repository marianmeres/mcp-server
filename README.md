# @marianmeres/mcp-server

[![NPM](https://img.shields.io/npm/v/@marianmeres/mcp-server)](https://www.npmjs.com/package/@marianmeres/mcp-server)
[![License](https://img.shields.io/npm/l/@marianmeres/mcp-server)](LICENSE)

A plugin-based [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) server for
Node that gives AI coding agents instant access to your package ecosystem — documentation,
tools, and domain-specific capabilities — without manual file reading every session.

## What It Does

The server acts as a **thin plugin host**. Point it at one or more directories containing
your packages, and it:

1. **Discovers tools automatically** — scans each package for a `mcp.ts` file and
   registers whatever tools the package declares
2. **Provides built-in ecosystem tools** — lets the agent list packages, read docs,
   search across documentation, and more
3. **Namespaces everything** — tools are prefixed with the package name
   (e.g. `my-package_my-tool`) to avoid collisions

The server communicates via **stdio transport** (JSON-RPC over stdin/stdout), which is the
standard for local MCP servers. The MCP client (Claude Code, Cowork, etc.) spawns it as a
subprocess — no ports, no HTTP, no manual startup.

## Why It's Useful

Without this server, an AI agent working on your project has no context about your package
ecosystem. It would need to manually find and read documentation files every session.

With this server, the agent can:

- Ask "what packages are available?" and get a structured overview
- Read any package's documentation on demand
- Search across all docs for a concept or pattern
- Use package-specific tools (query APIs, inspect schemas, etc.)

## Installation

Requires Node 24.12 or newer (it loads package `mcp.ts` files with Node's built-in type
stripping). Available on [npm](https://www.npmjs.com/package/@marianmeres/mcp-server):

```bash
# Run directly (recommended — it's a server, not a library dependency)
npx -y @marianmeres/mcp-server@^2 --config ./mcp.config.json

# Or add the type definition for writing package tools
npm install -D @marianmeres/mcp-server
```

Pin the major (`@^2`): a bare `npx @marianmeres/mcp-server` may keep reusing whatever
version sits in the npx cache.

> **Upgrading from 1.x (Deno, JSR):** 2.x runs on Node and is published to npm. The 1.x line
> stays on JSR for `deno run -A jsr:@marianmeres/mcp-server@1`. Package `mcp.ts` files
> written for Deno (`npm:` / `jsr:` imports, `Deno.*` calls) do not load under Node; see
> [Plugin requirements](#plugin-requirements).

## Quick Start

### 1. Create a config file

Create `mcp.config.json` in your project root, listing directories that contain your
packages:

```json
{
	"packageRoots": ["/path/to/your/packages", "/path/to/other/packages"]
}
```

Each "package root" is a directory whose immediate children are individual packages
(each in its own subdirectory).

### 2. Register with your MCP client

For **Claude Code** (globally, available in all projects):

```bash
claude mcp add --scope user my-mcp-server -- \
    npx -y @marianmeres/mcp-server@^2 --config /absolute/path/to/mcp.config.json
```

For **Claude Code** (project-scoped), create `.mcp.json` in the project root:

```json
{
	"mcpServers": {
		"my-mcp-server": {
			"type": "stdio",
			"command": "npx",
			"args": ["-y", "@marianmeres/mcp-server@^2", "--config", "./mcp.config.json"]
		}
	}
}
```

For **VSCode** (Copilot etc.), register via the Command Palette
("MCP: Add Server") or add to `~/Library/Application Support/Code/User/mcp.json`
using the same format as above.

For **Claude Desktop** (Cowork), add to
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"my-mcp-server": {
			"command": "npx",
			"args": [
				"-y",
				"@marianmeres/mcp-server@^2",
				"--config",
				"/absolute/path/to/mcp.config.json"
			]
		}
	}
}
```

To run from a local clone instead, use `node /path/to/mcp-server/src/main.ts` as the
command (after `pnpm install` in the clone).

### 3. Start using it

Once configured, the agent automatically has access to all registered tools. Ask it
things like:

- "What packages are available?"
- "Show me the docs for the `store` package"
- "Search the docs for how routing works"

## Built-in Tools

These tools are always available, regardless of whether any packages ship their own tools:

| Tool               | Parameters                | Description                                                        |
| ------------------ | ------------------------- | ------------------------------------------------------------------ |
| `list-packages`    | `root?` (optional filter) | List all packages with names, descriptions, and tool availability  |
| `get-package-docs` | `packageName` (required)  | Read a package's `AGENTS.md` (falls back to `README.md`)           |
| `search-docs`      | `query`, `caseSensitive?` | Full-text search across all package documentation (max 20 results) |

## Adding Tools to a Package

Any package can expose MCP tools by shipping a `mcp.ts` file at its root. The file
exports an array of tool definitions:

```typescript
// my-package/mcp.ts
import { z } from "zod";
import type { McpToolDefinition } from "@marianmeres/mcp-server/types";

export const tools: McpToolDefinition[] = [
	{
		name: "health-check",
		description: "Check if the service is running",
		params: {
			url: z.string().describe("Service URL"),
		},
		handler: async ({ url }) => {
			const res = await fetch(`${url}/health`);
			return `Status: ${res.status}`;
		},
	},
];
```

Key points:

- **`name`** — tool name (will be prefixed with the package directory name, e.g.
  `my-package_health-check`)
- **`description`** — shown to the AI agent to help it decide when to use the tool
  (see [Writing Effective Descriptions](#writing-effective-tool-descriptions) below)
- **`params`** — a record of [Zod](https://zod.dev/) schemas defining the tool's
  parameters
- **`handler`** — async function that receives validated parameters and returns a
  plain string (the server wraps it in the MCP response format)
- Only `zod` is needed as a dependency — no MCP SDK knowledge required
- Restart the MCP server to pick up new tools

### Plugin requirements

The server imports each `mcp.ts` straight from source with Node, so the file and
everything it imports must be loadable by Node:

- **Dependencies resolve from the package, not from the server.** Add `zod` to the
  package's own `package.json` (a devDependency is enough) and install it. The
  `@marianmeres/mcp-server/types` import is type-only and erased at load time, so it needs
  no install unless you type-check the file.
- **Use zod 3 (`^3.25.76`).** Zod 4 schemas validate fine, but their `.describe()` texts
  are dropped from the tool's parameter schema: zod 4 keeps them in a registry private to
  each zod copy, which the server cannot read.
- **Erasable TypeScript only.** Node strips types and never compiles: no `enum`,
  `namespace` or constructor parameter properties; use `import type` for type-only
  imports; write relative imports with their `.ts` extension.
- **No runtime-specific specifiers or globals.** No `npm:`, `jsr:` or `https:` imports, no
  `Deno.*`. Use web standards, and `node:*` modules where they don't reach.
- **Not under `node_modules`.** Node refuses to strip types there, so a package root must
  not point inside one.

A `mcp.ts` that fails any of these is skipped with a warning on stderr; the server and
the other tools keep running.

### The McpToolDefinition Type

```typescript
import type { z } from "zod";

interface McpToolDefinition {
	name: string;
	description: string;
	params: Record<string, z.ZodType>;
	handler: (args: Record<string, unknown>) => Promise<string>;
}
```

## Writing Effective Tool Descriptions

The `description` field is the single most important factor in whether the AI agent calls
your tool correctly. The agent performs **semantic matching** between the user's natural
language request and the available tool descriptions — it's essentially the contract
between human intent and your code.

**Why it matters:** When a user asks "What packages are available?", the agent scans all
registered tool descriptions to find the best match. A tool with the description
_"List all packages with names, descriptions, and tool availability"_ will be selected.
A tool with _"Does package stuff"_ probably won't.

**Guidelines:**

- **Be specific** — describe what the tool does, what it returns, and when to use it.
  _"Check if a service is healthy by hitting its /health endpoint"_ is much better than
  _"Health check"_.
- **Include key terms** the user is likely to say. If users might ask to "search",
  "find", or "look up" something, mention those concepts.
- **Avoid overlap** — if two tools have similar descriptions, the agent may pick the
  wrong one. Make each description distinct.
- **Describe parameters clearly** — use Zod's `.describe()` to explain each parameter.
  This helps the agent figure out what values to pass.

```typescript
// ❌ Vague — agent won't know when to use this
{
    name: "do-thing",
    description: "Processes data",
    params: { input: z.string() },
}

// ✅ Specific — agent can match this to user intent
{
    name: "validate-config",
    description: "Validate a package config file and report any errors or warnings",
    params: {
        path: z.string().describe("Absolute path to the config file to validate"),
    },
}
```

## Configuration

### Config file (recommended)

The simplest form — scan everything under each root:

```json
{
	"packageRoots": ["/absolute/path/to/packages", "./relative/path/also/works"]
}
```

Relative paths are resolved from the config file's location. Pass the config file via
`--config`:

```bash
npx -y @marianmeres/mcp-server@^2 --config ./mcp.config.json
```

### Filtering packages

When a root contains many directories (deprecated packages, unrelated projects, etc.),
you can filter which ones are discovered. Each root entry can be an object with filtering
options:

**Include list** — only scan these specific directories:

```json
{
	"packageRoots": [
		{ "path": "/path/to/packages", "include": ["store", "demino", "collection"] }
	]
}
```

**Exclude list** — scan everything except these:

```json
{
	"packageRoots": [
		{ "path": "/path/to/packages", "exclude": ["legacy-thing", "deprecated-pkg"] }
	]
}
```

**Marker file** — only scan directories containing a specific file:

```json
{
	"packageRoots": [{ "path": "/path/to/packages", "marker": "mcp-include.txt" }]
}
```

With the marker approach, each package opts in by having a `mcp-include.txt` file
at its root. This is the most decentralized option — each package decides for itself
whether to be visible to the MCP server.

**Bonus:** if the marker file has content, it is used as the **package description**
(shown when the agent calls `list-packages`). This is useful when the package's
`deno.json` or `package.json` doesn't have a `description` field. For example:

```
A reactive state management library with derived stores and persistence support
```

Description resolution order: `deno.json`/`package.json` `description` field →
marker file content → empty string.

**Combining modes** — plain strings and objects can be mixed. `marker` can combine with
`include` or `exclude` (both conditions must pass). `include` and `exclude` are mutually
exclusive.

```json
{
	"packageRoots": [
		"/path/to/small-focused-root",
		{ "path": "/path/to/large-root", "marker": "mcp-include.txt" },
		{ "path": "/path/to/another-root", "include": ["pkg-a", "pkg-b"] }
	]
}
```

### Environment variable (simple fallback)

For quick setup with a single package root:

```bash
MM_PACKAGES_ROOT=/path/to/packages npx -y @marianmeres/mcp-server@^2
```

### Per-project configuration

Each project can ship its own `mcp.config.json` listing the relevant package roots.
This way, different projects expose different sets of tools while sharing common packages.

## Tool Namespacing

Tools are namespaced by the package's directory name:

- `my-package/mcp.ts` defines `health-check` → registered as `my-package_health-check`

If the same directory name appears under multiple roots (rare), the server detects the
collision and uses a longer prefix: `root-name--package-name_tool-name`.

> **Note:** MCP tool names may only contain `[a-z0-9_-]`. The server uses `_` (underscore)
> as the namespace separator to comply with this constraint.

## Security

Package tools run inside the server process with its full privileges: file system,
network, environment. There is no sandbox, so only point package roots at code you trust.

## Development

```bash
pnpm install

# Start the server from source
pnpm start --config ./mcp.config.json

# Open the MCP Inspector (interactive web UI for testing tools)
pnpm run inspect

# Typecheck, lint and test (the CI gate)
pnpm run ci
```

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the easiest way
to manually test — it opens a browser UI where you can browse tools, fill in parameters,
and see results.

You can also send raw JSON-RPC to test:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
  | node src/main.ts --config ./mcp.config.json
```

## Architecture

```
mcp-server/
  src/
    main.ts            # Entry point (npm bin) — loads config, discovers plugins, starts stdio
    types.ts           # McpToolDefinition type (imported by packages)
    mod.ts             # Library export (`@marianmeres/mcp-server/types`)
    lib/
      config.ts        # Config loading (file or env var)
      discovery.ts     # Scans roots, imports mcp.ts files, namespaces tools
      builtin-tools.ts # The 3 built-in ecosystem tools
      fs-utils.ts      # Filesystem helpers (file existence, safe reads, dir scanning)
      errors.ts        # Error message extraction
```

## License

[MIT](LICENSE)
