import { verifyPipelineTriggerAuth } from '@/lib/cron-auth';
import {
  extractDOCXQuestions,
  extractPDFQuestions,
  extractXLSXQuestions,
} from '@/lib/domains/procurement/ai/extract-questions';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * POST /api/internal/procurement/extract-questions — Plane-1 (questions)
 * extraction bridge for the analyse_form worker lane (ID-145 {145.13}, BI-20;
 * TECH.md §3.1).
 *
 * WHY THIS ROUTE EXISTS: TECH.md §3.1 names the Plane-1 mechanism as "the
 * live Claude path" already built by {145.12}
 * (`lib/domains/procurement/ai/extract-questions.ts`,
 * `extractPDFQuestions`/`extractDOCXQuestions`/`extractXLSXQuestions`) —
 * reused here, NOT reimplemented in Python. The `analyse_form` job is
 * consumed by `scripts/bid_worker.py`, a Python background worker with no
 * browser session — `[id]/questions/extract/route.ts` ({145.12}'s own route)
 * is gated by `getAuthorisedClient()` cookie-session auth, which a
 * background worker cannot satisfy. Rather than touching that
 * already-landed, session-gated, user-facing route (out of this Subtask's
 * file-ownership boundary) or duplicating the Claude prompt/tool-schema in
 * Python (reintroducing exactly the "two homes for one fact" pattern ID-145
 * exists to eliminate — TECH.md §1.1), this route is a NEW, narrowly-scoped,
 * STATELESS bridge: given format + base64 content, run the SAME {145.12}
 * extraction functions and return the raw result. It performs NO DB access
 * and NO auth/role lookup — the worker (`scripts/bid_worker.py`) re-validates
 * the enqueuing user's role against `user_roles` itself (per
 * `lib/queue/envelope.ts`'s documented auth_context contract) and owns the
 * `form_questions` dedup + INSERT using its own service-role Supabase client,
 * exactly as it already does for `form_instance_fields` /
 * `template_completions`.
 *
 * Auth: `Authorization: Bearer <PIPELINE_TRIGGER_SECRET>` — the SAME
 * pipeline<->app boundary secret the cocoindex sidecar already uses for
 * `/api/internal/pipeline-runs/record` (ID-127.18, S436 D1;
 * `verifyPipelineTriggerAuth`, `lib/cron-auth.ts`, imported unmodified).
 * `bid_worker.py` lands inside the SAME built pipeline image
 * (`scripts/**`, per `.github/workflows/onprem-deploy.yml`) as the cocoindex
 * sidecar, so `PIPELINE_TRIGGER_SECRET` + `NEXT_PUBLIC_APP_URL` are already
 * present in its Coolify env when deployed per this Subtask's compose entry
 * — no new secret plumbing.
 *
 * Security posture: this route can only RUN an LLM extraction over
 * caller-supplied bytes and return the result — it cannot read, write, or
 * enumerate any KH data. Worst-case blast radius of a leaked secret is
 * Anthropic-token burn, the same posture already accepted for the
 * `EXTRACT_API_TOKEN`-gated `/extract` pure-cleaner route on the pipeline
 * image (see `deploy/coolify/docker-compose.platform.yaml`).
 */
export const maxDuration = 120;

/** Mirrors the pipeline image's own `/extract` route body cap convention
 * (`deploy/coolify/docker-compose.platform.yaml` — "self-enforces a 20 MB
 * per-route body cap"). Base64 inflates ~33%, so this caps the DECODED
 * artefact at roughly the same real-bytes ceiling as the 50 MB upload cap
 * (`app/api/procurement/upload/route.ts`) plus base64 overhead headroom.
 */
const MAX_CONTENT_BASE64_CHARS = 70_000_000;

const BodySchema = z.object({
  format: z.enum(['pdf', 'docx', 'xlsx']),
  content_base64: z.string().min(1).max(MAX_CONTENT_BASE64_CHARS),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyPipelineTriggerAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    logger.warn(
      { err },
      'internal.procurement.extract-questions: malformed JSON body',
    );
    return NextResponse.json(
      { error: 'invalid_json', details: safeErrorMessage(err, 'invalid JSON') },
      { status: 400 },
    );
  }

  const parsed = parseBody(BodySchema, rawBody);
  if (!parsed.success) return parsed.response;

  const { format, content_base64: contentBase64 } = parsed.data;

  try {
    if (format === 'pdf') {
      const result = await extractPDFQuestions(contentBase64);
      return NextResponse.json(result);
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    const result =
      format === 'docx'
        ? await extractDOCXQuestions(buffer)
        : await extractXLSXQuestions(buffer);
    return NextResponse.json(result);
  } catch (err) {
    logger.error(
      { err, format },
      'internal.procurement.extract-questions: extraction failed',
    );
    return NextResponse.json(
      {
        error: safeErrorMessage(err, 'Failed to extract questions'),
      },
      { status: 500 },
    );
  }
}
