/**
 * Test Data Factory for Integration Tests
 *
 * Provides factory functions to create test data for guides, guide sections,
 * and content items. Each factory generates data with unique identifiers to
 * avoid collisions between test runs.
 *
 * For mock-based tests, these factories return plain objects suitable for
 * configuring mock responses. For live DB tests, the same shapes can be
 * inserted directly via the Supabase client.
 */
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// UUID generation — RFC 4122 v4 compliant (required for Zod validation)
// ---------------------------------------------------------------------------

/** Generate a v4-compliant UUID for test data */
export function testUUID(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Guide factory
// ---------------------------------------------------------------------------

export interface TestGuide {
  id: string;
  slug: string;
  name: string;
  description: string;
  guide_type: string;
  domain_filter: string | null;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function createTestGuide(overrides: Partial<TestGuide> = {}): TestGuide {
  const id = overrides.id ?? testUUID();
  const slug = overrides.slug ?? `test-guide-${id.slice(0, 8)}`;
  return {
    id,
    slug,
    name: overrides.name ?? `Test Guide ${slug}`,
    description: overrides.description ?? 'A test guide for integration tests',
    guide_type: overrides.guide_type ?? 'sector',
    domain_filter: overrides.domain_filter ?? 'corporate',
    icon: overrides.icon ?? null,
    color: overrides.color ?? null,
    display_order: overrides.display_order ?? 1,
    is_published: overrides.is_published ?? true,
    created_by: overrides.created_by ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Guide section factory
// ---------------------------------------------------------------------------

export interface TestGuideSection {
  id: string;
  guide_id: string;
  section_name: string;
  section_description: string | null;
  subtopic_filter: string | null;
  expected_layer: string | null;
  content_type_filter: string | null;
  display_order: number;
  is_required: boolean;
  created_at: string;
}

export function createTestGuideSection(
  overrides: Partial<TestGuideSection> = {},
): TestGuideSection {
  return {
    id: overrides.id ?? testUUID(),
    guide_id: overrides.guide_id ?? testUUID(),
    section_name: overrides.section_name ?? 'Test Section',
    section_description: overrides.section_description ?? null,
    subtopic_filter: overrides.subtopic_filter ?? null,
    expected_layer: overrides.expected_layer ?? null,
    content_type_filter: overrides.content_type_filter ?? null,
    display_order: overrides.display_order ?? 1,
    is_required: overrides.is_required ?? true,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Guide sections query result (for suggestGuideSections mock)
// ---------------------------------------------------------------------------

export interface GuideSectionQueryRow {
  id: string;
  section_name: string;
  subtopic_filter: string | null;
  expected_layer: string | null;
  content_type_filter: string | null;
  display_order: number;
  is_required: boolean;
  guides: {
    id: string;
    name: string;
    slug: string;
    domain_filter: string | null;
    display_order: number;
    is_published: boolean;
  };
}

/**
 * Create a guide_sections row with joined guides data, as returned by the
 * suggestGuideSections query.
 */
export function createGuideSectionQueryRow(
  overrides: Partial<GuideSectionQueryRow> & {
    guides?: Partial<GuideSectionQueryRow['guides']>;
  } = {},
): GuideSectionQueryRow {
  const guideId = overrides.guides?.id ?? testUUID();
  return {
    id: overrides.id ?? testUUID(),
    section_name: overrides.section_name ?? 'Test Section',
    subtopic_filter: overrides.subtopic_filter ?? null,
    expected_layer: overrides.expected_layer ?? null,
    content_type_filter: overrides.content_type_filter ?? null,
    display_order: overrides.display_order ?? 1,
    is_required: overrides.is_required ?? true,
    guides: {
      id: guideId,
      name: overrides.guides?.name ?? 'Test Guide',
      slug: overrides.guides?.slug ?? 'test-guide',
      domain_filter: overrides.guides?.domain_filter ?? 'corporate',
      display_order: overrides.guides?.display_order ?? 1,
      is_published: overrides.guides?.is_published ?? true,
    },
  };
}
