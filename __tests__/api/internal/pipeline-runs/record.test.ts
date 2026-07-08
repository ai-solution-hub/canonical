/**
 * Tests for POST /api/internal/pipeline-runs/record.
 *
 * Subtask ID-28.11 — webhook callback bridge from the cocoindex Python
 * sidecar to the TS-side `recordPipelineRun()` helper per TECH.md §P-7
 * Option α (sidecar webhook callback).
 *
 * Acceptance (per testStrategy):
 *   - POST with valid `Authorization: Bearer <PIPELINE_TRIGGER_SECRET>` (or,
 *     during the ID-127.18 dual-accept rollout window, the legacy shared
 *     `CRON_SECRET`) writes a `pipeline_runs` row via `recordPipelineRun()`.
 *   - POST with a bearer matching neither secret, or with both unset,
 *     returns 401.
 *   - `stageCounts` field lands in `pipeline_runs.result` JSON.
 *
 * Auth pattern: mirrors `/api/cron/*` — bare `Authorization: Bearer <secret>`
 * check, but via the DEDICATED `verifyPipelineTriggerAuth()` (ID-127.18,
 * S436 D1 — splits the pipeline-sidecar boundary off `verifyCronAuth`'s
 * Vercel-cron-only secret). No `getAuthorisedClient()` here; the secret IS
 * the auth boundary (T-OQ2 ratified S252).
 *
 * Inv-18 discipline: this route is the ONLY path through which the cocoindex
 * sidecar lands `pipeline_runs` rows. The route MUST call
 * `recordPipelineRun()` — never a raw `supabase.from('pipeline_runs').insert`
 * (per CLAUDE.md "Cron pipeline_runs inserts" gotcha).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../../../helpers/mock-supabase';
import { createMockCronRequest } from '../../../helpers/factories/cron-request';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));

const { mockVerifyPipelineTriggerAuth } = vi.hoisted(() => ({
  mockVerifyPipelineTriggerAuth: vi.fn(),
}));

vi.mock('@/lib/cron-auth', () => ({
  verifyPipelineTriggerAuth: mockVerifyPipelineTriggerAuth,
}));

const { mockRecordPipelineRun } = vi.hoisted(() => ({
  mockRecordPipelineRun: vi.fn(),
}));

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: mockRecordPipelineRun,
}));

vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Import handler AFTER mocks (vi.mock hoist + factory function pattern)
import { POST } from '@/app/api/internal/pipeline-runs/record/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROUTE_PATH = '/api/internal/pipeline-runs/record';

/**
 * Build a valid POST payload body for the route. The cocoindex Python
 * sidecar emits this shape per TECH.md §P-7 + the ID-28.11 brief.
 */
function makePayload(
  overrides: Partial<{
    opId: string;
    pipelineName: string;
    status: 'in_progress' | 'completed' | 'completed_with_errors' | 'failed';
    itemsProcessed: number;
    itemsCreated: string[];
    stageCounts: Record<string, number>;
    errorMessage: string;
    errorClass: string;
    errorDetail: Record<string, unknown>;
    extractorVersion: string;
    retryCount: number;
    taxonomyMisses: Record<string, number>;
    itemFailures: Record<string, number>;
  }> = {},
): Record<string, unknown> {
  return {
    opId: overrides.opId ?? '11111111-1111-4111-8111-111111111111',
    pipelineName: overrides.pipelineName ?? 'kh_canonical_pipeline',
    status: overrides.status ?? 'completed',
    itemsProcessed: overrides.itemsProcessed ?? 5,
    itemsCreated: overrides.itemsCreated ?? [
      '22222222-2222-4222-8222-222222222222',
    ],
    stageCounts: overrides.stageCounts ?? {
      source_walk: 5,
      binary_conversion: 5,
      llm_extraction: 5,
      embedding: 5,
      entity_resolution: 5,
      chunking: 5,
      postgres_upsert: 5,
    },
    ...(overrides.errorMessage !== undefined
      ? { errorMessage: overrides.errorMessage }
      : {}),
    ...(overrides.errorClass !== undefined
      ? { errorClass: overrides.errorClass }
      : {}),
    ...(overrides.errorDetail !== undefined
      ? { errorDetail: overrides.errorDetail }
      : {}),
    ...(overrides.extractorVersion !== undefined
      ? { extractorVersion: overrides.extractorVersion }
      : {}),
    ...(overrides.retryCount !== undefined
      ? { retryCount: overrides.retryCount }
      : {}),
    ...(overrides.taxonomyMisses !== undefined
      ? { taxonomyMisses: overrides.taxonomyMisses }
      : {}),
    ...(overrides.itemFailures !== undefined
      ? { itemFailures: overrides.itemFailures }
      : {}),
  };
}

/**
 * Build a Request for the route. Mirrors `createMockCronRequest()` but for
 * POST with JSON body — the cron-request factory supports `method: 'POST'`
 * and `body: object` per its forward-compatible signature.
 */
function buildRequest(
  overrides: {
    secret?: string;
    body?: Record<string, unknown> | string;
    omitAuth?: boolean;
  } = {},
): Request {
  if (overrides.omitAuth) {
    // verifyPipelineTriggerAuth() checks the `authorization` header; omit it
    // entirely to exercise the missing-header branch.
    return new Request(`http://localhost:3000${ROUTE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides.body ?? makePayload()),
    });
  }
  return createMockCronRequest({
    path: ROUTE_PATH,
    method: 'POST',
    secret: overrides.secret,
    body: overrides.body ?? makePayload(),
  });
}

function resetMocks() {
  vi.clearAllMocks();
  mockVerifyPipelineTriggerAuth.mockReturnValue(true);
  mockRecordPipelineRun.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/internal/pipeline-runs/record — auth', () => {
  beforeEach(resetMocks);

  it('returns 401 when cron auth fails (wrong secret)', async () => {
    mockVerifyPipelineTriggerAuth.mockReturnValue(false);

    const res = await POST(buildRequest({ secret: 'wrong-secret' }) as never);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 401 when authorization header is missing entirely', async () => {
    mockVerifyPipelineTriggerAuth.mockReturnValue(false);

    const res = await POST(buildRequest({ omitAuth: true }) as never);
    expect(res.status).toBe(401);
  });

  it('does NOT call recordPipelineRun when auth fails', async () => {
    mockVerifyPipelineTriggerAuth.mockReturnValue(false);

    await POST(buildRequest({ secret: 'wrong-secret' }) as never);
    expect(mockRecordPipelineRun).not.toHaveBeenCalled();
  });

  it('accepts the request when cron auth succeeds', async () => {
    mockVerifyPipelineTriggerAuth.mockReturnValue(true);

    const res = await POST(buildRequest() as never);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/internal/pipeline-runs/record — body validation', () => {
  beforeEach(resetMocks);

  it('returns 400 when body is not valid JSON', async () => {
    const req = new Request(`http://localhost:3000${ROUTE_PATH}`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-cron-secret',
        'content-type': 'application/json',
      },
      body: 'not json{',
    });

    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when opId is missing', async () => {
    const payload = makePayload();
    delete payload.opId;

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when opId is not a UUID', async () => {
    const payload = makePayload({ opId: 'not-a-uuid' });

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when status is an unknown value', async () => {
    const payload = {
      ...makePayload(),
      status: 'unknown_status',
    };

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when stageCounts is missing required stage', async () => {
    const payload = makePayload({
      stageCounts: {
        // missing source_walk + others
        binary_conversion: 5,
      },
    });

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when stageCounts contains a negative count', async () => {
    const payload = makePayload({
      stageCounts: {
        source_walk: -1,
        binary_conversion: 5,
        llm_extraction: 5,
        embedding: 5,
        entity_resolution: 5,
        chunking: 5,
        postgres_upsert: 5,
      },
    });

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
  });

  it('accepts payload with all required fields present', async () => {
    const res = await POST(buildRequest() as never);
    expect(res.status).toBe(200);
    expect(mockRecordPipelineRun).toHaveBeenCalledTimes(1);
  });

  it('accepts payload with optional errorMessage + errorClass', async () => {
    const payload = makePayload({
      status: 'failed',
      errorMessage: 'Extraction failed: malformed JSON',
      errorClass: 'extraction_validation_failed',
    });

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(200);
  });

  it('accepts every member of the Inv-25 7-class error vocabulary', async () => {
    // ID-28.13: the route MUST accept every value the Python sidecar can
    // emit. The vocabulary lives in `lib/pipeline/error-classes.ts` and
    // matches the Inv-25 enumeration verbatim.
    const errorClasses = [
      'extraction_validation_failed',
      'extraction_provider_unavailable',
      'postgres_write_failed',
      'binary_conversion_failed',
      'embedding_failed',
      'entity_resolution_failed',
      'qa_dedup_proposer_failed',
    ];

    for (const errorClass of errorClasses) {
      const payload = makePayload({
        status: 'failed',
        errorMessage: 'boom',
        errorClass,
      });
      const res = await POST(buildRequest({ body: payload }) as never);
      expect(res.status, `errorClass=${errorClass} must parse`).toBe(200);
    }
  });

  it('rejects an unknown errorClass with HTTP 400 (Inv-25 7-class enum)', async () => {
    // ID-28.13: the route tightens the prior `z.string().optional()` to
    // the strict `PipelineErrorClassSchema` so the Python sidecar cannot
    // accidentally land an unmapped class string in
    // pipeline_runs.result.error_class — that would defeat operator
    // filter-by-cause queries (Inv-25 + Inv-26).
    const payload = makePayload({
      status: 'failed',
      errorMessage: 'boom',
      errorClass: 'totally_made_up_error_class',
    });
    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
    expect(mockRecordPipelineRun).not.toHaveBeenCalled();
  });

  it('rejects a pydantic-level sub-class string at the stage-level boundary', async () => {
    // ID-28.13 / Q-EX2 cross-boundary guard: pydantic-level sub-classes
    // (`invalid_enum`, `missing_required`, etc.) come from
    // `_PYDANTIC_ERROR_TO_ERROR_CLASS` in extraction.py — they live one
    // abstraction level deeper than the 7-class stage-level vocabulary.
    // The Python sidecar must surface the wrapping stage class
    // (`extraction_validation_failed`); leaking the pydantic class up
    // to the webhook would let operators filter on a vocabulary they
    // cannot trust. Guard at the trust boundary.
    const payload = makePayload({
      status: 'failed',
      errorMessage: 'pydantic-level leak',
      errorClass: 'missing_required',
    });
    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
  });

  it('accepts payload with status=in_progress (flow-start emission)', async () => {
    const payload = makePayload({
      status: 'in_progress',
      itemsProcessed: 0,
      itemsCreated: [],
    });

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(200);
  });

  it('rejects negative retryCount with HTTP 400 (Inv-23 invariant)', async () => {
    // The Zod schema enforces nonnegative integers — a negative value
    // would indicate a sidecar bug (uninitialised counter) and must
    // not silently land in `pipeline_runs.result.retry_count` where it
    // would corrupt operator dashboards.
    const payload = makePayload({ retryCount: -1 });
    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
    expect(mockRecordPipelineRun).not.toHaveBeenCalled();
  });

  it('rejects non-integer retryCount with HTTP 400', async () => {
    // Float retry counts would suggest a wrong-units bug (e.g. timing
    // value misrouted into the counter field); reject at the boundary.
    const payload = makePayload();
    (payload as Record<string, unknown>).retryCount = 1.5;
    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/internal/pipeline-runs/record — recordPipelineRun call shape', () => {
  beforeEach(resetMocks);

  it('calls recordPipelineRun with pipelineName from the body', async () => {
    await POST(buildRequest() as never);

    expect(mockRecordPipelineRun).toHaveBeenCalledTimes(1);
    const call = mockRecordPipelineRun.mock.calls[0][0];
    expect(call.pipelineName).toBe('kh_canonical_pipeline');
  });

  it('forwards opId so it lands in pipeline_runs.op_id', async () => {
    const opId = '33333333-3333-4333-8333-333333333333';
    await POST(buildRequest({ body: makePayload({ opId }) }) as never);

    const call = mockRecordPipelineRun.mock.calls[0][0];
    expect(call.opId).toBe(opId);
  });

  it('forwards status, itemsProcessed, and itemsCreated', async () => {
    const payload = makePayload({
      status: 'completed_with_errors',
      itemsProcessed: 12,
      itemsCreated: [
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555',
      ],
    });
    await POST(buildRequest({ body: payload }) as never);

    const call = mockRecordPipelineRun.mock.calls[0][0];
    expect(call.status).toBe('completed_with_errors');
    expect(call.itemsProcessed).toBe(12);
    expect(call.itemsCreated).toEqual(payload.itemsCreated);
  });

  it('lands stageCounts inside result.stage_counts JSON (Inv-17)', async () => {
    const stageCounts = {
      source_walk: 3,
      binary_conversion: 3,
      llm_extraction: 3,
      embedding: 3,
      entity_resolution: 3,
      chunking: 3,
      postgres_upsert: 3,
    };
    await POST(buildRequest({ body: makePayload({ stageCounts }) }) as never);

    const call = mockRecordPipelineRun.mock.calls[0][0];
    // stageCounts MUST land in result JSON (existing pipeline_runs.result column);
    // shape: result.stage_counts.{source_walk,binary_conversion,...}.
    expect(call.result).toBeDefined();
    const result = call.result as Record<string, unknown>;
    expect(result.stage_counts).toEqual(stageCounts);
  });

  it('lands extractorVersion inside result.extractor_version (Inv-8)', async () => {
    const sha = 'abc1234567890def1234567890abcdef12345678';
    await POST(
      buildRequest({
        body: makePayload({ extractorVersion: sha }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.extractor_version).toBe(sha);
  });

  it('lands errorClass inside result.error_class when provided', async () => {
    await POST(
      buildRequest({
        body: makePayload({
          status: 'failed',
          errorMessage: 'boom',
          errorClass: 'extraction_validation_failed',
        }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.error_class).toBe('extraction_validation_failed');
  });

  it('lands retryCount inside result.retry_count when provided (Inv-23)', async () => {
    // ID-28.13 testStrategy criterion: "transient 503-once mock retries
    // successfully (retry_count=1)". The Python sidecar reports the
    // per-flow retry count via an optional `retryCount` field on the
    // webhook payload (mirrors the existing `errorClass` /
    // `extractorVersion` optional-field pattern); the route lands it
    // inside `pipeline_runs.result.retry_count` so operator filter-
    // by-retries queries work uniformly with the rest of the result
    // envelope (Inv-17 + Inv-23).
    await POST(
      buildRequest({
        body: makePayload({
          status: 'completed',
          retryCount: 1,
        }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.retry_count).toBe(1);
  });

  it('lands retryCount=0 inside result.retry_count when supplied explicitly', async () => {
    // Zero is a meaningful value (the no-retry happy path) and MUST land
    // verbatim — distinguishable from "field not provided". Operator
    // dashboards relying on `result.retry_count IS NOT NULL` to count
    // emitted-with-retry-info runs depend on this.
    await POST(
      buildRequest({
        body: makePayload({
          status: 'completed',
          retryCount: 0,
        }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.retry_count).toBe(0);
  });

  it('omits retry_count from result when retryCount is absent (back-compat)', async () => {
    // Pre-28.13 sidecar emissions omit the field. The route MUST NOT
    // synthesise a `result.retry_count` key when the body does not carry
    // it, so the absence is distinguishable from `retry_count: 0` in the
    // landed envelope.
    await POST(buildRequest({ body: makePayload() }) as never);

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result).not.toHaveProperty('retry_count');
  });

  it('forwards errorMessage into the recordPipelineRun param', async () => {
    await POST(
      buildRequest({
        body: makePayload({
          status: 'failed',
          errorMessage: 'pipeline halted',
        }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    expect(call.errorMessage).toBe('pipeline halted');
  });

  it('passes the service-role supabase client to recordPipelineRun', async () => {
    await POST(buildRequest() as never);

    const call = mockRecordPipelineRun.mock.calls[0][0];
    expect(call.supabase).toBe(mockSupabase);
  });

  it('returns 200 OK with { ok: true } on success', async () => {
    const res = await POST(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 500 when recordPipelineRun throws unexpectedly', async () => {
    // recordPipelineRun is "never throws" by contract, but defensive guard
    // exists for completeness — if the helper's contract were violated, the
    // route MUST still respond cleanly to the Python sidecar.
    mockRecordPipelineRun.mockRejectedValueOnce(new Error('unexpected'));

    const res = await POST(buildRequest() as never);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/internal/pipeline-runs/record — errorDetail (bl-165 Option B, ID-61.4)', () => {
  beforeEach(resetMocks);

  it('lands errorDetail inside result.error_detail alongside the coarse error_class', async () => {
    // ID-61.4 acceptance: the fine classify_pydantic_error class rides the
    // payload as `errorDetail` and persists into pipeline_runs.result as
    // `result.error_detail`, WITHOUT displacing the coarse Inv-25 class in
    // `result.error_class`.
    await POST(
      buildRequest({
        body: makePayload({
          status: 'failed',
          errorMessage: 'extraction validation failed',
          errorClass: 'extraction_validation_failed',
          errorDetail: { pydantic_class: 'missing_required', stage: 'flow' },
        }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.error_detail).toEqual({
      pydantic_class: 'missing_required',
      stage: 'flow',
    });
    expect(result.error_class).toBe('extraction_validation_failed');
  });

  it('accepts every member of the pydantic fine vocabulary', async () => {
    // Vocabulary source (grounded): the codomain of
    // `_PYDANTIC_ERROR_TO_ERROR_CLASS` in
    // scripts/cocoindex_pipeline/extraction.py (classify_pydantic_error).
    // The route MUST accept every value the function can actually return —
    // a 400 on the terminal failed-run webhook would lose the entire
    // pipeline_runs row.
    const fineClasses = [
      'missing_required',
      'invalid_enum',
      'invalid_discriminator',
      'unexpected_field',
      'type_coercion',
    ];

    for (const pydanticClass of fineClasses) {
      const payload = makePayload({
        status: 'failed',
        errorClass: 'extraction_validation_failed',
        errorDetail: { pydantic_class: pydanticClass, stage: 'flow' },
      });
      const res = await POST(buildRequest({ body: payload }) as never);
      expect(res.status, `pydantic_class=${pydanticClass} must parse`).toBe(
        200,
      );
    }
  });

  it('rejects an unknown pydantic_class value with HTTP 400', async () => {
    // The fine vocabulary is strict at the trust boundary — a drifting
    // sidecar fails loudly with a 4xx rather than silently landing an
    // unmapped class string in pipeline_runs.result.error_detail.
    const payload = makePayload({
      status: 'failed',
      errorClass: 'extraction_validation_failed',
      errorDetail: { pydantic_class: 'totally_made_up_class', stage: 'flow' },
    });

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
    expect(mockRecordPipelineRun).not.toHaveBeenCalled();
  });

  it('rejects errorDetail missing the stage key with HTTP 400', async () => {
    const payload = makePayload({
      status: 'failed',
      errorDetail: { pydantic_class: 'missing_required' },
    });

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
  });

  it('omits error_detail from result when errorDetail is absent (no undefined leakage)', async () => {
    // Back-compat + no-silent-failure bar: the composed result must not
    // synthesise an `error_detail: undefined` key when the sidecar does
    // not send the field.
    await POST(buildRequest({ body: makePayload() }) as never);

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result).not.toHaveProperty('error_detail');
  });
});

describe('POST /api/internal/pipeline-runs/record — taxonomyMisses (ID-63.8 Inv-7 rider)', () => {
  beforeEach(resetMocks);

  it('lands taxonomyMisses inside result.taxonomy_misses', async () => {
    // flow.py emits `payload["taxonomyMisses"]` (per-field tally of
    // out-of-taxonomy soft-warns, `_FlowTaxonomyMissCounter.tally_by_field()`
    // → dict[str, int]). Before ID-61.4 the strict BodySchema silently
    // stripped the key — the live ID-63.8 Inv-7 regression this fixes.
    await POST(
      buildRequest({
        body: makePayload({
          taxonomyMisses: { primary_domain: 2, primary_subtopic: 1 },
        }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.taxonomy_misses).toEqual({
      primary_domain: 2,
      primary_subtopic: 1,
    });
  });

  it('lands an empty taxonomyMisses map verbatim (zero misses is meaningful)', async () => {
    // ID-63.8 Inv-7 semantics: an empty dict at flow-end means
    // "extractions ran, zero misses" — distinguishable from the field
    // being omitted (flow-start emission, no extraction yet).
    await POST(
      buildRequest({ body: makePayload({ taxonomyMisses: {} }) }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.taxonomy_misses).toEqual({});
  });

  it('rejects negative miss counts with HTTP 400', async () => {
    const payload = makePayload({ taxonomyMisses: { primary_domain: -1 } });

    const res = await POST(buildRequest({ body: payload }) as never);
    expect(res.status).toBe(400);
  });

  it('omits taxonomy_misses from result when taxonomyMisses is absent (no undefined leakage)', async () => {
    await POST(buildRequest({ body: makePayload() }) as never);

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result).not.toHaveProperty('taxonomy_misses');
  });
});

describe('POST /api/internal/pipeline-runs/record — itemFailures (80.2 §B.4 OQ-80.2-C, ID-80.9)', () => {
  beforeEach(resetMocks);

  it('lands itemFailures inside result.item_failures on a completed run', async () => {
    // OQ-80.2-C (RATIFIED): per-item form failures ride a COMPLETED run as
    // an item_failures tally — 'failed' is reserved for walk-wide faults.
    // The bl-224 cascade inversion: a form-branch fault never zeroes a
    // content file's reported writes.
    await POST(
      buildRequest({
        body: makePayload({
          status: 'completed',
          itemFailures: { forms: 1, content: 0 },
        }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.item_failures).toEqual({ forms: 1, content: 0 });
    expect(call.status).toBe('completed');
  });

  it('persists itemFailures additively alongside errorDetail and taxonomyMisses without 400', async () => {
    // Coordinate, don't clobber: ID-61.4 extended this same payload surface
    // (errorDetail + taxonomyMisses); itemFailures composes additively.
    const res = await POST(
      buildRequest({
        body: makePayload({
          status: 'failed',
          errorClass: 'extraction_validation_failed',
          errorDetail: { pydantic_class: 'missing_required', stage: 'flow' },
          taxonomyMisses: { primary_domain: 2 },
          itemFailures: { forms: 1, content: 2 },
        }),
      }) as never,
    );
    expect(res.status).toBe(200);

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.item_failures).toEqual({ forms: 1, content: 2 });
    expect(result.error_detail).toEqual({
      pydantic_class: 'missing_required',
      stage: 'flow',
    });
    expect(result.taxonomy_misses).toEqual({ primary_domain: 2 });
    expect(result.error_class).toBe('extraction_validation_failed');
  });

  it('lands an all-zero tally verbatim (clean walk is meaningful)', async () => {
    // The sidecar always threads the tally at flow end; {forms: 0,
    // content: 0} means "walk ran, zero per-item faults" — distinguishable
    // from the field being omitted entirely (flow-start emission).
    await POST(
      buildRequest({
        body: makePayload({ itemFailures: { forms: 0, content: 0 } }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.item_failures).toEqual({ forms: 0, content: 0 });
  });

  it('persists a three-key tally {forms, content, url} verbatim (ID-80.17, {75.11} url branch)', async () => {
    // {75.11} (Stage-1b URL-source mount) added a third branch to the
    // sidecar counter — init {'forms': 0, 'content': 0, 'url': 0},
    // incremented by bound_ingest_url. The BodySchema must admit the
    // 'url' key or Zod strips it at parse and the persisted
    // result.item_failures silently loses the url tally ({80.16} delta).
    await POST(
      buildRequest({
        body: makePayload({
          itemFailures: { forms: 1, content: 0, url: 2 },
        }),
      }) as never,
    );

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result.item_failures).toEqual({ forms: 1, content: 0, url: 2 });
  });

  it('rejects a negative url branch count with HTTP 400', async () => {
    // The url key, when present, is validated like its siblings — not
    // merely passed through.
    const res = await POST(
      buildRequest({
        body: makePayload({
          itemFailures: { forms: 0, content: 0, url: -1 },
        }),
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockRecordPipelineRun).not.toHaveBeenCalled();
  });

  it('rejects a negative branch count with HTTP 400', async () => {
    const res = await POST(
      buildRequest({
        body: makePayload({ itemFailures: { forms: -1, content: 0 } }),
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockRecordPipelineRun).not.toHaveBeenCalled();
  });

  it('rejects a non-integer branch count with HTTP 400', async () => {
    const res = await POST(
      buildRequest({
        body: makePayload({ itemFailures: { forms: 1.5, content: 0 } }),
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it('rejects itemFailures missing the content key with HTTP 400', async () => {
    // forms and content are required when the field is present; url is
    // optional ({80.17} back-compat — pre-75.11 sidecars emit two-key payloads
    // during the deploy window; post-75.11 the counter emits {forms, content, url}).
    const res = await POST(
      buildRequest({
        body: makePayload({ itemFailures: { forms: 1 } }),
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it('omits item_failures from result when itemFailures is absent (no undefined leakage)', async () => {
    // Back-compat: pre-80.9 sidecars (and flow-start emissions) omit the
    // field; the composed result must not synthesise item_failures.
    await POST(buildRequest({ body: makePayload() }) as never);

    const call = mockRecordPipelineRun.mock.calls[0][0];
    const result = call.result as Record<string, unknown>;
    expect(result).not.toHaveProperty('item_failures');
  });
});
