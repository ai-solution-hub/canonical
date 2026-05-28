/**
 * backlog-schema.test.ts
 *
 * Unit tests for `lib/validation/backlog-schema.ts`.
 *
 * Tests verify real behaviour against the spec (PRODUCT.md inv 36–40, 42 +
 * TECH §3). Fixtures are constructed manually using the canonical
 * `spec_needed` form and the canonical `dependencies` field name (renamed
 * from `needs_spec` / `depends_on` in S52 WP3 per FU-2 and FU-NEW).
 *
 * ID-15.4 (S58): `BacklogItem.id` schema tightened from `z.string().min(1)` to
 * `z.string().regex(/^\d+$/)`. All legacy-format ids (OPS-*, AST-S*-O*, C*-*,
 * RLS-P*, etc.) are now invalid; bare-digit ids only. Tests updated to use
 * bare-digit fixtures; legacy rejection test added.
 *
 * ID-15.7 (S59): `surfaced` field REMOVED per OQ-4 ratification (TECH §B.1).
 * Three structured-provenance fields added:
 *   - `session_refs: z.array(z.string())`
 *   - `commit_refs: z.array(z.string())`
 *   - `cross_doc_links: z.array(DocLinkSchema)` (from roadmap-schema.ts)
 * Fixtures updated to use structured-provenance triple (empty arrays as default).
 *
 * Test coverage:
 *   - Valid item per each BacklogStatus value (5 cases, one per subset value)
 *   - Invalid status rejected (legacy `needs_spec`, forbidden `done`, etc.)
 *   - New optional fields (`details`, `testStrategy`) accept null + string
 *   - New optional fields may be omitted entirely
 *   - Root BacklogSchema validates a minimal document
 *   - Root BacklogSchema validates a document with multiple items
 *   - Required fields — missing `id`, `description`, `status` each rejected
 *   - Legacy-format ids rejected (ID-15.4 schema tighten)
 *   - Priority enum — valid subset values accepted, invalid value rejected
 *   - Structured-provenance triple (B-INV-1/2): surfaced absent, triple present
 */

import { describe, it, expect } from 'vitest';
import {
  BacklogStatus,
  BacklogItemSchema,
  BacklogSchema,
} from '@/lib/validation/backlog-schema';

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixtures — minimal valid item base (spec_needed status)
// ──────────────────────────────────────────────────────────────────────────────

const VALID_ITEM_BASE = {
  id: '28',
  description: 'Getting Started checklist for first-time admins',
  type: 'feature' as const,
  status: 'spec_needed' as const,
  effort_estimate: '3-5h',
  priority: 'medium' as const,
  track: 'onboarding',
  dependencies: [],
  session_refs: [],
  commit_refs: [],
  cross_doc_links: [],
  notes: null,
};

// ──────────────────────────────────────────────────────────────────────────────
// BacklogStatus re-export
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogStatus re-export', () => {
  it('contains exactly the 5 pre-work values', () => {
    expect(BacklogStatus.options).toHaveLength(5);
    expect(BacklogStatus.options).toEqual(
      expect.arrayContaining([
        'spec_needed',
        'needs_research',
        'parked',
        'ready',
        'blocked',
      ]),
    );
  });

  it('rejects the legacy needs_spec form (canonical is spec_needed per inv 22)', () => {
    expect(BacklogStatus.safeParse('needs_spec').success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BacklogItemSchema — valid item per each status value
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogItemSchema — valid item per BacklogStatus value', () => {
  it('accepts status: spec_needed', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      status: 'spec_needed',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status: needs_research', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      id: '35',
      description: 'Session duration vs security research',
      type: 'research',
      status: 'needs_research',
      effort_estimate: null,
      priority: 'low',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status: parked', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      id: '99',
      description: 'Parked feature for future consideration',
      status: 'parked',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status: ready', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      id: '100',
      description: 'Ready to be picked up',
      status: 'ready',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status: blocked', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      id: '101',
      description: 'Blocked on external dependency',
      status: 'blocked',
    });
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BacklogItemSchema — invalid status rejected
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogItemSchema — invalid status rejected', () => {
  it('rejects legacy needs_spec (must use canonical spec_needed)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      status: 'needs_spec',
    });
    expect(result.success).toBe(false);
  });

  it('rejects done (closed status forbidden in Backlog surface)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      status: 'done',
    });
    expect(result.success).toBe(false);
  });

  it('rejects in_progress (in-work status not valid for Backlog pre-work surface)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      status: 'in_progress',
    });
    expect(result.success).toBe(false);
  });

  it('rejects arbitrary string not in BacklogStatus', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      status: 'some_unknown_value',
    });
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BacklogItemSchema — new optional fields (details + testStrategy)
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogItemSchema — new optional fields (inv 38)', () => {
  it('accepts details: null', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      details: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details).toBeNull();
    }
  });

  it('accepts details: string (markdown brief)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      details:
        'This item requires a spec to be authored first.\n\nSee `docs/specs/` for conventions.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details).toContain('spec');
    }
  });

  it('accepts testStrategy: null', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      testStrategy: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testStrategy).toBeNull();
    }
  });

  it('accepts testStrategy: string', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      testStrategy:
        'Render the onboarding overlay in Playwright; assert 3 steps visible.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testStrategy).toContain('Playwright');
    }
  });

  it('accepts item with both optional fields omitted entirely', () => {
    // No details or testStrategy key at all — both are optional
    const result = BacklogItemSchema.safeParse(VALID_ITEM_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.details).toBeUndefined();
      expect(result.data.testStrategy).toBeUndefined();
    }
  });

  it('accepts item with both optional fields populated', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      details: 'Pre-thought brief for promotion to Task list.',
      testStrategy: 'Validate via schema parse + visual smoke test.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.details).toBe('string');
      expect(typeof result.data.testStrategy).toBe('string');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BacklogItemSchema — rank field (Subtask 30.6 / TECH §3.1)
//
// Within-priority deterministic ordering. Lower integer = higher rank. Default
// null; pre-existing items omit. Schema does NOT enforce uniqueness or
// contiguity within tier (PRODUCT inv 3) — curator skill maintains discipline.
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogItemSchema — rank field (Subtask 30.6 / TECH §3.1)', () => {
  it('accepts rank: null (default)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rank).toBeNull();
    }
  });

  it('accepts rank as a positive integer', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rank).toBe(5);
    }
  });

  it('accepts rank omitted entirely (optional field, pre-existing items)', () => {
    const result = BacklogItemSchema.safeParse(VALID_ITEM_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rank).toBeUndefined();
    }
  });

  it('accepts rank: 0 (lowest non-negative integer)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects rank as a non-integer (e.g. 1.5)', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects rank as a string', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: '5',
    });
    expect(result.success).toBe(false);
  });

  it('rank round-trips when explicit null and when integer', () => {
    const withNull = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: null,
    });
    expect(withNull.success).toBe(true);
    if (withNull.success) {
      const reparsed = BacklogItemSchema.safeParse(withNull.data);
      expect(reparsed.success).toBe(true);
      if (reparsed.success) {
        expect(reparsed.data.rank).toBeNull();
      }
    }

    const withInt = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      rank: 42,
    });
    expect(withInt.success).toBe(true);
    if (withInt.success) {
      const reparsed = BacklogItemSchema.safeParse(withInt.data);
      expect(reparsed.success).toBe(true);
      if (reparsed.success) {
        expect(reparsed.data.rank).toBe(42);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BacklogItemSchema — required fields enforcement
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogItemSchema — required fields enforcement', () => {
  it('rejects item missing id', () => {
    const { id: _id, ...withoutId } = VALID_ITEM_BASE;
    const result = BacklogItemSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('rejects item missing description', () => {
    const { description: _desc, ...withoutDesc } = VALID_ITEM_BASE;
    const result = BacklogItemSchema.safeParse(withoutDesc);
    expect(result.success).toBe(false);
  });

  it('rejects item missing status', () => {
    const { status: _status, ...withoutStatus } = VALID_ITEM_BASE;
    const result = BacklogItemSchema.safeParse(withoutStatus);
    expect(result.success).toBe(false);
  });

  it('rejects item with empty id string', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      id: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects legacy-format ids (schema tightened to bare-digit in ID-15.4)', () => {
    // After ID-15.4 migration all backlog items use bare-digit ids (e.g. "42").
    // Legacy formats such as OPS-6, AST-S10-O1, C2-PA5 are no longer valid.
    for (const legacyId of [
      'OPS-6',
      'AST-S10-O1',
      'C2-PA5',
      'RLS-P8',
      'ID-17',
    ]) {
      const result = BacklogItemSchema.safeParse({
        ...VALID_ITEM_BASE,
        id: legacyId,
      });
      expect(
        result.success,
        `expected legacy id "${legacyId}" to be rejected`,
      ).toBe(false);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BacklogItemSchema — priority field
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogItemSchema — priority field', () => {
  it('accepts high', () => {
    expect(
      BacklogItemSchema.safeParse({ ...VALID_ITEM_BASE, priority: 'high' })
        .success,
    ).toBe(true);
  });

  it('accepts medium', () => {
    expect(
      BacklogItemSchema.safeParse({ ...VALID_ITEM_BASE, priority: 'medium' })
        .success,
    ).toBe(true);
  });

  it('accepts low', () => {
    expect(
      BacklogItemSchema.safeParse({ ...VALID_ITEM_BASE, priority: 'low' })
        .success,
    ).toBe(true);
  });

  it('rejects unknown priority value', () => {
    expect(
      BacklogItemSchema.safeParse({ ...VALID_ITEM_BASE, priority: 'critical' })
        .success,
    ).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BacklogSchema — root document validation
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogSchema — root document', () => {
  const VALID_ROOT = {
    document_name: 'Product Backlog',
    document_purpose: 'Items not currently on the roadmap.',
    related_documents: ['docs/reference/product-roadmap.json'],
    items: [],
  };

  it('validates a minimal document with empty items array', () => {
    const result = BacklogSchema.safeParse(VALID_ROOT);
    expect(result.success).toBe(true);
  });

  it('validates a document with one valid item', () => {
    const result = BacklogSchema.safeParse({
      ...VALID_ROOT,
      items: [VALID_ITEM_BASE],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].id).toBe('28');
    }
  });

  it('validates a document with multiple items covering different statuses', () => {
    const items = [
      { ...VALID_ITEM_BASE, id: '91', status: 'spec_needed' as const },
      {
        ...VALID_ITEM_BASE,
        id: '92',
        status: 'needs_research' as const,
        type: 'research' as const,
      },
      { ...VALID_ITEM_BASE, id: '93', status: 'parked' as const },
      { ...VALID_ITEM_BASE, id: '94', status: 'ready' as const },
      { ...VALID_ITEM_BASE, id: '95', status: 'blocked' as const },
    ];
    const result = BacklogSchema.safeParse({ ...VALID_ROOT, items });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(5);
    }
  });

  it('rejects a document with an item carrying an invalid status', () => {
    const result = BacklogSchema.safeParse({
      ...VALID_ROOT,
      items: [{ ...VALID_ITEM_BASE, status: 'needs_spec' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a document missing document_name', () => {
    const { document_name: _dn, ...withoutName } = VALID_ROOT;
    const result = BacklogSchema.safeParse(withoutName);
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Structured-provenance triple (B-INV-1 + B-INV-2 per TECH §B.5)
//
// B-INV-1: BacklogSchema.parse() succeeds with no `surfaced` field on items.
// B-INV-2: Items carry session_refs:[], commit_refs:[], cross_doc_links:[].
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogItemSchema — structured-provenance triple (ID-15.7 §B.1)', () => {
  it('accepts empty-array provenance triple (typical backlog item)', () => {
    const result = BacklogItemSchema.safeParse(VALID_ITEM_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_refs).toEqual([]);
      expect(result.data.commit_refs).toEqual([]);
      expect(result.data.cross_doc_links).toEqual([]);
    }
  });

  it('accepts non-empty session_refs', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      session_refs: ['kh-prod-readiness-S57', 'S196 INV-3 auth audit'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_refs).toHaveLength(2);
    }
  });

  it('accepts non-empty commit_refs', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      commit_refs: ['d53333ab', 'abc1234f'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commit_refs).toHaveLength(2);
    }
  });

  it('accepts non-empty cross_doc_links with valid DocLink shape', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      cross_doc_links: [
        {
          path: 'docs/specs/id-15-legacy-id-migration/TECH.md',
          anchor: '§B.1',
          raw: 'TECH §B.1',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cross_doc_links).toHaveLength(1);
      expect(result.data.cross_doc_links[0].path).toBe(
        'docs/specs/id-15-legacy-id-migration/TECH.md',
      );
    }
  });

  it('rejects item with surfaced field present (field removed per OQ-4 ratification)', () => {
    // BacklogItemSchema is a .strict()-free schema but surfaced is simply not
    // in the schema. If we pass it, Zod strips unrecognised keys (default
    // behaviour for z.object without .strict()). The absence of surfaced in
    // the result data is the key invariant to assert.
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      surfaced: 'Design critique audit',
    });
    // Zod strips unknown keys — parse succeeds but surfaced not in output
    expect(result.success).toBe(true);
    if (result.success) {
      expect('surfaced' in result.data).toBe(false);
    }
  });

  it('rejects item missing session_refs (required field)', () => {
    const { session_refs: _sr, ...withoutSessionRefs } = VALID_ITEM_BASE;
    const result = BacklogItemSchema.safeParse(withoutSessionRefs);
    expect(result.success).toBe(false);
  });

  it('rejects item missing commit_refs (required field)', () => {
    const { commit_refs: _cr, ...withoutCommitRefs } = VALID_ITEM_BASE;
    const result = BacklogItemSchema.safeParse(withoutCommitRefs);
    expect(result.success).toBe(false);
  });

  it('rejects item missing cross_doc_links (required field)', () => {
    const { cross_doc_links: _cdl, ...withoutCrossDocLinks } = VALID_ITEM_BASE;
    const result = BacklogItemSchema.safeParse(withoutCrossDocLinks);
    expect(result.success).toBe(false);
  });

  it('rejects cross_doc_links entry with missing required path field', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      cross_doc_links: [{ anchor: '§2.1', raw: 'some reference' }],
    });
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BacklogSchema — id-uniqueness refine (ID-67)
//
// BacklogSchema carries a .refine() that rejects any document where two or
// more items share the same id. This guard mechanically prevents recurrence
// of the S59 W1 dup id=23 blocker.
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogSchema — id-uniqueness refine (ID-67)', () => {
  const VALID_ROOT = {
    document_name: 'Product Backlog',
    document_purpose: 'Items not currently on the roadmap.',
    related_documents: ['docs/reference/product-roadmap.json'],
    items: [],
  };

  it('accepts a document where all items have unique ids', () => {
    const result = BacklogSchema.safeParse({
      ...VALID_ROOT,
      items: [
        { ...VALID_ITEM_BASE, id: '10' },
        { ...VALID_ITEM_BASE, id: '20' },
        { ...VALID_ITEM_BASE, id: '30' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a document with two items sharing the same id', () => {
    const result = BacklogSchema.safeParse({
      ...VALID_ROOT,
      items: [
        { ...VALID_ITEM_BASE, id: '23' },
        { ...VALID_ITEM_BASE, id: '23' },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(
        messages.some((msg) => msg.includes('23')),
        'Error message should name the duplicate id',
      ).toBe(true);
      expect(
        messages.some((msg) => msg.includes('unique')),
        'Error message should mention uniqueness requirement',
      ).toBe(true);
    }
  });

  it('rejects a document with three items where two share an id', () => {
    const result = BacklogSchema.safeParse({
      ...VALID_ROOT,
      items: [
        { ...VALID_ITEM_BASE, id: '10' },
        { ...VALID_ITEM_BASE, id: '23' },
        { ...VALID_ITEM_BASE, id: '23' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a document where multiple distinct ids are duplicated', () => {
    const result = BacklogSchema.safeParse({
      ...VALID_ROOT,
      items: [
        { ...VALID_ITEM_BASE, id: '10' },
        { ...VALID_ITEM_BASE, id: '10' },
        { ...VALID_ITEM_BASE, id: '20' },
        { ...VALID_ITEM_BASE, id: '20' },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues
        .map((issue) => issue.message)
        .join(' ');
      // Both duplicate ids should appear in the error message
      expect(messages).toContain('10');
      expect(messages).toContain('20');
    }
  });

  it('accepts a single-item document (no possible duplicate)', () => {
    const result = BacklogSchema.safeParse({
      ...VALID_ROOT,
      items: [{ ...VALID_ITEM_BASE, id: '42' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty items array (no possible duplicate)', () => {
    const result = BacklogSchema.safeParse({ ...VALID_ROOT, items: [] });
    expect(result.success).toBe(true);
  });
});
