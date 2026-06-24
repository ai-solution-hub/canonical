import { describe, it, expect } from 'vitest';
import {
  parseSeedArgs,
  resolveTarget,
  assertApplicationTypes,
  seedWorkspaces,
  PLATFORM_WORKSPACE_SEEDS,
  PIPELINE_SYSTEM_USER_ID,
  type EnvLike,
  type SeedDbClient,
} from '../../scripts/seed-platform-workspaces';

/**
 * Behaviour tests for the ID-127.2 (BI-8) Platform-workspace seed.
 *
 * Asserts the seed's user-observable contract against a recording Supabase
 * double (no live DB): six workspaces one-per-application_type with valid FKs;
 * re-seed converges with no duplicate; fails loud when an application_type is
 * absent or a credential env is missing; target selection writes the right DB.
 *
 * Test philosophy: behaviour, not implementation — the assertions are on the
 * returned seed plan and the rows the double records, not on chain ordering.
 */

// ---------------------------------------------------------------------------
// Recording Supabase double. Routes each from(table) to a per-table chain that
// supports the seed's verbs: select().in(), select().eq().maybeSingle(),
// insert().select().single(). Per-table queues let a re-run see the rows the
// first run "wrote".
// ---------------------------------------------------------------------------
interface Recorded {
  table: string;
  verb: 'select' | 'insert';
  payload?: unknown;
}

type Resp = { data: unknown; error: unknown };

interface TableState {
  /** Sequential responses for terminal `.in()` / `.maybeSingle()` reads. */
  reads: Resp[];
  /** Sequential responses for `.insert().select().single()` writes. */
  inserts: Resp[];
}

function makeClient(tables: Record<string, Partial<TableState>>): {
  client: SeedDbClient;
  recorded: Recorded[];
  inserted: Record<string, unknown[]>;
} {
  const recorded: Recorded[] = [];
  const inserted: Record<string, unknown[]> = {};
  const state: Record<string, TableState> = {};
  for (const [t, s] of Object.entries(tables)) {
    state[t] = { reads: [...(s.reads ?? [])], inserts: [...(s.inserts ?? [])] };
  }
  const nextRead = (t: string): Resp =>
    state[t]?.reads.shift() ?? { data: null, error: null };
  const nextInsert = (t: string): Resp =>
    state[t]?.inserts.shift() ?? { data: { id: `ins-${t}` }, error: null };

  function from(table: string) {
    return {
      select() {
        recorded.push({ table, verb: 'select' });
        const terminal = {
          // `select().in(...)` is awaited directly (returns an array).
          in: () => Promise.resolve(nextRead(table)),
          // `select().eq(...).maybeSingle()` — eq returns the same terminal,
          // which is itself awaitable (maybeSingle) for the seed's reads.
          eq: () => terminal,
          maybeSingle: () => Promise.resolve(nextRead(table)),
          then: (resolve: (v: Resp) => unknown) =>
            Promise.resolve(resolve(nextRead(table))),
        };
        return terminal;
      },
      insert(payload: unknown) {
        recorded.push({ table, verb: 'insert', payload });
        (inserted[table] ??= []).push(payload);
        return {
          select: () => ({
            single: () => Promise.resolve(nextInsert(table)),
          }),
        };
      },
    };
  }

  return { client: { from } as unknown as SeedDbClient, recorded, inserted };
}

/** The six application_type rows, one id per baseline key. */
function applicationTypeRows(): Array<{ id: string; key: string }> {
  return PLATFORM_WORKSPACE_SEEDS.map((s, i) => ({
    id: `at-${i}`,
    key: s.applicationTypeKey,
  }));
}

function fullEnv(): EnvLike {
  return {
    PLATFORM_PROD_URL: 'https://zjqbrdctesqvouboziae.supabase.co',
    PLATFORM_PROD_SERVICE_ROLE_KEY: 'prod-service-role-key',
    PLATFORM_STAGING_URL: 'https://rbwqewalexrzgxtvcqrh.supabase.co',
    PLATFORM_STAGING_SERVICE_ROLE_KEY: 'staging-service-role-key',
  };
}

// ---------------------------------------------------------------------------

describe('parseSeedArgs — a Platform target is mandatory', () => {
  it('selects the prod target from --target=prod', () => {
    expect(parseSeedArgs(['--target=prod']).target).toBe('prod');
  });

  it('selects the staging target from --target=staging', () => {
    expect(parseSeedArgs(['--target=staging']).target).toBe('staging');
  });

  it('falls back to the SEED_PLATFORM_TARGET env when no flag is given', () => {
    expect(parseSeedArgs([], { SEED_PLATFORM_TARGET: 'staging' }).target).toBe(
      'staging',
    );
  });

  it('refuses to run when no target is named', () => {
    expect(() => parseSeedArgs([], {})).toThrow(/target is required/i);
  });

  it('refuses an unrecognised target rather than guessing a DB', () => {
    expect(() => parseSeedArgs(['--target=nope'], {})).toThrow(
      /target is required/i,
    );
  });

  it('defaults to dry-run and only writes when --apply is given', () => {
    expect(parseSeedArgs(['--target=prod']).dryRun).toBe(true);
    expect(parseSeedArgs(['--target=prod', '--apply']).dryRun).toBe(false);
  });
});

describe('resolveTarget — points the seed at the right Platform DB', () => {
  it('resolves prod URL + key from the prod env pair', () => {
    const r = resolveTarget('prod', fullEnv());
    expect(r.url).toContain('zjqbrdctesqvouboziae');
    expect(r.serviceRoleKey).toBe('prod-service-role-key');
    expect(r.projectRef).toBe('zjqbrdctesqvouboziae');
  });

  it('resolves staging URL + key from the staging env pair', () => {
    const r = resolveTarget('staging', fullEnv());
    expect(r.url).toContain('rbwqewalexrzgxtvcqrh');
    expect(r.serviceRoleKey).toBe('staging-service-role-key');
  });

  it('fails loud when the target credential env is missing', () => {
    const env = fullEnv();
    delete env.PLATFORM_PROD_SERVICE_ROLE_KEY;
    expect(() => resolveTarget('prod', env)).toThrow(
      /PLATFORM_PROD_SERVICE_ROLE_KEY/,
    );
  });

  it('refuses a URL that does not match the target project ref (wrong-DB guard)', () => {
    const env = fullEnv();
    env.PLATFORM_PROD_URL = 'https://rbwqewalexrzgxtvcqrh.supabase.co';
    expect(() => resolveTarget('prod', env)).toThrow(/zjqbrdctesqvouboziae/);
  });
});

describe('assertApplicationTypes — the 6 baseline types are a prerequisite', () => {
  it('fails loud when an application_type is missing', async () => {
    const partial = applicationTypeRows().slice(0, 5); // drop training_onboarding
    const { client } = makeClient({
      application_types: { reads: [{ data: partial, error: null }] },
    });
    await expect(assertApplicationTypes(client)).rejects.toThrow(
      /application_type\(s\) absent/i,
    );
  });

  it('does not create application_types — only asserts them', async () => {
    const partial = applicationTypeRows().slice(0, 5);
    const { client, inserted } = makeClient({
      application_types: { reads: [{ data: partial, error: null }] },
    });
    await expect(assertApplicationTypes(client)).rejects.toThrow();
    expect(inserted.application_types).toBeUndefined();
  });
});

describe('seedWorkspaces — one workspace per application_type', () => {
  it('creates 6 workspaces, one per application_type, each FK-valid', async () => {
    const { client, inserted } = makeClient({
      application_types: {
        reads: [{ data: applicationTypeRows(), error: null }],
      },
      // every byName lookup returns null → all six are created
      workspaces: {
        reads: PLATFORM_WORKSPACE_SEEDS.map(() => ({
          data: null,
          error: null,
        })),
        inserts: PLATFORM_WORKSPACE_SEEDS.map((_s, i) => ({
          data: { id: `ws-${i}` },
          error: null,
        })),
      },
    });

    const results = await seedWorkspaces(client, false);

    expect(results).toHaveLength(6);
    expect(results.every((r) => r.action === 'created')).toBe(true);
    // one per application_type key, no dup
    expect(new Set(results.map((r) => r.applicationTypeKey)).size).toBe(6);

    const rows = (inserted.workspaces ?? []) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(6);
    // every inserted row carries the NOT-NULL FK + name + provenance
    for (const row of rows) {
      expect(row.application_type_id).toMatch(/^at-/);
      expect(typeof row.name).toBe('string');
      expect(row.created_by).toBe(PIPELINE_SYSTEM_USER_ID);
    }
    // FK resolved by stable key, not reused across rows
    expect(new Set(rows.map((r) => r.application_type_id)).size).toBe(6);
  });

  it('re-seed converges: no workspace is created twice', async () => {
    const { client, inserted } = makeClient({
      application_types: {
        reads: [{ data: applicationTypeRows(), error: null }],
      },
      // every byName lookup finds the existing row → nothing inserted
      workspaces: {
        reads: PLATFORM_WORKSPACE_SEEDS.map((_s, i) => ({
          data: { id: `existing-ws-${i}` },
          error: null,
        })),
      },
    });

    const results = await seedWorkspaces(client, false);

    expect(results.every((r) => r.action === 'already-exists')).toBe(true);
    expect(inserted.workspaces).toBeUndefined(); // zero writes on re-seed
  });

  it('dry-run plans the inserts but performs no write', async () => {
    const { client, inserted } = makeClient({
      application_types: {
        reads: [{ data: applicationTypeRows(), error: null }],
      },
      workspaces: {
        reads: PLATFORM_WORKSPACE_SEEDS.map(() => ({
          data: null,
          error: null,
        })),
      },
    });

    const results = await seedWorkspaces(client, true);

    expect(results.every((r) => r.action === 'would-create')).toBe(true);
    expect(inserted.workspaces).toBeUndefined();
  });

  it('fails loud (no partial seed) when an application_type is missing', async () => {
    const { client, inserted } = makeClient({
      application_types: {
        reads: [{ data: applicationTypeRows().slice(0, 5), error: null }],
      },
    });
    await expect(seedWorkspaces(client, false)).rejects.toThrow(
      /application_type\(s\) absent/i,
    );
    expect(inserted.workspaces).toBeUndefined();
  });
});
