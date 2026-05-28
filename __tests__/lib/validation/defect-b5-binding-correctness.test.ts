/**
 * DEFECT-B5 — wrong ResponseSchema bindings from 32.20 Source-A inference
 * (Subtask ID-32.28).
 *
 * The 32.20 Source-A codemod URL-matcher bound a schema describing a DIFFERENT
 * entity to a handful of routes. Under the {32.25} Option-4 pass-through
 * wrapper those routes throw `ResponseSchemaValidationError` LOUD because the
 * bound schema's REQUIRED top-level keys are entirely absent from the route's
 * real 2xx body (a disjoint-shape mismatch, NOT the nullable/strictness drift
 * that {32.26} owns — a permissive `.loose()` still requires its declared
 * fields, so a wrong binding rejects regardless of strictness).
 *
 * This Subtask hand-authors precise ResponseSchemas for those routes and
 * binds them via `defineRoute(...)` in the route files directly, so the
 * codemod's idempotency check (`isAlreadyWrapped`) preserves the correct
 * binding instead of re-inferring the wrong one.
 *
 * Two contracts under test (test-philosophy §1 — assert observable behaviour,
 * not generator internals):
 *
 *   (1) Each hand-authored schema is EXPORTED from `lib/validation/schemas.ts`,
 *       ACCEPTS the route's REAL 2xx body shape (verified against the handler
 *       source, not invented), and REJECTS a clearly-wrong body.
 *
 *   (2) The OLD wrongly-bound schema REJECTS the route's real body — proving
 *       the original binding was a genuine correctness defect, not a
 *       strictness artefact ({32.26}'s remit).
 *
 * Spec: docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PLAN.md §0 (the continuous
 * real-corpus probe is the AC-8 oracle); task-list.json ID-32.28 details.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import * as schemas from '@/lib/validation/schemas';

function getSchema(name: string): z.ZodTypeAny {
  return (schemas as Record<string, unknown>)[name] as z.ZodTypeAny;
}

// ── Real 2xx body fixtures (verified against each handler's success return) ──

/** GET /api/entities/co-occurrence — `{ pairs, total }`; pair rows from the
 *  `get_entity_co_occurrence` RPC Returns shape (database.types.ts). */
const coOccurrenceBody = {
  pairs: [
    {
      entity_a: 'Acme Ltd',
      entity_b: 'Globex',
      shared_count: 4,
      type_a: 'organisation',
      type_b: 'organisation',
    },
  ],
  total: 1,
};

/** PUT /api/coverage/targets — `{ success, count }` (route.ts:100). */
const coverageTargetsPutBody = { success: true, count: 3 };

/** POST /api/items/batch-review — `{ updated }` (route.ts:53). */
const batchReviewBody = { updated: 7 };

/** POST /api/items/batch-workspaces — `{ assignments }`, a
 *  `Record<string, string[]>` (route.ts:57). */
const batchWorkspacesBody = {
  assignments: { 'item-1': ['ws-a', 'ws-b'], 'item-2': ['ws-c'] },
};

/** PATCH /api/items/[id] — polymorphic; every 2xx branch shares `success`.
 *  Branches: status-transition (route.ts:362), supersession-clear (133),
 *  supersession-set (149), general field update via warningsEnvelope (935). */
const itemPatchTransitionBody = {
  success: true,
  previousStatus: 'draft',
  newStatus: 'in_review',
  transition: 'draft -> in_review',
};
const itemPatchGeneralBody = { success: true };
const itemPatchWarningsBody = {
  success: true,
  warnings: ['Quality score recalculation failed'],
};
const itemPatchSupersedeBody = {
  success: true,
  old_item: { id: 'a' },
  new_item: { id: 'b' },
};

/** DELETE /api/items/[id] — `{ deleted, id }` (route.ts:1012). */
const itemDeleteBody = { deleted: true, id: 'item-1' };

describe('DEFECT-B5 — corrected ResponseSchema bindings (ID-32.28)', () => {
  describe('co-occurrence — EntityCoOccurrenceResponseSchema', () => {
    const schema = () => getSchema('EntityCoOccurrenceResponseSchema');

    it('is exported from lib/validation/schemas.ts', () => {
      expect(schema()).toBeDefined();
    });

    it('ACCEPTS the route real body `{ pairs, total }`', () => {
      expect(schema().safeParse(coOccurrenceBody).success).toBe(true);
    });

    it('ACCEPTS an empty-pairs body (RPC returned no rows)', () => {
      expect(schema().safeParse({ pairs: [], total: 0 }).success).toBe(true);
    });

    it('REJECTS a clearly-wrong body (missing pairs)', () => {
      expect(schema().safeParse({ total: 0 }).success).toBe(false);
    });

    it('proves defect: old EntityDetailSchema REJECTS the real body', () => {
      expect(
        getSchema('EntityDetailSchema').safeParse(coOccurrenceBody).success,
      ).toBe(false);
    });
  });

  describe('coverage/targets PUT — CoverageTargetsPutResponseSchema', () => {
    const schema = () => getSchema('CoverageTargetsPutResponseSchema');

    it('is exported', () => {
      expect(schema()).toBeDefined();
    });

    it('ACCEPTS `{ success, count }`', () => {
      expect(schema().safeParse(coverageTargetsPutBody).success).toBe(true);
    });

    it('REJECTS a body missing count', () => {
      expect(schema().safeParse({ success: true }).success).toBe(false);
    });

    it('proves defect: old TargetsResponseSchema REJECTS the real PUT body', () => {
      expect(
        getSchema('TargetsResponseSchema').safeParse(coverageTargetsPutBody)
          .success,
      ).toBe(false);
    });
  });

  describe('items/batch-review — BatchReviewResponseSchema', () => {
    const schema = () => getSchema('BatchReviewResponseSchema');

    it('is exported', () => {
      expect(schema()).toBeDefined();
    });

    it('ACCEPTS `{ updated }`', () => {
      expect(schema().safeParse(batchReviewBody).success).toBe(true);
    });

    it('REJECTS a non-numeric updated', () => {
      expect(schema().safeParse({ updated: 'lots' }).success).toBe(false);
    });

    it('proves defect: old PatchResponseSchema REJECTS `{ updated }`', () => {
      expect(
        getSchema('PatchResponseSchema').safeParse(batchReviewBody).success,
      ).toBe(false);
    });
  });

  describe('items/batch-workspaces — BatchWorkspacesResponseSchema', () => {
    const schema = () => getSchema('BatchWorkspacesResponseSchema');

    it('is exported', () => {
      expect(schema()).toBeDefined();
    });

    it('ACCEPTS `{ assignments: Record<string, string[]> }`', () => {
      expect(schema().safeParse(batchWorkspacesBody).success).toBe(true);
    });

    it('ACCEPTS an empty assignments map', () => {
      expect(schema().safeParse({ assignments: {} }).success).toBe(true);
    });

    it('REJECTS assignments whose values are not string arrays', () => {
      expect(
        schema().safeParse({ assignments: { 'item-1': [1, 2] } }).success,
      ).toBe(false);
    });

    it('proves defect: old PatchResponseSchema REJECTS `{ assignments }`', () => {
      expect(
        getSchema('PatchResponseSchema').safeParse(batchWorkspacesBody).success,
      ).toBe(false);
    });
  });

  describe('items/[id] PATCH — ItemPatchResponseSchema (polymorphic)', () => {
    const schema = () => getSchema('ItemPatchResponseSchema');

    it('is exported', () => {
      expect(schema()).toBeDefined();
    });

    it('ACCEPTS the status-transition branch body', () => {
      expect(schema().safeParse(itemPatchTransitionBody).success).toBe(true);
    });

    it('ACCEPTS the general field-update body `{ success: true }`', () => {
      expect(schema().safeParse(itemPatchGeneralBody).success).toBe(true);
    });

    it('ACCEPTS the warnings-envelope body', () => {
      expect(schema().safeParse(itemPatchWarningsBody).success).toBe(true);
    });

    it('ACCEPTS the supersession-set body', () => {
      expect(schema().safeParse(itemPatchSupersedeBody).success).toBe(true);
    });

    it('REJECTS a body without success', () => {
      expect(schema().safeParse({ updated: 1 }).success).toBe(false);
    });

    it('proves defect: old PatchResponseSchema REJECTS the general body', () => {
      expect(
        getSchema('PatchResponseSchema').safeParse(itemPatchGeneralBody)
          .success,
      ).toBe(false);
    });
  });

  describe('items/[id] DELETE — ItemDeleteResponseSchema', () => {
    const schema = () => getSchema('ItemDeleteResponseSchema');

    it('is exported', () => {
      expect(schema()).toBeDefined();
    });

    it('ACCEPTS `{ deleted, id }`', () => {
      expect(schema().safeParse(itemDeleteBody).success).toBe(true);
    });

    it('REJECTS a body missing id', () => {
      expect(schema().safeParse({ deleted: true }).success).toBe(false);
    });

    it('proves defect: old PatchResponseSchema REJECTS `{ deleted, id }`', () => {
      expect(
        getSchema('PatchResponseSchema').safeParse(itemDeleteBody).success,
      ).toBe(false);
    });
  });
});
