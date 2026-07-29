/**
 * Behaviour tests for the ID-71.10 (M32, B-INV-32) one-or-many consolidation
 * of the content tools:
 *   - get_content_item + get_content_items   → `get`    (one-or-many)
 *   - assign_content_owner + bulk_assign_owner → `assign` (one-or-many)
 *
 * These cover the NEW one-or-many surface that the pre-consolidation tools did
 * not have: the exactly-one-of param guard on each tool, and the discriminated
 * `mode` shape returned by `get`. The single/batch/explicit/scope happy paths
 * themselves are covered by content-chunks-integration / assign-content-owner /
 * bulk-assign-owner.
 *
 * B-INV-32: each single+batch pair collapses to ONE parameterised entry.
 * B-INV-33: `get` preserves the two-step list/preview → verbatim retrieval —
 *           a single `id` returns the verbatim item with chunks; `ids` returns
 *           a batch list/preview (no chunks).
 * id-392 (M6): document bodies are composed from content_chunks /
 *           reference_items (fetchSourceDocumentBodies) — also guards the
 *           update tool refusing a `content` edit on a source document
 *           rather than silently discarding it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateMcpClient, mockGetMcpUserId, mockCheckMcpRole } = vi.hoisted(
  () => ({
    mockCreateMcpClient: vi.fn(),
    mockGetMcpUserId: vi.fn(),
    mockCheckMcpRole: vi.fn(),
  }),
);

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mockCreateMcpClient,
  getMcpUserId: mockGetMcpUserId,
  checkMcpRole: mockCheckMcpRole,
  createMcpUserClient: vi.fn(),
}));

vi.mock('@/lib/mcp/formatters', () => ({
  formatContentItem: vi.fn(() => 'formatted-item'),
  formatCreatedItem: vi.fn(() => 'created'),
  formatUpdatedItem: vi.fn(() => 'updated'),
  formatBatchContentItems: vi.fn(() => 'formatted-batch'),
  formatContentItemChunks: vi.fn(() => ''),
  truncateResponse: vi.fn((s: string) => s),
  CHARACTER_LIMIT: 10000,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return { ...actual, generateEmbedding: vi.fn() };
});
vi.mock('@/lib/ai/classify', () => ({ classifyContent: vi.fn() }));
vi.mock('@/lib/ai/summarise', () => ({ generateSummary: vi.fn() }));

import { registerContentTools } from '@/lib/mcp/tools/content';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-000000000099';
const ID_1 = '11111111-2222-4333-8444-555555555501';
const ID_2 = '11111111-2222-4333-8444-555555555502';

let mockServer: ReturnType<typeof createMockMcpServer>;

const extra = {
  authInfo: { token: 't', extra: { userId: ADMIN_USER_ID, role: 'admin' } },
};

describe('ID-71.10 content tool consolidation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetMcpUserId.mockReturnValue(ADMIN_USER_ID);
    mockCheckMcpRole.mockResolvedValue('admin');
    mockServer = createMockMcpServer();
    await registerContentTools(mockServer.server);
  });

  describe('single+batch pairs each collapse to one entry (B-INV-32)', () => {
    it('registers `get` and `assign`, and NOT the retired pair names', () => {
      expect(mockServer.getTool('get')).toBeDefined();
      expect(mockServer.getTool('assign')).toBeDefined();
      expect(mockServer.getTool('get_content_item')).toBeUndefined();
      expect(mockServer.getTool('get_content_items')).toBeUndefined();
      expect(mockServer.getTool('assign_content_owner')).toBeUndefined();
      expect(mockServer.getTool('bulk_assign_owner')).toBeUndefined();
    });

    it('new entries declare an outputSchema (B-INV-37)', () => {
      expect(mockServer.getTool('get')!.config.outputSchema).toBeDefined();
      expect(mockServer.getTool('assign')!.config.outputSchema).toBeDefined();
    });

    it('leaves the dedup tools out of scope (not registered in content.ts)', () => {
      // Dedup (find_duplicate_candidates / find_all_duplicates) lives in
      // search.ts / quality.ts — ID-71.10 part-1 must not touch them.
      expect(mockServer.getTool('find_duplicate_candidates')).toBeUndefined();
      expect(mockServer.getTool('find_all_duplicates')).toBeUndefined();
    });
  });

  describe('get — one-or-many param', () => {
    it('rejects when neither id nor ids is provided', async () => {
      const result = await mockServer.getHandler('get')!({}, extra);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('exactly one');
    });

    it('rejects when both id and ids are provided', async () => {
      const result = await mockServer.getHandler('get')!(
        { id: ID_1, ids: [ID_2] },
        extra,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('exactly one');
    });

    it('single id returns mode=single with a verbatim item and its chunks (B-INV-33 accept step)', async () => {
      const itemRow = {
        id: ID_1,
        suggested_title: 'Single Item',
      };
      // ID-131 (G-MCP-REPOINT) + id-392 (M6 retarget): four thenable
      // queries — source_documents .single(), record_lifecycle .maybeSingle()
      // (freshness/governance join), the content_chunks BODY read
      // (fetchSourceDocumentBody: .in().order().order().range()) — the
      // verbatim body is composed from chunk content, extracted_text is
      // legacy and never selected — then content_chunks .order() (section
      // metadata).
      const single = vi.fn().mockResolvedValue({ data: itemRow, error: null });
      const chainSingle = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single,
      };
      const chainLifecycle = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      const chainBody = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            { source_document_id: ID_1, content: 'verbatim body', position: 0 },
          ],
          error: null,
        }),
      };
      const chainChunks = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      const from = vi
        .fn()
        .mockReturnValueOnce(chainSingle)
        .mockReturnValueOnce(chainLifecycle)
        .mockReturnValueOnce(chainBody)
        .mockReturnValueOnce(chainChunks);
      mockCreateMcpClient.mockReturnValue({ from });

      const result = await mockServer.getHandler('get')!({ id: ID_1 }, extra);

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent!.mode).toBe('single');
      const item = result.structuredContent!.item as Record<string, unknown>;
      expect(item.id).toBe(ID_1);
      // id-392: the verbatim body comes from the composed chunk content.
      expect(item.content).toBe('verbatim body');
      expect(item.chunks).toEqual([]);
    });

    it('ids array returns mode=batch list/preview without a single item (B-INV-33 list step)', async () => {
      // ID-131 (G-MCP-REPOINT) + id-392 (M6 retarget): three queries —
      // source_documents .in() (the rows), the content_chunks BODY read
      // (fetchSourceDocumentBodies: .in().order().order().range()) that
      // composes each preview's `content`, then the record_lifecycle
      // freshness/governance enrichment (`.eq().in()`).
      const chainDocs = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [
            { id: ID_1, suggested_title: 'A' },
            { id: ID_2, suggested_title: 'B' },
          ],
          error: null,
        }),
      };
      const chainBody = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            { source_document_id: ID_1, content: 'a', position: 0 },
            { source_document_id: ID_2, content: 'b', position: 0 },
          ],
          error: null,
        }),
      };
      const chainLifecycle = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      const from = vi
        .fn()
        .mockReturnValueOnce(chainDocs)
        .mockReturnValueOnce(chainBody)
        .mockReturnValueOnce(chainLifecycle);
      mockCreateMcpClient.mockReturnValue({ from });

      const result = await mockServer.getHandler('get')!(
        { ids: [ID_1, ID_2] },
        extra,
      );

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent!.mode).toBe('batch');
      expect(result.structuredContent!.item).toBeNull();
      expect(result.structuredContent!.count).toBe(2);
      // Batch path queries source_documents.in(...).
      expect(chainDocs.in).toHaveBeenCalled();
      // id-392: each preview's content is the composed chunk body.
      const items = result.structuredContent!.items as Array<
        Record<string, unknown>
      >;
      expect(items.map((i) => i.content)).toEqual(['a', 'b']);
    });
  });

  describe('assign — one-or-many param', () => {
    it('rejects when neither item_ids nor scope is provided', async () => {
      const result = await mockServer.getHandler('assign')!(
        { owner_id: OWNER_ID },
        extra,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('exactly one');
    });

    it('rejects when both item_ids and scope are provided', async () => {
      const result = await mockServer.getHandler('assign')!(
        {
          item_ids: [ID_1],
          scope: { domain: 'Healthcare', unowned_only: true },
          owner_id: OWNER_ID,
        },
        extra,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('exactly one');
    });

    it('explicit item_ids path routes via the bulk_assign_content_owner RPC and reports action=assign_content_owner', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
      // ID-131 (G-MCP-REPOINT): the former content_items.id ->
      // source_document_id resolution query is GONE — bulk_assign_content_owner
      // matches record_lifecycle.owner_id, which IS the caller-supplied id
      // directly now (no content_items indirection left to resolve). This
      // branch no longer calls `.from()` at all; `from` is present only so
      // the mocked client shape stays consistent with other tests.
      const from = vi.fn();
      mockCreateMcpClient.mockReturnValue({ rpc, from });

      const result = await mockServer.getHandler('assign')!(
        { item_ids: [ID_1], owner_id: OWNER_ID },
        extra,
      );

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent!.action).toBe('assign_content_owner');
    });
  });

  describe('update_content_item — document body is chunk-composed (id-392 M6)', () => {
    it('rejects a `content` update on a source document as unsupported instead of silently discarding it', async () => {
      // The document body lives in content_chunks / reference_items; the old
      // `extracted_text` target is a column nothing reads. Accepting the
      // write would silently discard the edit, so the tool must refuse it.
      const chainOwner = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { id: ID_1 }, error: null }),
      };
      const from = vi.fn().mockReturnValueOnce(chainOwner);
      mockCreateMcpClient.mockReturnValue({ from });

      const result = await mockServer.getHandler('update_content_item')!(
        { id: ID_1, fields: { content: 'edited body' } },
        extra,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Unsupported for this source document: content',
      );
      // Nothing was written — the only DB touch was the owner-kind
      // resolution read against source_documents.
      expect(from).toHaveBeenCalledTimes(1);
      expect(from).toHaveBeenCalledWith('source_documents');
    });
  });
});
