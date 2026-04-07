/**
 * Mock Supabase client factory for tests.
 *
 * Creates a chainable mock that mirrors the Supabase query builder pattern.
 * Configure per-test responses via the returned chain mock methods.
 */
import { vi } from 'vitest';

export interface MockQueryChain {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
  contains: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  csv: ReturnType<typeof vi.fn>;
  // Make the chain directly awaitable (resolves to { data, error, count })
  then: ReturnType<typeof vi.fn>;
}

export interface MockSupabaseClient {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  auth: {
    getUser: ReturnType<typeof vi.fn>;
    admin: {
      listUsers: ReturnType<typeof vi.fn>;
      createUser: ReturnType<typeof vi.fn>;
      updateUserById: ReturnType<typeof vi.fn>;
      deleteUser: ReturnType<typeof vi.fn>;
    };
  };
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
  /** Exposed for configuring chain responses in tests */
  _chain: MockQueryChain;
}

/**
 * Default successful response for Supabase queries.
 * Override per-test by calling mockChain.single.mockResolvedValueOnce(...) etc.
 */
const DEFAULT_RESPONSE = { data: null, error: null, count: null };

export function createMockSupabaseClient(): MockSupabaseClient {
  const chain: MockQueryChain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    not: vi.fn(),
    ilike: vi.fn(),
    contains: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    gt: vi.fn(),
    lt: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    single: vi.fn().mockResolvedValue(DEFAULT_RESPONSE),
    maybeSingle: vi.fn().mockResolvedValue(DEFAULT_RESPONSE),
    csv: vi.fn().mockResolvedValue(DEFAULT_RESPONSE),
    // Default: resolve to empty result when chain is awaited directly
    then: vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    ),
  };

  // Every chain method returns the chain itself (except terminators)
  const chainableMethods: (keyof MockQueryChain)[] = [
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
  ];
  for (const method of chainableMethods) {
    chain[method].mockReturnValue(chain);
  }

  const storageBucket = {
    upload: vi
      .fn()
      .mockResolvedValue({ data: { path: 'test-path' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    getPublicUrl: vi
      .fn()
      .mockReturnValue({ data: { publicUrl: 'https://example.com/file' } }),
  };

  return {
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@example.com' } },
        error: null,
      }),
      admin: {
        listUsers: vi
          .fn()
          .mockResolvedValue({ data: { users: [] }, error: null }),
        createUser: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: null }),
        updateUserById: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    },
    storage: {
      from: vi.fn().mockReturnValue(storageBucket),
    },
    _chain: chain,
  };
}

/**
 * Configure the mock chain to return a specific user_roles lookup result.
 * Call this after createMockSupabaseClient() and before the route handler.
 *
 * The role lookup chain is: from('user_roles').select('role').eq('user_id', ...).single()
 * Since all chain methods return the same chain object, we configure .single()
 * to resolve the role for the first call (which is the auth role lookup).
 */
export function configureRole(
  client: MockSupabaseClient,
  role: 'admin' | 'editor' | 'viewer',
) {
  client._chain.single.mockResolvedValueOnce({
    data: { role },
    error: null,
  });
}

/**
 * Configure the mock to simulate an unauthenticated user.
 *
 * Mirrors real Supabase JS behaviour: `getUser()` returns
 * `{ data: { user: null }, error: AuthSessionMissingError }` when there is
 * no session. The `name` field is the discriminator that
 * `getAuthenticatedClient` uses to distinguish "not logged in" (401) from
 * a real auth-service error (500).
 */
export function configureUnauthenticated(client: MockSupabaseClient) {
  client.auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
  });
}

/**
 * Configure the mock to simulate a transient Supabase Auth service failure
 * (e.g. refresh-token failure, network timeout to the auth endpoint).
 * `getAuthenticatedClient` should surface this as `auth_service_failed`
 * (500), NOT silently downgrade it to 401 unauthenticated.
 */
export function configureAuthServiceError(client: MockSupabaseClient) {
  client.auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: {
      name: 'AuthApiError',
      message: 'Auth service unavailable',
      status: 503,
    },
  });
}
