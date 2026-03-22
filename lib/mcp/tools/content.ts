/**
 * Content item tool registrations (7 tools):
 *   4. get_content_item
 *  12. create_content_item
 *  19. update_content_item
 *  21. get_content_items
 *  31. assign_content_owner
 *  33. get_document_versions
 *  35. get_document_diff
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

            // Store the suggested layer via merge_item_metadata
            await supabase.rpc('merge_item_metadata', {
              p_item_id: item.id,
              p_new_data: { layer: suggestion.suggestedLayer } as unknown as Json,
            });
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

        // Guide section suggestion — fetch classified item then match
        let guideSectionSuggestions: { guideId: string; guideName: string; guideSlug: string; sectionId: string; sectionName: string; sectionOrder: number; isRequired: boolean; matchStrength: string; matchReason: string }[] = [];
        if (!isDraft) {
          try {
            const { data: classifiedItem } = await supabase
              .from('content_items')
              .select('primary_domain, primary_subtopic, content_type, metadata')
              .eq('id', item.id)
              .single();

            if (classifiedItem?.primary_domain) {
              const { suggestGuideSections } = await import('@/lib/guide-section-mapping');
              const meta = classifiedItem.metadata as Record<string, unknown> | null;
              const matches = await suggestGuideSections(supabase, {
                primaryDomain: classifiedItem.primary_domain,
                primarySubtopic: classifiedItem.primary_subtopic || '',
                layer: (typeof meta?.layer === 'string' ? meta.layer : suggestedLayerKey) || undefined,
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
        const guideNote = guideSectionSuggestions.length > 0
          ? `\n\n**Guide sections:** ${guideSectionSuggestions.map(gs => `${gs.guideName} > ${gs.sectionName}`).join(', ')}`
          : '';
        const warningNote = warnings.length > 0
          ? `\n\n**Warnings:**\n${warnings.map(w => `- ${w}`).join('\n')}`
          : '';
        const markdown = formatCreatedItem(created) + draftNote + layerNote + guideNote + warningNote;
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            ...created,
            governance_review_status: isDraft ? 'draft' : null,
            batch_tag: args.batch_tag ?? null,
            source_document: args.source_document ?? null,
            suggested_layer: suggestedLayerKey ?? null,
            guide_sections: guideSectionSuggestions.length > 0 ? guideSectionSuggestions : undefined,
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

  // -------------------------------------------------------------------------
  // 31. assign_content_owner (write tool — admin only)
  // -------------------------------------------------------------------------
  server.registerTool(
    'assign_content_owner',
    {
      title: 'Assign Content Owner',
      description: 'Assign or change the content owner for one or more items. The owner receives targeted notifications when their content becomes stale or needs governance review. Requires admin role. Use this to delegate content maintenance responsibility to specific team members.',
      inputSchema: {
        item_ids: z.array(z.string().uuid()).min(1).max(50)
          .describe('Content item IDs to assign (1-50)'),
        owner_id: z.string().uuid()
          .describe('User ID of the new owner'),
      },
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin']);
        if (!role) {
          return {
            content: [{ type: 'text' as const, text: 'Permission denied: admin role required to assign content owners.' }],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);

        // Call the bulk_assign_content_owner RPC
        const { data: updatedCount, error } = await supabase.rpc('bulk_assign_content_owner', {
          p_item_ids: args.item_ids,
          p_owner_id: args.owner_id,
          p_assigned_by: userId,
        });

        if (error) {
          return {
            content: [{ type: 'text' as const, text: `Failed to assign content owner: ${error.message}` }],
            isError: true,
          };
        }

        const count = updatedCount ?? 0;
        const notFoundCount = args.item_ids.length - count;

        let message = `Successfully assigned ownership of ${count} item${count === 1 ? '' : 's'} to user ${args.owner_id}.`;
        if (notFoundCount > 0) {
          message += ` ${notFoundCount} item${notFoundCount === 1 ? '' : 's'} not found or unchanged.`;
        }
        message += '\n\nThe owner will receive targeted notifications when their content becomes stale or needs governance review.';

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
          content: [{ type: 'text' as const, text: `Failed to assign content owner: ${message}. Ensure you have admin permissions.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 33. get_document_versions
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_document_versions',
    {
      title: 'Get Source Document Versions',
      description: 'List all versions of a source document, showing the version chain and which KB items were created from each version.',
      inputSchema: {
        document_id: z.string().uuid().describe('Source document ID (any version in the chain)'),
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
            content: [{ type: 'text' as const, text: `Failed to retrieve document versions: ${(error as { message: string }).message}. Check the ID is a valid source document UUID.` }],
            isError: true,
          };
        }

        const versions = data as VersionRow[] | null;

        if (!versions || versions.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No document found for ID: ${args.document_id}` }],
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
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })
            : 'Unknown date';

          const current = v.id === args.document_id ? ' **(requested)**' : '';
          const itemCount = Number(v.content_item_count) || 0;

          lines.push(`### Version ${v.version}${current}`);
          lines.push(`- **ID:** ${v.id}`);
          lines.push(`- **Status:** ${v.status}`);
          lines.push(`- **Uploaded:** ${date}`);
          lines.push(`- **File size:** ${v.file_size ? `${(v.file_size / 1024).toFixed(1)} KB` : 'Unknown'}`);
          lines.push(`- **Content hash:** ${v.content_hash?.slice(0, 12) ?? 'N/A'}...`);
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
          content: [{ type: 'text' as const, text: `Failed to retrieve document versions: ${message}. Check the ID is a valid source document UUID.` }],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 35. get_document_diff
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_document_diff',
    {
      title: 'Get Source Document Diff',
      description: 'Compare two versions of a source document. Shows added, modified, and removed Q&A pairs, plus which KB items are affected by the changes. Use when a client sends an updated document and you need to understand what changed.',
      inputSchema: {
        document_id: z.string().uuid().describe('Source document ID \u2014 returns the latest diff for this document'),
        diff_id: z.string().uuid().optional().describe('Specific diff ID to retrieve (overrides document_id lookup)'),
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
              content: [{ type: 'text' as const, text: `Diff entry not found: ${args.diff_id}` }],
              isError: true,
            };
          }

          // Fetch filenames for both documents
          const { data: oldDocRow } = await supabase
            .from('source_documents')
            .select('id, filename')
            .eq('id', diffEntry.old_document_id)
            .single();

          const { data: newDocRow } = await supabase
            .from('source_documents')
            .select('id, filename')
            .eq('id', diffEntry.new_document_id)
            .single();

          if (!oldDocRow || !newDocRow) {
            return {
              content: [{ type: 'text' as const, text: 'Source documents referenced by this diff no longer exist.' }],
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
            const { data: parent } = await supabase
              .from('source_documents')
              .select('id, filename')
              .eq('id', doc.parent_id)
              .single();

            if (!parent) {
              return {
                content: [{ type: 'text' as const, text: 'Parent document not found.' }],
                isError: true,
              };
            }

            oldDoc = parent;
            newDoc = { id: doc.id, filename: doc.filename };
          } else {
            // This might be the original - find child
            const { data: child } = await supabase
              .from('source_documents')
              .select('id, filename')
              .eq('parent_id', doc.id)
              .order('version', { ascending: false })
              .limit(1)
              .single();

            if (!child) {
              return {
                content: [{ type: 'text' as const, text: 'No version history found for this document. Upload an updated version to generate a diff.' }],
              };
            }

            oldDoc = { id: doc.id, filename: doc.filename };
            newDoc = child;
          }
        }

        // Fetch diff entries
        const { data: diffs, error: diffError } = await supabase
          .from('source_document_diffs')
          .select('diff_type, old_question, new_question, old_content, new_content, similarity_score, affected_content_item_id, status')
          .eq('old_document_id', oldDoc.id)
          .eq('new_document_id', newDoc.id);

        if (diffError) {
          return {
            content: [{ type: 'text' as const, text: `Failed to fetch diff: ${diffError.message}` }],
            isError: true,
          };
        }

        if (!diffs || diffs.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No diff data found between ${oldDoc.filename} and ${newDoc.filename}. The diff may not have been computed yet.` }],
          };
        }

        // Get affected content item titles
        const affectedIds = diffs
          .filter((d) => d.affected_content_item_id)
          .map((d) => d.affected_content_item_id!);

        const itemTitles = new Map<string, string>();
        if (affectedIds.length > 0) {
          const { data: items } = await supabase
            .from('content_items')
            .select('id, title')
            .in('id', affectedIds);

          for (const item of (items ?? [])) {
            itemTitles.set(item.id, item.title ?? 'Untitled');
          }
        }

        // Build formatter data
        const { formatDocumentDiff } = await import('@/lib/mcp/formatters');

        const formatterData = {
          old_filename: oldDoc.filename,
          new_filename: newDoc.filename,
          summary: {
            added: diffs.filter((d) => d.diff_type === 'added').length,
            removed: diffs.filter((d) => d.diff_type === 'removed').length,
            modified: diffs.filter((d) => d.diff_type === 'modified').length,
            unchanged: diffs.filter((d) => d.diff_type === 'unchanged').length,
            total_old: diffs.filter((d) => ['removed', 'modified', 'unchanged'].includes(d.diff_type)).length,
            total_new: diffs.filter((d) => ['added', 'modified', 'unchanged'].includes(d.diff_type)).length,
          },
          entries: diffs.map((d) => ({
            diff_type: d.diff_type as 'added' | 'removed' | 'modified' | 'unchanged',
            old_question: d.old_question ?? undefined,
            new_question: d.new_question ?? undefined,
            old_content: d.old_content ?? undefined,
            new_content: d.new_content ?? undefined,
            similarity_score: d.similarity_score ?? undefined,
            affected_item: d.affected_content_item_id
              ? { id: d.affected_content_item_id, title: itemTitles.get(d.affected_content_item_id) ?? 'Unknown' }
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
          content: [{ type: 'text' as const, text: `Document diff failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

}
