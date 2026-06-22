import { AIServiceError } from '@/lib/ai/errors';
import { generateSummary } from '@/lib/ai/summarise';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { SummaryDataSchema } from '@/lib/validation/jsonb';
import { SummaryGenerateBodySchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// Mirrors SummariseResult ({ summary_data: SummaryData }) from @/lib/ai/summarise.
const SummaryGenerateResponseSchema = z.object({
  summary_data: SummaryDataSchema,
});

export const POST = defineRoute(
  SummaryGenerateResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const rl = checkRateLimit(`summaries:${user.id}`, 10, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const raw = await request.json();
      const validated = parseBody(SummaryGenerateBodySchema, raw);
      if (!validated.success) return validated.response;

      const result = await generateSummary({
        supabase,
        itemId: validated.data.item_id,
        force: validated.data.force ?? false,
        userId: user.id,
      });

      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof AIServiceError) {
        return NextResponse.json(
          { error: safeErrorMessage(err, err.message) },
          { status: err.status },
        );
      }
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to generate summary') },
        { status: 500 },
      );
    }
  },
);
