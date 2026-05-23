/**
 * Fixture: with-schema-in-baseline — Source A inference happy path.
 *
 * The route's response interface name (`ReviewStatsResponse`) is present in
 * `docs/generated/type-drift-baseline.json` (one of the 37 R-WP17
 * fetcher-only entries). When Subtask 32.8 lands, its `inferSchema()` will
 * look up `ReviewStatsResponseSchema` (or `ReviewStatsResponseZodSchema`) in
 * `lib/validation/schemas.ts` via name-convention and inject that identifier
 * as the `ResponseSchema` argument.
 *
 * Modelled on `app/api/review/stats/route.ts` — a real AUTH_PLAIN route whose
 * interface IS in the baseline. The fixture declares a co-located synthetic
 * `ReviewStatsResponseSchema` constant (not exported from
 * `lib/validation/schemas.ts` today — Subtask 32.8 will source the real one)
 * to model the Source-A lookup target without coupling 32.7 to the actual
 * schema registry.
 *
 * For the 32.7 classifier harness this fixture is just an AUTH_PLAIN route —
 * the Source A inference contract is owned by Subtask 32.8.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';

// Synthetic schema constant mirroring the Source-A name-convention lookup
// target (`${interfaceName}Schema`). Subtask 32.8 will resolve the real
// schema export from `lib/validation/schemas.ts`; the fixture's local copy
// is provided so the fixture compiles standalone.
const ReviewStatsResponseSchema = z.object({
  total: z.number(),
  verified: z.number(),
  flagged: z.number(),
  unverified: z.number(),
});

type ReviewStatsResponse = z.infer<typeof ReviewStatsResponseSchema>;

export async function GET(_request: NextRequest) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  // Runtime parse exercises the synthetic schema so it has both a runtime
  // value position and a type position — Source A's lookup target uses the
  // const identifier, not just the inferred type.
  const payload: ReviewStatsResponse = ReviewStatsResponseSchema.parse({
    total: 0,
    verified: 0,
    flagged: 0,
    unverified: 0,
  });
  return NextResponse.json(payload);
}
