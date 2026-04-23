import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

// Mock BRANDING to a known value so the source_entity filter is deterministic
vi.mock('@/lib/client-config', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    BRANDING: {
      ...(actual.BRANDING as Record<string, unknown>),
      organisationName: 'Example Client Ltd',
    },
  };
});

// Import AFTER mocks
import { GET } from '@/app/api/certifications/route';

// ---------------------------------------------------------------------------
// RFC4122-compliant UUIDs for Zod strictness
// ---------------------------------------------------------------------------

const UUID_1 = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const UUID_2 = 'b2c3d4e5-f6a7-4901-bcde-f12345678901';
const UUID_3 = 'c3d4e5f6-a7b8-4012-cdef-123456789012';
const UUID_4 = 'd4e5f6a7-b8c9-4123-def0-234567890123';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.resetAllMocks();

  const chain = mockSupabase._chain;
  const chainableMethods = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const method of chainableMethods) {
    chain[method].mockReturnValue(chain);
  }
  chain.single.mockResolvedValue({ data: null, error: null, count: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
  chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.from.mockReturnValue(chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

/**
 * Configure the three sequential Supabase queries the certifications route
 * makes: (1) entity_relationships, (2) entity_mentions, (3) content_items.
 *
 * The mock chain is shared across all .from() calls — the route awaits each
 * query sequentially, so we use the `.then` mock queue to return different
 * results for each call in order.
 */
function configureQueries(
  relationships: Record<string, unknown>[],
  mentions: Record<string, unknown>[],
  contentItems: { id: string; title: string }[] = [],
) {
  const chain = mockSupabase._chain;

  // First .from() await = entity_relationships
  chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({ data: relationships, error: null }),
  );

  // Second .from() await = entity_mentions
  chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({ data: mentions, error: null }),
  );

  // Third .from() await = content_items
  chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({ data: contentItems, error: null }),
  );
}

// ---------------------------------------------------------------------------
// Tests — cert card holder + source_entity filter hotfix
// ---------------------------------------------------------------------------

describe('GET /api/certifications — holder + source_entity filter', () => {
  beforeEach(() => {
    resetMocks();
    // Auth: authenticated user with viewer role
    configureRole(mockSupabase, 'viewer');
  });

  it('(a) excludes mentions where metadata.holder is unset from both certifications and supplierCertifications', async () => {
    configureQueries(
      // Relationship: org holds ISO 27001
      [
        {
          source_entity: 'Example Client Ltd',
          target_entity: 'iso 27001',
          source_item_id: UUID_1,
        },
      ],
      // Mention: entity_type=certification but NO metadata.holder field
      [
        {
          canonical_name: 'iso 27001',
          entity_type: 'certification',
          entity_type_override: null,
          content_item_id: UUID_2,
          metadata: {},
        },
      ],
      [{ id: UUID_2, title: 'Some Document' }],
    );

    const response = await GET();
    const body = await response.json();

    // Should NOT appear in certifications (holder unset = excluded)
    expect(body.certifications).toHaveLength(0);
    // Should NOT appear in supplierCertifications either
    const supplierCerts = body.certifications.filter(
      (c: Record<string, unknown>) => c.holder === 'supplier',
    );
    expect(supplierCerts).toHaveLength(0);
  });

  it('(b) excludes mentions where metadata.holder === "self" but source_entity \!== org name', async () => {
    configureQueries(
      // Relationship: a DIFFERENT org holds ISO 27001
      [
        {
          source_entity: 'example-datacentre europe',
          target_entity: 'iso 27001',
          source_item_id: UUID_1,
        },
      ],
      // Mention: certification with holder='self', but the relationship
      // source_entity is 'example-datacentre europe', not 'Example Client Ltd'
      [
        {
          canonical_name: 'iso 27001',
          entity_type: 'certification',
          entity_type_override: null,
          content_item_id: UUID_2,
          metadata: { holder: 'self' },
        },
      ],
      [{ id: UUID_2, title: 'example-datacentre Cert Doc' }],
    );

    const response = await GET();
    const body = await response.json();

    // Step-1 filter removes relationships where source_entity \!= org name,
    // so no target_entities reach the mention query
    expect(body.certifications).toHaveLength(0);
  });

  it('(c) includes mentions where metadata.holder === "self" AND source_entity matches org name', async () => {
    configureQueries(
      // Relationship: our org holds ISO 9001
      [
        {
          source_entity: 'Example Client Ltd',
          target_entity: 'iso 9001',
          source_item_id: UUID_1,
        },
      ],
      // Mention: certification with holder='self'
      [
        {
          canonical_name: 'iso 9001',
          entity_type: 'certification',
          entity_type_override: null,
          content_item_id: UUID_3,
          metadata: { holder: 'self' },
        },
      ],
      [{ id: UUID_3, title: 'Our ISO 9001 Cert' }],
    );

    const response = await GET();
    const body = await response.json();

    // Should appear in certifications with holder='self'
    const selfCerts = body.certifications.filter(
      (c: Record<string, unknown>) => c.holder === 'self',
    );
    expect(selfCerts).toHaveLength(1);
    expect(selfCerts[0].canonical_name).toBe('iso 9001');
    expect(selfCerts[0].holder).toBe('self');
  });

  it('(d) includes mentions where metadata.holder === "supplier" in supplierCertifications', async () => {
    configureQueries(
      // Both relationships from our org — the classifier extracted them
      // as "Example Client Ltd holds cyber essentials" even though the
      // cert is actually held by a supplier (the mention metadata carries
      // that distinction, not the relationship source_entity)
      [
        {
          source_entity: 'Example Client Ltd',
          target_entity: 'cyber essentials',
          source_item_id: UUID_1,
        },
        {
          source_entity: 'Example Client Ltd',
          target_entity: 'iso 9001',
          source_item_id: UUID_3,
        },
      ],
      // Mentions: one supplier cert and one self cert
      [
        {
          canonical_name: 'cyber essentials',
          entity_type: 'certification',
          entity_type_override: null,
          content_item_id: UUID_2,
          metadata: { holder: 'supplier', supplier_name: 'example-datacentre' },
        },
        {
          canonical_name: 'iso 9001',
          entity_type: 'certification',
          entity_type_override: null,
          content_item_id: UUID_4,
          metadata: { holder: 'self' },
        },
      ],
      [
        { id: UUID_2, title: 'Supplier Cert Doc' },
        { id: UUID_4, title: 'Our ISO 9001' },
      ],
    );

    const response = await GET();
    const body = await response.json();

    // Supplier cert should appear in certifications array with holder='supplier'
    const supplierCerts = body.certifications.filter(
      (c: Record<string, unknown>) => c.holder === 'supplier',
    );
    expect(supplierCerts).toHaveLength(1);
    expect(supplierCerts[0].canonical_name).toBe('cyber essentials');
    expect(supplierCerts[0].holder).toBe('supplier');
    expect(supplierCerts[0].supplier_name).toBe('example-datacentre');

    // Self cert should also be present
    const selfCerts = body.certifications.filter(
      (c: Record<string, unknown>) => c.holder === 'self',
    );
    expect(selfCerts).toHaveLength(1);
    expect(selfCerts[0].canonical_name).toBe('iso 9001');
  });
});
