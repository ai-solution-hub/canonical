/**
 * Fixture: with-baseline-but-no-schema-constant — Source A inference fall-back.
 *
 * The route's response interface name (`PipelineRunRow`) is present in
 * repo-root `.type-drift-baseline.json` (one of the 37 R-WP17
 * fetcher-only entries), but `lib/validation/schemas.ts` does NOT export a
 * matching `${interfaceName}Schema` or `${interfaceName}ZodSchema` constant.
 * This exercises the fall-back branch of `inferSchema()`: return
 * `z.unknown()` placeholder with a `NEEDS_SCHEMA` reason code so the
 * `codemod-needs-manual.json` emitter (Subtask 32.12) can surface the route
 * for manual schema authorship.
 *
 * Counterpart to `with-schema-in-baseline.ts` (happy path). Both fixtures
 * classify as `AUTH_PLAIN` for the 32.7 classifier harness — the Source A
 * inference contract is owned by Subtask 32.8 alone.
 *
 * Modelled on `app/api/pipeline-runs/route.ts` — a real AUTH_PLAIN route
 * whose interface IS in the baseline but whose response shape has no
 * co-located Zod schema constant. Per TECH §3.A trade-off, Zod schema
 * naming conventions are not enforced — the fall-back path is the expected
 * outcome for a subset of baseline interfaces.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';

// PipelineRunRow is declared elsewhere (lib/query/fetchers.ts per the
// baseline) and has NO co-located Schema constant. The fixture deliberately
// omits any local Schema definition to model the fall-back lookup target.
type PipelineRunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
};

export async function GET(_request: NextRequest) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  // No runtime parse — the handler returns the response payload directly.
  // Source A's lookup target (`${interfaceName}Schema`) is absent from
  // `lib/validation/schemas.ts`, so `inferSchema()` falls back to
  // `z.unknown()` + NEEDS_SCHEMA reason.
  const payload: PipelineRunRow[] = [];
  return NextResponse.json(payload);
}
