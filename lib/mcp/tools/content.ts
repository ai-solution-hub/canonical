/**
 * Content item tool registrations (6 tools):
 *      get            (one-or-many; consolidates get_content_item + get_content_items, ID-71.10)
 *  12. create_content_item
 *  19. update_content_item
 *      get_workspace_items
 *      assign         (one-or-many; consolidates assign_content_owner + bulk_assign_owner, ID-71.10)
 *  33. get_document_versions
 *  (get_document_diff RETIRED ID-117.12 — legacy diff-display surface removed)
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, checkMcpRole } from '@/lib/mcp/auth';
import { resolveContentOwnerId } from '@/lib/auth/owner-default';
import { sb, tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import type { PipelineRunStatus } from '@/lib/pipeline/record-run';
import type { Database, Json } from '@/supabase/types/database.types';
import {
  formatContentItem,
  formatCreatedItem,
  formatUpdatedItem,
  formatBatchContentItems,
  formatContentItemChunks,
  truncateResponse,
  CHARACTER_LIMIT,
} from '@/lib/mcp/formatters';
import type {
  ContentItemDetail,
  CreatedItem,
  UpdatedItemResult,
  BatchContentItemsResult,
  ContentItemChunk,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  getGenerateEmbedding,
  defineTool,
  READ_ONLY_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
  NON_IDEMPOTENT_WRITE_ANNOTATIONS,
} from './shared';
import { slugifyDomain } from '@/lib/ai/classify';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Shared helper: fetch content items by ID array and format as batch result.
// Used by the `get` batch branch and get_workspace_items.
// ---------------------------------------------------------------------------

async function fetchAndFormatContentItems(
  supabase: ReturnType<typeof createMcpClient>,
  itemIds: string[],
): Promise<BatchContentItemsResult> {
  if (itemIds.length === 0) {
    return { count: 0, items: [], not_found: [] };
  }

  const { data: rows, error } = await supabase
    .from('content_items')
    .select(
      'id, title, suggested_title, content_type, primary_domain, primary_subtopic, summary, ai_keywords, freshness, classification_confidence, source_url, content, created_at, updated_at, governance_review_status, priority',
    )
    .in('id', itemIds);

  if (error) {
    throw new Error(`Batch fetch failed: ${error.message}`);
  }

  const foundIds = new Set((rows ?? []).map((r) => r.id));
  const notFound = itemIds.filter((id) => !foundIds.has(id));

  const items: ContentItemDetail[] = (rows ?? []).map((item) => {
    let content = item.content as string | null;
    if (typeof content === 'string' && content.length > CHARACTER_LIMIT) {
      content =
        content.slice(0, CHARACTER_LIMIT) + '\n\n... (content truncated)';
    }

    return {
      id: item.id,
      title: item.title,
      suggested_title: item.suggested_title,
      content_type: item.content_type,
      primary_domain: item.primary_domain,
      primary_subtopic: item.primary_subtopic,
      summary: item.summary,
      ai_keywords: item.ai_keywords,
      freshness: item.freshness,
      classification_confidence: item.classification_confidence,
      source_url: item.source_url,
      content,
      created_at: item.created_at,
      updated_at: item.updated_at,
      governance_review_status: item.governance_review_status,
      priority: item.priority,
    };
  });

  // Reorder to match input ID order
  const idOrder = new Map(itemIds.map((id, index) => [id, index]));
  items.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  return { count: items.length, items, not_found: notFound };
}

export async function registerContentTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // get (one-or-many) — consolidates get_content_item + get_content_items
  // (ID-71.10, M32, B-INV-32). Preserves the two-step list/preview → verbatim
  // retrieval contract (B-INV-33): a single `id` returns the verbatim item
  // (with document-section chunks — the "accept" step); an `ids` array returns
  // batch list/preview detail (content truncated, no chunks — the "list" step).
  // outputSchema declared per B-INV-37 (new entry only).
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get',
    {
      title: 'Get Content',
      description:
        'Retrieve one or many content items from the knowledge base. Pass `id` for a single item — returns the verbatim item including title, type, domain, summary, keywords, freshness status, full content text, and its document-section chunks (the accept step of the two-step retrieval). Pass `ids` (an array, max 50) for a batch list/preview — returns the same fields per item with content truncated and chunks omitted, ideal for auditing or reviewing several items in one call. Provide exactly one of `id` or `ids`. Use this after searching; use get_entity_relationships to explore connected entities.',
      inputSchema: {
        id: z
          .string()
          .uuid()
          .optional()
          .describe('The UUID of a single content item to retrieve verbatim'),
        ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .optional()
          .describe(
            'Array of content item UUIDs to fetch as a batch list/preview (max: 50)',
          ),
      },
      outputSchema: {
        mode: z
          .enum(['single', 'batch'])
          .describe('Which retrieval shape was returned'),
        item: z
          .record(z.string(), z.unknown())
          .nullable()
          .describe(
            'The verbatim item with chunks (single mode; null in batch mode)',
          ),
        count: z
          .number()
          .describe('Number of items returned (batch mode; 1 in single mode)'),
        items: z
          .array(z.record(z.string(), z.unknown()))
          .describe(
            'The list/preview items (batch mode; empty in single mode)',
          ),
        not_found: z
          .array(z.string())
          .describe('Requested IDs that were not found (batch mode)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      // Exactly-one-of guard (one-or-many param).
      const hasId = args.id !== undefined;
      const hasIds = args.ids !== undefined;
      if (hasId === hasIds) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Provide exactly one of `id` (single verbatim item) or `ids` (batch list/preview).',
            },
          ],
          isError: true,
        };
      }

      // ---- Batch branch (formerly get_content_items) ----
      if (hasIds) {
        try {
          const supabase = createMcpClient(extra.authInfo);
          const result = await fetchAndFormatContentItems(supabase, args.ids!);

          const markdown = truncateResponse(formatBatchContentItems(result));
          return {
            content: [{ type: 'text' as const, text: markdown }],
            structuredContent: toStructuredContent({
              mode: 'batch' as const,
              item: null,
              ...result,
            }),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return {
            content: [
              {
                type: 'text' as const,
                text: `Batch fetch failed: ${message}.`,
              },
            ],
            isError: true,
          };
        }
      }

      // ---- Single branch (formerly get_content_item) ----
      try {
        const supabase = createMcpClient(extra.authInfo);

        const { data: item, error } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content_type, primary_domain, primary_subtopic, summary, ai_keywords, freshness, classification_confidence, source_url, content, created_at, updated_at, governance_review_status, priority',
          )
          .eq('id', args.id!)
          .single();

        if (error || !item) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Content item not found: ${args.id}`,
              },
            ],
            isError: true,
          };
        }

        const itemDetail: ContentItemDetail = {
          id: item.id,
          title: item.title,
          suggested_title: item.suggested_title,
          content_type: item.content_type,
          primary_domain: item.primary_domain,
          primary_subtopic: item.primary_subtopic,
          summary: item.summary,
          ai_keywords: item.ai_keywords,
          freshness: item.freshness,
          classification_confidence: item.classification_confidence,
          source_url: item.source_url,
          content: item.content,
          created_at: item.created_at,
          updated_at: item.updated_at,
          governance_review_status: item.governance_review_status,
          priority: item.priority,
        };

        // Fetch chunks for this item (lightweight: metadata only, no content).
        // Non-fatal — chunks are supplementary to the item detail.
        let chunks: ContentItemChunk[] = [];
        const chunkResult = await tryQuery(
          supabase
            .from('content_chunks')
            .select(
              'id, heading_text, heading_level, heading_path, position, char_count, word_count',
            )
            .eq('source_document_id', args.id!)
            .order('position'),
          'mcp.content.get_item.chunks',
        );
        if (chunkResult.ok) {
          chunks = (chunkResult.data ?? []).map(
            (row: Record<string, unknown>) => ({
              id: row.id as string,
              heading_text: row.heading_text as string | null,
              heading_level: row.heading_level as number | null,
              heading_path: (row.heading_path as string[] | null) ?? [],
              position: row.position as number,
              char_count: row.char_count as number,
              word_count: row.word_count as number,
            }),
          );
        } else {
          logBestEffortWarn(
            'mcp.content.get_item.chunks',
            'Chunk fetch degraded — chunks omitted from response',
            { itemId: args.id, error: chunkResult.error.message },
          );
        }

        const chunkMarkdown = formatContentItemChunks(chunks);
        const markdown = truncateResponse(
          formatContentItem(itemDetail) + chunkMarkdown,
        );

        // Truncate content in structuredContent to prevent oversized responses
        // from large PDFs (which can exceed 500KB)
        const structuredItem: Record<string, unknown> = { ...item, chunks };
        if (
          typeof structuredItem.content === 'string' &&
          structuredItem.content.length > CHARACTER_LIMIT
        ) {
          structuredItem.content =
            structuredItem.content.slice(0, CHARACTER_LIMIT) +
            '\n\n... (content truncated)';
        }

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            mode: 'single' as const,
            item: structuredItem,
            count: 1,
            items: [],
            not_found: [],
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to retrieve content item: ${message}. Check the ID is a valid UUID.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 12. create_content_item (write tool — editor+ only)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'create_content_item',
    {
      title: 'Create Content Item',
      description:
        'Create a new content item in the knowledge base. Content should be in markdown format (the canonical storage format). Requires editor or admin role. The item will be automatically embedded for search unless created as a draft. Set publication_status to "draft" to create items that are excluded from search and visible only in the review queue\'s Drafts filter — useful for batch content creation that needs review before going live. Use batch_tag to group related draft items (e.g. "reorient-2026-03"). For provenance, supply one of the typed fields source_url (for URL-derived content), source_file (for file-derived content), or source_document_id (FK to source_documents.id) — see ep2-markdown-ui-ingest-spec.md §7.3 for parity with the markdown UI ingest path. Choose content_type carefully: use q_a_pair for question-answer pairs, case_study for project examples, policy for governance documents, certification for accreditations, capability for service descriptions. Use the kb://taxonomy resource to see valid domain and subtopic values.',
      inputSchema: {
        title: z.string().min(1).max(500).describe('Title of the content item'),
        content: z
          .string()
          .min(1)
          .max(500000)
          .describe('The content text in markdown format'),
        content_type: z
          .enum([
            'article',
            'blog',
            'pdf',
            'note',
            'research',
            'other',
            'q_a_pair',
            'case_study',
            'policy',
            'certification',
            'compliance',
            'methodology',
            'capability',
            'product_description',
          ])
          .describe('Type of content'),
        primary_domain: z
          .string()
          .optional()
          .describe('Primary domain category'),
        primary_subtopic: z.string().optional().describe('Primary subtopic'),
        priority: z
          .enum(['high', 'medium', 'low'])
          .optional()
          .describe('Priority level'),
        publication_status: z
          .enum(['draft', 'in_review', 'published', 'archived'])
          .optional()
          .describe(
            'Set to "draft" to create as a draft item (excluded from search, no embedding generated). Publish later via update_publication_status. Other values ("in_review", "published", "archived") are accepted for parity with update_publication_status, but creation flows typically use "draft" or omit this field (defaults to "published" via DB DEFAULT).',
          ),
        governance_review_status: z
          .enum(['draft'])
          .optional()
          .describe(
            'Deprecated (S202 §5.2 Phase 2.5): prefer publication_status="draft". Accepted for back-compat during the transition window — equivalent to publication_status="draft".',
          ),
        batch_tag: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Tag to group related items (e.g. "reorient-2026-03"). Stored in metadata.batch_tag for filtering.',
          ),
        source_url: z
          .string()
          .url()
          .max(2048)
          .optional()
          .describe(
            'Canonical URL of the source. Mirrors content_items.source_url. See ep2-markdown-ui-ingest-spec.md §7.3.',
          ),
        source_file: z
          .string()
          .max(500)
          .optional()
          .describe(
            'Original filename or relative path. Mirrors content_items.source_file. See ep2-markdown-ui-ingest-spec.md §7.3.',
          ),
        source_document_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'FK to source_documents.id. Mirrors content_items.source_document_id. See ep2-markdown-ui-ingest-spec.md §7.3.',
          ),
        // S205 WP-A1 (spec §3.1 AC1.5/AC1.7): the legacy `source_document` arg
        // is removed from the supported input. We declare it here so Zod
        // surfaces a validation error advertising the three typed
        // replacement fields when a legacy caller sends it.
        source_document: z
          .unknown()
          .refine((v) => v === undefined, {
            message:
              'The `source_document` parameter has been removed. Use one of `source_url` (for URL-derived items), `source_file` (for file-derived items), or `source_document_id` (FK to source_documents.id) instead. See ep2-markdown-ui-ingest-spec.md §7.3.',
          })
          .optional()
          .describe(
            'REMOVED. Use `source_url`, `source_file`, or `source_document_id` instead. See ep2-markdown-ui-ingest-spec.md §7.3.',
          ),
        skip_dedup: z
          .boolean()
          .optional()
          .describe(
            'Admin-only dedup override (spec §6 D2). When true and the caller is admin, exact-hash match is not stamped. Non-admin requests silently ignore the flag.',
          ),
        content_owner_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'S206 WP-A Phase 2 (AC3.3): admin-only content owner override. When provided by an admin caller, the new item is owned by the supplied UUID; non-admin callers are silent-forced to their own userId. Defaults to the caller userId when omitted.',
          ),
      },
      annotations: NON_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          // S206 WP4 (S205 verifier deferral M-2): emit pipeline_runs row on
          // auth-fail per AC2.1 ("ALL invocation paths emit pipeline_runs").
          // Uses the service-role client because the caller is BY DEFINITION
          // not editor/admin and the `pipeline_runs_insert` RLS policy
          // requires admin. recordPipelineRun is never-throws so this is
          // safe even if the audit insert itself fails.
          const { createServiceClient } = await import('@/lib/supabase/server');
          await recordPipelineRun({
            supabase: createServiceClient(),
            pipelineName: 'mcp_create_content_item',
            status: 'failed',
            itemsProcessed: 0,
            itemsCreated: null,
            errorMessage: 'permission_denied',
            result: {
              phase: 'auth_check',
              auth_info_present: extra.authInfo != null,
            } as Json,
          });
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: editor or admin role required.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        // Admin-only dedup override (spec §6 D2). Silent-ignore for
        // editors even though the flag is exposed on the input schema.
        const skipDedup = args.skip_dedup === true && role === 'admin';

        // Dedup — soft-block per spec §6 D1. Exact-hash match stamps
        // `dedup_status='suspected_duplicate'` + records the existing
        // id in `metadata.suspected_duplicate_of`.
        const { checkExactDuplicate, resolveDedupStamp } =
          await import('@/lib/dedup/content-dedup');
        let dedupStamp: {
          dedup_status: 'clean' | 'suspected_duplicate';
          suspected_duplicate_of?: string;
        } = { dedup_status: 'clean' };
        let dedupExistingTitle: string | undefined;
        try {
          const dedupCheck = await checkExactDuplicate(supabase, args.content);
          dedupStamp = resolveDedupStamp(
            dedupCheck.isDuplicate ? dedupCheck.existingId : undefined,
            { skipDedup },
          );
          if (dedupCheck.isDuplicate) {
            dedupExistingTitle = dedupCheck.existingTitle;
          }
        } catch (dedupErr) {
          logger.error(
            { err: dedupErr },
            'MCP create_content_item dedup check failed',
          );
        }

        // S206 WP-A Phase 2 (AC3.1) — resolve content owner. Admin caller
        // may supply an explicit owner UUID; non-admins are silent-forced
        // to their own userId via the helper. Retained for the pipeline_runs
        // audit `result` payload below (the create-leg no longer writes a row
        // directly, but the audit record still attributes the create).
        const ownerId = resolveContentOwnerId({
          explicit: args.content_owner_id,
          role,
          userId,
        });

        // The pipeline_runs `result` payload is shared across both create
        // legs (ID-71.16). It mirrors the prior direct-insert audit shape so
        // dashboards keep parity (S205 WP-A2 / AC2.3).
        const buildRunResult = (skippedReason: string | null): Json =>
          ({
            source_url: args.source_url ?? null,
            source_file: args.source_file ?? null,
            source_document_id: args.source_document_id ?? null,
            batch_tag: args.batch_tag ?? null,
            content_owner_id: ownerId,
            dedup_status: dedupStamp.dedup_status,
            skipped_reason: skippedReason,
          }) as Json;

        const dedupNote =
          dedupStamp.dedup_status === 'suspected_duplicate'
            ? `\n\n**Dedup:** Flagged as \`suspected_duplicate\` — matches existing item ${dedupStamp.suspected_duplicate_of}${dedupExistingTitle ? ` ("${dedupExistingTitle}")` : ''}. Admin may resolve via the dedup review workflow.`
            : '';

        // ─────────────────────────────────────────────────────────────────
        // ID-71.16 write-to-canonical-store create-leg (B-INV-6 + B-INV-12;
        // PRODUCT §OQ-1 Option A — RATIFIED FILE-BACKED, OQ-71.16-1). The
        // single direct `content_items.insert` is replaced by a
        // provenance-class-routed create-leg: the canonical store (the
        // reference layer for URLs, the cocoindex source-binding folder for
        // source-less creates) owns row materialisation, not this in-request
        // tool. Net-new uncontrolled DB ingestion is the WS-6 anti-goal.
        // ─────────────────────────────────────────────────────────────────

        if (args.source_url) {
          // URL branch — route through the owner-gated `reference_ingest`
          // evidence-pair RPC (atomic source_documents + reference_items,
          // server-side uuid5 PKs). This is the SAME seam
          // app/api/ingest/url/route.ts uses. B-25 HARD INVARIANT: the
          // reference_ingest RPC signature MUST NOT be altered — call it
          // as-is. UNCHANGED behaviour vs the ratified URL-create contract.
          const warnings: string[] = [];

          // Embedding for reference_items.embedding — truncate the combined
          // title + content to MAX_EMBEDDING_CHARS (text-embedding-3-large
          // 8,192-token cap), mirroring the in-handler truncation pattern.
          let embeddingValue: string | null = null;
          try {
            const generateEmbedding = await getGenerateEmbedding();
            const { MAX_EMBEDDING_CHARS } = await import('@/lib/ai/embed');
            const rawEmbeddingText = args.title + ' ' + args.content;
            const embeddingText =
              rawEmbeddingText.length > MAX_EMBEDDING_CHARS
                ? rawEmbeddingText.slice(0, MAX_EMBEDDING_CHARS)
                : rawEmbeddingText;
            const embeddingArray = await generateEmbedding(embeddingText);
            embeddingValue = JSON.stringify(embeddingArray);
          } catch (error) {
            // Non-fatal — the reference lands without an embedding (the
            // column is nullable; a backfill can re-derive it).
            warnings.push('Embedding generation failed');
            logger.error(
              { err: error },
              'MCP create_content_item (url) embedding failed',
            );
          }

          // Classification — POPULATE-UNLESS-ERROR. Caller-supplied domain /
          // subtopic win; otherwise classify the pasted content (mirrors the
          // url route). Nullable at the DB, so a failure passes NULL.
          let primaryDomain: string | null = args.primary_domain
            ? slugifyDomain(args.primary_domain)
            : null;
          let primarySubtopic: string | null = args.primary_subtopic
            ? slugifyDomain(args.primary_subtopic)
            : null;
          if (!primaryDomain) {
            try {
              const { classifyText } = await import('@/lib/ai/classify');
              const classified = await classifyText({
                supabase,
                title: args.title,
                content: args.content,
              });
              primaryDomain = classified.primary_domain;
              primarySubtopic = classified.primary_subtopic;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unknown error';
              warnings.push(`Classification failed: ${msg}`);
            }
          }

          // Provenance fields for the source_documents row (filename NOT
          // NULL). The pasted content is the reference body.
          const filename = `${slugifyDomain(args.title) || 'reference'}.md`;
          const fileSize = Buffer.byteLength(args.content);
          const contentHash = createHash('sha256')
            .update(args.content)
            .digest('hex');
          const extractionMetadata: Json = {
            extractor: 'mcp_create',
            via: 'mcp_create_content_item',
          };

          // B-25: the exact `reference_ingest` arg shape used by the url
          // route. The generated RPC Args type marks several nullable params
          // as required `string`; the RPC body inserts each straight into a
          // NULLABLE column, so we cast at this boundary (DB is source of
          // truth, migration 20260619130100).
          const ingestArgs = {
            p_source_url: args.source_url,
            p_title: args.title,
            p_body: args.content,
            p_summary: null,
            p_primary_domain: primaryDomain,
            p_primary_subtopic: primarySubtopic,
            p_embedding: embeddingValue,
            p_published_at: null,
            p_filename: filename,
            p_mime_type: 'text/markdown',
            p_file_size: fileSize,
            p_content_hash: contentHash,
            p_extraction_metadata: extractionMetadata,
          };
          const ingested = await sb(
            supabase.rpc(
              'reference_ingest',
              ingestArgs as unknown as Database['public']['Functions']['reference_ingest']['Args'],
            ),
            'mcp.content.reference_ingest',
          );

          const row = Array.isArray(ingested) ? ingested[0] : ingested;
          if (!row) {
            const { createServiceClient } =
              await import('@/lib/supabase/server');
            await recordPipelineRun({
              supabase: createServiceClient(),
              pipelineName: 'mcp_create_content_item',
              status: 'failed',
              itemsProcessed: 1,
              itemsCreated: null,
              errorMessage: 'reference_ingest returned no row',
              result: buildRunResult(null),
            });
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Failed to create item: reference_ingest returned no row',
                },
              ],
              isError: true,
            };
          }

          // S205 WP-A2 / AC2.3 — record the run (service-role client bypasses
          // the admin-only pipeline_runs_insert RLS policy, OPS-40 parity).
          const pipelineStatus: PipelineRunStatus =
            warnings.length > 0 ? 'completed_with_errors' : 'completed';
          const { createServiceClient } = await import('@/lib/supabase/server');
          await recordPipelineRun({
            supabase: createServiceClient(),
            pipelineName: 'mcp_create_content_item',
            status: pipelineStatus,
            itemsProcessed: 1,
            itemsCreated: [row.reference_id],
            errorMessage: warnings.length > 0 ? warnings.join('; ') : null,
            result: buildRunResult(null),
          });

          const created: CreatedItem = {
            id: row.reference_id,
            title: row.title ?? args.title,
            content_type: args.content_type,
          };
          const warningNote =
            warnings.length > 0
              ? `\n\n**Warnings:**\n${warnings.map((w) => `- ${w}`).join('\n')}`
              : '';
          const referenceNote =
            '\n\n**Stored as:** reference (evidence layer) — landed via the canonical reference seam. The pipeline keeps it queryable; it is not a directly-edited content item.';
          const markdown =
            formatCreatedItem(created) +
            referenceNote +
            dedupNote +
            warningNote;
          return {
            content: [{ type: 'text' as const, text: markdown }],
            structuredContent: toStructuredContent({
              ...created,
              status: 'created',
              source_url: row.source_url ?? args.source_url,
              source_file: null,
              source_document_id: row.source_document_id ?? null,
              already_existed: row.already_existed ?? false,
              warnings: warnings.length > 0 ? warnings : undefined,
              dedup_status: dedupStamp.dedup_status,
              suspected_duplicate_of: dedupStamp.suspected_duplicate_of ?? null,
            }),
          };
        }

        // Source-less branch (no source_url — i.e. source_file-only,
        // source_document_id-only, or no-provenance): write the markdown
        // `content` arg AS A FILE into the cocoindex source-binding folder via
        // `stageAndWalk` (the SAME primitive folder-drop {56.12} uses). It
        // drops the bytes (/stage) then triggers an incremental walk (/walk);
        // the pipeline content branch then mints source_documents(storage_path)
        // + the linked content_items row — the canonical-store guarantee so a
        // future re-ingest re-derives the item.
        //
        // BEHAVIOUR (PRODUCT §OQ-1 Option A downside): the source-less create
        // is propose-into-store / EVENTUALLY-CONSISTENT. stageAndWalk returns
        // the source_file correlation key, NOT a content_items row id; the row
        // materialises on the pipeline walk. The response mirrors the
        // folder-drop status-poll contract (the caller polls content_items by
        // source_file via the same status surface).
        const { stageAndWalk, assertCorpusRelativeDestPath } =
          await import('@/lib/upload/folder-drop');
        const path = await import('path');

        // Distinct corpus subdir so agent-originated drops are legible vs the
        // UI 'folder-drop/' subdir. The filename is a slug of the title; the
        // basename becomes content_items.source_file (the poll key).
        const AGENT_CREATE_SUBDIR = 'agent-create';
        const slug = slugifyDomain(args.title);
        const filename = `${slug || `agent-create-${Date.now()}`}.md`;
        const destPath = path.posix.join(AGENT_CREATE_SUBDIR, filename);
        // Fail a mis-wire loudly before the bytes leave the process.
        assertCorpusRelativeDestPath(destPath);

        const dropResult = await stageAndWalk({
          bytes: new TextEncoder().encode(args.content),
          filename,
          destPath,
          titlePrefix: '',
          contentType: 'text/markdown',
        });

        // S205 WP-A2 / AC2.3 — record the run on the success path (service-role
        // client bypasses the admin-only pipeline_runs_insert RLS policy).
        const { createServiceClient: createServiceClientForDrop } =
          await import('@/lib/supabase/server');
        await recordPipelineRun({
          supabase: createServiceClientForDrop(),
          pipelineName: 'mcp_create_content_item',
          status: 'completed',
          itemsProcessed: 1,
          // The row id is not known yet (pipeline materialises it); the
          // source_file correlation key stands in for itemsCreated here.
          itemsCreated: [dropResult.sourceFile],
          errorMessage: null,
          result: buildRunResult('materialising_via_pipeline'),
        });

        const created: CreatedItem = {
          id: dropResult.sourceFile,
          title: args.title,
          content_type: args.content_type,
        };
        const materialisingNote = `\n\n**Status:** Materialising via the canonical pipeline — the content was staged to the source-binding folder as \`${dropResult.destPath}\` and will become queryable once the ingest walk completes. Poll \`content_items\` by \`source_file = "${dropResult.sourceFile}"\` to confirm.`;
        const markdown =
          formatCreatedItem(created) + materialisingNote + dedupNote;
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            // No synchronous content_items row id — the pipeline mints it.
            id: null,
            title: args.title,
            content_type: args.content_type,
            status: 'materialising_via_pipeline',
            // The correlation key the caller polls on (mirrors folder-drop).
            source_file: dropResult.sourceFile,
            dest_path: dropResult.destPath,
            source_url: null,
            source_document_id: args.source_document_id ?? null,
            dedup_status: dedupStamp.dedup_status,
            suspected_duplicate_of: dedupStamp.suspected_duplicate_of ?? null,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        // S206 WP4 (S205 verifier deferral M-2): emit pipeline_runs row on
        // outer-catch per AC2.1. Uses the service-role client to bypass the
        // admin-only `pipeline_runs_insert` RLS policy — the catch may fire
        // for an editor caller whose RLS-scoped client cannot write the
        // audit row. recordPipelineRun is never-throws so this is safe even
        // if the audit insert itself fails. Wrapped in its own try/catch so
        // the original error surface (the "Failed to create item" message)
        // is never replaced by an unrelated audit failure.
        try {
          const { createServiceClient } = await import('@/lib/supabase/server');
          await recordPipelineRun({
            supabase: createServiceClient(),
            pipelineName: 'mcp_create_content_item',
            status: 'failed',
            itemsProcessed: 0,
            itemsCreated: null,
            errorMessage: message,
            result: { phase: 'handler_catch_all' } as Json,
          });
        } catch (auditErr) {
          logger.error(
            { err: auditErr },
            'MCP create_content_item outer-catch pipeline_runs emission failed',
          );
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to create item: ${message}. Ensure you have editor or admin permissions.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 19. update_content_item (write tool — editor+ only)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'update_content_item',
    {
      title: 'Update Content Item',
      description:
        "Edit an existing content item's metadata and content fields. Updates are applied immediately and auto-versioned in content_history. Requires editor or admin role. Updatable fields: title, suggested_title, content, answer_standard, answer_advanced, primary_domain, primary_subtopic, priority, notes, expiry_date, lifecycle_type. Use the kb://taxonomy resource for valid domain and subtopic values.",
      inputSchema: {
        id: z
          .string()
          .uuid()
          .describe('The UUID of the content item to update'),
        fields: z
          .object({
            title: z.string().optional().describe('Display title'),
            suggested_title: z
              .string()
              .optional()
              .describe('AI-suggested title'),
            content: z
              .string()
              .max(500000)
              .optional()
              .describe('Main content text'),
            answer_standard: z
              .string()
              .optional()
              .describe('Standard answer (Q&A pairs)'),
            answer_advanced: z
              .string()
              .optional()
              .describe('Advanced answer (Q&A pairs)'),
            primary_domain: z
              .string()
              .optional()
              .describe('Domain classification'),
            primary_subtopic: z
              .string()
              .optional()
              .describe('Subtopic classification'),
            priority: z
              .enum(['high', 'medium', 'low'])
              .optional()
              .describe('Priority level'),
            notes: z.string().optional().describe('Editorial notes'),
            expiry_date: z
              .string()
              .nullable()
              .optional()
              .describe(
                'Expiry date in ISO 8601 format (YYYY-MM-DD). Set to null to clear.',
              ),
            lifecycle_type: z
              .enum(['evergreen', 'date_bound', 'regulatory', 'version_bound'])
              .optional()
              .describe('Content lifecycle type'),
          })
          .describe(
            'Fields to update — only include fields you want to change',
          ),
        reason: z
          .string()
          .optional()
          .describe(
            'Explanation of why the update was made (stored for audit trail)',
          ),
      },
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: editor or admin role required.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);

        // Validate that at least one field is being updated
        const allowedFields = [
          'title',
          'suggested_title',
          'content',
          'answer_standard',
          'answer_advanced',
          'primary_domain',
          'primary_subtopic',
          'priority',
          'expiry_date',
          'lifecycle_type',
        ] as const;

        const updateData: Record<string, unknown> = {};
        const updatedFields: string[] = [];

        for (const field of allowedFields) {
          if (args.fields[field] !== undefined) {
            updateData[field] = args.fields[field];
            updatedFields.push(field);
          }
        }

        // Normalise taxonomy strings to canonical lowercase kebab-case slugs.
        // Prevents case-inconsistent domains (e.g. 'CORPORATE' vs 'corporate')
        // from drifting into the DB via MCP sub-agents.
        if (typeof updateData.primary_domain === 'string') {
          updateData.primary_domain = slugifyDomain(updateData.primary_domain);
        }
        if (typeof updateData.primary_subtopic === 'string') {
          updateData.primary_subtopic = slugifyDomain(
            updateData.primary_subtopic,
          );
        }

        if (updatedFields.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No fields to update. Provide at least one field in the fields object.',
              },
            ],
            isError: true,
          };
        }

        // Fetch current values for the updated fields (for audit trail)
        const { data: current, error: fetchError } = await supabase
          .from('content_items')
          .select(updatedFields.join(', '))
          .eq('id', args.id)
          .single();

        if (fetchError) {
          // Distinguish a bad/unknown field from a genuinely missing row. A
          // dropped or non-existent column surfaces as Postgres undefined_column
          // (42703) or PostgREST schema-cache miss (PGRST204) — that is a request
          // error, not a not-found. Only a no-rows `.single()` (PGRST116) means
          // the item itself does not exist.
          const code = fetchError.code ?? '';
          const message = fetchError.message ?? '';
          const isColumnError =
            code === '42703' ||
            code === 'PGRST204' ||
            /column/i.test(message) ||
            /does not exist/i.test(message);
          if (isColumnError) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Invalid field in update: ${message}. Check the field names against the allowed update fields.`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: `Content item not found: ${args.id}`,
              },
            ],
            isError: true,
          };
        }

        if (!current) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Content item not found: ${args.id}`,
              },
            ],
            isError: true,
          };
        }

        // Add updated_by
        updateData.updated_by = userId;

        // Apply update
        const { error: updateError } = await supabase
          .from('content_items')
          .update(
            updateData as Database['public']['Tables']['content_items']['Update'],
          )
          .eq('id', args.id);

        if (updateError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Update failed: ${updateError.message}. Check the ID is valid and you have permissions.`,
              },
            ],
            isError: true,
          };
        }

        const result: UpdatedItemResult = {
          id: args.id,
          updated_fields: updatedFields,
          previous_values: JSON.parse(JSON.stringify(current)) as Record<
            string,
            unknown
          >,
          reason: args.reason ?? null,
        };

        const markdown = formatUpdatedItem(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Update failed: ${message}. Ensure you have editor or admin permissions.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // get_workspace_items
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_workspace_items',
    {
      title: 'Get Workspace Items',
      description:
        'Fetch content items assigned to a specific workspace via the content_item_workspaces junction table. Returns paginated items with full detail. Use this to browse all content within a workspace without needing to know individual item IDs.',
      inputSchema: {
        workspace_id: z
          .string()
          .uuid()
          .describe('Workspace UUID to fetch items for'),
        limit: z
          .number()
          .optional()
          .describe('Maximum items to return (default: 20, max: 50)'),
        offset: z
          .number()
          .optional()
          .describe('Pagination offset (default: 0)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const itemLimit = Math.min(args.limit ?? 20, 50);
        const itemOffset = args.offset ?? 0;

        // Query junction table for workspace content items, ordered by assignment date
        const { data: junctionRows, error: junctionError } = await supabase
          .from('content_item_workspaces')
          .select('content_item_id')
          .eq('workspace_id', args.workspace_id)
          .order('assigned_at', { ascending: false })
          .range(itemOffset, itemOffset + itemLimit - 1); // Supabase range is inclusive on both ends

        if (junctionError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to fetch workspace items: ${junctionError.message}.`,
              },
            ],
            isError: true,
          };
        }

        const itemIds = (junctionRows ?? []).map(
          (row: { content_item_id: string }) => row.content_item_id,
        );

        const result = await fetchAndFormatContentItems(supabase, itemIds);

        const markdown = truncateResponse(formatBatchContentItems(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            workspace_id: args.workspace_id,
            offset: itemOffset,
            ...result,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to fetch workspace items: ${message}. Check the workspace_id is a valid UUID.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // assign (one-or-many) — consolidates assign_content_owner + bulk_assign_owner
  // (ID-71.10, M32, B-INV-32). The one-or-many axis: assign by an explicit
  // `item_ids` array (the former assign_content_owner) OR assign by a `scope`
  // filter (domain/subtopic/content_type — the former bulk_assign_owner, with
  // dry-run, cursor pagination, skip-if-owned, audit trail). Provide exactly
  // one of `item_ids` or `scope`. Both paths preserve per-user RLS
  // (createMcpClient), the admin gate, and the canonical 'owner_change' audit
  // provenance. outputSchema declared per B-INV-37 (new entry only).
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'assign',
    {
      title: 'Assign Content Owner',
      description:
        'Assign or change the content owner for one or many items. Provide `item_ids` (1-50 explicit UUIDs) for a direct assignment, OR `scope` (a domain/subtopic/content_type filter) to assign every matching item — the scope path supports dry-run preview, skip-if-owned with force_override opt-in, cursor pagination for scopes >500 items, and a per-item audit trail. Provide exactly one of `item_ids` or `scope`. Requires admin role. Use the scope path for "assign all unowned Healthcare content to Sarah" workflows. The owner receives targeted notifications when their content becomes stale or needs governance review.',
      inputSchema: {
        item_ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .optional()
          .describe(
            'Explicit content item IDs to assign (1-50). Provide this OR scope.',
          ),
        scope: z
          .object({
            domain: z
              .string()
              .optional()
              .describe('Primary domain filter (e.g. "Healthcare")'),
            subtopic: z
              .string()
              .optional()
              .describe('Primary subtopic within the domain'),
            content_type: z
              .string()
              .optional()
              .describe(
                'Content type filter (e.g. "article", "qa_pair", "policy")',
              ),
            unowned_only: z
              .boolean()
              .default(true)
              .describe(
                'Only assign items with no current owner (default: true)',
              ),
          })
          .optional()
          .describe(
            'Scope filter (provide this OR item_ids). Apply mode (dry_run: false) requires at least one of domain, subtopic, or content_type. ' +
              'dry_run: true accepts empty scope for whole-KB inspection.',
          ),
        owner_id: z
          .string()
          .uuid()
          .describe('User UUID of the new content owner'),
        force_override: z
          .boolean()
          .default(false)
          .describe(
            'Scope path only. When true AND unowned_only is false, overwrite existing owners. ' +
              'When false (default), items with an existing owner are skipped even if unowned_only is false.',
          ),
        notify: z
          .boolean()
          .default(true)
          .describe(
            'Scope path only. Send a notification to the new owner on successful apply. Default true. Set false to suppress.',
          ),
        batch_mode: z
          .boolean()
          .default(false)
          .describe(
            'Scope path only. When true, send a single summary notification instead of per-item. ' +
              'Useful for large scope applies.',
          ),
        cursor: z
          .string()
          .optional()
          .describe(
            'Scope path only. Opaque pagination cursor returned by previous call when assigned_count === 500. ' +
              'Supplying it continues from where the previous call stopped.',
          ),
        dry_run: z
          .boolean()
          .default(false)
          .describe(
            'Scope path only. Preview affected items without writing. Empty scope permitted in dry_run for whole-KB inspection.',
          ),
      },
      outputSchema: {
        action: z
          .enum(['assign_content_owner', 'bulk_assign_owner'])
          .describe(
            'Which assignment path ran: explicit item_ids vs scope filter',
          ),
        owner_id: z.string().describe('The assigned owner UUID'),
        assigned_count: z
          .number()
          .optional()
          .describe('Items assigned (scope path)'),
        requested: z
          .number()
          .optional()
          .describe('IDs supplied for assignment (explicit item_ids path)'),
        updated: z
          .number()
          .optional()
          .describe('Items updated (explicit item_ids path)'),
        not_found: z
          .number()
          .optional()
          .describe('Requested IDs not found or unchanged (explicit path)'),
        dry_run: z.boolean().optional().describe('Preview-only (scope path)'),
      },
      annotations: NON_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      // Exactly-one-of guard (one-or-many param).
      const hasItemIds = args.item_ids !== undefined;
      const hasScope = args.scope !== undefined;
      if (hasItemIds === hasScope) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Provide exactly one of `item_ids` (explicit assignment) or `scope` (filter-based assignment).',
            },
          ],
          isError: true,
        };
      }

      // ---- Explicit item_ids branch (formerly assign_content_owner) ----
      if (hasItemIds) {
        try {
          const role = await checkMcpRole(extra.authInfo, ['admin']);
          if (!role) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Permission denied: admin role required to assign content owners.',
                },
              ],
              isError: true,
            };
          }

          const supabase = createMcpClient(extra.authInfo);
          const userId = getMcpUserId(extra.authInfo);
          const itemIds = args.item_ids!;

          // Call the bulk_assign_content_owner RPC
          const { data: updatedCount, error } = await supabase.rpc(
            'bulk_assign_content_owner',
            {
              p_item_ids: itemIds,
              p_owner_id: args.owner_id,
              p_assigned_by: userId,
            },
          );

          if (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Failed to assign content owner: ${error.message}`,
                },
              ],
              isError: true,
            };
          }

          const count = updatedCount ?? 0;
          const notFoundCount = itemIds.length - count;

          let message = `Successfully assigned ownership of ${count} item${count === 1 ? '' : 's'} to user ${args.owner_id}.`;
          if (notFoundCount > 0) {
            message += ` ${notFoundCount} item${notFoundCount === 1 ? '' : 's'} not found or unchanged.`;
          }
          message +=
            '\n\nThe owner will receive targeted notifications when their content becomes stale or needs governance review.';

          return {
            content: [{ type: 'text' as const, text: message }],
            structuredContent: toStructuredContent({
              action: 'assign_content_owner',
              owner_id: args.owner_id,
              requested: itemIds.length,
              updated: count,
              not_found: notFoundCount,
            }),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to assign content owner: ${message}. Ensure you have admin permissions.`,
              },
            ],
            isError: true,
          };
        }
      }

      // ---- Scope-filter branch (formerly bulk_assign_owner) ----
      try {
        // 1. Admin gate
        const role = await checkMcpRole(extra.authInfo, ['admin']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: admin role required to bulk assign content owners.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const actingUserId = getMcpUserId(extra.authInfo);

        const scope = args.scope!;
        const ownerId = args.owner_id;
        const forceOverride = args.force_override;
        const notify = args.notify;
        const batchMode = args.batch_mode;
        const cursor = args.cursor;
        const dryRun = args.dry_run;

        // Reject empty scope on apply mode (Zod .refine() equivalent)
        const hasScopeFilter =
          scope.domain !== undefined ||
          scope.subtopic !== undefined ||
          scope.content_type !== undefined;
        if (!dryRun && !hasScopeFilter) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Apply mode requires at least one of domain, subtopic, or content_type. Use dry_run: true to preview whole-KB scope.',
              },
            ],
            isError: true,
          };
        }

        // 2. Validate owner exists in user_roles
        const { data: ownerRow, error: ownerError } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('user_id', ownerId)
          .maybeSingle();

        if (ownerError || !ownerRow) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Invalid owner_id: user ${ownerId} not found in user_roles.`,
              },
            ],
            isError: true,
          };
        }

        // 3. Cursor decode + scope_hash validation
        const scopeSnapshot = {
          domain: scope.domain ?? null,
          subtopic: scope.subtopic ?? null,
          content_type: scope.content_type ?? null,
          unowned_only: scope.unowned_only,
        };
        const scopeHash = createHash('sha256')
          .update(JSON.stringify(scopeSnapshot))
          .digest('hex')
          .slice(0, 16);

        let cursorLastId: string | null = null;
        if (cursor) {
          try {
            const decoded = JSON.parse(
              Buffer.from(cursor, 'base64url').toString('utf8'),
            ) as { last_id: string; scope_hash: string };
            if (decoded.scope_hash !== scopeHash) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Scope changed between paginated calls. The cursor is no longer valid — start a new pagination sequence with the updated scope.',
                  },
                ],
                isError: true,
              };
            }
            cursorLastId = decoded.last_id;
          } catch {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Invalid cursor format. Use the opaque cursor string returned by the previous call.',
                },
              ],
              isError: true,
            };
          }
        }

        // 4. Build scope query
        let query = supabase
          .from('content_items')
          .select('id, title, content_owner_id')
          .order('id', { ascending: true })
          .limit(501); // fetch 501 to detect if pagination needed

        if (scope.domain) {
          query = query.eq('primary_domain', scope.domain);
        }
        if (scope.subtopic) {
          query = query.eq('primary_subtopic', scope.subtopic);
        }
        if (scope.content_type) {
          query = query.eq('content_type', scope.content_type);
        }
        if (scope.unowned_only) {
          query = query.is('content_owner_id' as 'id', null);
        }
        if (cursorLastId) {
          query = query.gt('id' as 'content_owner_id', cursorLastId);
        }

        const { data: matchedItems, error: queryError } = await query;
        if (queryError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to query content items: ${queryError.message}`,
              },
            ],
            isError: true,
          };
        }

        const allMatched = matchedItems ?? [];
        const hasMore = allMatched.length > 500;
        const capped = hasMore ? allMatched.slice(0, 500) : allMatched;

        // 5. Partition into affected / skipped
        type MatchedItem = {
          id: string;
          title: string;
          content_owner_id: string | null;
        };
        const itemsAffected: Array<{
          id: string;
          title: string;
          previous_owner_id: string | null;
        }> = [];
        const itemsSkipped: Array<{
          id: string;
          title: string;
          current_owner_id: string;
        }> = [];

        for (const item of capped as MatchedItem[]) {
          if (item.content_owner_id && !scope.unowned_only) {
            if (forceOverride) {
              itemsAffected.push({
                id: item.id,
                title: item.title,
                previous_owner_id: item.content_owner_id,
              });
            } else {
              itemsSkipped.push({
                id: item.id,
                title: item.title,
                current_owner_id: item.content_owner_id,
              });
            }
          } else if (!item.content_owner_id) {
            itemsAffected.push({
              id: item.id,
              title: item.title,
              previous_owner_id: null,
            });
          }
        }

        // Build next_cursor
        const nextCursor = hasMore
          ? Buffer.from(
              JSON.stringify({
                last_id: capped[capped.length - 1].id,
                scope_hash: scopeHash,
              }),
            ).toString('base64url')
          : null;

        // Build warnings
        const warnings: string[] = [];
        if (itemsSkipped.length > 0) {
          warnings.push(
            `${itemsSkipped.length} item${itemsSkipped.length === 1 ? '' : 's'} skipped because they already have an owner; set force_override: true to reassign.`,
          );
        }

        // 6. Dry-run: return preview
        if (dryRun) {
          const result = {
            action: 'bulk_assign_owner' as const,
            dry_run: true,
            scope: scopeSnapshot,
            owner_id: ownerId,
            assigned_count: itemsAffected.length,
            skipped_owned_count: itemsSkipped.length,
            items_affected: itemsAffected,
            ...(itemsSkipped.length > 0
              ? { items_skipped: itemsSkipped.slice(0, 100) }
              : {}),
            next_cursor: nextCursor,
            ...(warnings.length > 0 ? { warnings } : {}),
          };

          const lines = [
            `**Bulk Assign Owner — DRY RUN**`,
            `Scope: ${JSON.stringify(scopeSnapshot)}`,
            `Owner: ${ownerId}`,
            `Would assign: ${itemsAffected.length} item${itemsAffected.length === 1 ? '' : 's'}`,
            `Skipped (already owned): ${itemsSkipped.length}`,
          ];
          if (nextCursor) {
            lines.push(
              `\nMore items available — pass the next_cursor value to continue.`,
            );
          }

          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
            structuredContent: toStructuredContent(result),
          };
        }

        // 7. Apply mode
        if (itemsAffected.length === 0) {
          const result = {
            action: 'bulk_assign_owner' as const,
            dry_run: false,
            scope: scopeSnapshot,
            owner_id: ownerId,
            assigned_count: 0,
            skipped_owned_count: itemsSkipped.length,
            items_affected: [],
            ...(itemsSkipped.length > 0
              ? { items_skipped: itemsSkipped.slice(0, 100) }
              : {}),
            next_cursor: nextCursor,
            ...(warnings.length > 0 ? { warnings } : {}),
          };
          return {
            content: [
              {
                type: 'text' as const,
                text: `No items to assign. ${itemsSkipped.length} item${itemsSkipped.length === 1 ? ' was' : 's were'} skipped (already owned).`,
              },
            ],
            structuredContent: toStructuredContent(result),
          };
        }

        // 8. Call RPC
        const targetIds = itemsAffected.map((i) => i.id);
        const { data: updatedCount, error: rpcError } = await supabase.rpc(
          'bulk_assign_content_owner',
          {
            p_item_ids: targetIds,
            p_owner_id: ownerId,
            p_assigned_by: actingUserId,
          },
        );

        if (rpcError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to assign content owner: ${rpcError.message}`,
              },
            ],
            isError: true,
          };
        }

        const count =
          typeof updatedCount === 'number'
            ? updatedCount
            : itemsAffected.length;

        // 9. Audit trail — best-effort content_history insert.
        // change_reason: canonical 'owner_change' value (Appendix D of
        // docs/reference/data-entry-points.md) — matches single-item
        // owner PATCH so provenance queries group both paths together.
        try {
          await sb(
            supabase.from('content_history').insert(
              itemsAffected.map((item) => ({
                content_item_id: item.id,
                change_type: 'owner_assigned',
                change_reason: 'owner_change',
                title: `Ownership assigned via bulk_assign_owner`,
                content: `Owner changed to ${ownerId}`,
                version: 0,
                created_by: actingUserId,
                metadata: {
                  source: 'mcp:bulk_assign_owner',
                  scope: scopeSnapshot,
                  previous_owner_id: item.previous_owner_id,
                  new_owner_id: ownerId,
                } as unknown as Json,
              })),
            ),
            'content_history.bulk_assign_owner',
          );
        } catch (err) {
          logBestEffortWarn(
            'content.owner.audit',
            'Failed to write content_history for bulk owner assignment',
            {
              affected_count: itemsAffected.length,
              error: err instanceof Error ? err.message : String(err),
            },
          );
          warnings.push(
            'Audit trail write failed — ownership was assigned but history records were not created.',
          );
        }

        // 10. Notification (best-effort)
        if (notify && ownerId !== actingUserId) {
          try {
            const scopeParts: string[] = [];
            if (scopeSnapshot.domain)
              scopeParts.push(`domain: ${scopeSnapshot.domain}`);
            if (scopeSnapshot.subtopic)
              scopeParts.push(`subtopic: ${scopeSnapshot.subtopic}`);
            if (scopeSnapshot.content_type)
              scopeParts.push(`type: ${scopeSnapshot.content_type}`);
            const scopeDesc =
              scopeParts.length > 0 ? ` across ${scopeParts.join(', ')}` : '';

            const title = batchMode
              ? `${count} item${count === 1 ? '' : 's'} assigned to you${scopeDesc}`
              : `You have been assigned as owner of ${count} content item${count === 1 ? '' : 's'}`;

            // PostgREST resolves to `{ error }` rather than throwing on DB-level
            // rejections (constraint violations, RLS), so destructure and route
            // explicitly — the outer try/catch only covers JS-level failures.
            const { error: notifyError } = await supabase
              .from('notifications')
              .insert({
                user_id: ownerId,
                type: 'owner_assignment',
                entity_type: 'content_item',
                entity_id: targetIds[0],
                title,
                message: null,
              });
            if (notifyError) {
              logBestEffortWarn(
                'content.owner.notify',
                'Failed to create bulk owner assignment notification',
                {
                  owner_id: ownerId,
                  error: notifyError.message,
                },
              );
            }
          } catch (err) {
            logBestEffortWarn(
              'content.owner.notify',
              'Failed to create bulk owner assignment notification',
              {
                owner_id: ownerId,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        }

        // 11. Return structured result
        const result = {
          action: 'bulk_assign_owner' as const,
          dry_run: false,
          scope: scopeSnapshot,
          owner_id: ownerId,
          assigned_count: count,
          skipped_owned_count: itemsSkipped.length,
          items_affected: itemsAffected,
          ...(itemsSkipped.length > 0
            ? { items_skipped: itemsSkipped.slice(0, 100) }
            : {}),
          next_cursor: nextCursor,
          ...(warnings.length > 0 ? { warnings } : {}),
        };

        const lines = [
          `**Bulk Assign Owner — APPLIED**`,
          `Assigned ${count} item${count === 1 ? '' : 's'} to ${ownerId}.`,
        ];
        if (itemsSkipped.length > 0) {
          lines.push(
            `Skipped ${itemsSkipped.length} already-owned item${itemsSkipped.length === 1 ? '' : 's'}.`,
          );
        }
        if (nextCursor) {
          lines.push(
            `\nMore items available — pass the next_cursor value to continue.`,
          );
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to bulk assign content owner: ${message}. Ensure you have admin permissions.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 33. get_document_versions
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_document_versions',
    {
      title: 'Get Source Document Versions',
      description:
        'List all versions of a source document, showing the version chain and which KB items were created from each version.',
      inputSchema: {
        document_id: z
          .string()
          .uuid()
          .describe('Source document ID (any version in the chain)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        // RPC added after last type generation — cast to bypass strict typing
        // until types are regenerated. The RPC returns a TABLE with known columns.
        interface VersionRow {
          id: string;
          filename: string;
          original_filename: string;
          mime_type: string;
          file_size: number;
          content_hash: string;
          version: number;
          parent_id: string | null;
          storage_path: string;
          status: string;
          uploaded_by: string;
          created_at: string;
          content_item_count: number;
        }

        const { data, error } = await (supabase.rpc as CallableFunction)(
          'get_document_version_chain',
          { p_document_id: args.document_id },
        );

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to retrieve document versions: ${(error as { message: string }).message}. Check the ID is a valid source document UUID.`,
              },
            ],
            isError: true,
          };
        }

        const versions = data as VersionRow[] | null;

        if (!versions || versions.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No document found for ID: ${args.document_id}`,
              },
            ],
            isError: true,
          };
        }

        // Format as a version timeline
        const lines: string[] = [];
        lines.push(`## Document Version Chain`);
        lines.push(`**Filename:** ${versions[0].filename}`);
        lines.push(`**Total versions:** ${versions.length}`);
        lines.push('');

        for (const v of versions) {
          const date = v.created_at
            ? new Date(v.created_at).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Unknown date';

          const current = v.id === args.document_id ? ' **(requested)**' : '';
          const itemCount = Number(v.content_item_count) || 0;

          lines.push(`### Version ${v.version}${current}`);
          lines.push(`- **ID:** ${v.id}`);
          lines.push(`- **Status:** ${v.status}`);
          lines.push(`- **Uploaded:** ${date}`);
          lines.push(
            `- **File size:** ${v.file_size ? `${(v.file_size / 1024).toFixed(1)} KB` : 'Unknown'}`,
          );
          lines.push(
            `- **Content hash:** ${v.content_hash?.slice(0, 12) ?? 'N/A'}...`,
          );
          lines.push(`- **KB items created:** ${itemCount}`);
          if (v.parent_id) {
            lines.push(`- **Parent version:** ${v.parent_id}`);
          }
          lines.push('');
        }

        const markdown = truncateResponse(lines.join('\n'));

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            document_id: args.document_id,
            filename: versions[0].filename,
            total_versions: versions.length,
            versions: versions.map((v) => ({
              id: v.id,
              version: v.version,
              status: v.status,
              filename: v.filename,
              file_size: v.file_size,
              content_hash: v.content_hash,
              parent_id: v.parent_id,
              uploaded_by: v.uploaded_by,
              created_at: v.created_at,
              content_item_count: Number(v.content_item_count) || 0,
            })),
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to retrieve document versions: ${message}. Check the ID is a valid source document UUID.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // get_document_diff REMOVED (ID-117.12): legacy diff-display tool retired
  // alongside the source_document_diffs engine. The binary-diff surface now
  // lives at /documents/[id]/diff (ID-117.10); revision history is sourced from
  // q_a_pair_history / content_item_versions (INV-14/17).
}
