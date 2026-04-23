import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { DigestGenerateBodySchema } from '@/lib/validation/schemas';
import { generateDigest } from '@/lib/ai/digest';
import { AIServiceError } from '@/lib/ai/errors';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const rl = checkRateLimit(`digest:${user.id}`, 5, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const validated = parseBody(DigestGenerateBodySchema, raw);
    if (!validated.success) return validated.response;

    const {
      period_days: periodDays,
      digest_type: digestType,
      domain: filterDomain,
      keywords: filterKeywords,
      date_from: dateFrom,
      date_to: dateTo,
    } = validated.data;

    const result = await generateDigest({
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
      // OPS-23: structured 413 body for the cost guard
      if (err.status === 413) {
        try {
          const parsed = JSON.parse(err.message);
          if (parsed.code === 'DIGEST_TOO_MANY_ITEMS') {
            return NextResponse.json(parsed, { status: 413 });
          }
        } catch {
          // Not JSON — fall through to generic path
        }
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
}
