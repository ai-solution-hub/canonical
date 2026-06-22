/**
 * Path C — catalogue-from-instance behaviour tests (ID-52.14).
 *
 * Covers the two load-bearing invariants:
 * - Inv-21: the catalogue is authored through a human-confirmed step — no row
 *   is written unless the caller confirms it.
 * - Inv-24: the write step is gated to admin/editor; a viewer-role caller is
 *   refused with the standard authorisation-failure routing and NO row is
 *   written.
 *
 * Plus the Inv-22 read shape and Inv-23 (no workspace_id) on the produced row,
 * and the classify step parsing behaviour. Anthropic is mocked at the SDK
 * boundary; Supabase via the shared `createMockSupabaseClient()` helper, per
 * `docs/reference/test-philosophy.md` (behaviour-not-implementation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AuthorisedResult } from '@/lib/auth/client';
import {
  classifyField,
  buildCatalogueRow,
  confirmAndWriteCatalogue,
  resolveRequirementEmbedding,
  REQUIREMENT_TYPES,
  DEFAULT_TEMPLATE_VERSION,
  type FormTemplateField,
  type FieldClassification,
  type CatalogueRowInsert,
} from '@/lib/catalogue/from-instance';
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
  overrides: Partial<FormTemplateField> = {},
): FormTemplateField {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    template_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
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

function makeRow(
  overrides: Partial<CatalogueRowInsert> = {},
): CatalogueRowInsert {
  return buildCatalogueRow({
    field: makeField(),
    classification: makeClassification(),
    embedding: null,
    templateName: 'Acme ITT 2026',
    templateType: 'itt',
    ...overrides,
  });
}

/** Mock Anthropic that returns a single text block with the given payload. */
function makeAnthropic(textPayload: string): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: textPayload, citations: null }],
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

// ── Inv-24: auth gate ───────────────────────────────────────────────────────

describe('confirmAndWriteCatalogue — auth gate (Inv-24)', () => {
  it('refuses the write step for a viewer-role caller and writes no rows', async () => {
    const supabase = createMockSupabaseClient();
    const confirmRow = vi.fn().mockResolvedValue(true);

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeRow()],
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
      rows: [makeRow()],
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
    supabase._chain.upsert.mockResolvedValueOnce({ data: null, error: null });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeRow()],
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
      rows: [makeRow(), makeRow()],
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
    supabase._chain.upsert.mockResolvedValue({ data: null, error: null });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeRow(), makeRow(), makeRow()],
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
    supabase._chain.upsert
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: 'permission denied for table form_template_requirements',
          code: '42501',
        },
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeRow(), makeRow()],
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
    const row = buildCatalogueRow({
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

    expect(row.requirement_type).toBe('evidence');
    expect(row.matching_keywords).toEqual(['insurance', 'public liability']);
    expect(row.matching_guidance).toBe('Match against insurance certificates.');
    expect(row.is_mandatory).toBe(true);
    expect(row.section_name).toBe('Insurance');
    expect(row.template_type).toBe('itt');
  });

  it('serialises the embedding via JSON.stringify for the Supabase vector param', () => {
    const row = buildCatalogueRow({
      field: makeField(),
      classification: makeClassification(),
      embedding: [0.1, 0.2, 0.3],
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
    });

    expect(row.requirement_embedding).toBe(JSON.stringify([0.1, 0.2, 0.3]));
  });

  it('never carries a workspace_id (the catalogue is global)', () => {
    const row = makeRow();
    expect('workspace_id' in row).toBe(false);
  });
});

// ── ID-52.22: idempotent re-run — natural-key UPSERT + version sentinel ──────

describe('confirmAndWriteCatalogue — idempotent re-run (ID-52.22)', () => {
  it('writes via UPSERT on the natural key so a re-catalogue run is a no-op, not a duplicate-key failure', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.upsert.mockResolvedValue({ data: null, error: null });
    const rows = [makeRow(), makeRow()];

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows,
      confirmRow: async () => true,
      getAuthorised: async () => authorised('admin'),
    });

    expect(result.written).toBe(2);
    expect(result.failed).toBe(0);
    // The write verb is upsert — a re-run over identical rows UPDATEs in
    // place (zero net new rows) instead of raising 23505 on the constraint.
    expect(supabase._chain.insert).not.toHaveBeenCalled();
    expect(supabase._chain.upsert).toHaveBeenCalledTimes(2);
    // Conflict target = the four natural-key columns of the live
    // form_template_requirements_unique_section constraint, exactly.
    expect(supabase._chain.upsert).toHaveBeenCalledWith(rows[0], {
      onConflict: 'template_name,template_version,section_ref,question_number',
      ignoreDuplicates: false,
    });
  });
});

describe('buildCatalogueRow — non-NULL template_version sentinel (ID-52.22)', () => {
  it('defaults template_version to the sentinel so the natural key has no NULL member', () => {
    const row = makeRow();
    expect(row.template_version).toBe(DEFAULT_TEMPLATE_VERSION);
    expect(row.template_version).toBe('v1');
  });

  it('never emits a NULL template_version, even when explicitly passed null', () => {
    const row = buildCatalogueRow({
      field: makeField(),
      classification: makeClassification(),
      embedding: null,
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
      templateVersion: null,
    });
    expect(row.template_version).toBe('v1');
    expect(typeof row.template_version).toBe('string');
    expect(row.template_version).not.toHaveLength(0);
  });

  it('honours an explicit template version override', () => {
    const row = buildCatalogueRow({
      field: makeField(),
      classification: makeClassification(),
      embedding: null,
      templateName: 'Acme ITT 2026',
      templateType: 'itt',
      templateVersion: '2026-rev-a',
    });
    expect(row.template_version).toBe('2026-rev-a');
  });
});

describe('resolveRequirementEmbedding — recompute on text change only (ID-52.22)', () => {
  const STORED_EMBEDDING = [0.1, 0.2, 0.3];

  /** Stub the natural-key pre-read to return one existing catalogue row. */
  function stubExistingRow(
    supabase: ReturnType<typeof createMockSupabaseClient>,
    existing: {
      requirement_text: string;
      requirement_embedding: string | null;
    },
  ) {
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: existing,
      error: null,
    });
  }

  it('reuses the stored embedding when the requirement text is unchanged (no embed call)', async () => {
    const supabase = createMockSupabaseClient();
    const field = makeField();
    stubExistingRow(supabase, {
      requirement_text: field.question_text ?? '',
      requirement_embedding: JSON.stringify(STORED_EMBEDDING),
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
  });

  it('recomputes the embedding when the requirement text changed', async () => {
    const supabase = createMockSupabaseClient();
    const field = makeField();
    stubExistingRow(supabase, {
      requirement_text: 'An earlier wording of this question.',
      requirement_embedding: JSON.stringify(STORED_EMBEDDING),
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
      requirement_embedding: null,
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

  it('an unchanged-text re-run still UPSERTs the row so other changed fields update', async () => {
    const supabase = createMockSupabaseClient();
    const field = makeField();
    stubExistingRow(supabase, {
      requirement_text: field.question_text ?? '',
      requirement_embedding: JSON.stringify(STORED_EMBEDDING),
    });
    supabase._chain.upsert.mockResolvedValueOnce({ data: null, error: null });
    const embedFn = vi.fn();

    const resolved = await resolveRequirementEmbedding({
      supabase: supabase as never,
      field,
      templateName: 'Acme ITT 2026',
      embedText: 'unchanged',
      embedFn,
    });
    const row = buildCatalogueRow({
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
      rows: [row],
      confirmRow: async () => true,
      getAuthorised: async () => authorised('editor'),
    });

    expect(embedFn).not.toHaveBeenCalled();
    expect(result.written).toBe(1);
    expect(supabase._chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        matching_guidance: 'Revised guidance from the re-run.',
        requirement_embedding: JSON.stringify(STORED_EMBEDDING),
      }),
      expect.objectContaining({
        onConflict:
          'template_name,template_version,section_ref,question_number',
      }),
    );
  });
});

// ── Classify step (Anthropic SDK boundary) ──────────────────────────────────

describe('classifyField — Anthropic classification', () => {
  it('parses a valid classification from the model response', async () => {
    const anthropic = makeAnthropic(
      JSON.stringify({
        requirement_type: 'declaration',
        matching_keywords: ['bribery', 'fraud', 'mandatory exclusion'],
        matching_guidance: 'Yes/no declaration.',
      }),
    );

    const classification = await classifyField(anthropic, makeField());

    expect(classification.requirement_type).toBe('declaration');
    expect(REQUIREMENT_TYPES).toContain(classification.requirement_type);
    expect(classification.matching_keywords).toContain('bribery');
    expect(classification.matching_guidance).toBe('Yes/no declaration.');
  });

  it('tolerates a markdown-fenced JSON response', async () => {
    const anthropic = makeAnthropic(
      '```json\n{"requirement_type":"data","matching_keywords":["VAT number"],"matching_guidance":null}\n```',
    );

    const classification = await classifyField(anthropic, makeField());

    expect(classification.requirement_type).toBe('data');
    expect(classification.matching_guidance).toBeNull();
  });

  it('rejects a response with an out-of-set requirement_type', async () => {
    const anthropic = makeAnthropic(
      JSON.stringify({
        requirement_type: 'info_only',
        matching_keywords: ['x'],
        matching_guidance: null,
      }),
    );

    await expect(classifyField(anthropic, makeField())).rejects.toThrow(
      /invalid requirement_type/,
    );
  });

  it('rejects a response with no matching keywords', async () => {
    const anthropic = makeAnthropic(
      JSON.stringify({
        requirement_type: 'data',
        matching_keywords: [],
        matching_guidance: null,
      }),
    );

    await expect(classifyField(anthropic, makeField())).rejects.toThrow(
      /empty matching_keywords/,
    );
  });
});
