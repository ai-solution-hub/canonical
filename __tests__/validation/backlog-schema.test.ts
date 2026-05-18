/**
 * backlog-schema.test.ts
 *
 * Unit tests for `lib/validation/backlog-schema.ts`.
 *
 * Tests verify real behaviour against the spec (PRODUCT.md inv 36–40, 42 +
 * TECH §3). Fixtures are constructed manually — the live `product-backlog.json`
 * is NOT parsed here because the existing 36 items carry `needs_spec` (legacy
 * form) rather than the canonical `spec_needed`. The 36-item retrofit is
 * deferred to FU-NEW; this suite tests the SCHEMA, not the current data file.
 *
 * Test coverage:
 *   - Valid item per each BacklogStatus value (5 cases, one per subset value)
 *   - Invalid status rejected (legacy `needs_spec`, forbidden `done`, etc.)
 *   - New optional fields (`details`, `testStrategy`) accept null + string
 *   - New optional fields may be omitted entirely
 *   - Root BacklogSchema validates a minimal document
 *   - Root BacklogSchema validates a document with multiple items
 *   - Required fields — missing `id`, `description`, `status` each rejected
 *   - Priority enum — valid subset values accepted, invalid value rejected
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
  id: 'C1-T3-Settings-3',
  description: 'Getting Started checklist for first-time admins',
  type: 'feature' as const,
  status: 'spec_needed' as const,
  effort_estimate: '3-5h',
  priority: 'medium' as const,
  track: 'onboarding',
  depends_on: [],
  surfaced: 'Design critique audit',
  notes: null,
};

// ──────────────────────────────────────────────────────────────────────────────
// BacklogStatus re-export
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogStatus re-export', () => {
  it('contains exactly the 5 pre-work values', () => {
    expect(BacklogStatus.options).toHaveLength(5);
    expect(BacklogStatus.options).toEqual(
      expect.arrayContaining(['spec_needed', 'needs_research', 'parked', 'ready', 'blocked']),
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
      id: 'C1-DT-Login-1',
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
      id: 'OPS-99',
      description: 'Parked feature for future consideration',
      status: 'parked',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status: ready', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      id: 'OPS-100',
      description: 'Ready to be picked up',
      status: 'ready',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status: blocked', () => {
    const result = BacklogItemSchema.safeParse({
      ...VALID_ITEM_BASE,
      id: 'OPS-101',
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
      details: 'This item requires a spec to be authored first.\n\nSee `docs/specs/` for conventions.',
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
      testStrategy: 'Render the onboarding overlay in Playwright; assert 3 steps visible.',
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
});

// ──────────────────────────────────────────────────────────────────────────────
// BacklogItemSchema — priority field
// ──────────────────────────────────────────────────────────────────────────────

describe('BacklogItemSchema — priority field', () => {
  it('accepts high', () => {
    expect(BacklogItemSchema.safeParse({ ...VALID_ITEM_BASE, priority: 'high' }).success).toBe(true);
  });

  it('accepts medium', () => {
    expect(BacklogItemSchema.safeParse({ ...VALID_ITEM_BASE, priority: 'medium' }).success).toBe(true);
  });

  it('accepts low', () => {
    expect(BacklogItemSchema.safeParse({ ...VALID_ITEM_BASE, priority: 'low' }).success).toBe(true);
  });

  it('rejects unknown priority value', () => {
    expect(
      BacklogItemSchema.safeParse({ ...VALID_ITEM_BASE, priority: 'critical' }).success,
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
    last_updated: 'kh-prod-readiness-S50 Wave A.1',
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
      expect(result.data.items[0].id).toBe('C1-T3-Settings-3');
    }
  });

  it('validates a document with multiple items covering different statuses', () => {
    const items = [
      { ...VALID_ITEM_BASE, id: 'A1', status: 'spec_needed' as const },
      { ...VALID_ITEM_BASE, id: 'A2', status: 'needs_research' as const, type: 'research' as const },
      { ...VALID_ITEM_BASE, id: 'A3', status: 'parked' as const },
      { ...VALID_ITEM_BASE, id: 'A4', status: 'ready' as const },
      { ...VALID_ITEM_BASE, id: 'A5', status: 'blocked' as const },
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
