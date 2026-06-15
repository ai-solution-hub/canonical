/**
 * ID-104.9 — touchpoint registry (T3/T4/T5, B-INV-3/4/5).
 *
 * Behaviour-first per reference/test-philosophy.md. Exercises the registry
 * through `registerTouchpoint` / `getTouchpoint` / `listTouchpoints` against the
 * shared Supabase mock (`createMockSupabaseClient`) — never a live DB.
 *
 * The behaviours under test (the {104.9} testStrategy):
 *   - duplicate `touchpoint_id` insert is REJECTED (PK conflict surfaced as a
 *     clear error, NOT swallowed);
 *   - a contract field change advances `contract_version` AND `registry_version`;
 *   - an unchanged re-register is a no-op (no version churn);
 *   - `listTouchpoints` returns registered rows with their bound contract + owner;
 *   - `getTouchpoint` resolves a single row (the runner's registration-as-gate
 *     read) and returns null for an unregistered id.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/supabase/types/database.types';
import type { AgentEvalContract } from '@/lib/eval/contract';
import {
  getTouchpoint,
  listTouchpoints,
  registerTouchpoint,
} from '@/lib/eval/registry';
import { SupabaseError } from '@/lib/supabase/safe';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

/** A complete, valid contract fixture — every mandatory field present. */
function makeContract(
  overrides: Partial<AgentEvalContract> = {},
): AgentEvalContract {
  return {
    touchpoint_id: 'tool.classify_content',
    kind: 'tool',
    owner: 'platform-team',
    suite_name: 'l1',
    grounding_shape: 'structured_output',
    severity_on_fail: 'block',
    variance_band: 0.02,
    ...overrides,
  };
}

/**
 * Build a stored `eval_touchpoints` row from a contract + version pair,
 * matching the table shape the registry reads back.
 */
function makeRow(
  contract: AgentEvalContract,
  versions: { contract_version: number; registry_version: number },
) {
  return {
    touchpoint_id: contract.touchpoint_id,
    kind: contract.kind,
    owner: contract.owner,
    suite_name: contract.suite_name,
    grounding_shape: contract.grounding_shape,
    severity_on_fail: contract.severity_on_fail,
    variance_band: contract.variance_band,
    graduation_metric: contract.graduation_metric ?? null,
    contract_version: versions.contract_version,
    registry_version: versions.registry_version,
    file_sha256: null,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
  };
}

/** Narrow the mock to the `SupabaseClient<Database>` the registry expects. */
function asClient(mock: MockSupabaseClient): SupabaseClient<Database> {
  return mock as unknown as SupabaseClient<Database>;
}

describe('registerTouchpoint', () => {
  it('inserts a new touchpoint at contract_version 1 when none exists', async () => {
    const mock = createMockSupabaseClient();
    const contract = makeContract();

    // No existing row (the pre-read), no existing rows (registry-version scan),
    // then the inserted row comes back.
    mock._chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );
    mock._chain.single.mockResolvedValueOnce({
      data: makeRow(contract, { contract_version: 1, registry_version: 1 }),
      error: null,
    });

    const row = await registerTouchpoint(asClient(mock), contract);

    expect(mock.from).toHaveBeenCalledWith('eval_touchpoints');
    expect(mock._chain.insert).toHaveBeenCalledTimes(1);
    const inserted = mock._chain.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      touchpoint_id: 'tool.classify_content',
      owner: 'platform-team',
      contract_version: 1,
    });
    expect(row.contract_version).toBe(1);
    expect(row.registry_version).toBe(1);
  });

  it('rejects a duplicate touchpoint_id insert — PK conflict surfaced, not swallowed', async () => {
    const mock = createMockSupabaseClient();
    const contract = makeContract();

    // No row visible to the pre-read (e.g. a racing concurrent insert), empty
    // registry-version scan, then the INSERT trips the PK unique violation.
    mock._chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );
    mock._chain.single.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "eval_touchpoints_pkey"',
        details: 'Key (touchpoint_id)=(tool.classify_content) already exists.',
        hint: '',
      },
    });

    // The conflict must surface as a SupabaseError carrying the PK violation
    // code — not be swallowed into a silent success or a generic Error.
    const error = await registerTouchpoint(asClient(mock), contract).then(
      () => {
        throw new Error('expected a duplicate-id rejection, but it resolved');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SupabaseError);
    expect((error as SupabaseError).code).toBe('23505');
  });

  it('advances contract_version AND registry_version when a contract field changes', async () => {
    const mock = createMockSupabaseClient();
    const stored = makeContract({ owner: 'platform-team' });
    const incoming = makeContract({ owner: 'evals-team' }); // owner changed

    // Pre-read returns the stored row at v1/v3; registry scan sees max
    // registry_version 3 across the table; the UPDATE returns the bumped row.
    mock._chain.maybeSingle.mockResolvedValueOnce({
      data: makeRow(stored, { contract_version: 1, registry_version: 3 }),
      error: null,
    });
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({
        data: [{ registry_version: 3 }, { registry_version: 1 }],
        error: null,
        count: 2,
      }),
    );
    mock._chain.single.mockResolvedValueOnce({
      data: makeRow(incoming, { contract_version: 2, registry_version: 4 }),
      error: null,
    });

    const row = await registerTouchpoint(asClient(mock), incoming);

    expect(mock._chain.update).toHaveBeenCalledTimes(1);
    const patch = mock._chain.update.mock.calls[0][0];
    expect(patch.contract_version).toBe(2); // stored 1 -> 2
    expect(patch.registry_version).toBe(4); // table max 3 -> 4
    expect(patch.owner).toBe('evals-team');
    expect(row.contract_version).toBe(2);
    expect(row.registry_version).toBe(4);
  });

  it('is a no-op (no version churn) when re-registering an identical contract', async () => {
    const mock = createMockSupabaseClient();
    const contract = makeContract();

    mock._chain.maybeSingle.mockResolvedValueOnce({
      data: makeRow(contract, { contract_version: 2, registry_version: 5 }),
      error: null,
    });

    const row = await registerTouchpoint(asClient(mock), contract);

    expect(mock._chain.insert).not.toHaveBeenCalled();
    expect(mock._chain.update).not.toHaveBeenCalled();
    expect(row.contract_version).toBe(2);
    expect(row.registry_version).toBe(5);
  });

  it('rejects a contract that fails schema validation before any DB write', async () => {
    const mock = createMockSupabaseClient();
    // severity_on_fail is not a member of the SeverityTier union.
    const bad = {
      ...makeContract(),
      severity_on_fail: 'catastrophic',
    } as unknown as AgentEvalContract;

    await expect(registerTouchpoint(asClient(mock), bad)).rejects.toThrow();
    expect(mock.from).not.toHaveBeenCalled();
  });
});

describe('getTouchpoint', () => {
  it('returns the registered row with its bound contract + owner', async () => {
    const mock = createMockSupabaseClient();
    const contract = makeContract();
    mock._chain.maybeSingle.mockResolvedValueOnce({
      data: makeRow(contract, { contract_version: 1, registry_version: 1 }),
      error: null,
    });

    const row = await getTouchpoint(asClient(mock), 'tool.classify_content');

    expect(mock.from).toHaveBeenCalledWith('eval_touchpoints');
    expect(row?.touchpoint_id).toBe('tool.classify_content');
    expect(row?.owner).toBe('platform-team');
  });

  it('returns null for an unregistered touchpoint (the runner gate substrate)', async () => {
    const mock = createMockSupabaseClient();
    mock._chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const row = await getTouchpoint(asClient(mock), 'tool.never_registered');

    expect(row).toBeNull();
  });
});

describe('listTouchpoints', () => {
  it('returns registered rows with bound contract + owner', async () => {
    const mock = createMockSupabaseClient();
    const a = makeContract({ touchpoint_id: 'tool.a', owner: 'team-a' });
    const b = makeContract({ touchpoint_id: 'prompt.b', owner: 'team-b' });
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({
        data: [
          makeRow(a, { contract_version: 1, registry_version: 1 }),
          makeRow(b, { contract_version: 2, registry_version: 2 }),
        ],
        error: null,
        count: 2,
      }),
    );

    const rows = await listTouchpoints(asClient(mock));

    expect(mock.from).toHaveBeenCalledWith('eval_touchpoints');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.touchpoint_id)).toEqual(['tool.a', 'prompt.b']);
    expect(rows.map((r) => r.owner)).toEqual(['team-a', 'team-b']);
  });

  it('returns an empty array (stable default) when the registry is empty', async () => {
    const mock = createMockSupabaseClient();
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );

    const rows = await listTouchpoints(asClient(mock));

    expect(rows).toEqual([]);
  });
});
