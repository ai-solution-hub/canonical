import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

// Import AFTER mocks
import { GET, PUT } from '@/app/api/organisation/profile/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = 'a0000000-0000-4000-8000-000000000001';

const MOCK_PROFILE = {
  id: VALID_UUID,
  name: 'Acme Services',
  slug: 'acme-services',
  description: 'A test company',
  website_url: 'https://acme.example.com',
  sectors: ['Technology'],
  services: ['Consulting'],
  certifications: ['ISO 27001'],
  geographic_scope: ['UK'],
  competitors: [],
  target_customers: 'Public sector',
  value_proposition: 'Best in class',
  key_topics: ['AI'],
  is_active: true,
  is_primary: true,
  created_by: VALID_UUID,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const VALID_UPSERT_BODY = {
  name: 'Acme Services',
  sectors: ['Technology'],
  services: ['Consulting'],
  certifications: [],
  geographic_scope: [],
  key_topics: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();

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
  chain.single.mockResolvedValue({ data: null, error: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: VALID_UUID, email: 'admin@example.com' } },
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/organisation/profile', () => {
  beforeEach(resetMocks);

  it('returns 200 with profile data when primary exists', async () => {
    configureRole(mockSupabase, 'admin');
    // The maybeSingle call for getOrganisationProfile
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        id: MOCK_PROFILE.id,
        name: MOCK_PROFILE.name,
        description: MOCK_PROFILE.description,
        website_url: MOCK_PROFILE.website_url,
        sectors: MOCK_PROFILE.sectors,
        services: MOCK_PROFILE.services,
        certifications: MOCK_PROFILE.certifications,
        geographic_scope: MOCK_PROFILE.geographic_scope,
        target_customers: MOCK_PROFILE.target_customers,
        value_proposition: MOCK_PROFILE.value_proposition,
        key_topics: MOCK_PROFILE.key_topics,
      },
      error: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.profile).toBeTruthy();
    expect(body.profile.name).toBe('Acme Services');
    expect(body.profile.sectors).toEqual(['Technology']);
  });

  it('returns 200 with null profile when no primary exists', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.profile).toBeNull();
  });

  it('returns 401 for unauthenticated requests', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer requests', async () => {
    configureRole(mockSupabase, 'viewer');

    const res = await GET();

    expect(res.status).toBe(403);
  });

  it('returns 200 for editor requests', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.profile).toBeNull();
  });
});

describe('PUT /api/organisation/profile', () => {
  beforeEach(resetMocks);

  it('creates a new primary profile when none exists', async () => {
    configureRole(mockSupabase, 'admin');
    // getFullPrimaryProfile returns null (no existing profile)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // resolveUniqueSlug — no collision
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    // insert().select().single() returns created profile
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        name: 'Acme Services',
        description: null,
        website_url: null,
        sectors: ['Technology'],
        services: ['Consulting'],
        certifications: [],
        geographic_scope: [],
        target_customers: null,
        value_proposition: null,
        key_topics: [],
      },
      error: null,
    });

    const req = createTestRequest('/api/organisation/profile', {
      method: 'PUT',
      body: VALID_UPSERT_BODY,
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.profile.name).toBe('Acme Services');
  });

  it('updates existing primary profile', async () => {
    configureRole(mockSupabase, 'admin');
    // getFullPrimaryProfile returns existing profile
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: MOCK_PROFILE,
      error: null,
    });
    // resolveUniqueSlug — no collision
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    // update().eq().select().single() returns updated profile
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        name: 'Acme Services Updated',
        description: null,
        website_url: null,
        sectors: ['Technology', 'Healthcare'],
        services: ['Consulting'],
        certifications: [],
        geographic_scope: [],
        target_customers: null,
        value_proposition: null,
        key_topics: [],
      },
      error: null,
    });

    const req = createTestRequest('/api/organisation/profile', {
      method: 'PUT',
      body: {
        ...VALID_UPSERT_BODY,
        name: 'Acme Services Updated',
        sectors: ['Technology', 'Healthcare'],
      },
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.profile.name).toBe('Acme Services Updated');
  });

  it('returns 401 for unauthenticated requests', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/organisation/profile', {
      method: 'PUT',
      body: VALID_UPSERT_BODY,
    });

    const res = await PUT(req);

    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer requests', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/organisation/profile', {
      method: 'PUT',
      body: VALID_UPSERT_BODY,
    });

    const res = await PUT(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for missing name', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/organisation/profile', {
      method: 'PUT',
      body: { sectors: ['Technology'] },
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 for empty sectors', async () => {
    configureRole(mockSupabase, 'admin');

    const req = createTestRequest('/api/organisation/profile', {
      method: 'PUT',
      body: { name: 'Acme', sectors: [] },
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
  });
});
