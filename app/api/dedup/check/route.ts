import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { checkForDuplicates } from '@/lib/dedup/content-dedup';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

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

const DedupCheckResponseSchema = z.object({
  isDuplicate: z.boolean(),
  matches: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      similarity: z.number(),
    }),
  ),
});

export const POST = defineRoute(
  DedupCheckResponseSchema,
  async (request: NextRequest) => {
    try {
      // Auth + role check — editors and admins only
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      // Rate limit: 30 requests per minute (allows checking ~30 Q&A pairs)
      const { allowed } = checkRateLimit(
        `dedup:check:${user.id}`,
        30,
        60 * 1000,
      );
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
  },
);
