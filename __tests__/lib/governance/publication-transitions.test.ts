/**
 * Unit tests for the §5.2 publication-lifecycle transition helper.
 *
 * Covers:
 * - VALID_PUBLICATION_STATUSES drift guard against the SQL CHECK array.
 * - computeAllowedTransitions for every (currentStatus, role) pair (4×3).
 * - Specific role-gate ACs (AC3.3–AC3.6).
 * - applyTransitionSideEffects mutation table (per plan T5 lines 376–387).
 * - Non-mutation guarantee on applyTransitionSideEffects.
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §3.2, §3.4, §8.3
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T5
 *
 * Pinned-time pattern per CLAUDE.md ("Date-sensitive tests need pinned time"
 * gotcha) — `vi.useFakeTimers()` + `vi.setSystemTime()` so `archived_at`
 * timestamps assert against a deterministic ISO string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Database } from '@/supabase/types/database.types';
import {
  VALID_PUBLICATION_STATUSES,
  computeAllowedTransitions,
  applyTransitionSideEffects,
  type PublicationStatus,
  type UserRole,
} from '@/lib/governance/publication-transitions';

// Pinned timestamp for archived_at assertions. Chosen as a midday UTC value
// so DST and midnight-boundary rounding don't confound the ISO comparison.
const PINNED_NOW_ISO = '2026-04-27T12:00:00.000Z';
const PINNED_NOW = new Date(PINNED_NOW_ISO);

// Canonical user id used across tests — RFC 4122 v4 compliant per CLAUDE.md
// gotcha "Zod UUID validation is strict".
const USER_ID = 'a0000000-0000-4000-8000-000000000001';

describe('VALID_PUBLICATION_STATUSES', () => {
  it('matches the canonical SQL CHECK array order verbatim', () => {
    // Drift guard per CLAUDE.md `feedback_check_constraint_app_enum_drift`.
    //
    // The generated `database.types.ts` carries `publication_status: string`
    // (not a literal union — see `supabase/types/database.types.ts:574,650,
    // 726,2770`), so we cannot extract the four-value tuple at compile time.
    // Encoding the canonical array as a fixture provides runtime drift
    // detection: a CHECK widening in PG without a TS update fails this test
    // loudly.
    //
    // TODO(future): replace with a `pg_get_constraintdef` extraction in the
    // generated types or a side-channel JSON fixture pulled from migration
    // SQL — would catch silent CHECK widenings end-to-end.
    expect(VALID_PUBLICATION_STATUSES).toEqual([
      'draft',
      'in_review',
      'published',
      'archived',
    ]);
  });

  it('is type-compatible with the generated `content_items.publication_status` column', () => {
    // Compile-time check: every value in VALID_PUBLICATION_STATUSES is
    // assignable to the generated column type. The generated type is
    // `string`, so this is a one-way check — but it ensures we never
    // accidentally widen the tuple beyond what the column accepts.
    type ColumnType = Database['public']['Tables']['content_items']['Row']['publication_status'];
    const sample = VALID_PUBLICATION_STATUSES[0] satisfies ColumnType;
    expect(typeof sample).toBe('string');
  });
});

describe('computeAllowedTransitions — full matrix (AC3.1, AC3.2)', () => {
  // The expected matrix encodes spec §3.2 (transition table + disallowed
  // list) intersected with §3.4 (role-gate matrix) verbatim. Each cell is
  // the EXACT set of allowed `newStatus` values for that (currentStatus,
  // role) pair.
  //
  // Discrepancies with the prompt's "instruction matrix" — spec wins:
  //
  // 1. `'in_review'` editor: spec §3.4 says YES per §5.3 for both
  //    `in_review→published` AND `in_review→draft`; prompt instruction said
  //    `['draft']` only. Spec is authoritative.
  // 2. `'published'` admin: spec §3.4 + §3.2 disallowed list say
  //    `['archived', 'draft']` (published→in_review is DISALLOWED). Prompt
  //    instruction said `['in_review', 'archived']`. Spec is authoritative.
  // 3. `'archived'` admin: spec §3.4 + §3.2 disallowed list say
  //    `['published', 'draft']` (archived→in_review is DISALLOWED). Prompt
  //    instruction said `['published', 'draft', 'in_review']`. Spec is
  //    authoritative.
  const cases: ReadonlyArray<{
    currentStatus: PublicationStatus;
    role: UserRole;
    expected: readonly PublicationStatus[];
  }> = [
    // From draft
    { currentStatus: 'draft', role: 'admin', expected: ['in_review', 'published'] },
    { currentStatus: 'draft', role: 'editor', expected: ['in_review'] },
    { currentStatus: 'draft', role: 'viewer', expected: [] },
    // From in_review
    { currentStatus: 'in_review', role: 'admin', expected: ['published', 'draft'] },
    { currentStatus: 'in_review', role: 'editor', expected: ['published', 'draft'] },
    { currentStatus: 'in_review', role: 'viewer', expected: [] },
    // From published
    { currentStatus: 'published', role: 'admin', expected: ['archived', 'draft'] },
    { currentStatus: 'published', role: 'editor', expected: [] },
    { currentStatus: 'published', role: 'viewer', expected: [] },
    // From archived
    { currentStatus: 'archived', role: 'admin', expected: ['published', 'draft'] },
    { currentStatus: 'archived', role: 'editor', expected: [] },
    { currentStatus: 'archived', role: 'viewer', expected: [] },
  ];

  it.each(cases)(
    'computeAllowedTransitions($currentStatus, $role) returns $expected',
    ({ currentStatus, role, expected }) => {
      const result = computeAllowedTransitions(currentStatus, role);
      expect([...result]).toEqual([...expected]);
    },
  );

  it('every spec-disallowed transition is absent from every role (AC3.2)', () => {
    // Spec §3.2 disallowed list — must be empty across ALL roles.
    const disallowedPairs: ReadonlyArray<[PublicationStatus, PublicationStatus]> = [
      ['draft', 'archived'],
      ['in_review', 'archived'],
      ['archived', 'in_review'],
      ['published', 'in_review'],
    ];
    const allRoles: readonly UserRole[] = ['admin', 'editor', 'viewer'];

    for (const [from, to] of disallowedPairs) {
      for (const role of allRoles) {
        const allowed = computeAllowedTransitions(from, role);
        expect(allowed).not.toContain(to);
      }
    }
  });
});

describe('computeAllowedTransitions — specific role-gate ACs', () => {
  it('AC3.3: `draft → in_review` allowed for editor', () => {
    expect(computeAllowedTransitions('draft', 'editor')).toContain('in_review');
  });

  it('AC3.4: `draft → published` allowed for admin only (editor returns empty for that target)', () => {
    expect(computeAllowedTransitions('draft', 'admin')).toContain('published');
    expect(computeAllowedTransitions('draft', 'editor')).not.toContain('published');
    expect(computeAllowedTransitions('draft', 'viewer')).not.toContain('published');
  });

  it('AC3.5: `published → archived` allowed for admin only', () => {
    expect(computeAllowedTransitions('published', 'admin')).toContain('archived');
    expect(computeAllowedTransitions('published', 'editor')).not.toContain('archived');
    expect(computeAllowedTransitions('published', 'viewer')).not.toContain('archived');
  });

  it('AC3.6: `archived → published` admin-only, plus `archived → draft` admin-only', () => {
    expect(computeAllowedTransitions('archived', 'admin')).toContain('published');
    expect(computeAllowedTransitions('archived', 'admin')).toContain('draft');
    expect(computeAllowedTransitions('archived', 'editor')).toEqual([]);
    expect(computeAllowedTransitions('archived', 'viewer')).toEqual([]);
  });
});

describe('applyTransitionSideEffects', () => {
  beforeEach(() => {
    // `vi.useFakeTimers()` intercepts both `Date.now()` AND `new Date()`
    // constructor — same pattern as cadence-renewal.test.ts so
    // `new Date().toISOString()` inside the helper produces a deterministic
    // string (per CLAUDE.md "Date-sensitive tests need pinned time").
    vi.useFakeTimers();
    vi.setSystemTime(PINNED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('non-archive transitions — no archive-metadata mutation', () => {
    const noArchiveTransitions: ReadonlyArray<[PublicationStatus, PublicationStatus]> = [
      ['draft', 'in_review'],
      ['draft', 'published'],
      ['in_review', 'draft'],
      ['in_review', 'published'],
      ['published', 'draft'],
    ];

    it.each(noArchiveTransitions)(
      '%s → %s leaves archived_at / archived_by / archive_reason absent from payload',
      (from, to) => {
        const result = applyTransitionSideEffects(
          { publication_status: from, updated_by: USER_ID },
          from,
          to,
          USER_ID,
        );
        expect(result.publication_status).toBe(to);
        expect(result.updated_by).toBe(USER_ID);
        // Archive keys are not added — assert absence (vs `=== null`).
        expect('archived_at' in result).toBe(false);
        expect('archived_by' in result).toBe(false);
        expect('archive_reason' in result).toBe(false);
      },
    );
  });

  describe('published → archived', () => {
    it('stamps archived_at to ISO timestamp and archived_by to userId', () => {
      const result = applyTransitionSideEffects(
        { publication_status: 'published' },
        'published',
        'archived',
        USER_ID,
      );
      expect(result.publication_status).toBe('archived');
      expect(result.archived_at).toBe(PINNED_NOW_ISO);
      expect(result.archived_by).toBe(USER_ID);
      // archive_reason absent when not provided (key omitted, not null).
      expect('archive_reason' in result).toBe(false);
    });

    it('stamps archive_reason when provided', () => {
      const result = applyTransitionSideEffects(
        { publication_status: 'published' },
        'published',
        'archived',
        USER_ID,
        'Superseded by newer policy version',
      );
      expect(result.archive_reason).toBe('Superseded by newer policy version');
    });

    it('omits archive_reason key when archiveReason argument is undefined', () => {
      const result = applyTransitionSideEffects(
        { publication_status: 'published' },
        'published',
        'archived',
        USER_ID,
        undefined,
      );
      expect('archive_reason' in result).toBe(false);
    });
  });

  describe('un-archive transitions (AC3.6)', () => {
    const unarchiveTargets: readonly PublicationStatus[] = ['published', 'draft', 'in_review'];

    it.each(unarchiveTargets)(
      'archived → %s clears archived_at to null while preserving archived_by + archive_reason',
      (target) => {
        const result = applyTransitionSideEffects(
          {
            publication_status: 'archived',
            archived_at: '2026-01-15T10:00:00.000Z',
            archived_by: 'b1111111-1111-4111-8111-111111111111',
            archive_reason: 'Original archive reason',
          },
          'archived',
          target,
          USER_ID,
        );
        expect(result.publication_status).toBe(target);
        // archived_at explicitly cleared.
        expect(result.archived_at).toBeNull();
        // archived_by + archive_reason PRESERVED (not cleared).
        expect(result.archived_by).toBe('b1111111-1111-4111-8111-111111111111');
        expect(result.archive_reason).toBe('Original archive reason');
      },
    );
  });

  describe('AC3.6 specifics — archived → published preserves audit trail', () => {
    it('clears archived_at to null but does NOT clear archived_by + archive_reason', () => {
      const result = applyTransitionSideEffects(
        {
          publication_status: 'archived',
          archived_at: '2026-01-15T10:00:00.000Z',
          archived_by: 'b1111111-1111-4111-8111-111111111111',
          archive_reason: 'Archived for legal hold',
        },
        'archived',
        'published',
        USER_ID,
      );
      expect(result.archived_at).toBeNull();
      expect(result.archived_by).toBe('b1111111-1111-4111-8111-111111111111');
      expect(result.archive_reason).toBe('Archived for legal hold');
    });
  });

  describe('non-mutation guarantee', () => {
    it('does not mutate the basePayload reference (published → archived)', () => {
      const basePayload = {
        publication_status: 'published' as const,
        updated_by: USER_ID,
        custom_field: 'preserve me',
      };
      const snapshot = { ...basePayload };
      const result = applyTransitionSideEffects(
        basePayload,
        'published',
        'archived',
        USER_ID,
        'Cleanup',
      );
      // basePayload unchanged — same keys + same values.
      expect(basePayload).toEqual(snapshot);
      // result is a different object reference.
      expect(result).not.toBe(basePayload);
      // result includes basePayload extras.
      expect(result.custom_field).toBe('preserve me');
      expect(result.updated_by).toBe(USER_ID);
    });

    it('does not mutate the basePayload reference (archived → published, audit-trail keys present)', () => {
      const basePayload = {
        publication_status: 'archived' as const,
        archived_at: '2026-01-15T10:00:00.000Z',
        archived_by: 'b1111111-1111-4111-8111-111111111111',
        archive_reason: 'Original reason',
        updated_by: USER_ID,
      };
      const snapshot = { ...basePayload };
      const result = applyTransitionSideEffects(
        basePayload,
        'archived',
        'published',
        USER_ID,
      );
      // basePayload unchanged.
      expect(basePayload).toEqual(snapshot);
      expect(basePayload.archived_at).toBe('2026-01-15T10:00:00.000Z');
      // result has cleared archived_at.
      expect(result).not.toBe(basePayload);
      expect(result.archived_at).toBeNull();
    });

    it('preserves arbitrary extra keys in the basePayload', () => {
      const result = applyTransitionSideEffects(
        {
          publication_status: 'draft',
          updated_by: USER_ID,
          updated_at: PINNED_NOW_ISO,
          some_other_key: 42,
        },
        'draft',
        'in_review',
        USER_ID,
      );
      expect(result.publication_status).toBe('in_review');
      expect(result.updated_by).toBe(USER_ID);
      expect(result.updated_at).toBe(PINNED_NOW_ISO);
      expect(result.some_other_key).toBe(42);
    });
  });
});
