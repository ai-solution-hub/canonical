/**
 * Path C — catalogue-from-instance behaviour tests (ID-52.14; {130.24} DR-036;
 * {145.16} POST-W1 rename).
 *
 * Covers the two load-bearing invariants:
 * - Inv-21: the catalogue is authored through a human-confirmed step — no row
 *   is written unless the caller confirms it.
 * - Inv-24: the write step is gated to admin/editor; a viewer-role caller is
 *   refused with the standard authorisation-failure routing and NO row is
 *   written.
 *
 * Plus the Inv-22 read shape and Inv-23 (no workspace_id) on the produced row,
 * the classify step parsing behaviour, the read step against
 * `form_instance_fields` ({145.16} W1c — renamed from `form_template_fields`,
 * `template_id` -> `form_instance_id`), and ({130.24} DR-036) the embedding
 * dual-write into the polymorphic `record_embeddings` store — the
 * `requirement_embedding` column was dropped from `form_requirement_templates`
 * ({145.16} W1c — renamed from `form_template_requirements`, pure rename) in
 * favour of `record_embeddings(owner_kind='form_template_requirement')`,
 * mirroring the company_profile EMB-STORE precedent. Anthropic is mocked at
 * the SDK boundary; Supabase via the shared `createMockSupabaseClient()`
 * helper, per `docs/reference/test-philosophy.md`
 * (behaviour-not-implementation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AuthorisedResult } from '@/lib/auth/client';
import {
  readInstanceFields,
  classifyField,
  buildCatalogueRow,
  confirmAndWriteCatalogue,
  resolveRequirementEmbedding,
  REQUIREMENT_TYPES,
  DEFAULT_TEMPLATE_VERSION,
  type FormInstanceField,
  type FieldClassification,
  type CatalogueCandidate,
} from '@/lib/domains/procurement/form-templating/catalogue/from-instance';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

// Logger is a side-channel; silence it so tests assert on behaviour, not logs.
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: loggerMocks }));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Factory functions (test-philosophy §1 criterion 6) ──────────────────────

function makeField(
  overrides: Partial<FormInstanceField> = {},
): FormInstanceField {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    form_instance_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sequence: 1,
    field_type: 'text',
    question_text:
      'Please provide your annual turnover for the last two years.',
    section_name: 'Economic and Financial Standing',
    is_mandatory: true,
    word_limit: null,
    col_index: null,
    created_at: null,
    fill_error: null,
    fill_status: 'pending',
    mapping_confidence: null,
    mapping_status: 'pending',
    placeholder_text: null,
    question_id: null,
    reference_urls: null,
    row_index: null,
    table_index: null,
    geometry: null,
    updated_at: null,
    ...overrides,
  };
}

function makeClassification(
  overrides: Partial<FieldClassification> = {},
): FieldClassification {
  return {
    requirement_type: 'data',
    matching_keywords: ['annual turnover', 'revenue', 'financial performance'],
    matching_guidance: null,
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<Parameters<typeof buildCatalogueRow>[0]> = {},
): CatalogueCandidate {
  return buildCatalogueRow({
    field: makeField(),
    classification: makeClassification(),
    embedding: null,
    templateName: 'Acme ITT 2026',
    templateType: 'itt',
    ...overrides,
  });
}

/**
 * Mock Anthropic that returns a single `tool_use` block for the
 * `classify_field` tool with the given (already-structured) input. ID-154:
 * `classifyField` forces this tool via `tool_choice` instead of parsing raw
 * text, so the mock response shape is a tool_use block, not text.
 */
function makeAnthropic(input: unknown): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'toolu_test',
            name: 'classify_field',
            input,
          },
        ],
      }),
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}

function authorised(role: 'admin' | 'editor'): AuthorisedResult {
  return {
    success: true,
    role,
    user: { id: 'user-1' } as never,
    supabase: {} as never,
  };
}

// ── readInstanceFields — read-only instance-field fetch ({145.16} W1c) ──────

describe('readInstanceFields — reads form_instance_fields ({145.16})', () => {
  it('queries form_instance_fields filtered by form_instance_id, ordered by sequence', async () => {
    const supabase = createMockSupabaseClient();
    const rows = [makeField({ sequence: 1 }), makeField({ sequence: 2 })];
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: rows, error: null, count: 2 }),
    );

    const result = await readInstanceFields(
      supabase as never,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(rows);
    }
    expect(supabase.from).toHaveBeenCalledWith('form_instance_fields');
    expect(supabase._chain.eq).toHaveBeenCalledWith(
      'form_instance_id',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    expect(supabase._chain.order).toHaveBeenCalledWith('sequence', {
      ascending: true,
    });
  });

  it('returns a Result error (not a throw) when the read fails', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'relation does not exist', code: '42P01' },
          count: null,
        }),
    );

    const result = await readInstanceFields(supabase as never, 'some-id');

    expect(result.ok).toBe(false);
  });
});

// ── Inv-24: auth gate ───────────────────────────────────────────────────────

describe('confirmAndWriteCatalogue — auth gate (Inv-24)', () => {
  it('refuses the write step for a viewer-role caller and writes no rows', async () => {
    const supabase = createMockSupabaseClient();
    const confirmRow = vi.fn().mockResolvedValue(true);

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeCandidate()],
      confirmRow,
      // Viewer is not in ['admin','editor'] → forbidden.
      getAuthorised: async () => ({ success: false, reason: 'forbidden' }),
    });

    expect(result.refused).toBe(true);
    expect(result.refusalReason).toBe('forbidden');
    expect(result.refusalStatus).toBe(403);
    expect(result.written).toBe(0);
    // The confirmation prompt is never reached once the gate refuses.
    expect(confirmRow).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('refuses the write step for an unauthenticated caller (401)', async () => {
    const supabase = createMockSupabaseClient();

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeCandidate()],
      confirmRow: vi.fn().mockResolvedValue(true),
      getAuthorised: async () => ({
        success: false,
        reason: 'unauthenticated',
      }),
    });

    expect(result.refused).toBe(true);
    expect(result.refusalStatus).toBe(401);
    expect(result.written).toBe(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('allows the write step for an authorised editor', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      error: null,
    });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeCandidate()],
      confirmRow: vi.fn().mockResolvedValue(true),
      getAuthorised: async () => authorised('editor'),
    });

    expect(result.refused).toBe(false);
    expect(result.written).toBe(1);
  });
});

// ── Inv-21: human-confirmation gate ─────────────────────────────────────────

describe('confirmAndWriteCatalogue — confirmation gate (Inv-21)', () => {
  it('writes no rows when the caller declines confirmation', async () => {
    const supabase = createMockSupabaseClient();

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeCandidate(), makeCandidate()],
      confirmRow: async () => false, // human declines every row
      getAuthorised: async () => authorised('admin'),
    });

    expect(result.written).toBe(0);
    expect(result.declined).toBe(2);
    expect(supabase._chain.upsert).not.toHaveBeenCalled();
    expect(supabase._chain.insert).not.toHaveBeenCalled();
  });

  it('writes only the rows the caller confirms (per-row gate)', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.single.mockResolvedValue({
      data: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      error: null,
    });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeCandidate(), makeCandidate(), makeCandidate()],
      // Confirm only the middle row.
      confirmRow: async (_row, index) => index === 1,
      getAuthorised: async () => authorised('editor'),
    });

    expect(result.written).toBe(1);
    expect(result.declined).toBe(2);
    expect(supabase._chain.upsert).toHaveBeenCalledTimes(1);
  });

  it('records a failed write without aborting the remaining confirmed rows', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.single
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: 'permission denied for table form_requirement_templates',
          code: '42501',
        },
      })
      .mockResolvedValueOnce({
        data: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
        error: null,
      });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeCandidate(), makeCandidate()],
      confirmRow: async () => true,
      getAuthorised: async () => authorised('admin'),
    });

    expect(result.written).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

// ── Inv-22 / Inv-23: produced row shape ─────────────────────────────────────

describe('buildCatalogueRow — read shape (Inv-22) and global scope (Inv-23)', () => {
  it('carries the matching fields T10 reads', () => {
    const candidate = buildCatalogueRow({
      field: makeField({ is_mandatory: true, section_name: 'Insurance' }),
      classification: makeClassification({
        requirement_type: 'evidence',
        matching_keywords: ['insurance', 'public liability'],
        matching_guidance: 'Match against insurance certificates.',
      }),
      embedding: [0.1, 0.2, 0.3],
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
    });

    expect(candidate.row.requirement_type).toBe('evidence');
    expect(candidate.row.matching_keywords).toEqual([
      'insurance',
      'public liability',
    ]);
    expect(candidate.row.matching_guidance).toBe(
      'Match against insurance certificates.',
    );
    expect(candidate.row.is_mandatory).toBe(true);
    expect(candidate.row.section_name).toBe('Insurance');
    expect(candidate.row.template_type).toBe('itt');
  });

  it('carries the embedding alongside the row rather than inline on it ({130.24} DR-036)', () => {
    const candidate = buildCatalogueRow({
      field: makeField(),
      classification: makeClassification(),
      embedding: [0.1, 0.2, 0.3],
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
    });

    expect(candidate.embedding).toEqual([0.1, 0.2, 0.3]);
    // The row itself carries no requirement_embedding — the column was
    // dropped in favour of the record_embeddings dual-write.
    expect('requirement_embedding' in candidate.row).toBe(false);
  });

  it('never carries a workspace_id (the catalogue is global)', () => {
    const candidate = makeCandidate();
    expect('workspace_id' in candidate.row).toBe(false);
  });
});

// ── ID-52.22: idempotent re-run — natural-key UPSERT + version sentinel ──────

describe('confirmAndWriteCatalogue — idempotent re-run (ID-52.22)', () => {
  it('writes via UPSERT on the natural key so a re-catalogue run is a no-op, not a duplicate-key failure', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.single.mockResolvedValue({
      data: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      error: null,
    });
    const candidates = [makeCandidate(), makeCandidate()];

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: candidates,
      confirmRow: async () => true,
      getAuthorised: async () => authorised('admin'),
    });

    expect(result.written).toBe(2);
    expect(result.failed).toBe(0);
    // {145.16} W1c — the write targets the renamed form_requirement_templates
    // table (was form_template_requirements).
    expect(supabase.from).toHaveBeenCalledWith('form_requirement_templates');
    // The write verb is upsert — a re-run over identical rows UPDATEs in
    // place (zero net new rows) instead of raising 23505 on the constraint.
    expect(supabase._chain.insert).not.toHaveBeenCalled();
    // Both candidates default embedding: null, so no record_embeddings write
    // — exactly one upsert per row.
    expect(supabase._chain.upsert).toHaveBeenCalledTimes(2);
    // Conflict target = the four natural-key columns of the live
    // form_template_requirements_unique_section constraint, exactly.
    expect(supabase._chain.upsert).toHaveBeenCalledWith(candidates[0].row, {
      onConflict: 'template_name,template_version,section_ref,question_number',
      ignoreDuplicates: false,
    });
  });
});

describe('buildCatalogueRow — non-NULL template_version sentinel (ID-52.22)', () => {
  it('defaults template_version to the sentinel so the natural key has no NULL member', () => {
    const candidate = makeCandidate();
    expect(candidate.row.template_version).toBe(DEFAULT_TEMPLATE_VERSION);
    expect(candidate.row.template_version).toBe('v1');
  });

  it('never emits a NULL template_version, even when explicitly passed null', () => {
    const candidate = buildCatalogueRow({
      field: makeField(),
      classification: makeClassification(),
      embedding: null,
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
      templateVersion: null,
    });
    expect(candidate.row.template_version).toBe('v1');
    expect(typeof candidate.row.template_version).toBe('string');
    expect(candidate.row.template_version).not.toHaveLength(0);
  });

  it('honours an explicit template version override', () => {
    const candidate = buildCatalogueRow({
      field: makeField(),
      classification: makeClassification(),
      embedding: null,
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
      templateVersion: '2026-rev-a',
    });
    expect(candidate.row.template_version).toBe('2026-rev-a');
  });
});

describe('resolveRequirementEmbedding — recompute on text change only (ID-52.22; {130.24} DR-036)', () => {
  const STORED_EMBEDDING = [0.1, 0.2, 0.3];
  const EXISTING_ROW_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  /**
   * Stub the two-step pre-read ({130.24} DR-036 — the vector no longer lives
   * inline on form_requirement_templates, {145.16} W1c-renamed from
   * form_template_requirements): (1) the natural-key lookup on
   * form_requirement_templates resolving `{id, requirement_text}`, then (2)
   * — only reached when the text matches — the record_embeddings lookup by
   * `(owner_kind, owner_id, model)` resolving the stored embedding (or a
   * null row when there is none).
   */
  function stubExistingRow(
    supabase: ReturnType<typeof createMockSupabaseClient>,
    existing: {
      requirement_text: string;
      storedEmbedding: string | null;
    },
  ) {
    supabase._chain.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: EXISTING_ROW_ID,
          requirement_text: existing.requirement_text,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: existing.storedEmbedding
          ? { embedding: existing.storedEmbedding }
          : null,
        error: null,
      });
  }

  it('reuses the stored embedding when the requirement text is unchanged (no embed call)', async () => {
    const supabase = createMockSupabaseClient();
    const field = makeField();
    stubExistingRow(supabase, {
      requirement_text: field.question_text ?? '',
      storedEmbedding: JSON.stringify(STORED_EMBEDDING),
    });
    const embedFn = vi.fn().mockResolvedValue([9, 9, 9]);

    const resolved = await resolveRequirementEmbedding({
      supabase: supabase as never,
      field,
      templateName: 'Acme ITT 2026',
      embedText: 'irrelevant — must not be embedded',
      embedFn,
    });

    expect(embedFn).not.toHaveBeenCalled();
    expect(resolved.reused).toBe(true);
    expect(resolved.embedding).toEqual(STORED_EMBEDDING);
    expect(supabase.from).toHaveBeenCalledWith('record_embeddings');
    expect(supabase._chain.eq).toHaveBeenCalledWith(
      'owner_kind',
      'form_template_requirement',
    );
    expect(supabase._chain.eq).toHaveBeenCalledWith(
      'owner_id',
      EXISTING_ROW_ID,
    );
  });

  it('recomputes the embedding when the requirement text changed', async () => {
    const supabase = createMockSupabaseClient();
    const field = makeField();
    stubExistingRow(supabase, {
      requirement_text: 'An earlier wording of this question.',
      storedEmbedding: JSON.stringify(STORED_EMBEDDING),
    });
    const embedFn = vi.fn().mockResolvedValue([0.4, 0.5, 0.6]);

    const resolved = await resolveRequirementEmbedding({
      supabase: supabase as never,
      field,
      templateName: 'Acme ITT 2026',
      embedText: 'revised question text\n\nKeywords: turnover',
      embedFn,
    });

    expect(embedFn).toHaveBeenCalledTimes(1);
    expect(embedFn).toHaveBeenCalledWith(
      'revised question text\n\nKeywords: turnover',
    );
    expect(resolved.reused).toBe(false);
    expect(resolved.embedding).toEqual([0.4, 0.5, 0.6]);
  });

  it('computes the embedding when no catalogue row exists for the natural key', async () => {
    const supabase = createMockSupabaseClient();
    // Default mock maybeSingle resolves { data: null } — no existing row.
    const embedFn = vi.fn().mockResolvedValue([0.7, 0.8, 0.9]);

    const resolved = await resolveRequirementEmbedding({
      supabase: supabase as never,
      field: makeField(),
      templateName: 'Acme ITT 2026',
      embedText: 'first-time catalogue text',
      embedFn,
    });

    expect(embedFn).toHaveBeenCalledTimes(1);
    expect(resolved.reused).toBe(false);
    expect(resolved.embedding).toEqual([0.7, 0.8, 0.9]);
  });

  it('recomputes when the existing row has no usable stored embedding', async () => {
    const supabase = createMockSupabaseClient();
    const field = makeField();
    stubExistingRow(supabase, {
      requirement_text: field.question_text ?? '',
      storedEmbedding: null,
    });
    const embedFn = vi.fn().mockResolvedValue([1, 2, 3]);

    const resolved = await resolveRequirementEmbedding({
      supabase: supabase as never,
      field,
      templateName: 'Acme ITT 2026',
      embedText: 'text',
      embedFn,
    });

    expect(embedFn).toHaveBeenCalledTimes(1);
    expect(resolved.reused).toBe(false);
  });

  it('an unchanged-text re-run still UPSERTs the row so other changed fields update, and re-writes the reused embedding to record_embeddings', async () => {
    const supabase = createMockSupabaseClient();
    const field = makeField();
    stubExistingRow(supabase, {
      requirement_text: field.question_text ?? '',
      storedEmbedding: JSON.stringify(STORED_EMBEDDING),
    });
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: EXISTING_ROW_ID },
      error: null,
    });
    const embedFn = vi.fn();

    const resolved = await resolveRequirementEmbedding({
      supabase: supabase as never,
      field,
      templateName: 'Acme ITT 2026',
      embedText: 'unchanged',
      embedFn,
    });
    const candidate = buildCatalogueRow({
      field,
      classification: makeClassification({
        matching_guidance: 'Revised guidance from the re-run.',
      }),
      embedding: resolved.embedding,
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
    });
    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [candidate],
      confirmRow: async () => true,
      getAuthorised: async () => authorised('editor'),
    });

    expect(embedFn).not.toHaveBeenCalled();
    expect(result.written).toBe(1);
    expect(supabase._chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        matching_guidance: 'Revised guidance from the re-run.',
      }),
      expect.objectContaining({
        onConflict:
          'template_name,template_version,section_ref,question_number',
      }),
    );
    // The reused vector is dual-written into record_embeddings, keyed by the
    // upserted row's id and JSON-serialised ({130.24} DR-036).
    expect(supabase._chain.upsert).toHaveBeenCalledWith(
      {
        owner_kind: 'form_template_requirement',
        owner_id: EXISTING_ROW_ID,
        model: 'text-embedding-3-large',
        embedding: JSON.stringify(STORED_EMBEDDING),
      },
      { onConflict: 'owner_kind,owner_id,model' },
    );
  });
});

// ── {130.24} DR-036: record_embeddings dual-write ────────────────────────────

describe('confirmAndWriteCatalogue — record_embeddings dual-write ({130.24} DR-036)', () => {
  it('dual-writes a non-null embedding into record_embeddings keyed by the upserted row id', async () => {
    const supabase = createMockSupabaseClient();
    const rowId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: rowId },
      error: null,
    });

    const candidate = buildCatalogueRow({
      field: makeField(),
      classification: makeClassification(),
      embedding: [0.1, 0.2, 0.3],
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
    });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [candidate],
      confirmRow: async () => true,
      getAuthorised: async () => authorised('editor'),
    });

    expect(result.written).toBe(1);
    expect(supabase.from).toHaveBeenCalledWith('record_embeddings');
    expect(supabase._chain.upsert).toHaveBeenCalledWith(
      {
        owner_kind: 'form_template_requirement',
        owner_id: rowId,
        model: 'text-embedding-3-large',
        embedding: JSON.stringify([0.1, 0.2, 0.3]),
      },
      { onConflict: 'owner_kind,owner_id,model' },
    );
  });

  it('skips the record_embeddings write when the candidate has no embedding', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      error: null,
    });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeCandidate()], // default embedding: null
      confirmRow: async () => true,
      getAuthorised: async () => authorised('editor'),
    });

    expect(result.written).toBe(1);
    expect(supabase.from).not.toHaveBeenCalledWith('record_embeddings');
  });

  it('records a dual-write failure without marking the row itself failed', async () => {
    const supabase = createMockSupabaseClient();
    const rowId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: rowId },
      error: null,
    });
    // The row-upsert path terminates on `.single()` (mocked above); the
    // record_embeddings upsert is awaited directly via the chain's implicit
    // `then` — override its NEXT (and only, in this test) invocation to fail.
    supabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: {
            message: 'permission denied for table record_embeddings',
            code: '42501',
          },
          count: null,
        }),
    );

    const candidate = buildCatalogueRow({
      field: makeField(),
      classification: makeClassification(),
      embedding: [0.1, 0.2, 0.3],
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
    });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [candidate],
      confirmRow: async () => true,
      getAuthorised: async () => authorised('editor'),
    });

    expect(result.written).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.embeddingWriteFailures).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

// ── Classify step (Anthropic SDK boundary) ──────────────────────────────────

describe('classifyField — Anthropic classification (ID-154: strict tool_use)', () => {
  it('parses a valid classification from the model response', async () => {
    const anthropic = makeAnthropic({
      requirement_type: 'declaration',
      matching_keywords: ['bribery', 'fraud', 'mandatory exclusion'],
      matching_guidance: 'Yes/no declaration.',
    });

    const classification = await classifyField(anthropic, makeField());

    expect(classification.requirement_type).toBe('declaration');
    expect(REQUIREMENT_TYPES).toContain(classification.requirement_type);
    expect(classification.matching_keywords).toContain('bribery');
    expect(classification.matching_guidance).toBe('Yes/no declaration.');
  });

  it('forces a strict classify_field tool call instead of raw-JSON text parsing', async () => {
    const anthropic = makeAnthropic({
      requirement_type: 'data',
      matching_keywords: ['VAT number'],
      matching_guidance: null,
    });

    await classifyField(anthropic, makeField());

    const createMock = anthropic.messages.create as unknown as ReturnType<
      typeof vi.fn
    >;
    const call = createMock.mock.calls[0][0];
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0].name).toBe('classify_field');
    expect(call.tools[0].strict).toBe(true);
    expect(call.tool_choice).toEqual({
      type: 'tool',
      name: 'classify_field',
    });
  });

  it('expresses matching_guidance nullability via anyOf, not an array-valued type (strict-mode-supported subset)', async () => {
    const anthropic = makeAnthropic({
      requirement_type: 'data',
      matching_keywords: ['VAT number'],
      matching_guidance: null,
    });

    await classifyField(anthropic, makeField());

    const createMock = anthropic.messages.create as unknown as ReturnType<
      typeof vi.fn
    >;
    const call = createMock.mock.calls[0][0];
    const guidanceSchema = call.tools[0].input_schema.properties
      .matching_guidance as Record<string, unknown>;

    // Array-valued `type` is NOT in Anthropic's supported strict-mode JSON
    // Schema subset — asserting its absence guards against regressing back
    // to the (undefined-behaviour-under-strict-mode) shape.
    expect(guidanceSchema).not.toHaveProperty('type');
    expect(guidanceSchema.anyOf).toEqual([
      { type: 'string' },
      { type: 'null' },
    ]);
  });

  it('rejects a response with an out-of-set requirement_type', async () => {
    const anthropic = makeAnthropic({
      requirement_type: 'info_only',
      matching_keywords: ['x'],
      matching_guidance: null,
    });

    await expect(classifyField(anthropic, makeField())).rejects.toThrow(
      /invalid requirement_type/,
    );
  });

  it('rejects a response with no matching keywords', async () => {
    const anthropic = makeAnthropic({
      requirement_type: 'data',
      matching_keywords: [],
      matching_guidance: null,
    });

    await expect(classifyField(anthropic, makeField())).rejects.toThrow(
      /empty matching_keywords/,
    );
  });

  it('throws when the response contains no classify_field tool_use block', async () => {
    const anthropic: Pick<Anthropic, 'messages'> = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'I will not classify this.' }],
        }),
      },
    } as unknown as Pick<Anthropic, 'messages'>;

    await expect(classifyField(anthropic, makeField())).rejects.toThrow(
      /no tool_use/i,
    );
  });
});
