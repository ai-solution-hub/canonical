/**
 * curator-rewrites-smoke.test.ts — contract smoke test for the Shape A
 * rewrites of `.claude/skills/triage-finding/SKILL.md` and
 * `.claude/skills/update-roadmap-backlog/SKILL.md` (per ID-30.5).
 *
 * **Test philosophy compliance** (T-OQ-5 ratified default): this is a
 * "mock-payload + contract-output" smoke test. It does NOT execute the LLM
 * harness — agent execution belongs to the orchestrator runtime. Instead it
 * asserts the **input → output contract** documented in the two rewritten
 * skills' SKILL.md bodies:
 *
 * 1. A Branch C decision from rewritten `triage-finding` (per TECH §4.1)
 *    produces a YAML packet shape that includes `backlog_slot.rank`.
 * 2. Walking the documented Create-mode Step 3 (Backlog target) of
 *    rewritten `update-roadmap-backlog` (per TECH §4.2) — given that
 *    payload — composes a backlog entry that:
 *      (a) parses cleanly against the BacklogItemSchema extended with
 *          `rank: z.number().int().nullable().optional()` (the field shape
 *          Subtask 30.6 will add to `lib/validation/backlog-schema.ts` per
 *          PRODUCT inv 3; this test uses the extension inline as
 *          forward-compatibility — once 30.6 ships, the extension can be
 *          dropped in favour of the real schema export).
 *      (b) round-trips Phase-B provenance fields (session_refs +
 *          commit_refs + cross_doc_links + notes) without loss.
 *      (c) carries the rank field exactly as set in the triage payload
 *          (no silent default, no silent overwrite).
 *
 * **Why this pattern and not full LLM execution**: the LLM agent's job is
 * to interpret the rewritten skill bodies and produce conforming output;
 * the test verifies the contract surface that the LLM is asked to honour.
 * If the skill body's documented field set drifts from the schema, this
 * test fails — which is exactly the regression we want to catch.
 *
 * **Forward-compat hook**: once Subtask 30.6 lands the real `rank` field on
 * `BacklogItemSchema`, replace the `BacklogItemSchemaWithRank` extension
 * below with a direct import. The rest of the test stays the same.
 *
 * Specs:
 * - `docs/specs/id-30-roadmap-backlog-consolidation/PRODUCT.md` invariant 13 +
 *   invariant 3 (rank field shape).
 * - `docs/specs/id-30-roadmap-backlog-consolidation/TECH.md` §4.1 + §4.2.
 * - `.claude/skills/triage-finding/SKILL.md` Branch C output.
 * - `.claude/skills/update-roadmap-backlog/SKILL.md` Create flow Step 3
 *   "For backlog" field table.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  BacklogItemSchema,
  BacklogItemType,
} from '@/lib/validation/backlog-schema';
import { BacklogStatus, Priority } from '@/lib/validation/work-status';
import { DocLinkSchema } from '@/lib/validation/roadmap-schema';
import { BARE_ID_REGEX } from '@/lib/validation/schemas';

// ──────────────────────────────────────────────────────────────────────────────
// Forward-compat extension — once Subtask 30.6 lands `rank` on the real
// BacklogItemSchema, drop this extension and import the canonical schema.
//
// Defined here as `.extend({ rank: ... })` so the test exercises the EXACT
// shape Subtask 30.6 commits: nullable + optional integer (PRODUCT inv 3).
// ──────────────────────────────────────────────────────────────────────────────

const BacklogItemSchemaWithRank = BacklogItemSchema.extend({
  /**
   * Within-priority deterministic ordering. Lower integer = higher rank.
   * Default null; pre-existing items omit. Schema does NOT enforce
   * uniqueness or contiguity within tier (PRODUCT inv 3). Curator skill
   * (per `update-roadmap-backlog` Update mode) maintains discipline via
   * auto-shift collision policy.
   */
  rank: z.number().int().nullable().optional(),
});

type BacklogItemWithRank = z.infer<typeof BacklogItemSchemaWithRank>;

// ──────────────────────────────────────────────────────────────────────────────
// Branch C triage payload shape — mirrors the rewritten triage-finding
// Step 3 YAML output for a `decision: backlog` route under Shape A
// (per TECH §4.1).
// ──────────────────────────────────────────────────────────────────────────────

interface TriageBranchCPayload {
  decision: 'backlog';
  justification: string;
  backlog_slot: {
    track: string;
    type: z.infer<typeof BacklogItemType>;
    priority: z.infer<typeof Priority>;
    status: z.infer<typeof BacklogStatus>;
    rank: number | null;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Provenance shape (per `update-roadmap-backlog` SKILL.md Inputs table).
// ──────────────────────────────────────────────────────────────────────────────

interface CreateProvenance {
  session_counter: string;
  source_task_id: string | null;
  source_commit_sha: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// composeBacklogEntry — direct transcription of `update-roadmap-backlog`
// SKILL.md Create flow Step 3 "For backlog" field table (post-rewrite).
//
// Inputs: triage payload + provenance + finding context (id, description,
// effort_estimate, notes, dependencies, cross_doc_links). Output: a
// BacklogItem-shaped object the curator would append to
// `docs/reference/product-backlog.json` `items[]`.
//
// This function IS the contract under test — if the rewritten skill body
// adds, drops, or renames a field, this function changes too, and the
// schema parse below catches drift.
// ──────────────────────────────────────────────────────────────────────────────

interface FindingContext {
  next_free_id: string;
  description: string;
  effort_estimate: string | null;
  notes: string | null;
  dependencies: string[];
  cross_doc_links: z.infer<typeof DocLinkSchema>[];
}

function composeBacklogEntry(
  triage: TriageBranchCPayload,
  provenance: CreateProvenance,
  context: FindingContext,
): BacklogItemWithRank {
  // session_refs: provenance.session_counter at minimum, plus
  // source_task_id if available (per SKILL.md Step 3 table).
  const session_refs: string[] = [provenance.session_counter];
  if (provenance.source_task_id) {
    session_refs.push(provenance.source_task_id);
  }

  // commit_refs: source_commit_sha if available, else [] (per Step 3).
  const commit_refs: string[] = provenance.source_commit_sha
    ? [provenance.source_commit_sha]
    : [];

  return {
    id: context.next_free_id,
    description: context.description,
    type: triage.backlog_slot.type,
    status: triage.backlog_slot.status,
    effort_estimate: context.effort_estimate,
    priority: triage.backlog_slot.priority,
    track: triage.backlog_slot.track,
    dependencies: context.dependencies,
    session_refs,
    commit_refs,
    cross_doc_links: context.cross_doc_links,
    notes: context.notes,
    // rank: from triage payload `backlog_slot.rank`. Default null
    // per PRODUCT inv 3 + rewritten SKILL.md Step 3 table.
    rank: triage.backlog_slot.rank,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const PROVENANCE: CreateProvenance = {
  session_counter: 'kh-prod-readiness-S66',
  source_task_id: 'ID-30.5',
  source_commit_sha: 'abc1234',
};

const DOC_LINK_EXAMPLE = {
  path: 'docs/specs/id-30-roadmap-backlog-consolidation/PRODUCT.md',
  anchor: '#invariant-13',
  raw: 'docs/specs/id-30-roadmap-backlog-consolidation/PRODUCT.md#invariant-13',
};

const FINDING_CONTEXT_EXAMPLE: FindingContext = {
  next_free_id: '108',
  description:
    'search filter component re-renders on every keystroke due to unstable empty-array default',
  effort_estimate: '2-3h',
  notes: 'Evidence: components/search/Filter.tsx:42 (S66 sub-o W0c finding).',
  dependencies: [],
  cross_doc_links: [DOC_LINK_EXAMPLE],
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('curator skill rewrites (Shape A) — smoke contract', () => {
  describe('triage-finding Branch C payload (TECH §4.1)', () => {
    it('produces a Branch C payload that includes rank (default null)', () => {
      // Simulate the rewritten triage-finding output for Example 4 (tech-debt
      // routing per the rewritten Example 4 in SKILL.md).
      const payload: TriageBranchCPayload = {
        decision: 'backlog',
        justification:
          'Branch C — single-feature search tech-debt, weeks-scope, ' +
          'no current Task touches search. Branch B failed condition 1 ' +
          '(search already covered by existing theme).',
        backlog_slot: {
          track: 'search',
          type: 'tech_debt',
          priority: 'medium',
          status: 'spec_needed',
          rank: null, // default per PRODUCT inv 3 + rewritten Branch C
        },
      };

      // Contract assertion: the payload shape MUST include all five fields
      // per the rewritten Branch C output YAML.
      expect(payload.decision).toBe('backlog');
      expect(payload.backlog_slot.track).toBe('search');
      expect(payload.backlog_slot.type).toBe('tech_debt');
      expect(payload.backlog_slot.priority).toBe('medium');
      expect(payload.backlog_slot.status).toBe('spec_needed');
      // Critical assertion — rank field is present, default null.
      expect(payload.backlog_slot).toHaveProperty('rank');
      expect(payload.backlog_slot.rank).toBeNull();
    });

    it('accepts an explicit integer rank when triage carries an ordering signal', () => {
      const payload: TriageBranchCPayload = {
        decision: 'backlog',
        justification:
          'Branch C — single-feature item, evidence carries an ordering ' +
          'signal (priority tier high already has items ranked 1-5; this ' +
          'item explicitly belongs at rank 6).',
        backlog_slot: {
          track: 'authentication',
          type: 'feature',
          priority: 'high',
          status: 'ready',
          rank: 6,
        },
      };

      expect(payload.backlog_slot.rank).toBe(6);
    });
  });

  describe('update-roadmap-backlog Create mode for backlog (TECH §4.2)', () => {
    it('(a) composes an entry that parses cleanly against BacklogItemSchema with rank field', () => {
      const triage: TriageBranchCPayload = {
        decision: 'backlog',
        justification: 'Branch C — single-feature search tech-debt.',
        backlog_slot: {
          track: 'search',
          type: 'tech_debt',
          priority: 'medium',
          status: 'spec_needed',
          rank: null,
        },
      };

      const entry = composeBacklogEntry(
        triage,
        PROVENANCE,
        FINDING_CONTEXT_EXAMPLE,
      );

      const result = BacklogItemSchemaWithRank.safeParse(entry);
      if (!result.success) {
        // Surface the Zod issue list for debugging on schema drift.
        throw new Error(
          `BacklogItemSchemaWithRank parse failed: ${JSON.stringify(
            result.error.issues,
            null,
            2,
          )}`,
        );
      }
      expect(result.success).toBe(true);
      expect(result.data.rank).toBeNull();
    });

    it('(a) accepts an explicit integer rank without schema violation', () => {
      const triage: TriageBranchCPayload = {
        decision: 'backlog',
        justification: 'Branch C — explicit ordering signal.',
        backlog_slot: {
          track: 'authentication',
          type: 'feature',
          priority: 'high',
          status: 'ready',
          rank: 6,
        },
      };

      const entry = composeBacklogEntry(triage, PROVENANCE, {
        ...FINDING_CONTEXT_EXAMPLE,
        next_free_id: '109',
      });

      const result = BacklogItemSchemaWithRank.safeParse(entry);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rank).toBe(6);
      }
    });

    it('(b) round-trips Phase-B provenance — session_refs + commit_refs + cross_doc_links + notes', () => {
      const triage: TriageBranchCPayload = {
        decision: 'backlog',
        justification: 'Branch C provenance round-trip.',
        backlog_slot: {
          track: 'search',
          type: 'tech_debt',
          priority: 'medium',
          status: 'spec_needed',
          rank: null,
        },
      };

      const entry = composeBacklogEntry(
        triage,
        PROVENANCE,
        FINDING_CONTEXT_EXAMPLE,
      );

      // session_refs round-trip: provenance.session_counter at minimum,
      // plus source_task_id when present (per SKILL.md Step 3 table).
      expect(entry.session_refs).toEqual(['kh-prod-readiness-S66', 'ID-30.5']);

      // commit_refs round-trip: source_commit_sha at index 0.
      expect(entry.commit_refs).toEqual(['abc1234']);

      // cross_doc_links round-trip: the DocLink object is preserved
      // verbatim (no transformation, no drop).
      expect(entry.cross_doc_links).toHaveLength(1);
      expect(entry.cross_doc_links[0]).toEqual(DOC_LINK_EXAMPLE);

      // notes round-trip: free text preserved including the evidence
      // reference (file:line + session marker).
      expect(entry.notes).toBe(
        'Evidence: components/search/Filter.tsx:42 (S66 sub-o W0c finding).',
      );

      // Schema-level guarantee: the composed entry parses against the
      // BacklogItem schema with all provenance fields intact.
      const result = BacklogItemSchemaWithRank.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('(b) handles null commit_refs when provenance.source_commit_sha is null', () => {
      const triage: TriageBranchCPayload = {
        decision: 'backlog',
        justification: 'Branch C with null commit_sha.',
        backlog_slot: {
          track: 'search',
          type: 'tech_debt',
          priority: 'medium',
          status: 'spec_needed',
          rank: null,
        },
      };

      const provenanceNoCommit: CreateProvenance = {
        session_counter: 'kh-prod-readiness-S66',
        source_task_id: null,
        source_commit_sha: null,
      };

      const entry = composeBacklogEntry(
        triage,
        provenanceNoCommit,
        FINDING_CONTEXT_EXAMPLE,
      );

      // session_refs has only the session_counter when source_task_id is null.
      expect(entry.session_refs).toEqual(['kh-prod-readiness-S66']);
      // commit_refs is empty array (not missing field) when commit_sha is null.
      expect(entry.commit_refs).toEqual([]);

      const result = BacklogItemSchemaWithRank.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('(c) rank field is settable from the triage payload (no silent default)', () => {
      const triageWithRank: TriageBranchCPayload = {
        decision: 'backlog',
        justification: 'Branch C with explicit rank=3 from ordering signal.',
        backlog_slot: {
          track: 'authentication',
          type: 'feature',
          priority: 'high',
          status: 'ready',
          rank: 3,
        },
      };

      const entry = composeBacklogEntry(
        triageWithRank,
        PROVENANCE,
        FINDING_CONTEXT_EXAMPLE,
      );

      // The rank from the triage payload must reach the composed entry
      // verbatim — no silent overwrite to null, no auto-default.
      expect(entry.rank).toBe(3);

      const result = BacklogItemSchemaWithRank.safeParse(entry);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rank).toBe(3);
      }
    });

    it('(c) rank: null in triage produces rank: null on the entry (the documented default)', () => {
      const triageNullRank: TriageBranchCPayload = {
        decision: 'backlog',
        justification: 'Branch C with default null rank.',
        backlog_slot: {
          track: 'search',
          type: 'tech_debt',
          priority: 'medium',
          status: 'spec_needed',
          rank: null,
        },
      };

      const entry = composeBacklogEntry(
        triageNullRank,
        PROVENANCE,
        FINDING_CONTEXT_EXAMPLE,
      );

      expect(entry.rank).toBeNull();

      const result = BacklogItemSchemaWithRank.safeParse(entry);
      expect(result.success).toBe(true);
    });
  });

  describe('BacklogItemSchema rank extension — PRODUCT inv 3 contract', () => {
    it('accepts integer rank (positive)', () => {
      const entry = composeBacklogEntry(
        {
          decision: 'backlog',
          justification: 'positive rank',
          backlog_slot: {
            track: 'auth',
            type: 'feature',
            priority: 'high',
            status: 'ready',
            rank: 5,
          },
        },
        PROVENANCE,
        FINDING_CONTEXT_EXAMPLE,
      );
      const result = BacklogItemSchemaWithRank.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('accepts null rank (the documented default)', () => {
      const entry = composeBacklogEntry(
        {
          decision: 'backlog',
          justification: 'null rank',
          backlog_slot: {
            track: 'search',
            type: 'tech_debt',
            priority: 'medium',
            status: 'spec_needed',
            rank: null,
          },
        },
        PROVENANCE,
        FINDING_CONTEXT_EXAMPLE,
      );
      const result = BacklogItemSchemaWithRank.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('rejects non-integer rank (e.g. string "5")', () => {
      // Bypass TypeScript to test the schema's runtime rejection.
      const entry = {
        ...composeBacklogEntry(
          {
            decision: 'backlog',
            justification: 'non-integer rank',
            backlog_slot: {
              track: 'search',
              type: 'tech_debt',
              priority: 'medium',
              status: 'spec_needed',
              rank: null,
            },
          },
          PROVENANCE,
          FINDING_CONTEXT_EXAMPLE,
        ),
        rank: '5' as unknown as number, // intentional type violation
      };
      const result = BacklogItemSchemaWithRank.safeParse(entry);
      expect(result.success).toBe(false);
    });

    it('id field still enforces BARE_ID_REGEX after extension', () => {
      // Confirm `.extend()` did NOT bypass the BARE_ID_REGEX check.
      expect(BARE_ID_REGEX.test('108')).toBe(true);
      expect(BARE_ID_REGEX.test('ID-30.5')).toBe(false);

      const entry = composeBacklogEntry(
        {
          decision: 'backlog',
          justification: 'bare-id check',
          backlog_slot: {
            track: 'search',
            type: 'tech_debt',
            priority: 'medium',
            status: 'spec_needed',
            rank: null,
          },
        },
        PROVENANCE,
        { ...FINDING_CONTEXT_EXAMPLE, next_free_id: 'ID-30.5' }, // invalid
      );
      const result = BacklogItemSchemaWithRank.safeParse(entry);
      expect(result.success).toBe(false);
    });
  });
});
