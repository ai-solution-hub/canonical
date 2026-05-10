/**
 * Canonical mock MCP server factory for tests.
 *
 * Replaces 24 near-duplicate `createMockMcpServer` / `createMockServer` /
 * `createTestServer` definitions previously copy-pasted across
 * `__tests__/mcp/*.test.ts`. Per W-RA in `remediation-plan.md` §3.1 and
 * the S37 audit Agent D finding C6 (`agent-d-output.md` §C6).
 *
 * The helper absorbs the most permissive variation observed across the 24
 * files so a single import covers every consumer pattern:
 *
 * - **Record access:** `mockServer.tools['tool_name']`, `mockServer.prompts['…']`,
 *   `mockServer.resources['…']` — used directly by `quality-briefing` and
 *   the prompt-template suites.
 * - **Array access:** `mockServer.toolList.length` / `.find(t => t.name === …)` —
 *   used by `tool-annotations-coverage` (registration count guard) and the
 *   `tools.find()` consumer pattern in governance-queue-tools, review-tools,
 *   list-user-workspaces, etc.
 * - **Map access via getters:** `mockServer.getHandler(name)`,
 *   `mockServer.getTool(name)`, `mockServer.getPrompt(name)`,
 *   `mockServer.getResourceHandler(name)` — the most common consumer
 *   pattern across the suite.
 * - **`server` field cast:** `mockServer.server` is the same object typed
 *   as `McpServer` for callsites that pass the harness into a `register*()`
 *   function whose signature requires the SDK class. Equivalent to the
 *   `{ server: McpServer; tools }` return shape several factories used.
 * - **`registerTool` is a `vi.fn()`** so call-counts can be asserted where
 *   needed (e.g. `expect(mockServer.registerTool).toHaveBeenCalledTimes(N)`),
 *   matching the `vi.fn()`-based factories in the audit.
 *
 * Pattern reference: `validCreateBody(overrides)` in
 * `__tests__/api/items.test.ts` — Liam-preferred `Partial<T>` overrides
 * convention per Test Philosophy §1 #6.
 */
import { vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Canonical MCP tool result shape. Matches the SDK's `CallToolResult`
 * subset that every tool in the codebase returns. The generic
 * `TStructured` lets consumers narrow `structuredContent` to the tool's
 * specific schema when asserting on field-level shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface MockToolResult<TStructured = any> {
  content: Array<{ type: string; text: string }>;
  structuredContent?: TStructured;
  isError?: boolean;
}

/**
 * Tool handler signature observed across the MCP test suite. Args and extra
 * are intentionally typed as `Record<string, unknown>` — individual suites
 * narrow via casts at the callsite where the tool's input schema is known.
 *
 * Return type defaults to `Promise<MockToolResult>` because every captured
 * tool in the SUT returns the SDK's `CallToolResult` shape. The
 * `structuredContent` slot is `any`-typed by default to preserve the
 * ergonomics the 24 pre-consolidation suites relied on (each suite cast
 * to a tool-specific schema inline). Strict consumers can pass
 * `MockToolResult<MyShape>` via a wrapper type.
 */
export type MockToolHandler = (
  args: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<MockToolResult>;

/**
 * Prompt handler signature for `registerPrompt`. Prompts return MCP
 * `messages` envelopes (role + content blocks).
 */
export type MockPromptHandler = (
  args: Record<string, unknown>,
) => Promise<{
  messages: Array<{
    role: string;
    content: { type: string; text: string };
  }>;
}>;

/**
 * Resource handler signature. Resources accept variadic args (URI / template
 * params / metadata depending on registration shape) — kept open with
 * `unknown[]` so both static and template resources fit.
 */
export type MockResourceHandler = (...args: unknown[]) => Promise<unknown>;

/** Captured tool registration record. */
export interface MockToolRegistration {
  name: string;
  config: Record<string, unknown>;
  handler: MockToolHandler;
}

/** Captured prompt registration record. */
export interface MockPromptRegistration {
  name: string;
  config: Record<string, unknown>;
  handler: MockPromptHandler;
}

/** Captured resource registration record. */
export interface MockResourceRegistration {
  name: string;
  /** URI string or `ResourceTemplate` instance — kept opaque. */
  uriOrTemplate: unknown;
  metadata: unknown;
  handler: MockResourceHandler;
}

export interface MockMcpServer {
  // Same object cast as McpServer for callsites whose signatures require
  // the SDK class. `registerTool` etc. are duck-type compatible.
  server: McpServer;

  // Capture stores — Record by name + Array in registration order so both
  // `tools[name]` and `toolList.find(...)` consumer patterns work.
  tools: Record<string, MockToolRegistration>;
  toolList: MockToolRegistration[];
  prompts: Record<string, MockPromptRegistration>;
  promptList: MockPromptRegistration[];
  resources: Record<string, MockResourceRegistration>;
  resourceList: MockResourceRegistration[];

  // Registration capture functions — `vi.fn()` so call-counts/args can be
  // asserted where the contract demands it.
  registerTool: Mock;
  registerPrompt: Mock;
  registerResource: Mock;

  // Convenience getters covering the four lookup patterns observed.
  getHandler(name: string): MockToolHandler | undefined;
  getTool(name: string): MockToolRegistration | undefined;
  getPrompt(name: string): MockPromptRegistration | undefined;
  getResourceHandler(name: string): MockResourceHandler | undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a mock MCP server that captures every tool / prompt / resource
 * registration and exposes them via Record + Array + getter access patterns.
 *
 * @param overrides Optional partial overrides. Most callsites pass nothing;
 *                  pass a partial to inject test-specific behaviour (e.g.
 *                  `registerTool: vi.fn(...)` to override capture behaviour).
 *
 * @example Tool handler invocation
 * ```ts
 * const mockServer = createMockMcpServer();
 * await registerSearchTools(mockServer.server);
 * const handler = mockServer.getHandler('search_knowledge_base')!;
 * const result = await handler({ query: 'foo' }, { authInfo });
 * ```
 *
 * @example Direct tool record access (quality-briefing pattern)
 * ```ts
 * expect(mockServer.tools['get_quality_briefing']).toBeDefined();
 * ```
 *
 * @example Registration count guard (tool-annotations-coverage pattern)
 * ```ts
 * expect(mockServer.toolList.length).toBe(58);
 * ```
 *
 * @example Prompt registration (prompt-template suites)
 * ```ts
 * registerPrompts(mockServer.server as never);
 * const prompt = mockServer.getPrompt('review_item');
 * ```
 */
export function createMockMcpServer(
  overrides: Partial<MockMcpServer> = {},
): MockMcpServer {
  const tools: Record<string, MockToolRegistration> = {};
  const toolList: MockToolRegistration[] = [];
  const prompts: Record<string, MockPromptRegistration> = {};
  const promptList: MockPromptRegistration[] = [];
  const resources: Record<string, MockResourceRegistration> = {};
  const resourceList: MockResourceRegistration[] = [];

  const registerTool = vi.fn(
    (
      name: string,
      config: Record<string, unknown>,
      handler: MockToolHandler,
    ) => {
      const entry: MockToolRegistration = { name, config, handler };
      tools[name] = entry;
      toolList.push(entry);
      // Match the SDK's RegisteredTool return shape (consumers across the
      // 24 files variably treat the result as `{ enabled: true }` or ignore
      // it; returning the documented shape is the safest superset).
      return { enabled: true };
    },
  );

  const registerPrompt = vi.fn(
    (
      name: string,
      config: Record<string, unknown>,
      handler: MockPromptHandler,
    ) => {
      const entry: MockPromptRegistration = { name, config, handler };
      prompts[name] = entry;
      promptList.push(entry);
      return { enabled: true };
    },
  );

  const registerResource = vi.fn(
    (
      name: string,
      uriOrTemplate: unknown,
      metadata: unknown,
      handler: MockResourceHandler,
    ) => {
      const entry: MockResourceRegistration = {
        name,
        uriOrTemplate,
        metadata,
        handler,
      };
      resources[name] = entry;
      resourceList.push(entry);
      return { enabled: true };
    },
  );

  // Build the harness object first so `server` can alias to it (cast as
  // McpServer for callsites whose signatures require the SDK class).
  const harness = {
    tools,
    toolList,
    prompts,
    promptList,
    resources,
    resourceList,
    registerTool,
    registerPrompt,
    registerResource,
    getHandler(name: string): MockToolHandler | undefined {
      return tools[name]?.handler;
    },
    getTool(name: string): MockToolRegistration | undefined {
      return tools[name];
    },
    getPrompt(name: string): MockPromptRegistration | undefined {
      return prompts[name];
    },
    getResourceHandler(name: string): MockResourceHandler | undefined {
      return resources[name]?.handler;
    },
  };

  const mockServer: MockMcpServer = {
    ...harness,
    server: harness as unknown as McpServer,
    ...overrides,
  };

  return mockServer;
}
