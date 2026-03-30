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
// Content item factory
// ---------------------------------------------------------------------------

export interface TestContentItem {
  id: string;
  title: string;
  content: string;
  content_type: string;
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  secondary_subtopic: string | null;
  layer: string | null;
  metadata: Record<string, unknown>;
  governance_review_status: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export function createTestContentItem(
  overrides: Partial<TestContentItem> = {},
): TestContentItem {
  return {
    id: overrides.id ?? testUUID(),
    title: overrides.title ?? 'Test Content Item',
    content: overrides.content ?? '<p>Test content</p>',
    content_type: overrides.content_type ?? 'q_a_pair',
    primary_domain: overrides.primary_domain ?? 'corporate',
    primary_subtopic: overrides.primary_subtopic ?? null,
    secondary_domain: overrides.secondary_domain ?? null,
    secondary_subtopic: overrides.secondary_subtopic ?? null,
    layer: overrides.layer ?? null,
    metadata: overrides.metadata ?? {},
    governance_review_status: overrides.governance_review_status ?? null,
    archived_at: overrides.archived_at ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// RPC result factory — simulates get_guide_content RPC response rows
// ---------------------------------------------------------------------------

export interface GuideContentRpcRow {
  section_id: string;
  section_name: string;
  section_description: string | null;
  section_order: number;
  expected_layer: string | null;
  subtopic_filter: string | null;
  content_type_filter: string | null;
  is_required: boolean;
  content_id: string | null;
  content_title: string | null;
  content_type: string | null;
  content_layer: string | null;
  content_brief: string | null;
  content_freshness: string | null;
  content_verified_at: string | null;
  content_captured_date: string | null;
}

/**
 * Create an RPC result row as returned by get_guide_content.
 * When content_id is null, represents a section with no matching content (LEFT JOIN).
 */
export function createGuideContentRow(
  overrides: Partial<GuideContentRpcRow> = {},
): GuideContentRpcRow {
  return {
    section_id: overrides.section_id ?? testUUID(),
    section_name: overrides.section_name ?? 'Test Section',
    section_description: overrides.section_description ?? null,
    section_order: overrides.section_order ?? 1,
    expected_layer: overrides.expected_layer ?? null,
    subtopic_filter: overrides.subtopic_filter ?? null,
    content_type_filter: overrides.content_type_filter ?? null,
    is_required: overrides.is_required ?? true,
    content_id: overrides.content_id ?? null,
    content_title: overrides.content_title ?? null,
    content_type: overrides.content_type ?? null,
    content_layer: overrides.content_layer ?? null,
    content_brief: overrides.content_brief ?? null,
    content_freshness: overrides.content_freshness ?? null,
    content_verified_at: overrides.content_verified_at ?? null,
    content_captured_date: overrides.content_captured_date ?? null,
  };
}

// ---------------------------------------------------------------------------
// Guide coverage RPC result factory — simulates get_guide_coverage response
// ---------------------------------------------------------------------------

export interface GuideCoverageRpcRow {
  guide_id: string;
  guide_slug: string;
  guide_name: string;
  domain_filter: string | null;
  section_id: string;
  section_name: string;
  section_order: number;
  is_required: boolean;
  content_count: number;
}

export function createGuideCoverageRow(
  overrides: Partial<GuideCoverageRpcRow> = {},
): GuideCoverageRpcRow {
  return {
    guide_id: overrides.guide_id ?? testUUID(),
    guide_slug: overrides.guide_slug ?? 'test-guide',
    guide_name: overrides.guide_name ?? 'Test Guide',
    domain_filter: overrides.domain_filter ?? 'corporate',
    section_id: overrides.section_id ?? testUUID(),
    section_name: overrides.section_name ?? 'Test Section',
    section_order: overrides.section_order ?? 1,
    is_required: overrides.is_required ?? true,
    content_count: overrides.content_count ?? 0,
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
