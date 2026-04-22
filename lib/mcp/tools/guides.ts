/**
 * Guide tool registrations (4 tools):
 *   list_guides
 *   get_guide
 *   create_guide
 *   update_guide
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  defineTool,
  READ_ONLY_ANNOTATIONS,
  NON_IDEMPOTENT_WRITE_ANNOTATIONS,
  SAFE_WRITE_ANNOTATIONS,
  toStructuredContent,
  type ToolExtra,
} from './shared';
import { createMcpClient, checkMcpRole, getMcpUserId } from '@/lib/mcp/auth';
import { sb, tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import {
  VALID_GUIDE_TYPES,
  guideCreateSchema,
  guideUpdateSchema,
  buildGuideSectionSchema,
  buildGuideSectionUpdateSchema,
} from '@/lib/validation/guide-schemas';
import { fetchActiveLayerKeys } from '@/lib/validation/layer-schemas';
import {
  formatGuideList,
  formatGuideDetail,
  formatCreatedGuide,
  formatUpdatedGuide,
} from '@/lib/mcp/formatters/guides';
import type {
  GuideListItem,
  GuideDetail,
  GuideSectionDetail,
} from '@/lib/mcp/formatters/guides';

export async function registerGuideTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // list_guides
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'list_guides',
    {
      title: 'List Guides',
      description:
        'List all guides in the knowledge base with optional filtering by type, domain, and publish status. Returns a summary table with section counts. Use this to discover available guides before fetching full detail with get_guide.',
      inputSchema: {
        guide_type: z
          .enum(VALID_GUIDE_TYPES)
          .optional()
          .describe('Filter by guide type'),
        domain_filter: z
          .string()
          .optional()
          .describe('Filter by domain (exact match on domain_filter column)'),
        published_only: z
          .boolean()
          .default(true)
          .describe('Only show published guides (default: true)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Maximum guides to return (default: 50, max: 200)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        let query = supabase
          .from('guides')
          .select('id, name, slug, guide_type, domain_filter, is_published, display_order')
          .order('display_order')
          .order('name')
          .limit(args.limit);

        if (args.guide_type) {
          query = query.eq('guide_type', args.guide_type);
        }

        if (args.domain_filter) {
          query = query.eq('domain_filter', args.domain_filter);
        }

        if (args.published_only) {
          query = query.eq('is_published', true);
        }

        const guides = await sb(query, 'mcp.guides.list');

        // Parallel section count — single query with .in() to avoid N round-trips
        const guideIds = (guides as Array<{ id: string }>).map((g) => g.id);
        let sectionCountMap = new Map<string, number>();

        if (guideIds.length > 0) {
          const countResult = await tryQuery(
            supabase
              .from('guide_sections')
              .select('guide_id')
              .in('guide_id', guideIds),
            'mcp.guides.list.section_counts',
          );

          if (countResult.ok) {
            for (const row of countResult.data as Array<{ guide_id: string }>) {
              sectionCountMap.set(
                row.guide_id,
                (sectionCountMap.get(row.guide_id) ?? 0) + 1,
              );
            }
          } else {
            logBestEffortWarn(
              'mcp.guides.list.section_counts',
              'Section count query degraded — counts shown as 0',
              { error: countResult.error.message },
            );
            sectionCountMap = new Map();
          }
        }

        const guideItems: GuideListItem[] = (
          guides as Array<{
            id: string;
            name: string;
            slug: string;
            guide_type: string;
            domain_filter: string | null;
            is_published: boolean;
            display_order: number;
          }>
        ).map((g) => ({
          id: g.id,
          name: g.name,
          slug: g.slug,
          guide_type: g.guide_type,
          domain_filter: g.domain_filter,
          is_published: g.is_published,
          display_order: g.display_order,
          section_count: sectionCountMap.get(g.id) ?? 0,
        }));

        const markdown = formatGuideList(guideItems);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            count: guideItems.length,
            guides: guideItems,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to list guides: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // get_guide
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_guide',
    {
      title: 'Get Guide',
      description:
        'Retrieve a guide by its ID or slug, including all sections ordered by display_order. Provide exactly one of id or slug. Returns full guide metadata and section definitions.',
      inputSchema: {
        id: z
          .string()
          .uuid()
          .optional()
          .describe('Guide UUID — provide this or slug, not both'),
        slug: z
          .string()
          .optional()
          .describe('Guide slug — provide this or id, not both'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        // Validate: exactly one of id or slug
        if (args.id && args.slug) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Provide either id or slug, not both.',
              },
            ],
            isError: true,
          };
        }

        if (!args.id && !args.slug) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Provide either id or slug to identify the guide.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);

        let guideQuery = supabase
          .from('guides')
          .select(
            'id, name, slug, description, guide_type, domain_filter, icon, color, display_order, is_published, created_at, updated_at',
          );

        if (args.id) {
          guideQuery = guideQuery.eq('id', args.id);
        } else {
          guideQuery = guideQuery.eq('slug', args.slug!);
        }

        const guideResult = await tryQuery(
          guideQuery.single(),
          'mcp.guides.get',
        );

        if (!guideResult.ok || !guideResult.data) {
          const identifier = args.id ?? args.slug;
          return {
            content: [
              {
                type: 'text' as const,
                text: `Guide not found: ${identifier}`,
              },
            ],
            isError: true,
          };
        }

        const guide = guideResult.data;

        // Fetch sections ordered by display_order
        const sections = await sb(
          supabase
            .from('guide_sections')
            .select(
              'id, section_name, description, expected_layer, subtopic_filter, content_type_filter, display_order, is_required',
            )
            .eq('guide_id', guide.id)
            .order('display_order'),
          'mcp.guides.get.sections',
        );

        const guideDetail: GuideDetail = {
          id: guide.id,
          name: guide.name,
          slug: guide.slug,
          description: guide.description,
          guide_type: guide.guide_type,
          domain_filter: guide.domain_filter,
          icon: guide.icon,
          color: guide.color,
          display_order: guide.display_order,
          is_published: guide.is_published,
          created_at: guide.created_at,
          updated_at: guide.updated_at,
        };

        const sectionDetails: GuideSectionDetail[] = (
          sections as Array<{
            id: string;
            section_name: string;
            description: string | null;
            expected_layer: string | null;
            subtopic_filter: string | null;
            content_type_filter: string | null;
            display_order: number;
            is_required: boolean;
          }>
        ).map((s) => ({
          id: s.id,
          section_name: s.section_name,
          description: s.description,
          expected_layer: s.expected_layer,
          subtopic_filter: s.subtopic_filter,
          content_type_filter: s.content_type_filter,
          display_order: s.display_order,
          is_required: s.is_required,
        }));

        const markdown = formatGuideDetail(guideDetail, sectionDetails);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            ...guideDetail,
            sections: sectionDetails,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to retrieve guide: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // create_guide
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'create_guide',
    {
      title: 'Create Guide',
      description:
        'Create a new guide with optional sections. Guides organise knowledge base content into structured views by domain, subtopic, and content type. Requires editor or admin role. Set is_published to false (default) to create as draft. Use the kb://taxonomy resource for valid domain values.',
      inputSchema: {
        name: guideCreateSchema.shape.name.describe('Guide name'),
        slug: guideCreateSchema.shape.slug.describe('URL-safe slug (lowercase, hyphens, numbers only)'),
        description: guideCreateSchema.shape.description.describe('Guide description'),
        guide_type: guideCreateSchema.shape.guide_type.describe('Guide type: sector, product, company, research, or custom'),
        domain_filter: guideCreateSchema.shape.domain_filter.describe('Primary domain this guide covers'),
        icon: guideCreateSchema.shape.icon.describe('Icon identifier'),
        color: guideCreateSchema.shape.color.describe('Colour identifier'),
        display_order: guideCreateSchema.shape.display_order.describe('Display order (lower = first)'),
        is_published: guideCreateSchema.shape.is_published.describe('Publish immediately (default: false)'),
        sections: z
          .array(
            z.object({
              section_name: z.string().min(1).max(200).describe('Section name'),
              description: z.string().max(1000).optional().nullable().describe('Section description'),
              expected_layer: z.string().optional().nullable().describe('Valid layer key — see kb://taxonomy resource for current values'),
              subtopic_filter: z.string().optional().nullable().describe('Subtopic filter'),
              content_type_filter: z.string().optional().nullable().describe('Content type filter'),
              display_order: z.number().int().min(0).describe('Section display order'),
              is_required: z.boolean().default(true).describe('Whether the section is required'),
            }),
          )
          .optional()
          .describe('Optional sections to create with the guide'),
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

        // Validate sections BEFORE inserting the guide to avoid orphan rows
        // (H-1 fix: layer fetch / section validation must precede guide insert)
        if (args.sections && args.sections.length > 0) {
          let layerKeys: string[];
          try {
            layerKeys = await fetchActiveLayerKeys(supabase);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Unknown error';
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Layer vocabulary unavailable: ${message}. No guide was created.`,
                },
              ],
              isError: true,
            };
          }

          const sectionSchema = buildGuideSectionSchema(layerKeys);
          for (const section of args.sections) {
            const result = sectionSchema.safeParse(section);
            if (!result.success) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Section validation failed: ${result.error.issues.map((i) => i.message).join('; ')}. No guide was created.`,
                  },
                ],
                isError: true,
              };
            }
          }
        }

        const insertResult = await tryQuery(
          supabase
            .from('guides')
            .insert({
              name: args.name,
              slug: args.slug,
              description: args.description ?? null,
              guide_type: args.guide_type,
              domain_filter: args.domain_filter ?? null,
              icon: args.icon ?? null,
              color: args.color ?? null,
              display_order: args.display_order,
              is_published: args.is_published,
              created_by: userId,
            })
            .select('id, name, slug, guide_type, is_published')
            .single(),
          'mcp.guides.create',
        );

        if (!insertResult.ok) {
          // Slug collision — unique constraint on slug
          if (insertResult.error.code === '23505') {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `A guide with slug "${args.slug}" already exists. Choose a different slug.`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to create guide: ${insertResult.error.message}`,
              },
            ],
            isError: true,
          };
        }

        const guide = insertResult.data;

        // Insert sections if provided (already validated above)
        const warnings: string[] = [];
        let sectionCount = 0;

        if (args.sections && args.sections.length > 0) {
          const sectionInserts = args.sections.map((s) => ({
            guide_id: guide.id,
            section_name: s.section_name,
            description: s.description ?? null,
            expected_layer: s.expected_layer ?? null,
            subtopic_filter: s.subtopic_filter ?? null,
            content_type_filter: s.content_type_filter ?? null,
            display_order: s.display_order,
            is_required: s.is_required,
          }));

          const sectionResult = await tryQuery(
            supabase.from('guide_sections').insert(sectionInserts),
            'mcp.guides.create.sections',
          );

          if (sectionResult.ok) {
            sectionCount = args.sections.length;
          } else {
            warnings.push(
              `Section insert failed: ${sectionResult.error.message}. Guide was created but sections were not.`,
            );
          }
        }

        const result = {
          id: guide.id,
          name: guide.name,
          slug: guide.slug,
          guide_type: guide.guide_type,
          is_published: guide.is_published,
          section_count: sectionCount,
        };

        const warningNote =
          warnings.length > 0
            ? `\n\n**Warnings:**\n${warnings.map((w) => `- ${w}`).join('\n')}`
            : '';
        const markdown = formatCreatedGuide(result) + warningNote;

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            ...result,
            warnings: warnings.length > 0 ? warnings : undefined,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to create guide: ${message}. Ensure you have editor or admin permissions.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // update_guide
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'update_guide',
    {
      title: 'Update Guide',
      description:
        'Update an existing guide\'s metadata and optionally add or update sections. Sections with an id are updated; sections without an id are inserted as new. No sections are deleted. Requires editor or admin role.',
      inputSchema: {
        id: z
          .string()
          .uuid()
          .describe('The UUID of the guide to update'),
        fields: guideUpdateSchema.describe('Fields to update — only include fields you want to change'),
        sections: z
          .array(
            z.object({
              id: z
                .string()
                .uuid()
                .optional()
                .describe('Section UUID — include to update existing section, omit to insert new'),
              section_name: z.string().min(1).max(200).optional().describe('Section name'),
              description: z.string().max(1000).nullable().optional().describe('Section description'),
              expected_layer: z.string().optional().nullable().describe('Valid layer key — see kb://taxonomy resource for current values'),
              subtopic_filter: z.string().nullable().optional().describe('Subtopic filter'),
              content_type_filter: z.string().nullable().optional().describe('Content type filter'),
              display_order: z.number().int().min(0).optional().describe('Section display order'),
              is_required: z.boolean().optional().describe('Whether the section is required'),
            }),
          )
          .optional()
          .describe('Sections to add or update (id present = update, id absent = insert)'),
        reason: z
          .string()
          .optional()
          .describe('Explanation of why the update was made (audit trail)'),
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

        // Build update data from fields
        const allowedFields = [
          'name',
          'slug',
          'description',
          'guide_type',
          'domain_filter',
          'icon',
          'color',
          'display_order',
          'is_published',
        ] as const;

        const updateData: Record<string, unknown> = {};
        const updatedFields: string[] = [];

        for (const field of allowedFields) {
          if (args.fields[field] !== undefined) {
            updateData[field] = args.fields[field];
            updatedFields.push(field);
          }
        }

        // Update guide metadata if any fields provided
        if (updatedFields.length > 0) {
          const updateResult = await tryQuery(
            supabase
              .from('guides')
              .update(updateData)
              .eq('id', args.id)
              .select('id'),
            'mcp.guides.update',
          );

          if (!updateResult.ok) {
            // Slug collision on rename
            if (updateResult.error.code === '23505') {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `A guide with slug "${args.fields.slug}" already exists. Choose a different slug.`,
                  },
                ],
                isError: true,
              };
            }
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Failed to update guide: ${updateResult.error.message}`,
                },
              ],
              isError: true,
            };
          }

          // Critical: check 0-row update (Supabase PATCH returns 200 OK with 0 rows on wrong UUID)
          if (!updateResult.data || (updateResult.data as Array<{ id: string }>).length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Guide not found: ${args.id}. No update was applied.`,
                },
              ],
              isError: true,
            };
          }
        } else {
          // No field updates — verify the guide exists before processing sections
          const existResult = await tryQuery(
            supabase
              .from('guides')
              .select('id')
              .eq('id', args.id)
              .single(),
            'mcp.guides.update.exists',
          );

          if (!existResult.ok || !existResult.data) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Guide not found: ${args.id}`,
                },
              ],
              isError: true,
            };
          }
        }

        // Process sections: id present = update, id absent = insert
        const warnings: string[] = [];
        let sectionsAdded = 0;
        let sectionsUpdated = 0;

        if (args.sections && args.sections.length > 0) {
          // Validate section fields against live layer vocabulary
          let layerKeys: string[];
          try {
            layerKeys = await fetchActiveLayerKeys(supabase);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Unknown error';
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Layer vocabulary unavailable: ${message}. Guide metadata was updated but sections could not be validated.`,
                },
              ],
              isError: true,
            };
          }

          const updateSectionSchema = buildGuideSectionUpdateSchema(layerKeys);
          for (const section of args.sections) {
            const result = updateSectionSchema.safeParse(section);
            if (!result.success) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Section validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
                  },
                ],
                isError: true,
              };
            }
          }

          const toUpdate = args.sections.filter((s) => s.id);
          const toInsert = args.sections.filter((s) => !s.id);

          // Update existing sections
          for (const section of toUpdate) {
            const sectionData: Record<string, unknown> = {};
            if (section.section_name !== undefined)
              sectionData.section_name = section.section_name;
            if (section.description !== undefined)
              sectionData.description = section.description;
            if (section.expected_layer !== undefined)
              sectionData.expected_layer = section.expected_layer;
            if (section.subtopic_filter !== undefined)
              sectionData.subtopic_filter = section.subtopic_filter;
            if (section.content_type_filter !== undefined)
              sectionData.content_type_filter = section.content_type_filter;
            if (section.display_order !== undefined)
              sectionData.display_order = section.display_order;
            if (section.is_required !== undefined)
              sectionData.is_required = section.is_required;

            if (Object.keys(sectionData).length > 0) {
              const result = await tryQuery(
                supabase
                  .from('guide_sections')
                  .update(sectionData)
                  .eq('id', section.id!)
                  .eq('guide_id', args.id),
                'mcp.guides.update.section',
              );
              if (result.ok) {
                sectionsUpdated++;
              } else {
                warnings.push(
                  `Section ${section.id} update failed: ${result.error.message}`,
                );
              }
            }
          }

          // Insert new sections
          if (toInsert.length > 0) {
            const insertData = toInsert.map((s) => ({
              guide_id: args.id,
              section_name: s.section_name ?? 'Untitled section',
              description: s.description ?? null,
              expected_layer: s.expected_layer ?? null,
              subtopic_filter: s.subtopic_filter ?? null,
              content_type_filter: s.content_type_filter ?? null,
              display_order: s.display_order ?? 0,
              is_required: s.is_required ?? true,
            }));

            const insertResult = await tryQuery(
              supabase.from('guide_sections').insert(insertData),
              'mcp.guides.update.new_sections',
            );

            if (insertResult.ok) {
              sectionsAdded = toInsert.length;
            } else {
              warnings.push(
                `New section insert failed: ${insertResult.error.message}`,
              );
            }
          }
        }

        // Fetch updated guide name and slug for the response
        const updatedGuide = await sb(
          supabase
            .from('guides')
            .select('name, slug')
            .eq('id', args.id)
            .single(),
          'mcp.guides.update.refetch',
        );

        const result = {
          id: args.id,
          name: (updatedGuide as { name: string; slug: string } | null)?.name ?? args.fields.name ?? 'Unknown',
          slug: (updatedGuide as { name: string; slug: string } | null)?.slug ?? args.fields.slug ?? null,
          updated_fields: updatedFields,
          sections_added: sectionsAdded,
          sections_updated: sectionsUpdated,
          reason: args.reason ?? null,
        };

        const warningNote =
          warnings.length > 0
            ? `\n\n**Warnings:**\n${warnings.map((w) => `- ${w}`).join('\n')}`
            : '';
        const markdown = formatUpdatedGuide(result) + warningNote;

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            ...result,
            warnings: warnings.length > 0 ? warnings : undefined,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to update guide: ${message}. Ensure you have editor or admin permissions.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
