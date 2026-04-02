import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import route AFTER mocks are registered
const { GET } = await import('@/app/api/certifications/route');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_RELATIONSHIPS = [
  {
    source_entity: 'Acme Corp',
    target_entity: 'ISO 27001',
    source_item_id: 'item-1',
  },
  {
    source_entity: 'Acme Corp',
    target_entity: 'Cyber Essentials Plus',
    source_item_id: 'item-2',
  },
  {
    source_entity: 'Acme Corp',
    target_entity: 'G-Cloud 14',
    source_item_id: 'item-3',
  },
  {
    source_entity: 'Acme Corp',
    target_entity: 'ICO Registration',
    source_item_id: 'item-4',
  },
  {
    source_entity: 'Supplier Co',
    target_entity: 'ISO 9001',
    source_item_id: 'item-5',
  },
];

const MOCK_MENTIONS = [
  {
    canonical_name: 'ISO 27001',
    entity_type: 'certification',
    entity_type_override: null,
    content_item_id: 'ci-1',
    metadata: {
      version: '2022',
      issuing_body: 'BSI',
      date_obtained: '2024-06-15',
      expiry_date: '2027-06-15',
      scope: 'SaaS development and hosting',
      holder: 'self',
    },
  },
  {
    canonical_name: 'ISO 27001',
    entity_type: 'certification',
    entity_type_override: null,
    content_item_id: 'ci-2',
    metadata: {},
  },
  {
    canonical_name: 'Cyber Essentials Plus',
    entity_type: 'certification',
    entity_type_override: null,
    content_item_id: 'ci-3',
    metadata: {
      date_obtained: '2026-01-15',
      expiry_date: '2027-01-15',
      holder: 'self',
    },
  },
  {
    canonical_name: 'G-Cloud 14',
    entity_type: 'framework',
    entity_type_override: null,
    content_item_id: 'ci-4',
    metadata: {
      round: '14',
      status: 'active',
      lot: 'Cloud Hosting',
      date_joined: '2025-01-01',
      expiry_date: '2026-12-31',
    },
  },
  {
    canonical_name: 'ICO Registration',
    entity_type: 'regulation',
    entity_type_override: null,
    content_item_id: 'ci-5',
    metadata: {
      registration_number: 'ZA123456',
      registering_body: 'ICO',
      date_registered: '2020-01-01',
    },
  },
  {
    canonical_name: 'ISO 9001',
    entity_type: 'certification',
    entity_type_override: null,
    content_item_id: 'ci-6',
    metadata: {
      holder: 'supplier',
      supplier_name: 'Supplier Co',
    },
  },
];

const MOCK_CONTENT_ITEMS = [
  { id: 'ci-1', title: 'ISO 27001 Policy Document' },
  { id: 'ci-2', title: 'Security Overview' },
  { id: 'ci-3', title: 'Cyber Essentials Certificate' },
  { id: 'ci-4', title: 'G-Cloud Application' },
  { id: 'ci-5', title: 'ICO Registration Details' },
  { id: 'ci-6', title: 'Supplier Compliance Pack' },
];

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainable = [
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
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then
    .mockReset()
    .mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupFullMockData() {
  // Track call order to return different data for different .from() calls
  mockSupabase.from.mockImplementation(() => {
    // Return the chain but configure .then() based on which query
    return mockSupabase._chain;
  });

  // The route makes 3 queries that resolve via .then():
  // 1. entity_relationships (with .eq())
  // 2. entity_mentions (with .in())
  // 3. content_items (with .in())
  //
  // Since the chain is shared, we configure .then() to return different data
  // for each successive call
  let thenCallCount = 0;
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) => {
      thenCallCount++;
      if (thenCallCount === 1) {
        return resolve({ data: MOCK_RELATIONSHIPS, error: null });
      }
      if (thenCallCount === 2) {
        return resolve({ data: MOCK_MENTIONS, error: null });
      }
      if (thenCallCount === 3) {
        return resolve({ data: MOCK_CONTENT_ITEMS, error: null });
      }
      return resolve({ data: [], error: null });
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/certifications', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns empty report when no holds relationships exist', async () => {
    // Default mock returns empty data
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.certifications).toEqual([]);
    expect(body.frameworks).toEqual([]);
    expect(body.registrations).toEqual([]);
    expect(body.summary.total_certifications).toBe(0);
  });

  it('returns correct structure with full mock data', async () => {
    setupFullMockData();

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('certifications');
    expect(body).toHaveProperty('frameworks');
    expect(body).toHaveProperty('registrations');
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('total_certifications');
    expect(body.summary).toHaveProperty('valid');
    expect(body.summary).toHaveProperty('expiring_soon');
    expect(body.summary).toHaveProperty('expired');
    expect(body.summary).toHaveProperty('unknown');
  });

  it('separates certifications, frameworks, and registrations', async () => {
    setupFullMockData();

    const res = await GET();
    const body = await res.json();

    // ISO 27001 + Cyber Essentials Plus (self) + ISO 9001 (supplier) = 3 certifications
    const certNames = body.certifications.map(
      (c: { canonical_name: string }) => c.canonical_name,
    );
    expect(certNames).toContain('ISO 27001');
    expect(certNames).toContain('Cyber Essentials Plus');
    expect(certNames).toContain('ISO 9001');

    // G-Cloud 14 = 1 framework
    expect(body.frameworks).toHaveLength(1);
    expect(body.frameworks[0].canonical_name).toBe('G-Cloud 14');

    // ICO Registration = 1 registration
    expect(body.registrations).toHaveLength(1);
    expect(body.registrations[0].canonical_name).toBe('ICO Registration');
  });

  it('derives expiry status correctly', async () => {
    setupFullMockData();

    const res = await GET();
    const body = await res.json();

    // ISO 27001 expires 2027-06-15 — should be 'valid' (well into the future)
    const iso27001 = body.certifications.find(
      (c: { canonical_name: string }) => c.canonical_name === 'ISO 27001',
    );
    expect(iso27001.expiry_status).toBe('valid');

    // ICO Registration has no expiry_date — should be 'unknown'
    const ico = body.registrations.find(
      (r: { canonical_name: string }) =>
        r.canonical_name === 'ICO Registration',
    );
    expect(ico.expiry_status).toBe('unknown');
  });

  it('separates self-held and supplier certifications', async () => {
    setupFullMockData();

    const res = await GET();
    const body = await res.json();

    const selfCerts = body.certifications.filter(
      (c: { holder: string }) => c.holder === 'self',
    );
    const supplierCerts = body.certifications.filter(
      (c: { holder: string }) => c.holder === 'supplier',
    );

    expect(selfCerts.length).toBe(2); // ISO 27001, Cyber Essentials Plus
    expect(supplierCerts.length).toBe(1); // ISO 9001
    expect(supplierCerts[0].supplier_name).toBe('Supplier Co');
  });

  it('includes content item counts and references', async () => {
    setupFullMockData();

    const res = await GET();
    const body = await res.json();

    // ISO 27001 is mentioned in ci-1 and ci-2
    const iso27001 = body.certifications.find(
      (c: { canonical_name: string }) => c.canonical_name === 'ISO 27001',
    );
    expect(iso27001.content_item_count).toBe(2);
    expect(iso27001.mention_count).toBe(2);
    expect(iso27001.content_items).toHaveLength(2);
  });

  it('handles database error on relationships query', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        return resolve({ data: null, error: { message: 'Connection failed' } });
      },
    );

    const res = await GET();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('includes metadata in certification entries', async () => {
    setupFullMockData();

    const res = await GET();
    const body = await res.json();

    const iso27001 = body.certifications.find(
      (c: { canonical_name: string }) => c.canonical_name === 'ISO 27001',
    );
    expect(iso27001.metadata.version).toBe('2022');
    expect(iso27001.metadata.issuing_body).toBe('BSI');
    expect(iso27001.metadata.scope).toBe('SaaS development and hosting');
  });

  it('includes framework metadata', async () => {
    setupFullMockData();

    const res = await GET();
    const body = await res.json();

    const gcloud = body.frameworks[0];
    expect(gcloud.metadata.round).toBe('14');
    expect(gcloud.metadata.status).toBe('active');
    expect(gcloud.metadata.lot).toBe('Cloud Hosting');
  });

  it('includes registration metadata', async () => {
    setupFullMockData();

    const res = await GET();
    const body = await res.json();

    const ico = body.registrations[0];
    expect(ico.metadata.registration_number).toBe('ZA123456');
    expect(ico.metadata.registering_body).toBe('ICO');
  });

  it('counts summary totals correctly', async () => {
    setupFullMockData();

    const res = await GET();
    const body = await res.json();

    // 3 total certifications (2 self + 1 supplier)
    expect(body.summary.total_certifications).toBe(3);

    // Valid + unknown + expiring = total (exact values depend on current date vs test data dates)
    const statusSum =
      body.summary.valid +
      body.summary.expiring_soon +
      body.summary.expired +
      body.summary.unknown;
    expect(statusSum).toBe(body.summary.total_certifications);
  });
});
