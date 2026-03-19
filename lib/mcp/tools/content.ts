/**
 * Content item tool registrations (4 tools):
 *   4. get_content_item
 *  12. create_content_item
 *  19. update_content_item
 *  21. get_content_items
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, getMcpUserId, checkMcpRole } from '@/lib/mcp/auth';
import type { Database, Json } from '@/supabase/types/database.types';
import {
  formatContentItem,
  formatCreatedItem,
  formatUpdatedItem,
  formatBatchContentItems,
  truncateResponse,
  CHARACTER_LIMIT,
} from '@/lib/mcp/formatters';
import type {
  ContentItemDetail,
  CreatedItem,
  UpdatedItemResult,
  BatchContentItemsResult,
} from '@/lib/mcp/formatters';
import { type ToolExtra, toStructuredContent, getGenerateEmbedding, getClassifyContent, getGenerateSummary } from './shared';

export async function registerContentTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 4. get_content_item
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_content_item',
    {
      title: 'Get Content Item',
      description: 'Retrieve a specific content item from the knowledge base by its ID. Returns the full item including title, type, domain, summary, keywords, freshness status, content text, and entity relationships. For Q&A pairs, includes standard and advanced answers. Use this after searching to get the complete details of a specific item. Use get_entity_relationships to explore connected entities.',
      inputSchema: {
        id: z.string().uuid().describe('The UUID of the content item to retrieve'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        const { data: item, error } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content_type, primary_domain, primary_subtopic, ai_summary, ai_keywords, freshness, classification_confidence, source_url, content, created_at, updated_at, governance_review_status, priority',
          )
          .eq('id', args.id)
          .single();

        if (error || !item) {
          return {
            content: [{ type: 'text' as const, text: `Content item not found: ${args.id}` }],
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
          ai_summary: item.ai_summary,
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

        const markdown = truncateResponse(formatContentItem(itemDetail));

        // Truncate content in structuredContent to prevent oversized responses
        // from large PDFs (which can exceed 500KB)
        const structuredItem = { ...item };
        if (typeof structuredItem.content === 'string' && structuredItem.content.length > CHARACTER_LIMIT) {
          structuredItem.content = structuredItem.content.slice(0, CHARACTER_LIMIT) + '\n\n... (content truncated)';
        }

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(structuredItem),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to retrieve content item: ${message}. Check the ID is a valid UUID.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 12. create_content_item (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'create_content_item',
    {
      title: 'Create Content Item',
      description: 'Create a new content item in the knowledge base. Requires editor or admin role. The item will be automatically embedded for search unless created as a draft. Set governance_review_status to "draft" to create items that are excluded from search and visible only in the review queue\'s Drafts filter — useful for batch content creation that needs review before going live. Use batch_tag to group related draft items (e.g. "reorient-2026-03") and source_document to record provenance. Choose content_type carefully: use q_a_pair for question-answer pairs, case_study for project examples, policy for governance documents, certification for accreditations, capability for service descriptions. Use the kb://taxonomy resource to see valid domain and subtopic values.',
      inputSchema: {
        title: z.string().min(1).max(500).describe('Title of the content item'),
        content: z.string().min(1).max(500000).describe('The content text'),
        content_type: z.enum([
          'article', 'blog', 'pdf', 'note', 'research', 'other',
          'q_a_pair', 'case_study', 'policy', 'certification',
          'compliance', 'methodology', 'capability', 'product_description',
        ]).describe('Type of content'),
        primary_domain: z.string().optional().describe('Primary domain category'),
        primary_subtopic: z.string().optional().describe('Primary subtopic'),
        priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level'),
        governance_review_status: z.enum(['draft']).optional().describe('Set to "draft" to create as a draft item (excluded from search, no embedding generated). Publish later via update_governance_status.'),
        batch_tag: z.string().max(200).optional().describe('Tag to group related items (e.g. "reorient-2026-03"). Stored in metadata.batch_tag for filtering.'),
        source_document: z.string().max(500).optional().describe('Source document name or path for provenance tracking. Stored in metadata.source_document.'),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [{ type: 'text' as const, text: 'Permission denied: editor or admin role required.' }],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const isDraft = args.governance_review_status === 'draft';

        // Skip embedding for drafts — generated on publish to save API cost
        let embedding: number[] | null = null;
        if (!isDraft) {
          try {
            const generateEmbedding = await getGenerateEmbedding();
            embedding = await generateEmbedding(args.title + ' ' + args.content.slice(0, 5000));
          } catch (error) {
            // Embedding failure is non-fatal — item is still created but invisible to search
            console.error('Failed to generate embeddings:', error);
          }
        }

        // Build metadata with optional batch_tag and source_document
        const metadata: Record<string, string> = {};
        if (args.batch_tag) metadata.batch_tag = args.batch_tag;
        if (args.source_document) metadata.source_document = args.source_document;

        const insertData: Database['public']['Tables']['content_items']['Insert'] = {
          title: args.title,
          suggested_title: args.title,
          content: args.content,
          content_type: args.content_type,
          platform: 'manual',
          captured_date: new Date().toISOString(),
          created_by: userId,
          ...(args.primary_domain && { primary_domain: args.primary_domain }),
          ...(args.primary_subtopic && { primary_subtopic: args.primary_subtopic }),
          ...(args.priority && { priority: args.priority }),
          ...(embedding && { embedding: JSON.stringify(embedding) }),
          ...(isDraft && { governance_review_status: 'draft' }),
          ...(Object.keys(metadata).length > 0 && { metadata: metadata as unknown as Json }),
        };

        const { data: item, error } = await supabase
          .from('content_items')
          .insert(insertData)
          .select('id, title, content_type')
          .single();

        if (error || !item) {
          return {
            content: [{ type: 'text' as const, text: `Failed to create item: ${error?.message ?? 'Unknown error'}` }],
            isError: true,
          };
        }

        const created: CreatedItem = {
          id: item.id,
          title: item.title ?? args.title,
          content_type: item.content_type ?? args.content_type,
        };

        // AI processing — awaited to avoid serverless truncation
        const warnings: string[] = [];

        if (!isDraft) {
          try {
            const classifyContent = await getClassifyContent();
            await classifyContent({ supabase, itemId: item.id, force: true, userId });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            warnings.push(`Classification failed: ${msg}`);
            console.error(`MCP create_content_item classification failed for ${item.id}:`, err);
          }

          try {
            const generateSummary = await getGenerateSummary();
            await generateSummary({ supabase, itemId: item.id, force: true, userId });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            warnings.push(`Summary generation failed: ${msg}`);
            console.error(`MCP create_content_item summary failed for ${item.id}:`, err);
          }
        }

        const draftNote = isDraft
          ? '\n\n**Status:** Draft — excluded from search. Use `update_governance_status` to publish when ready.'
          : '';
        const warningNote = warnings.length > 0
          ? `\n\n**Warnings:**\n${warnings.map(w => `- ${w}`).join('\n')}`
          : '';
        const markdown = formatCreatedItem(created) + draftNote + warningNote;
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            ...created,
            governance_review_status: isDraft ? 'draft' : null,
            batch_tag: args.batch_tag ?? null,
            source_document: args.source_document ?? null,
            warnings: warnings.length > 0 ? warnings : undefined,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to create item: ${message}. Ensure you have editor or admin permissions.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 19. update_content_item (write tool — editor+ only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'update_content_item',
    {
      title: 'Update Content Item',
      description: 'Edit an existing content item\'s metadata and content fields. Updates are applied immediately and auto-versioned in content_history. Requires editor or admin role. Updatable fields: title, suggested_title, content, answer_standard, answer_advanced, primary_domain, primary_subtopic, priority, notes. Use the kb://taxonomy resource for valid domain and subtopic values.',
      inputSchema: {
        id: z.string().uuid().describe('The UUID of the content item to update'),
        fields: z.object({
          title: z.string().optional().describe('Display title'),
          suggested_title: z.string().optional().describe('AI-suggested title'),
          content: z.string().max(500000).optional().describe('Main content text'),
          answer_standard: z.string().optional().describe('Standard answer (Q&A pairs)'),
          answer_advanced: z.string().optional().describe('Advanced answer (Q&A pairs)'),
          primary_domain: z.string().optional().describe('Domain classification'),
          primary_subtopic: z.string().optional().describe('Subtopic classification'),
          priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level'),
          notes: z.string().optional().describe('Editorial notes'),
        }).describe('Fields to update — only include fields you want to change'),
        reason: z.string().optional().describe('Explanation of why the update was made (stored for audit trail)'),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [{ type: 'text' as const, text: 'Permission denied: editor or admin role required.' }],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);

        // Validate that at least one field is being updated
        const allowedFields = [
          'title', 'suggested_title', 'content', 'answer_standard',
          'answer_advanced', 'primary_domain', 'primary_subtopic',
          'priority', 'notes',
        ] as const;

        const updateData: Record<string, unknown> = {};
        const updatedFields: string[] = [];

        for (const field of allowedFields) {
          if (args.fields[field] !== undefined) {
            updateData[field] = args.fields[field];
            updatedFields.push(field);
          }
        }

        if (updatedFields.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No fields to update. Provide at least one field in the fields object.' }],
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
            content: [{ type: 'text' as const, text: `Content item not found: ${args.id}` }],
            isError: true,
          };
        }

        // Add updated_by
        updateData.updated_by = userId;

        // Apply update
        const { error: updateError } = await supabase
          .from('content_items')
          .update(updateData as Database['public']['Tables']['content_items']['Update'])
          .eq('id', args.id);

        if (updateError) {
          return {
            content: [{ type: 'text' as const, text: `Update failed: ${updateError.message}. Check the ID is valid and you have permissions.` }],
            isError: true,
          };
        }

        const result: UpdatedItemResult = {
          id: args.id,
          updated_fields: updatedFields,
          previous_values: JSON.parse(JSON.stringify(current)) as Record<string, unknown>,
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
          content: [{ type: 'text' as const, text: `Update failed: ${message}. Ensure you have editor or admin permissions.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 21. get_content_items (batch)
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_content_items',
    {
      title: 'Get Content Items (Batch)',
      description: 'Fetch multiple content items by ID array in a single call. Eliminates the need for multiple get_content_item calls when auditing or reviewing several items. Returns the same detail level as get_content_item for each item. Maximum 50 IDs per call.',
      inputSchema: {
        ids: z.array(z.string().uuid()).min(1).max(50).describe('Array of content item UUIDs to fetch (max: 50)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        const { data: rows, error } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, content_type, primary_domain, primary_subtopic, ai_summary, ai_keywords, freshness, classification_confidence, source_url, content, created_at, updated_at, governance_review_status, priority',
          )
          .in('id', args.ids);

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Batch fetch failed: ${error.message}.` }],
            isError: true,
          };
        }

        const foundIds = new Set((rows ?? []).map((r: Record<string, unknown>) => r.id as string));
        const notFound = args.ids.filter((id) => !foundIds.has(id));

        const items: ContentItemDetail[] = ((rows ?? []) as Record<string, unknown>[]).map((item) => {
          // Truncate content in results to prevent oversized responses
          let content = item.content as string | null;
          if (typeof content === 'string' && content.length > CHARACTER_LIMIT) {
            content = content.slice(0, CHARACTER_LIMIT) + '\n\n... (content truncated)';
          }

          return {
            id: item.id as string,
            title: item.title as string | null,
            suggested_title: item.suggested_title as string | null,
            content_type: item.content_type as string | null,
            primary_domain: item.primary_domain as string | null,
            primary_subtopic: item.primary_subtopic as string | null,
            ai_summary: item.ai_summary as string | null,
            ai_keywords: item.ai_keywords as string[] | null,
            freshness: item.freshness as string | null,
            classification_confidence: item.classification_confidence as number | null,
            source_url: item.source_url as string | null,
            content,
            created_at: item.created_at as string | null,
            updated_at: item.updated_at as string | null,
            governance_review_status: item.governance_review_status as string | null,
            priority: item.priority as string | null,
          };
        });

        // Reorder to match input ID order
        const idOrder = new Map(args.ids.map((id, index) => [id, index]));
        items.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

        const result: BatchContentItemsResult = {
          count: items.length,
          items,
          not_found: notFound,
        };

        const markdown = truncateResponse(formatBatchContentItems(result));
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Batch fetch failed: ${message}.` }],
          isError: true,
        };
      }
    },
  );

}
