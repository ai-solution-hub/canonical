/**
 * Template tool registrations (3 tools):
 *  27. list_templates
 *  28. get_template_coverage
 *  29. get_template_gaps
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient } from '@/lib/mcp/auth';
import {
  formatTemplateList,
  formatTemplateCoverage,
  formatTemplateGaps,
  truncateResponse,
} from '@/lib/mcp/formatters';
import type {
  TemplateCoverageData,
  TemplateListData,
  TemplateGapsData,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  READ_ONLY_ANNOTATIONS,
} from './shared';

export async function registerTemplateTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 27. list_templates (Read tool — all roles)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'list_templates',
    {
      title: 'List Templates',
      description:
        'List available bid template definitions with requirement counts. Use to see which templates can be checked for coverage. Templates include Standard Selection Questionnaire, G-Cloud applications, and other procurement templates.',
      inputSchema: {
        template_type: z
          .string()
          .optional()
          .describe(
            'Filter by template type: sq, rfp, eqq, gcloud, method_statement, dos, dps, framework, other',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { listAvailableTemplates } =
          await import('@/lib/templates/template-coverage');
        const templates = await listAvailableTemplates(
          supabase,
          args.template_type,
        );

        const result: TemplateListData = {
          templates: templates.map((t) => ({
            template_name: t.template_name,
            template_version: t.template_version,
            template_type: t.template_type,
            requirement_count: t.requirement_count,
            is_current: t.is_current,
          })),
        };

        const markdown = formatTemplateList(result);
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
              text: `Failed to list templates: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 28. get_template_coverage (Read tool — all roles)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_template_coverage',
    {
      title: 'Template Coverage',
      description:
        'Check how well the knowledge base covers a specific bid template. Returns per-section coverage status (strong/partial/gap) and an overall completeness score. Use to understand readiness for a specific template type. Use list_templates first to see available templates.',
      inputSchema: {
        template_name: z
          .string()
          .describe(
            'The template name (e.g. "Standard Selection Questionnaire")',
          ),
        template_version: z
          .string()
          .optional()
          .describe(
            'Specific version (e.g. "PPN 03/24"). Defaults to current version.',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const {
          fetchTemplateRequirements,
          fetchContentForMatching,
          computeTemplateCoverage,
        } = await import('@/lib/templates/template-coverage');

        const requirements = await fetchTemplateRequirements(
          supabase,
          args.template_name,
          args.template_version,
        );

        if (requirements.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No requirements found for template "${args.template_name}"${args.template_version ? ` version ${args.template_version}` : ''}. Use list_templates to see available templates.`,
              },
            ],
            isError: true,
          };
        }

        const contentItems = await fetchContentForMatching(supabase);

        const coverage = computeTemplateCoverage(
          args.template_name,
          args.template_version ?? requirements[0].template_version,
          requirements[0].template_type,
          requirements,
          contentItems,
        );

        const result: TemplateCoverageData = coverage;
        const markdown = truncateResponse(formatTemplateCoverage(result));
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
              text: `Template coverage query failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 29. get_template_gaps (Read tool — all roles)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_template_gaps',
    {
      title: 'Template Gaps',
      description:
        'Show only the gaps and partial matches for a template — requirements where the knowledge base is missing or has insufficient content. Use this when planning what content to create next.',
      inputSchema: {
        template_name: z
          .string()
          .describe(
            'The template name (e.g. "Standard Selection Questionnaire")',
          ),
        template_version: z
          .string()
          .optional()
          .describe('Specific version. Defaults to current version.'),
        include_partial: z
          .boolean()
          .optional()
          .describe('Include partial matches alongside gaps (default: true)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const {
          fetchTemplateRequirements,
          fetchContentForMatching,
          computeTemplateCoverage,
        } = await import('@/lib/templates/template-coverage');

        const requirements = await fetchTemplateRequirements(
          supabase,
          args.template_name,
          args.template_version,
        );

        if (requirements.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No requirements found for template "${args.template_name}"${args.template_version ? ` version ${args.template_version}` : ''}. Use list_templates to see available templates.`,
              },
            ],
            isError: true,
          };
        }

        const contentItems = await fetchContentForMatching(supabase);
        const includePartial = args.include_partial ?? true;

        const coverage = computeTemplateCoverage(
          args.template_name,
          args.template_version ?? requirements[0].template_version,
          requirements[0].template_type,
          requirements,
          contentItems,
        );

        // Flatten all requirements, filter to gaps (and optionally partial)
        const allReqs = coverage.sections.flatMap((s) => s.requirements);
        const gapReqs = allReqs.filter(
          (r) =>
            r.coverage_status === 'gap' ||
            (includePartial && r.coverage_status === 'partial'),
        );

        const gapCount = allReqs.filter(
          (r) => r.coverage_status === 'gap',
        ).length;
        const partialCount = includePartial
          ? allReqs.filter((r) => r.coverage_status === 'partial').length
          : 0;

        const result: TemplateGapsData = {
          template_name: coverage.template_name,
          template_version: coverage.template_version,
          template_type: coverage.template_type,
          total_requirements: coverage.total_requirements,
          gap_count: gapCount,
          partial_count: partialCount,
          gaps: gapReqs,
        };

        const markdown = truncateResponse(formatTemplateGaps(result));
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
              text: `Template gaps query failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
