/**
 * Requirement-catalogue query-glue tests (ID-147 {147.16} — TECH §7/§H1,
 * PRODUCT §H1/§H3; ID-145 BI-24/BI-47).
 *
 * Covers the plain async fetch/save functions directly against the shared
 * Supabase mock (`__tests__/helpers/mock-supabase.ts`), independent of any
 * React/QueryClient scaffolding — mirrors the
 * `__tests__/lib/query/promotion-candidates-fetcher.test.ts` convention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  return {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
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
  it('inserts into form_requirement_templates and returns the persisted row', async () => {
    const created = makeRow();
    const table = createMockSupabaseTable({ data: created, error: null });
    mockCreateClient.mockReturnValue(table);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await saveRequirementTemplate({ values });

    expect(table.from).toHaveBeenCalledWith('form_requirement_templates');
    expect(table._chain.insert).toHaveBeenCalledWith(values);
    expect(table._chain.update).not.toHaveBeenCalled();
    expect(result).toEqual(created);
  });

  it('throws when the insert errors', async () => {
    const table = createMockSupabaseTable({
      data: null,
      error: new Error('insert boom'),
    });
    mockCreateClient.mockReturnValue(table);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      saveRequirementTemplate({ values: {} as any }),
    ).rejects.toThrow();
  });
});

describe('saveRequirementTemplate — update (id supplied)', () => {
  it('updates the row matching id and returns the persisted row', async () => {
    const updated = makeRow({ requirement_text: 'Updated wording.' });
    const table = createMockSupabaseTable({ data: updated, error: null });
    mockCreateClient.mockReturnValue(table);

    const values = { requirement_text: 'Updated wording.' };
    const result = await saveRequirementTemplate({
      id: updated.id,
      values,
    });

    expect(table.from).toHaveBeenCalledWith('form_requirement_templates');
    expect(table._chain.update).toHaveBeenCalledWith(values);
    expect(table._chain.eq).toHaveBeenCalledWith('id', updated.id);
    expect(table._chain.insert).not.toHaveBeenCalled();
    expect(result).toEqual(updated);
  });

  it('throws when the update errors', async () => {
    const table = createMockSupabaseTable({
      data: null,
      error: new Error('update boom'),
    });
    mockCreateClient.mockReturnValue(table);

    await expect(
      saveRequirementTemplate({ id: 'row-1', values: {} }),
    ).rejects.toThrow();
  });
});
