import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { htmlToPlainText } from '@/lib/editor-utils';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { KBIntegrationBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase, role } = auth;

      const { allowed } = checkRateLimit(
        `bid-integrate:${user.id}`,
        10,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const raw = await request.json();
      const parsed = parseBody(KBIntegrationBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const { integrations, skip_dedup } = parsed.data;

      // Admin-only dedup override (spec §6 D2). Silent-ignore for non-admin.
      const skipDedup = skip_dedup === true && role === 'admin';
      const { checkExactDuplicate } = await import('@/lib/dedup/content-dedup');

      // Verify the procurement exists. Identity (name, domain hint) lives on the
      // workspace; the won-state GATE now reads the FORM, not workspaces.status.
      // ID-130 {130.11} re-anchored per-stage outcome onto form_templates and
      // stopped writing workspaces.status — reading it here was a
      // split-read-brain that blocked KB integration for ALL won procurements.
      // Post-T2: discriminator via application_types JOIN.
      const { data: bid, error: procurementError } = await supabase
        .from('workspaces')
        .select('id, name, domain_metadata, application_types!inner(key)')
        .eq('id', id)
        .eq('application_types.key', 'procurement')
        .single();

      if (procurementError || !bid) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      // Won-state gate (ID-130 {130.11}/{130.17}): the engagement is single-form
      // v1 — the terminal outcome lives on form_templates.outcome. Read the
      // workspace's form and gate KB integration on a 'won' outcome.
      const { data: form, error: formError } = await supabase
        .from('form_templates')
        .select('outcome, workflow_state')
        .eq('workspace_id', id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (formError) {
        return NextResponse.json(
          { error: 'Failed to read the procurement form outcome' },
          { status: 500 },
        );
      }

      const formOutcome = form?.outcome ?? null;
      if (formOutcome !== 'won') {
        return NextResponse.json(
          {
            error: `KB integration is only available for won procurements (current outcome: "${formOutcome ?? 'none'}")`,
            current_outcome: formOutcome,
          },
          { status: 400 },
        );
      }

      // Fetch the questions and responses for integration.
      // Post-T2: `form_questions.workspace_id` → `workspace_id`.
      const questionIds = integrations.map((i) => i.question_id);
      const { data: questions, error: questionsError } = await supabase
        .from('form_questions')
        .select('id, question_text')
        .eq('workspace_id', id)
        .in('id', questionIds);

      if (questionsError) {
        // S151 WP4 (C4): without the questions map, the integration loop
        // would write KB items with empty `question_text` — silent KB
        // pollution on the won-bid happy path. Fail loudly.
        return NextResponse.json(
          {
            error: 'Failed to fetch bid questions for integration',
            details: questionsError.message,
          },
          { status: 500 },
        );
      }

      const questionMap = new Map(
        (questions ?? []).map((q) => [q.id, q.question_text]),
      );

      // `id` is carried through for UC5-style lineage (source_form_response_id)
      // on the draft q_a_pair insert below.
      const { data: responses, error: responsesError } = await supabase
        .from('form_responses')
        .select('id, question_id, response_text')
        .in('question_id', questionIds);

      if (responsesError) {
        // S151 WP4 (C4): same risk as the questions branch — without the
        // responses map, KB writes would have empty bodies.
        return NextResponse.json(
          {
            error: 'Failed to fetch bid responses for integration',
            details: responsesError.message,
          },
          { status: 500 },
        );
      }

      const responseMap = new Map(
        (responses ?? []).map((r) => [
          r.question_id,
          { id: r.id, response_text: r.response_text },
        ]),
      );

      // Process each integration. ID-131 {131.28} Part 2 (HYBRID RETIRE): the
      // only surviving non-skip action is `new_entry` for `q_a_pair` — it
      // writes a DRAFT `q_a_pairs` row (UC5 promote-path write shape), never
      // `content_items`. `update_existing` is retired (no rebuild path).
      const items: Array<{
        question_id: string;
        q_a_pair_id: string;
        action: 'created' | 'skipped';
      }> = [];

      let created = 0;
      // update_existing is retired (no rebuild path) — updated stays 0 but is
      // kept in the response shape for API-contract stability with the
      // existing frontend (kb-integration-review.tsx reads result.updated).
      const updated = 0;
      let skipped = 0;
      const warnings: string[] = [];

      for (const integration of integrations) {
        if (integration.action === 'skip') {
          skipped++;
          items.push({
            question_id: integration.question_id,
            q_a_pair_id: '',
            action: 'skipped',
          });
          continue;
        }

        const questionText = questionMap.get(integration.question_id) ?? '';
        const response = responseMap.get(integration.question_id);
        const responseText = response?.response_text ?? '';
        const plainText = htmlToPlainText(responseText ?? '');

        if (!plainText) {
          skipped++;
          items.push({
            question_id: integration.question_id,
            q_a_pair_id: '',
            action: 'skipped',
          });
          continue;
        }

        // Only remaining non-skip action is 'new_entry' (schema enforces
        // this — 'update_existing' is retired).
        // Dedup — spec §6 D1 variant for bid-outcome: exact-hash match
        // is skip-and-log (not stamp). Procurement-outcome is a post-won admin
        // workflow where duplicate content is almost certainly the
        // response already present in the KB. Skipping prevents double
        // entry; admin can review the log. Admins may `skip_dedup=true`
        // to force-insert anyway.
        if (!skipDedup) {
          try {
            const dedupCheck = await checkExactDuplicate(supabase, plainText);
            if (dedupCheck.isDuplicate) {
              skipped++;
              warnings.push(
                `Skipped bid integration for question ${integration.question_id} — response matches existing KB item ${dedupCheck.existingId}${dedupCheck.existingTitle ? ` ("${dedupCheck.existingTitle}")` : ''}`,
              );
              items.push({
                question_id: integration.question_id,
                q_a_pair_id: dedupCheck.existingId ?? '',
                action: 'skipped',
              });
              continue;
            }
          } catch (dedupErr) {
            logger.error(
              { err: dedupErr },
              `Procurement-outcome dedup check failed for question ${integration.question_id}`,
            );
            // Non-fatal — proceed with insert as clean
          }
        }

        // ID-131 {131.28} Part 2 (HYBRID RETIRE, OQ oq-66a0c5410864622b):
        // re-pointed onto the UC5 promote-path write shape
        // (app/api/q-a-pairs/promote/route.ts) — a review-before-publish
        // DRAFT with lineage, never a `content_items` row. Per DR-025/DR-026
        // (sources are evidence; authority earned at promotion) there is NO
        // embedding generated at insert — `question_embedding` populates
        // later via the standard question-match recompute path.
        const { data: newPair, error: insertError } = await supabase
          .from('q_a_pairs')
          .insert({
            question_text: questionText,
            answer_standard: responseText,
            origin_kind: 'derived_from_form_response',
            publication_status: 'draft',
            source_form_response_id: response?.id ?? null,
            source_question_id: integration.question_id,
            source_workspace_id: id,
          })
          .select('id')
          .single();

        if (insertError) {
          logger.error(
            { err: insertError },
            `Failed to create KB entry for question ${integration.question_id}`,
          );
          skipped++;
          items.push({
            question_id: integration.question_id,
            q_a_pair_id: '',
            action: 'skipped',
          });
          continue;
        }

        created++;
        items.push({
          question_id: integration.question_id,
          q_a_pair_id: newPair?.id ?? '',
          action: 'created',
        });
      }

      return NextResponse.json({
        created,
        updated,
        skipped,
        items,
        warnings,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to integrate responses to KB') },
        { status: 500 },
      );
    }
  },
);
