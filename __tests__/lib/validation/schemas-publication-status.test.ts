/**
 * Validation tests for `publication_status` editable-field wiring
 * (S202 §5.2 Phase 2 / T6).
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §8.1, §8.2, AC6.3
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T6
 *
 * Covers AC6.3: `EDITABLE_FIELDS` includes `'publication_status'`;
 * `ItemUpdateBodySchema` accepts `field='publication_status'` with valid enum
 * values, rejects null + non-enum values, and accepts an optional
 * `archive_reason` peer field (≤500 chars).
 */
import { describe, it, expect } from 'vitest';
import {
  ItemUpdateBodySchema,
  EDITABLE_FIELDS,
  validateEditableField,
} from '@/lib/validation/schemas';
import { VALID_PUBLICATION_STATUSES } from '@/lib/governance/publication-transitions';

describe('publication_status — editable-field wiring (AC6.3)', () => {
  it('EDITABLE_FIELDS contains "publication_status"', () => {
    expect(EDITABLE_FIELDS.has('publication_status')).toBe(true);
  });

  it('validateEditableField("publication_status") returns true', () => {
    expect(validateEditableField('publication_status')).toBe(true);
  });
});

describe('ItemUpdateBodySchema — publication_status branch (AC6.3)', () => {
  // -------------------------------------------------------------------------
  // Acceptance — every CHECK-enforced enum value passes validation.
  // Source: VALID_PUBLICATION_STATUSES from publication-transitions helper
  // (drift-guarded against the SQL CHECK array by the helper's own tests).
  // -------------------------------------------------------------------------
  for (const status of VALID_PUBLICATION_STATUSES) {
    it(`accepts field='publication_status' value='${status}'`, () => {
      const result = ItemUpdateBodySchema.safeParse({
        field: 'publication_status',
        value: status,
      });
      expect(result.success).toBe(true);
    });
  }

  it('rejects field="publication_status" with value=null', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'publication_status',
      value: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(
        messages.some((m) => /publication_status cannot be null/i.test(m)),
      ).toBe(true);
    }
  });

  it('rejects field="publication_status" with non-enum value', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'publication_status',
      value: 'not_a_status',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(
        messages.some((m) => /publication_status must be one of/i.test(m)),
      ).toBe(true);
    }
  });

  it('rejects field="publication_status" with array value (wrong shape)', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'publication_status',
      value: ['draft'],
    });
    expect(result.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Optional archive_reason peer field — valid <= 500 chars; rejected > 500.
  // -------------------------------------------------------------------------
  it('accepts optional archive_reason ≤ 500 chars alongside field="publication_status"', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'publication_status',
      value: 'archived',
      archive_reason: 'superseded by v2 — content materially restructured',
    });
    expect(result.success).toBe(true);
  });

  it('rejects archive_reason > 500 chars', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'publication_status',
      value: 'archived',
      archive_reason: 'a'.repeat(501),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod string max-violation message contains the field path.
      const archiveReasonIssue = result.error.issues.find((i) =>
        i.path.includes('archive_reason'),
      );
      expect(archiveReasonIssue).toBeDefined();
    }
  });

  it('accepts omitted archive_reason (it is optional)', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'publication_status',
      value: 'in_review',
    });
    expect(result.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Cross-check: archive_reason is at the top level (peer of `value`), not
  // nested under value. A caller passing it inside `value` should fail.
  // -------------------------------------------------------------------------
  it('archive_reason inside value (wrong shape) is rejected', () => {
    const result = ItemUpdateBodySchema.safeParse({
      field: 'publication_status',
      value: { status: 'archived', archive_reason: 'x' },
    });
    expect(result.success).toBe(false);
  });
});
