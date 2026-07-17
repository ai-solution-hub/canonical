/**
 * Requirement-catalogue query-glue tests (ID-147 {147.16} — TECH §7/§H1,
 * PRODUCT §H1/§H3; ID-145 BI-24/BI-47).
 *
 * `fetchRequirementTemplates` is covered directly against the shared
 * Supabase mock (`__tests__/helpers/mock-supabase.ts`), independent of any
 * React/QueryClient scaffolding — mirrors the
 * `__tests__/lib/query/promotion-candidates-fetcher.test.ts` convention.
 *
 * `saveRequirementTemplate` is covered via a stubbed `fetch` — ID-147
 * {147.16} fix-mode remediation (Checker FAIL) re-pointed writes at the
 * admin/editor-gated `app/api/procurement/requirement-catalogue/route.ts`
 * (see the source module doc), so these tests now assert the fetch/route
 * contract (method, path, body) rather than a direct Supabase client chain
 * — mirrors `__tests__/components/question-answer-editor.test.tsx`'s
 * `mockFetchJson` pattern for `lib/query/procurement-question-answer-slot.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockSupabaseTable } from '@/__tests__/helpers/mock-supabase';

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mockCreateClient,
}));

import {
  fetchRequirementTemplates,
  saveRequirementTemplate,
  requirementCatalogueKeys,
  REQUIREMENT_TYPES,
  type RequirementTemplateRow,
} from '@/lib/query/requirement-catalogue';

function makeRow(
  overrides: Partial<RequirementTemplateRow> = {},
): RequirementTemplateRow {
  const base: Record<string, unknown> = {
    id: 'a0000000-0000-4000-8000-000000000001',
    template_name: 'Standard PSQ',
    template_version: 'v1',
    template_type: 'PSQ',
    section_ref: '3.2',
    section_name: 'Health and Safety',
    question_number: 4,
    requirement_text: 'Describe your H&S policy.',
    description: null,
    requirement_type: 'policy',
    primary_domain: 'Health & Safety',
    primary_subtopic: 'Policy',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['safety', 'RIDDOR'],
    matching_guidance: 'Match on policy documents',
    is_mandatory: true,
    is_current: true,
    sector_applicability: ['construction'],
    word_limit_guidance: 250,
    display_order: 0,
    created_at: '2026-07-01T08:00:00Z',
    updated_at: '2026-07-01T08:00:00Z',
    ...overrides,
  };
  return base as RequirementTemplateRow;
}

/** Stubs `fetch` with a single resolved JSON response. */
function mockFetchJson(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requirementCatalogueKeys', () => {
  it('is a local namespace, disjoint from the shared query-keys registry', () => {
    expect(requirementCatalogueKeys.all).toEqual([
      'requirement-catalogue-templates',
    ]);
    expect(requirementCatalogueKeys.list).toEqual([
      'requirement-catalogue-templates',
      'list',
    ]);
  });
});

describe('REQUIREMENT_TYPES', () => {
  it('matches the form_template_requirements_requirement_type_check CHECK constraint', () => {
    expect(REQUIREMENT_TYPES).toEqual([
      'policy',
      'statement',
      'evidence',
      'data',
      'narrative',
      'declaration',
      'reference',
    ]);
  });
});

describe('fetchRequirementTemplates', () => {
  it('reads form_requirement_templates ordered by template_name then display_order', async () => {
    const rows = [makeRow()];
    const table = createMockSupabaseTable({ data: rows, error: null });
    mockCreateClient.mockReturnValue(table);

    const result = await fetchRequirementTemplates();

    expect(table.from).toHaveBeenCalledWith('form_requirement_templates');
    expect(table._chain.select).toHaveBeenCalledWith('*');
    expect(table._chain.order).toHaveBeenCalledWith('template_name', {
      ascending: true,
    });
    expect(table._chain.order).toHaveBeenCalledWith('display_order', {
      ascending: true,
    });
    expect(result).toEqual(rows);
  });

  it('returns an empty array when the table has no rows', async () => {
    const table = createMockSupabaseTable({ data: null, error: null });
    mockCreateClient.mockReturnValue(table);

    const result = await fetchRequirementTemplates();

    expect(result).toEqual([]);
  });

  it('throws when the read errors', async () => {
    const table = createMockSupabaseTable({
      data: null,
      error: new Error('read boom'),
    });
    mockCreateClient.mockReturnValue(table);

    await expect(fetchRequirementTemplates()).rejects.toThrow();
  });
});

describe('saveRequirementTemplate — create (no id)', () => {
  it('POSTs to the requirement-catalogue route and returns the persisted row', async () => {
    const created = makeRow();
    const fetchMock = mockFetchJson(created);
    vi.stubGlobal('fetch', fetchMock);

    const values = {
      template_name: 'Standard PSQ',
      template_type: 'PSQ',
      section_ref: '3.2',
      section_name: 'Health and Safety',
      requirement_text: 'Describe your H&S policy.',
      requirement_type: 'policy' as const,
      is_mandatory: true,
      is_current: true,
      display_order: 0,
    };

    const result = await saveRequirementTemplate({ values });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/procurement/requirement-catalogue',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      }),
    );
    expect(result).toEqual(created);
  });

  it('throws the route error message when the POST fails', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({ error: 'Validation failed' }, false, 400),
    );

    await expect(saveRequirementTemplate({ values: {} })).rejects.toThrow(
      'Validation failed',
    );
  });

  it('falls back to a generic message when the failed POST has no JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      }),
    );

    await expect(saveRequirementTemplate({ values: {} })).rejects.toThrow(
      'Failed to save requirement (500)',
    );
  });
});

describe('saveRequirementTemplate — update (id supplied)', () => {
  it('PATCHes the requirement-catalogue route with id folded into the body', async () => {
    const updated = makeRow({ requirement_text: 'Updated wording.' });
    const fetchMock = mockFetchJson(updated);
    vi.stubGlobal('fetch', fetchMock);

    const values = { requirement_text: 'Updated wording.' };
    const result = await saveRequirementTemplate({
      id: updated.id,
      values,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/procurement/requirement-catalogue',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: updated.id, ...values }),
      }),
    );
    expect(result).toEqual(updated);
  });

  it('throws the route error message when the PATCH fails', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson({ error: 'Requirement not found' }, false, 404),
    );

    await expect(
      saveRequirementTemplate({ id: 'row-1', values: {} }),
    ).rejects.toThrow('Requirement not found');
  });
});
