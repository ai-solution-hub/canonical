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
import type { AuthorisedResult } from '@/lib/auth';
import {
  classifyField,
  buildCatalogueRow,
  confirmAndWriteCatalogue,
  REQUIREMENT_TYPES,
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
    supabase._chain.insert.mockResolvedValueOnce({ data: null, error: null });

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
    expect(supabase._chain.insert).not.toHaveBeenCalled();
  });

  it('writes only the rows the caller confirms (per-row gate)', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.insert.mockResolvedValue({ data: null, error: null });

    const result = await confirmAndWriteCatalogue({
      supabase: supabase as never,
      rows: [makeRow(), makeRow(), makeRow()],
      // Confirm only the middle row.
      confirmRow: async (_row, index) => index === 1,
      getAuthorised: async () => authorised('editor'),
    });

    expect(result.written).toBe(1);
    expect(result.declined).toBe(2);
    expect(supabase._chain.insert).toHaveBeenCalledTimes(1);
  });

  it('records a failed insert without aborting the remaining confirmed rows', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.insert
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'duplicate key', code: '23505' },
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
