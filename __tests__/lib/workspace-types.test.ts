/**
 * Workspace Types — Sync Constraint Tests
 *
 * Post-ID-29: `lib/workspace-types.ts` has collapsed to the sync source of
 * truth for `application_types.key` (used by Zod schema construction at
 * module-load). Only `APPLICATION_TYPE_KEYS` + `getValidTypeValues()`
 * remain — UI metadata surface lives in
 * `hooks/workspaces/use-application-types.ts` (tested in
 * `__tests__/hooks/workspaces/use-application-types.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { getValidTypeValues } from '@/lib/workspace-types';

describe('workspace-types sync constraint', () => {
  describe('getValidTypeValues', () => {
    it('returns a non-empty tuple', () => {
      const values = getValidTypeValues();
      expect(values.length).toBeGreaterThanOrEqual(1);
    });

    it('includes procurement and intelligence (active DB application types)', () => {
      // Post-T2: 'bid' renamed to 'procurement'; 'kb_section' retired.
      const values = getValidTypeValues();
      expect(values).toContain('procurement');
      expect(values).toContain('intelligence');
    });

    it('first element is a string (tuple shape)', () => {
      const values = getValidTypeValues();
      expect(typeof values[0]).toBe('string');
    });

    it('returns all 6 application_types seed keys', () => {
      // Sync constraint: must match the `application_types` table seed.
      // Update both in lockstep when a seed key is added or retired.
      const values = getValidTypeValues();
      expect(values).toEqual([
        'procurement',
        'intelligence',
        'sales_proposal',
        'product_guide',
        'competitor_research',
        'training_onboarding',
      ]);
    });
  });
});
