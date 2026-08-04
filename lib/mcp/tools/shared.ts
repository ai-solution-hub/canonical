/**
 * Shared utilities, types, and lazy import wrappers for MCP tool registrations.
 *
 * All heavy modules are loaded on-demand to prevent Vercel serverless cold
 * start crashes. Module-level imports of OpenAI SDK, dashboard queries, and
 * Anthropic SDK cause the function to crash at the V8/Node level before any
 * application code runs.
 */
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerRequest,
  ServerNotification,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  McpServer,
  RegisteredTool,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  AnySchema,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';

// ---------------------------------------------------------------------------
// Type alias for the extra parameter in tool callbacks
// ---------------------------------------------------------------------------

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// ---------------------------------------------------------------------------
// P0-19: MCP tool annotation constants + `defineTool` / `defineAppTool`
// wrappers (DECISIONS.md v4.1 §3.1 P0-19 / C-6 gate).
//
// The four `ToolAnnotations` advisory fields are declared `Required<>` at the
// type level so every tool has to set every one. Pick one of the four named
// constants below — they encode the only policy-approved combinations.
//
// Why a wrapper instead of modifying SDK types? The SDK types are vendored,
// so we can't tighten `registerTool`'s `annotations` to `Required<>` directly.
// A thin wrapper is the idiomatic TypeScript workaround and has zero runtime
// cost (it just delegates to `server.registerTool`).
// ---------------------------------------------------------------------------

/**
 * A `ToolAnnotations` variant where every advisory field is explicit.
 * `defineTool` enforces this at compile time so no tool can silently omit
 * a field.
 * @public
 */
export type RequiredToolAnnotations = Required<
  Pick<
    ToolAnnotations,
    'readOnlyHint' | 'idempotentHint' | 'destructiveHint' | 'openWorldHint'
  >
>;

/**
 * Pure read — no side effects, safe to retry, non-destructive. Use for every
 * `search_*`, `get_*`, `list_*`, `find_*`, `audit_*`, `suggest_*`, `show_*`
 * tool.
 */
export const READ_ONLY_ANNOTATIONS: RequiredToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * Write that is safe to retry (same inputs → same end state) and does not
 * destroy data. Use for `update_*`, `assign_*`, `cite_*` (upsert),
 * `classify_content`, `generate_summary`, `update_governance_status`.
 */
export const SAFE_WRITE_ANNOTATIONS: RequiredToolAnnotations = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * Destructive write — archives or deletes data. Use for `delete_content_item`
 * and similar hard-delete tools. MCP clients may show an extra confirmation
 * prompt for these.
 */
export const DESTRUCTIVE_WRITE_ANNOTATIONS: RequiredToolAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

/**
 * Write that is NOT idempotent — each call creates a new row or fresh state.
 * Use for `create_content_item` (fresh UUID per call) and similar creators.
 */
export const NON_IDEMPOTENT_WRITE_ANNOTATIONS: RequiredToolAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * Non-idempotent write that interacts with external systems over the network
 * (third-party HTTP APIs, RSS feeds, etc.). Use for tools that trigger
 * pipelines fetching from outside services — clients can warn users about
 * external interactions.
 */
export const NON_IDEMPOTENT_OPEN_WORLD_WRITE_ANNOTATIONS: RequiredToolAnnotations =
  {
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: false,
    openWorldHint: true,
  };

/**
 * Tool config shape for `defineTool`. Mirrors the `config` parameter of
 * `McpServer.registerTool` but tightens `annotations` to the
 * `RequiredToolAnnotations` variant.
 * @public
 */
export interface DefineToolConfig<
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  OutputArgs extends ZodRawShapeCompat | AnySchema = ZodRawShapeCompat,
> {
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  annotations: RequiredToolAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * Wrapper over `server.registerTool` that enforces all four
 * `ToolAnnotations` fields at compile time. Use one of the named
 * constants (`READ_ONLY_ANNOTATIONS`, `SAFE_WRITE_ANNOTATIONS`,
 * `DESTRUCTIVE_WRITE_ANNOTATIONS`, `NON_IDEMPOTENT_WRITE_ANNOTATIONS`) for
 * the `annotations` field.
 *
 * Return type mirrors `server.registerTool` so callers keep the same
 * `RegisteredTool` handle.
 */
export function defineTool<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
>(
  server: McpServer,
  name: string,
  config: DefineToolConfig<InputArgs, OutputArgs>,
  cb: ToolCallback<InputArgs>,
): RegisteredTool {
  return server.registerTool(name, config, cb);
}

// ---------------------------------------------------------------------------
// Helper — safely convert typed objects to structuredContent
// ---------------------------------------------------------------------------

/**
 * The MCP SDK requires structuredContent to have a `[x: string]: unknown`
 * index signature. This helper performs a safe cast via JSON round-trip.
 */
export function toStructuredContent(data: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Lazy imports — all heavy modules are loaded on-demand to prevent Vercel
// serverless cold start crashes.
// ---------------------------------------------------------------------------

export async function getGenerateEmbedding() {
  const { generateEmbedding } = await import('@/lib/ai/embed');
  return generateEmbedding;
}
export async function getClassifyContent() {
  const { classifyContent } = await import('@/lib/ai/classify');
  return classifyContent;
}
export async function getGenerateSummary() {
  const { generateSummary } = await import('@/lib/ai/summarise');
  return generateSummary;
}
export async function getDashboardModule() {
  return await import('@/lib/dashboard');
}
export async function getAIErrors() {
  const { AIServiceError } = await import('@/lib/ai/errors');
  return AIServiceError;
}
