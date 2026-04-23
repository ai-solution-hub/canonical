/**
 * Content item tool registrations (9 tools):
 *   4. get_content_item
 *  12. create_content_item
 *  19. update_content_item
 *  21. get_content_items
 *      get_workspace_items
 *  31. assign_content_owner
 *  32. bulk_assign_owner
 *  33. get_document_versions
 *  35. get_document_diff
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, checkMcpRole } from '@/lib/mcp/auth';
import { sb, tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
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
  getClassifyContent,
  getGenerateSummary,
  defineTool,
  READ_ONLY_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
  NON_IDEMPOTENT_WRITE_ANNOTATIONS,
} from './shared';
import { slugifyDomain } from '@/lib/ai/classify';

// ---------------------------------------------------------------------------
// Shared helper: fetch content items by ID array and format as batch result.
// Used by get_content_items and get_workspace_items.
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

  const foundIds = new Set(
    (rows ?? []).map((r: Record<string, unknown>) => r.id as string),
  );
  const notFound = itemIds.filter((id) => !foundIds.has(id));

  const items: ContentItemDetail[] = (
    (rows ?? []) as Record<string, unknown>[]
  ).map((item) => {
    let content = item.content as string | null;
    if (typeof content === 'string' && content.length > CHARACTER_LIMIT) {
      content =
        content.slice(0, CHARACTER_LIMIT) + '\n\n... (content truncated)';
    }

    return {
      id: item.id as string,
      title: item.title as string | null,
      suggested_title: item.suggested_title as string | null,
      content_type: item.content_type as string | null,
      primary_domain: item.primary_domain as string | null,
      primary_subtopic: item.primary_subtopic as string | null,
      summary: item.summary as string | null,
      ai_keywords: item.ai_keywords as string[] | null,
      freshness: item.freshness as string | null,
      classification_confidence: item.classification_confidence as
        | number
        | null,
      source_url: item.source_url as string | null,
      content,
      created_at: item.created_at as string | null,
      updated_at: item.updated_at as string | null,
      governance_review_status: item.governance_review_status as string | null,
      priority: item.priority as string | null,
    };
  });

  // Reorder to match input ID order
  const idOrder = new Map(itemIds.map((id, index) => [id, index]));
  items.sort(
    (a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0),
  );

  return { count: items.length, items, not_found: notFound };
}

export async function registerContentTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 4. get_content_item
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_content_item',
    {
      title: 'Get Content Item',
      description:
        'Retrieve a specific content item from the knowledge base by its ID. Returns the full item including title, type, domain, summary, keywords, freshness status, content text, and entity relationships. For Q&A pairs, includes standard and advanced answers. Use this after searching to get the complete details of a specific item. Use get_entity_relationships to explore connected entities.',
      inputSchema: {
        id: z
          .string()
          .uuid()
          .describe('The UUID of the content item to retrieve'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        const { data: item, error } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content_type, primary_domain, primary_subtopic, summary, ai_keywords, freshness, classification_confidence, source_url, content, created_at, updated_at, governance_review_status, priority',
          )
          .eq('id', args.id)
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
            .eq('content_item_id', args.id)
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
          structuredContent: toStructuredContent(structuredItem),
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
        'Create a new content item in the knowledge base. Content should be in markdown format (the canonical storage format). Requires editor or admin role. The item will be automatically embedded for search unless created as a draft. Set governance_review_status to "draft" to create items that are excluded from search and visible only in the review queue\'s Drafts filter — useful for batch content creation that needs review before going live. Use batch_tag to group related draft items (e.g. "reorient-2026-03") and source_document to record provenance. Choose content_type carefully: use q_a_pair for question-answer pairs, case_study for project examples, policy for governance documents, certification for accreditations, capability for service descriptions. Use the kb://taxonomy resource to see valid domain and subtopic values.',
      inputSchema: {
        title: z.string().min(1).max(500).describe('Title of the content item'),
        content: z.string().min(1).max(500000).describe('The content text in markdown format'),
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
        governance_review_status: z
          .enum(['draft'])
          .optional()
          .describe(
            'Set to "draft" to create as a draft item (excluded from search, no embedding generated). Publish later via update_governance_status.',
          ),
        batch_tag: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Tag to group related items (e.g. "reorient-2026-03"). Stored in metadata.batch_tag for filtering.',
          ),
        source_document: z
          .string()
          .max(500)
          .optional()
          .describe(
            'Source document name or path for provenance tracking. Stored in metadata.source_document.',
          ),
        skip_dedup: z
          .boolean()
          .optional()
          .describe(
            'Admin-only dedup override (spec §6 D2). When true and the caller is admin, exact-hash match is not stamped. Non-admin requests silently ignore the flag.',
          ),
      },
      annotations: NON_IDEMPOTENT_WRITE_ANNOTATIONS,
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
        const isDraft = args.governance_review_status === 'draft';

        // Admin-only dedup override (spec §6 D2). Silent-ignore for
        // editors even though the flag is exposed on the input schema.
        const skipDedup = args.skip_dedup === true && role === 'admin';

        // Dedup — soft-block per spec §6 D1. Exact-hash match stamps
        // `dedup_status='suspected_duplicate'` + records the existing
        // id in `metadata.suspected_duplicate_of`. `find_exact_duplicates`
        // is SECURITY DEFINER so the RLS-scoped client sees cross-user
        // matches.
        const { checkExactDuplicate, resolveDedupStamp } =
          await import('@/lib/dedup');
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
          console.error('MCP create_content_item dedup check failed:', dedupErr);
        }

        // Skip embedding for drafts — generated on publish to save API cost
        let embedding: number[] | null = null;
        if (!isDraft) {
          try {
            const generateEmbedding = await getGenerateEmbedding();
            embedding = await generateEmbedding(
              args.title + ' ' + args.content.slice(0, 5000),
            );
          } catch (error) {
            // Embedding failure is non-fatal — item is still created but invisible to search
            console.error('Failed to generate embeddings:', error);
          }
        }

        // Build metadata with optional batch_tag, source_document, dedup ref
        const metadata: Record<string, string> = {};
        if (args.batch_tag) metadata.batch_tag = args.batch_tag;
        if (args.source_document)
          metadata.source_document = args.source_document;
        if (dedupStamp.suspected_duplicate_of) {
          metadata.suspected_duplicate_of = dedupStamp.suspected_duplicate_of;
        }

        const insertData: Database['public']['Tables']['content_items']['Insert'] =
          {
            title: args.title,
            suggested_title: args.title,
            content: args.content,
            content_type: args.content_type,
            platform: 'manual',
            captured_date: new Date().toISOString(),
            created_by: userId,
            dedup_status: dedupStamp.dedup_status,
            ...(args.primary_domain && {
              primary_domain: slugifyDomain(args.primary_domain),
            }),
            ...(args.primary_subtopic && {
              primary_subtopic: slugifyDomain(args.primary_subtopic),
            }),
            ...(args.priority && { priority: args.priority }),
            ...(embedding && { embedding: JSON.stringify(embedding) }),
            ...(isDraft && { governance_review_status: 'draft' }),
            ...(Object.keys(metadata).length > 0 && {
              metadata: metadata as unknown as Json,
            }),
          };

        const { data: item, error } = await supabase
          .from('content_items')
          .insert(insertData)
          .select('id, title, content_type')
          .single();

        if (error || !item) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to create item: ${error?.message ?? 'Unknown error'}`,
              },
            ],
            isError: true,
          };
        }

        // S186 WP-E: write v1 content_history row to match the other 4 TS
        // ingest routes (app/api/ingest/url, /api/items, /api/items/batch,
        // /api/upload). The DB trigger `trg_content_items_ensure_v1_history`
        // is a backstop — if this explicit write fails, the trigger fills
        // in at transaction commit with change_reason='auto_v1_on_insert'.
        // Non-fatal — the item itself is usable without history. No
        // `.select()` is needed here: this runs in a Next.js API route (not a
        // standalone Bun script) so the 204 response is fine. See CLAUDE.md
        // §Supabase "Bun fetch hangs on HTTP 204 through sandbox proxy".
        {
          const { error: historyErr } = await supabase
            .from('content_history')
            .insert({
              content_item_id: item.id,
              title: args.title,
              content: args.content,
              brief: null,
              detail: null,
              reference: null,
              change_type: 'create',
              change_summary: 'Item created via MCP create_content_item tool',
              change_reason: 'initial_ingest',
              created_by: userId,
              version: 1,
            });
          if (historyErr) {
            console.error(
              `MCP create_content_item v1 history insert failed for ${item.id}: ${historyErr.message}`,
            );
          }
        }

        const created: CreatedItem = {
          id: item.id,
          title: item.title ?? args.title,
          content_type: item.content_type ?? args.content_type,
        };

        // Layer inference — suggest and store a layer
        let suggestedLayerKey: string | undefined;
        if (!isDraft) {
          try {
            const { inferLayer } = await import('@/lib/layer-inference');
            const suggestion = inferLayer({
              contentType: args.content_type,
              contentLength: args.content.length,
              ingestionSource: 'manual',
              hasBrief: false,
              hasDetail: false,
              hasReference: false,
              isBidDiscovered: false,
              title: args.title,
            });
            suggestedLayerKey = suggestion.suggestedLayer;

            // Store the suggested layer in the dedicated column
            await supabase
              .from('content_items')
              .update({ layer: suggestion.suggestedLayer } as Record<
                string,
                unknown
              >)
              .eq('id', item.id);
          } catch (layerErr) {
            // Non-fatal — item is still usable without a layer
            console.error('MCP layer inference failed:', layerErr);
          }
        }

        // AI processing — awaited to avoid serverless truncation
        const warnings: string[] = [];

        if (!isDraft) {
          try {
            const classifyContent = await getClassifyContent();
            await classifyContent({
              supabase,
              itemId: item.id,
              force: true,
              userId,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            warnings.push(`Classification failed: ${msg}`);
            console.error(
              `MCP create_content_item classification failed for ${item.id}:`,
              err,
            );
          }

          try {
            const generateSummary = await getGenerateSummary();
            await generateSummary({
              supabase,
              itemId: item.id,
              force: true,
              userId,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            warnings.push(`Summary generation failed: ${msg}`);
            console.error(
              `MCP create_content_item summary failed for ${item.id}:`,
              err,
            );
          }

          // Chunking — split markdown into heading-based chunks with embeddings.
          // Uses service client to bypass RLS (the chunks table mirrors
          // content_items permissions but a service client avoids edge cases).
          try {
            const { regenerateChunks } = await import(
              '@/lib/content/chunk-store'
            );
            const { createServiceClient } = await import(
              '@/lib/supabase/server'
            );
            const chunkServiceClient = createServiceClient();
            const chunkResult = await regenerateChunks(
              chunkServiceClient,
              item.id,
              args.content,
            );
            if (chunkResult.errors.length > 0) {
              warnings.push(
                `Chunking: ${chunkResult.errors.length} error(s)`,
              );
            }
          } catch (chunkErr) {
            console.error(
              `MCP create_content_item chunking failed for ${item.id}:`,
              chunkErr,
            );
            warnings.push('Content chunking failed');
          }
        }

        // Guide section suggestion — fetch classified item then match
        let guideSectionSuggestions: {
          guideId: string;
          guideName: string;
          guideSlug: string;
          sectionId: string;
          sectionName: string;
          sectionOrder: number;
          isRequired: boolean;
          matchStrength: string;
          matchReason: string;
        }[] = [];
        if (!isDraft) {
          try {
            const classifiedItem = await sb(
              supabase
                .from('content_items')
                .select(
                  'primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, content_type, metadata',
                )
                .eq('id', item.id)
                .single(),
              'mcp.content.classified_item',
            );

            if (classifiedItem?.primary_domain) {
              const { suggestGuideSections } =
                await import('@/lib/guide-section-mapping');
              const matches = await suggestGuideSections(supabase, {
                primaryDomain: classifiedItem.primary_domain,
                primarySubtopic: classifiedItem.primary_subtopic || '',
                secondaryDomain: classifiedItem.secondary_domain || undefined,
                secondarySubtopic:
                  classifiedItem.secondary_subtopic || undefined,
                layer: suggestedLayerKey || undefined,
                contentType: classifiedItem.content_type || args.content_type,
              });
              guideSectionSuggestions = matches;
            }
          } catch (guideErr) {
            console.error('MCP guide section suggestion failed:', guideErr);
            // Non-fatal — item is still usable without guide section suggestions
          }
        }

        const draftNote = isDraft
          ? '\n\n**Status:** Draft — excluded from search. Use `update_governance_status` to publish when ready.'
          : '';
        const layerNote = suggestedLayerKey
          ? `\n\n**Layer:** ${suggestedLayerKey} (auto-assigned)`
          : '';
        const guideNote =
          guideSectionSuggestions.length > 0
            ? `\n\n**Guide sections:** ${guideSectionSuggestions.map((gs) => `${gs.guideName} > ${gs.sectionName}`).join(', ')}`
            : '';
        const dedupNote =
          dedupStamp.dedup_status === 'suspected_duplicate'
            ? `\n\n**Dedup:** Flagged as \`suspected_duplicate\` — matches existing item ${dedupStamp.suspected_duplicate_of}${dedupExistingTitle ? ` ("${dedupExistingTitle}")` : ''}. Admin may resolve via the dedup review workflow.`
            : '';
        const warningNote =
          warnings.length > 0
            ? `\n\n**Warnings:**\n${warnings.map((w) => `- ${w}`).join('\n')}`
            : '';
        const markdown =
          formatCreatedItem(created) +
          draftNote +
          layerNote +
          guideNote +
          dedupNote +
          warningNote;
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            ...created,
            governance_review_status: isDraft ? 'draft' : null,
            batch_tag: args.batch_tag ?? null,
            source_document: args.source_document ?? null,
            suggested_layer: suggestedLayerKey ?? null,
            guide_sections:
              guideSectionSuggestions.length > 0
                ? guideSectionSuggestions
                : undefined,
            warnings: warnings.length > 0 ? warnings : undefined,
            dedup_status: dedupStamp.dedup_status,
            suspected_duplicate_of: dedupStamp.suspected_duplicate_of ?? null,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
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
          'notes',
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

        if (fetchError || !current) {
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
  // 21. get_content_items (batch)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_content_items',
    {
      title: 'Get Content Items (Batch)',
      description:
        'Fetch multiple content items by ID array in a single call. Eliminates the need for multiple get_content_item calls when auditing or reviewing several items. Returns the same detail level as get_content_item for each item. Maximum 50 IDs per call.',
      inputSchema: {
        ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .describe('Array of content item UUIDs to fetch (max: 50)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const result = await fetchAndFormatContentItems(supabase, args.ids);

        const markdown = truncateResponse(formatBatchContentItems(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            { type: 'text' as const, text: `Batch fetch failed: ${message}.` },
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
  // 31. assign_content_owner (write tool — admin only)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'assign_content_owner',
    {
      title: 'Assign Content Owner',
      description:
        'Assign or change the content owner for one or more items. The owner receives targeted notifications when their content becomes stale or needs governance review. Requires admin role. Use this to delegate content maintenance responsibility to specific team members.',
      inputSchema: {
        item_ids: z
          .array(z.string().uuid())
          .min(1)
          .max(50)
          .describe('Content item IDs to assign (1-50)'),
        owner_id: z.string().uuid().describe('User ID of the new owner'),
      },
      annotations: SAFE_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
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

        // Call the bulk_assign_content_owner RPC
        const { data: updatedCount, error } = await supabase.rpc(
          'bulk_assign_content_owner',
          {
            p_item_ids: args.item_ids,
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
        const notFoundCount = args.item_ids.length - count;

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
            requested: args.item_ids.length,
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
    },
  );

  // -------------------------------------------------------------------------
  // 32. bulk_assign_owner (non-idempotent write — admin only)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'bulk_assign_owner',
    {
      title: 'Bulk Assign Content Owner',
      description:
        'Assign a content owner to items matching a scope filter (domain, subtopic, content_type). ' +
        'Supports dry-run preview, skip-if-owned default with force_override opt-in, ' +
        'cursor pagination for scopes >500 items, and per-item audit trail. ' +
        'Requires admin role. Use this for "assign all unowned Healthcare content to Sarah" workflows.',
      inputSchema: {
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
          .describe(
            'Scope filter. Apply mode (dry_run: false) requires at least one of domain, subtopic, or content_type. ' +
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
            'When true AND unowned_only is false, overwrite existing owners. ' +
              'When false (default), items with an existing owner are skipped even if unowned_only is false.',
          ),
        notify: z
          .boolean()
          .default(true)
          .describe(
            'Send a notification to the new owner on successful apply. Default true. Set false to suppress.',
          ),
        batch_mode: z
          .boolean()
          .default(false)
          .describe(
            'When true, send a single summary notification instead of per-item. ' +
              'Useful for large scope applies.',
          ),
        cursor: z
          .string()
          .optional()
          .describe(
            'Opaque pagination cursor returned by previous call when assigned_count === 500. ' +
              'Supplying it continues from where the previous call stopped.',
          ),
        dry_run: z
          .boolean()
          .default(false)
          .describe(
            'Preview affected items without writing. Empty scope permitted in dry_run for whole-KB inspection.',
          ),
      },
      annotations: NON_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
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

        const {
          scope,
          owner_id: ownerId,
          force_override: forceOverride,
          notify,
          batch_mode: batchMode,
          cursor,
          dry_run: dryRun,
        } = args;

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

  // -------------------------------------------------------------------------
  // 35. get_document_diff
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_document_diff',
    {
      title: 'Get Source Document Diff',
      description:
        'Compare two versions of a source document. Shows added, modified, and removed content blocks (Q&A pairs or full-text sections depending on document type), plus which KB items are affected by the changes. Use when a client sends an updated document and you need to understand what changed.',
      inputSchema: {
        document_id: z
          .string()
          .uuid()
          .describe(
            'Source document ID \u2014 returns the latest diff for this document',
          ),
        diff_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Specific diff ID to retrieve (overrides document_id lookup)',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        let oldDoc: { id: string; filename: string };
        let newDoc: { id: string; filename: string };

        if (args.diff_id) {
          // ---- Direct diff lookup by diff_id ----
          const { data: diffEntry, error: diffLookupError } = await supabase
            .from('source_document_diffs')
            .select('old_document_id, new_document_id')
            .eq('id', args.diff_id)
            .limit(1)
            .single();

          if (diffLookupError || !diffEntry) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Diff entry not found: ${args.diff_id}`,
                },
              ],
              isError: true,
            };
          }

          // Fetch filenames for both documents
          const oldDocRow = await sb(
            supabase
              .from('source_documents')
              .select('id, filename')
              .eq('id', diffEntry.old_document_id)
              .maybeSingle(),
            'mcp.content.diff_old_document',
          );

          const newDocRow = await sb(
            supabase
              .from('source_documents')
              .select('id, filename')
              .eq('id', diffEntry.new_document_id)
              .maybeSingle(),
            'mcp.content.diff_new_document',
          );

          if (!oldDocRow || !newDocRow) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Source documents referenced by this diff no longer exist.',
                },
              ],
              isError: true,
            };
          }

          oldDoc = oldDocRow;
          newDoc = newDocRow;
        } else {
          // ---- Primary flow: get latest diff for a document ----
          // Find the document and its parent to get the diff pair
          const { data: doc, error: docError } = await supabase
            .from('source_documents')
            .select('id, filename, parent_id')
            .eq('id', args.document_id)
            .single();

          if (docError || !doc) {
            return {
              content: [{ type: 'text' as const, text: 'Document not found.' }],
              isError: true,
            };
          }

          // This document could be either the old or new version
          // Try: this doc as new (has parent_id) -> diff between parent and this
          // Or: this doc as old -> find child that references this as parent

          if (doc.parent_id) {
            // This is a newer version - diff with parent
            const parent = await sb(
              supabase
                .from('source_documents')
                .select('id, filename')
                .eq('id', doc.parent_id)
                .maybeSingle(),
              'mcp.content.diff_parent_document',
            );

            if (!parent) {
              return {
                content: [
                  { type: 'text' as const, text: 'Parent document not found.' },
                ],
                isError: true,
              };
            }

            oldDoc = parent;
            newDoc = { id: doc.id, filename: doc.filename };
          } else {
            // This might be the original - find child
            const child = await sb(
              supabase
                .from('source_documents')
                .select('id, filename')
                .eq('parent_id', doc.id)
                .order('version', { ascending: false })
                .limit(1)
                .maybeSingle(),
              'mcp.content.diff_child_document',
            );

            if (!child) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'No version history found for this document. Upload an updated version to generate a diff.',
                  },
                ],
              };
            }

            oldDoc = { id: doc.id, filename: doc.filename };
            newDoc = child;
          }
        }

        // Fetch diff entries
        const { data: diffs, error: diffError } = await supabase
          .from('source_document_diffs')
          .select(
            'diff_type, diff_mode, old_question, new_question, old_content, new_content, similarity_score, affected_content_item_id, status',
          )
          .eq('old_document_id', oldDoc.id)
          .eq('new_document_id', newDoc.id);

        if (diffError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to fetch diff: ${diffError.message}`,
              },
            ],
            isError: true,
          };
        }

        if (!diffs || diffs.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No diff data found between ${oldDoc.filename} and ${newDoc.filename}. The diff may not have been computed yet.`,
              },
            ],
          };
        }

        // Get affected content item titles
        const affectedIds = diffs
          .filter((d) => d.affected_content_item_id)
          .map((d) => d.affected_content_item_id!);

        const itemTitles = new Map<string, string>();
        if (affectedIds.length > 0) {
          const items = await sb(
            supabase
              .from('content_items')
              .select('id, title')
              .in('id', affectedIds),
            'mcp.content.diff_affected_items',
          );

          for (const item of items ?? []) {
            itemTitles.set(item.id, item.title ?? 'Untitled');
          }
        }

        // Build formatter data
        const { formatDocumentDiff } = await import('@/lib/mcp/formatters');

        // Determine overall diff mode from entries
        const entryDiffMode =
          diffs.length > 0 && (diffs[0] as Record<string, unknown>).diff_mode
            ? ((diffs[0] as Record<string, unknown>).diff_mode as string)
            : 'qa';

        const formatterData: import('@/lib/mcp/formatters').DocumentDiffData = {
          old_filename: oldDoc.filename,
          new_filename: newDoc.filename,
          diff_mode: entryDiffMode as 'qa' | 'full_text',
          summary: {
            added: diffs.filter((d) => d.diff_type === 'added').length,
            removed: diffs.filter((d) => d.diff_type === 'removed').length,
            modified: diffs.filter((d) => d.diff_type === 'modified').length,
            unchanged: diffs.filter((d) => d.diff_type === 'unchanged').length,
            total_old: diffs.filter((d) =>
              ['removed', 'modified', 'unchanged'].includes(d.diff_type),
            ).length,
            total_new: diffs.filter((d) =>
              ['added', 'modified', 'unchanged'].includes(d.diff_type),
            ).length,
          },
          entries: diffs.map((d) => ({
            diff_type: d.diff_type as
              | 'added'
              | 'removed'
              | 'modified'
              | 'unchanged',
            diff_mode: (((d as Record<string, unknown>).diff_mode as string) ??
              'qa') as 'qa' | 'full_text',
            old_question: d.old_question ?? undefined,
            new_question: d.new_question ?? undefined,
            old_content: d.old_content ?? undefined,
            new_content: d.new_content ?? undefined,
            similarity_score: d.similarity_score ?? undefined,
            affected_item: d.affected_content_item_id
              ? {
                  id: d.affected_content_item_id,
                  title:
                    itemTitles.get(d.affected_content_item_id) ?? 'Unknown',
                }
              : null,
          })),
        };

        const markdown = truncateResponse(formatDocumentDiff(formatterData));

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(formatterData),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            { type: 'text' as const, text: `Document diff failed: ${message}` },
          ],
          isError: true,
        };
      }
    },
  );
}
