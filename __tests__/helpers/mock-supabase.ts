/**
 * Mock Supabase client factory for tests.
 *
 * Creates a chainable mock that mirrors the Supabase query builder pattern.
 * Configure per-test responses via the returned chain mock methods.
 *
 * **Two factories:**
 * - `createMockSupabaseClient()` — full client (`from`, `rpc`, `auth`,
 *   `storage`, `_chain`). Use for api-route tests that exercise the full
 *   surface.
 * - `createMockSupabaseTable(initialResolution?)` — minimal chainable
 *   single-table builder. Use for lib-function tests that only consume
 *   `from(table).<chain>`. Per W2-RG in `remediation-plan.md` §3.8 —
 *   covers the per-file `createMockSupabase()` duplicates in
 *   `__tests__/lib/`. Added S44 W2-RG.
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
    error: {
      name: 'AuthSessionMissingError',
      message: 'Auth session missing!',
    },
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

// ---------------------------------------------------------------------------
// Single-table builders (S44 W2-RG)
// ---------------------------------------------------------------------------

/**
 * Resolution shape used by `createMockSupabaseTable()`. Both lib tests and
 * api-route tests await a chain terminator returning this shape — match it
 * literally so consumers can pass through their fixture data.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface MockTableResolution<TData = any> {
  data: TData;
  error: unknown;
}

/**
 * Build a minimal chainable mock that resolves any `from(<table>).<chain>`
 * call to `initialResolution`. Replaces 6+ per-file `createMockSupabase()`
 * duplicates in `__tests__/lib/` per W2-RG.
 *
 * The chain methods (`select`, `insert`, `update`, `delete`, `eq`, `neq`,
 * `in`, `is`, `not`, `gte`, `lte`, `order`, `limit`) all return the chain
 * itself, so the lib function under test can compose them freely. Terminal
 * methods (`single`, `maybeSingle`, the implicit `then`) resolve to the
 * provided `initialResolution`.
 *
 * Override per-test via `chain.<method>.mockResolvedValueOnce(...)` for
 * narrow-shape tests, or `chain.then.mockImplementationOnce(...)` for
 * tests that await the chain directly.
 *
 * @param initialResolution Default resolved value. Defaults to
 *                          `{ data: [], error: null }` — the safest
 *                          "empty success" baseline.
 *
 * @example Simple terminal `eq` resolution
 * ```ts
 * const supabase = createMockSupabaseTable({
 *   data: [{ alias: 'Examplia', canonical: 'Example Client Limited' }],
 *   error: null,
 * });
 * await loadAliases(supabase);
 * ```
 *
 * @example Override per-test
 * ```ts
 * const supabase = createMockSupabaseTable();
 * supabase._chain.single.mockResolvedValueOnce({ data: row, error: null });
 * ```
 */
/**
 * Return type of `createMockSupabaseTable()`. The `from` / `rpc` signatures
 * are tightened from raw `Mock<Procedure | Constructable>` to the structural
 * shape the lib functions expect — `(table: string) => unknown` and
 * `(name: string, args?: unknown) => PromiseLike<{data, error}>` — so the
 * helper drops in as a `SupabaseClient` substitute without per-callsite
 * casts. The underlying functions are still vitest Mocks at runtime
 * (`vi.fn()`), preserving `mock.calls` introspection.
 */
export interface MockSupabaseTable {
  from: ((table: string) => MockQueryChain) & ReturnType<typeof vi.fn>;
  rpc: ((
    name: string,
    args?: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => PromiseLike<{ data: any; error: any }>) &
    ReturnType<typeof vi.fn>;
  _chain: MockQueryChain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockSupabaseTable<TData = any>(
  initialResolution: MockTableResolution<TData> = {
    data: [] as unknown as TData,
    error: null,
  },
): MockSupabaseTable {
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
    single: vi.fn().mockResolvedValue(initialResolution),
    maybeSingle: vi.fn().mockResolvedValue(initialResolution),
    csv: vi.fn().mockResolvedValue(initialResolution),
    then: vi.fn((resolve: (v: unknown) => void) => resolve(initialResolution)),
  };

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

  return {
    from: vi.fn().mockReturnValue(chain) as MockSupabaseTable['from'],
    rpc: vi
      .fn()
      .mockResolvedValue(initialResolution) as MockSupabaseTable['rpc'],
    _chain: chain,
  };
}
