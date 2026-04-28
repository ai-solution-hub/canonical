# MCP Module

MCP server exposed via Streamable HTTP transport at `/api/mcp/mcp`. Current
tool, resource, and prompt counts: `docs/generated/mcp-inventory.md` (regenerate
with `bun run generate:mcp-inventory`).

## Key Files

- `tools/index.ts` — barrel that calls `registerXxxTools(server)` in discovery
  order
- `tools/shared.ts` — `ToolExtra` type, `toStructuredContent` helper, lazy
  import wrappers
- `resources.ts` — resource + prompt registrations (template, static, and app
  resources)
- `auth.ts` — per-user Supabase client from OAuth bearer token, role checking
- `formatters/` — parallel structure to `tools/`; one formatter file per
  category
- `app-bundles.ts` — auto-generated HTML string constants for MCP Apps
  (committed)
- `plugin-bundle.ts` — auto-generated base64 plugin ZIP (committed)

Entry point: `app/api/mcp/[transport]/route.ts`

## Conventions

### Tool Registration

Use `defineTool` (or `defineAppTool` for MCP App trigger tools) from `./shared`.
The wrapper enforces all four `ToolAnnotations` fields at compile time via
`RequiredToolAnnotations` — pick one of the four named constants:
`READ_ONLY_ANNOTATIONS`, `SAFE_WRITE_ANNOTATIONS`,
`DESTRUCTIVE_WRITE_ANNOTATIONS`, or `NON_IDEMPOTENT_WRITE_ANNOTATIONS`.

```typescript
defineTool(
  server,
  'snake_case_name',           // No service prefix — single-purpose server
  {
    title: 'Human Title',
    description: '...',
    inputSchema: { param: z.string().describe('...') },
    annotations: READ_ONLY_ANNOTATIONS,
  },
  async (args, extra: ToolExtra) => { ... }
);
```

**Gotcha:** `destructiveHint` defaults to `true` in the MCP spec. Use one of the
four named annotation constants via `defineTool` so clients don't render
read-only tools as destructive.

### Response Format

Every tool returns dual content — Markdown for humans, JSON for machines:

```typescript
return {
  content: [{ type: 'text' as const, text: markdown }],
  structuredContent: toStructuredContent(dataObject),
};
```

Errors use `isError: true` with guidance text. Markdown truncated to 10,000
chars via `truncateResponse()`.

### Auth

All tools call `createMcpClient(extra.authInfo)` for RLS-scoped queries. Write
tools additionally call `checkMcpRole(extra.authInfo, ['admin', 'editor'])`.

### Lazy Imports

Heavy modules (AI, dashboard, bid queries) are loaded on-demand via wrapper
functions in `shared.ts` to prevent Vercel cold start crashes at module
evaluation time. Always use these wrappers, never direct imports.

### Formatters

Each formatter file defines TypeScript interfaces for structured data shapes and
format functions for Markdown output. The barrel `formatters/index.ts`
re-exports everything. Dates use `formatDateUK` (DD/MM/YYYY).

### Adding a New Tool

1. Add tool function to the appropriate category file in `tools/`
2. Add corresponding formatter in `formatters/` (interface + format function)
3. Register in `tools/index.ts` if new category file
4. Run `bun run generate:mcp-inventory` to update inventory docs
5. Add unit tests in `__tests__/mcp/`

## MCP Apps

Four apps in `mcp-apps/`: `coverage-matrix`, `bid-dashboard`, `reorient-me`,
`intelligence-feed`.

Each app is a Vite single-file build. Build pipeline: `bun run build:mcp-apps`
builds all apps, then `scripts/bundle-mcp-apps.ts` inlines the HTML into
`app-bundles.ts` as string constants. Both `app-bundles.ts` and
`plugin-bundle.ts` are committed so Vercel can serve without filesystem reads.

App types in `mcp-apps/{name}/src/types.ts` must match the corresponding
`formatters/*.ts` interfaces — tested by `mcp-app-contracts.test.ts`.

## Testing

- **Unit tests:** `__tests__/mcp/` — formatters, tool registration, app
  contracts (file count tracked in `docs/generated/codebase-stats.md`)
- **Eval Layer 1:** `bun run test:mcp-eval` — protocol compliance (42 checks)
- **Eval Layer 3:** `bun run test:mcp-eval:rq` — response quality (17 checks)
- **Eval Layer 4:** `bun run test:mcp-eval:fc` — functional correctness (37
  checks, live DB)
- **Eval fixtures:** `scripts/mcp-eval/fixtures.ts` — canonical tool/prompt
  lists, auth helpers

## References

- **MCP App build guide:** `docs/reference/mcp-app-build-guide.md` —
  step-by-step for creating new MCP Apps (scaffold, lifecycle, CSS,
  registration, deployment)
- **Eval spec:** `docs/specs/mcp-evaluation-spec.md` — layered evaluation design
  (note: tool counts in the spec are stale; `scripts/mcp-eval/fixtures.ts` is
  the canonical source for current tool/prompt lists)
- **Auto-generated inventory:** `docs/generated/mcp-inventory.md` — current
  tool, resource, and prompt listings (regenerate with
  `bun run generate:mcp-inventory`)
- **Skills:** `mcp-builder` (building MCP servers), `create-mcp-app`
  (scaffolding MCP Apps), `convert-web-app` (converting existing web UIs to MCP
  Apps)

## Gotchas

- **Fresh server per request:** Never reuse `McpServer` or transport instances —
  Vercel warm instances corrupt shared state. Use `mcp-handler` only for
  `.well-known` endpoint.
- **`toStructuredContent` is required:** MCP SDK's index signature rejects plain
  objects. Always wrap via the helper.
- **Registration order matters:** Tool discovery order in MCP clients follows
  the call order in `tools/index.ts`.
- **App bundle size:** `app-bundles.ts` is ~500KB. Changes to MCP App source
  require rebuilding (`bun run build:mcp-apps`) and committing the updated file.
