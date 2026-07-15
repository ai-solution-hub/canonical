/**
 * MCP tool registrations for the R7 question_matches reader (1 tool):
 *   get_question_matches
 *
 * ID-145 {145.17} — BI-36: a new form-scoped Claude-facing reader tool over
 * `question_match_search` (id-57/T10) returning a question's ranked
 * corpus-match candidates. Kept in its own file — DISJOINT from
 * lib/mcp/tools/procurement.ts, which {145.21} owns for the MCP re-key pass
 * (TECH.md §4 "MCP reader (BI-36)").
 *
 * Form-scoped, never workspace-scoped: the sole input is the form question's
 * own id (`form_questions.id`, the RPC's `p_form_question_id`) — the RPC has
 * no workspace concept and `question_matches` never had a workspace column.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient } from '@/lib/mcp/auth';
import { sb } from '@/lib/supabase/safe';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  READ_ONLY_ANNOTATIONS,
} from './shared';

/** Shape returned by `question_match_search` — stored per-method scores, no live re-scoring. */
interface QuestionMatchRow {
  q_a_pair_id: string;
  question_text_preview: string;
  answer_standard_preview: string;
  embedding_score: number | null;
  fulltext_score: number | null;
  scope_tag: string[] | null;
  publication_status: string;
}

const DEFAULT_LIMIT = 20;

function formatQuestionMatches(
  questionId: string,
  matches: QuestionMatchRow[],
): string {
  if (matches.length === 0) {
    return (
      `No corpus matches found for question ${questionId}. ` +
      'The question may not have been recomputed yet, or no eligible Q&A pairs overlap its scope.'
    );
  }

  const lines = [`## Corpus matches for question ${questionId}`, ''];
  for (const m of matches) {
    const embeddingScore =
      m.embedding_score !== null ? m.embedding_score.toFixed(2) : 'n/a';
    const fulltextScore =
      m.fulltext_score !== null ? m.fulltext_score.toFixed(2) : 'n/a';
    lines.push(
      `- **${m.question_text_preview}** (embedding: ${embeddingScore}, fulltext: ${fulltextScore})`,
      `  ${m.answer_standard_preview}`,
      `  scope: ${(m.scope_tag ?? []).join(', ') || 'none'} | q_a_pair_id: ${m.q_a_pair_id}`,
    );
  }
  return lines.join('\n');
}

export async function registerQuestionMatchTools(
  server: McpServer,
): Promise<void> {
  // -------------------------------------------------------------------------
  // get_question_matches
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_question_matches',
    {
      title: 'Get Question Matches',
      description:
        "Get the ranked Q&A-corpus candidate matches for a procurement form question, via the question_match_search RPC (id-57/T10). Form-scoped — takes the question's own id, never a workspace id. Call this after the question has been created or updated (which recomputes its matches) to see the current candidate set for drafting a response.",
      inputSchema: {
        question_id: z
          .string()
          .uuid()
          .describe('The UUID of the form question (form_questions.id)'),
        question_kind: z
          .string()
          .optional()
          .describe(
            'Optional form_types.key filter — restricts results to matches materialised under this question_kind (default: no filter)',
          ),
        limit: z
          .number()
          .optional()
          .describe('Maximum number of matches to return (default: 20)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);

        const matches = await sb<QuestionMatchRow[]>(
          supabase.rpc('question_match_search', {
            p_form_question_id: args.question_id,
            p_question_kind: args.question_kind,
            p_limit: args.limit ?? DEFAULT_LIMIT,
          }),
          'mcp.question_matches.search',
        );

        const markdown = formatQuestionMatches(args.question_id, matches ?? []);

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            question_id: args.question_id,
            count: matches?.length ?? 0,
            matches: matches ?? [],
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get question matches: ${message}. Check the question id is a valid UUID.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
