/**
 * Regression guard for P0-19 `defineTool` / `defineAppTool` contract.
 *
 * Every MCP tool registered against the server must declare all four
 * `ToolAnnotations` advisory fields (the `RequiredToolAnnotations` variant
 * enforced by `defineTool`). This test captures every tool registration via
 * a mock server, then asserts the full contract at runtime so the guarantee
 * survives future refactors even if `defineTool` is bypassed.
 *
 * Why mock-capture? `McpServer._registeredTools` is declared `private` on
 * the SDK class (`@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`),
 * so iterating live registrations via a public method is not possible.
 *
 * Why all 11 modules? `registerAppTool` (ext-apps) is a thin convenience
 * wrapper that delegates to `server.registerTool`, so the single mock
 * `registerTool` capture catches the 4 app-tool registrations too — total
 * captured count should be 58 across all 16 modules (governance.ts adds
 * `update_publication_status` in S202 §5.2 T7; search.ts adds
 * `find_duplicate_candidates` in S217 W1B).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Mocks — keep minimal; these tools are never executed, only registered
// ---------------------------------------------------------------------------

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: vi.fn(),
  createMcpUserClient: vi.fn(),
  getMcpUserId: vi.fn(),
  getMcpUserRole: vi.fn(),
  checkMcpRole: vi.fn(),
}));

vi.mock('@/lib/ai/embed', () => ({ generateEmbedding: vi.fn() }));
vi.mock('@/lib/ai/classify', () => ({ classifyContent: vi.fn() }));
vi.mock('@/lib/ai/summarise', () => ({ generateSummary: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports — after mocks so auth/AI stubs are active
// ---------------------------------------------------------------------------

import { registerSearchTools } from '@/lib/mcp/tools/search';
import { registerContentTools } from '@/lib/mcp/tools/content';
import { registerBidTools } from '@/lib/mcp/tools/bids';
import { registerDashboardTools } from '@/lib/mcp/tools/dashboard';
import { registerQualityTools } from '@/lib/mcp/tools/quality';
import { registerAITools } from '@/lib/mcp/tools/ai';
import { registerEntityTools } from '@/lib/mcp/tools/entities';
import { registerTemplateTools } from '@/lib/mcp/tools/templates';
import { registerGovernanceTools } from '@/lib/mcp/tools/governance';
import { registerSupersessionTools } from '@/lib/mcp/tools/supersession';
import { registerReviewTools } from '@/lib/mcp/tools/review';
import { registerIntelligenceTools } from '@/lib/mcp/tools/intelligence';
import { registerAppTools } from '@/lib/mcp/tools/apps';
import { registerGuideTools } from '@/lib/mcp/tools/guides';
import { registerChangeReportTools } from '@/lib/mcp/tools/change-report';
import { registerWorkspaceTools } from '@/lib/mcp/tools/workspaces';

// ---------------------------------------------------------------------------
// Mock server — captures (name, config) from every registerTool call
// ---------------------------------------------------------------------------

interface ToolRegistration {
  name: string;
  config: {
    annotations?: {
      readOnlyHint?: boolean;
      idempotentHint?: boolean;
      destructiveHint?: boolean;
      openWorldHint?: boolean;
    };
  };
}

function createMockServer(registered: ToolRegistration[]): McpServer {
  return {
    registerTool: vi.fn((name: string, config: ToolRegistration['config']) => {
      registered.push({ name, config });
      // Return a shape loosely compatible with `RegisteredTool` — the ext-apps
      // `registerAppTool` wrapper inspects nothing on the result.
      return { enabled: true };
    }),
  } as unknown as McpServer;
}

async function collectAllTools(): Promise<ToolRegistration[]> {
  const registered: ToolRegistration[] = [];
  const server = createMockServer(registered);

  // Registration order matches `tools/index.ts` for completeness. The
  // `registerAppTool` path in apps.ts delegates internally to
  // `server.registerTool`, so the single mock catches every tool including
  // the 4 app tools.
  await registerSearchTools(server);
  await registerDashboardTools(server);
  await registerBidTools(server);
  await registerContentTools(server);
  await registerQualityTools(server);
  await registerAITools(server);
  await registerEntityTools(server);
  await registerTemplateTools(server);
  await registerAppTools(server);
  await registerGovernanceTools(server);
  await registerSupersessionTools(server);
  await registerReviewTools(server);
  await registerIntelligenceTools(server);
  await registerGuideTools(server);
  await registerChangeReportTools(server);
  await registerWorkspaceTools(server);

  return registered;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP tool annotation coverage (P0-19 regression guard)', () => {
  let tools: ToolRegistration[];

  beforeEach(async () => {
    vi.clearAllMocks();
    tools = await collectAllTools();
  });

  it('registers exactly 58 tools across all 16 modules', () => {
    // This guards against accidental duplicate registrations or a module
    // silently no-oping (e.g. a lazy-import failure inside registerAppTools).
    expect(tools.length).toBe(58);
  });

  it('every registered tool declares all four ToolAnnotations fields', () => {
    for (const tool of tools) {
      expect(
        tool.config.annotations,
        `${tool.name} missing annotations`,
      ).toBeDefined();
      expect(
        typeof tool.config.annotations!.readOnlyHint,
        `${tool.name} missing readOnlyHint`,
      ).toBe('boolean');
      expect(
        typeof tool.config.annotations!.idempotentHint,
        `${tool.name} missing idempotentHint`,
      ).toBe('boolean');
      expect(
        typeof tool.config.annotations!.destructiveHint,
        `${tool.name} missing destructiveHint`,
      ).toBe('boolean');
      expect(
        typeof tool.config.annotations!.openWorldHint,
        `${tool.name} missing openWorldHint`,
      ).toBe('boolean');
    }
  });

  it('readOnlyHint=true tools never set destructiveHint=true', () => {
    for (const tool of tools) {
      if (tool.config.annotations?.readOnlyHint === true) {
        expect(
          tool.config.annotations.destructiveHint,
          `${tool.name}: read-only tool must not be destructive`,
        ).toBe(false);
      }
    }
  });

  it('only delete_content_item and supersede_content_item have destructiveHint=true', () => {
    // Both tools retire a live row: delete_content_item removes it,
    // supersede_content_item hides it behind a successor version.
    const destructive = tools.filter(
      (t) => t.config.annotations?.destructiveHint === true,
    );
    expect(destructive.map((t) => t.name).sort()).toEqual([
      'delete_content_item',
      'supersede_content_item',
    ]);
  });
});
