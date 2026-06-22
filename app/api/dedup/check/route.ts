import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkForDuplicates } from '@/lib/dedup/content-dedup';
import { safeErrorMessage } from '@/lib/error';
import { z } from 'zod';
import { parseBody } from '@/lib/validation';
import { logger } from '@/lib/logger';

export const maxDuration = 15;

/**
 * Request body schema for the dedup check endpoint.
 *
 * Accepts the text to check and an optional pre-computed embedding.
 * The embedding is an array of numbers (vector) — if omitted, only
 * exact-match dedup is performed (no near-duplicate semantic search).
 */
const DedupCheckBodySchema = z.object({
  text: z.string().min(1, 'Text is required').max(50000, 'Text too long'),
  embedding: z.array(z.number()).optional(),
});

/**
 * POST /api/dedup/check — Check text for duplicates against the KB.
 *
 * Wraps `checkForDuplicates` from `lib/dedup.ts` for client-side
 * per-pair dedup checking in the Q&A preview flow.
 *
 * Auth: editor or admin role required (same as item creation).
 * Rate limit: 30 requests per minute per user (allows batch checking
 * of Q&A pairs with some headroom).
 */
export async function POST(request: NextRequest) {
  try {
    // Auth + role check — editors and admins only
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Rate limit: 30 requests per minute (allows checking ~30 Q&A pairs)
    const { allowed } = checkRateLimit(`dedup:check:${user.id}`, 30, 60 * 1000);
    if (!allowed) return rateLimitResponse();

    // Parse and validate request body
    const raw = await request.json();
    const parsed = parseBody(DedupCheckBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { text, embedding } = parsed.data;

    // Run dedup check
    const result = await checkForDuplicates(supabase, text, embedding);

    return NextResponse.json({
      isDuplicate: result.has_duplicates,
      matches: result.matches.map((m) => ({
        id: m.id,
        title: m.title,
        similarity: m.similarity,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Dedup check failed');
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Dedup check failed') },
      { status: 500 },
    );
  }
}
