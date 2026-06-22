import { generateChangeReport } from '@/lib/ai/change-reports';
import { AIServiceError } from '@/lib/ai/errors';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import {
  ChangeReportGenerateBodySchema,
  ChangeReportGenerateResponseSchema,
} from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export const POST = defineRoute(
  ChangeReportGenerateResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const rl = checkRateLimit(`digest:${user.id}`, 5, 60_000);
      if (!rl.allowed) return rateLimitResponse(rl.resetAt);

      const raw = await request.json();
      const validated = parseBody(ChangeReportGenerateBodySchema, raw);
      if (!validated.success) return validated.response;

      const {
        period_days: periodDays,
        frequency: digestType,
        domain: filterDomain,
        keywords: filterKeywords,
        date_from: dateFrom,
        date_to: dateTo,
      } = validated.data;

      const result = await generateChangeReport({
        supabase,
        periodDays,
        digestType,
        filterDomain,
        filterKeywords,
        dateFrom,
        dateTo,
        userId: user.id,
      });

      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof AIServiceError) {
        // OPS-23: pass structured code + data straight through when present
        // (cost-guard 413 carries DIGEST_TOO_MANY_ITEMS with item_count + max).
        if (err.code) {
          return NextResponse.json(
            {
              error: safeErrorMessage(err, err.message),
              message: err.message,
              code: err.code,
              ...(err.data ?? {}),
            },
            { status: err.status },
          );
        }
        return NextResponse.json(
          { error: safeErrorMessage(err, err.message) },
          { status: err.status },
        );
      }
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to generate digest') },
        { status: 500 },
      );
    }
  },
);
