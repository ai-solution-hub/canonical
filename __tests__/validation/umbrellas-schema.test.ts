/**
 * umbrellas-schema.test.ts
 *
 * Unit tests for `lib/validation/umbrellas-schema.ts`.
 *
 * Tests verify real behaviour against TECH §3.2 of
 * `docs/specs/canonical-pipeline-task-list-migration/TECH.md` and PRODUCT inv
 * 7–9 of the same spec set.
 *
 * Coverage:
 *   - UmbrellaStatus enum — exactly 4 values, each accepted, invalid rejected.
 *   - UmbrellaEntrySchema — valid entry parses; required fields enforced;
 *     `id` kebab-case regex (rejects CamelCase, leading digit, trailing dash,
 *     leading dash, uppercase, internal whitespace); `task_ids[]` accepts
 *     bare-digit ids; rejects non-bare-digit shapes (`BID-5`, `9.5`,
 *     dotted-decimal, prefixed); empty `task_ids[]` allowed; strict-mode
 *     rejects unknown fields.
 *   - UmbrellasSchema (root) — valid root parses; multi-membership accepted
 *     (same Task id in multiple umbrella entries); `last_updated` discipline
 *     (≤200-char cap, single-line, single session-id, kh-{track}-S{N} prefix).
 *
 * Per FORWARD-COMPAT CONSTRAINT (PRODUCT inv 8 LOCK): the 6 UmbrellaEntry
 * field names — `id`, `title`, `substrate_doc`, `task_ids`, `status`, `phase`
 * — are LOCKED for ID-9 docubot consumption. Tests assert exact field names
 * to catch any accidental rename.
 */

import { describe, it, expect } from 'vitest';
import {
  UmbrellaStatus,
  UmbrellaEntrySchema,
  UmbrellasSchema,
} from '@/lib/validation/umbrellas-schema';

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ──────────────────────────────────────────────────────────────────────────────

const VALID_ENTRY = {
  id: 'canonical-pipeline',
  title: 'Canonical Pipeline Implementation',
  substrate_doc:
    'docs/specs/canonical-pipeline-implementation-plan/PLAN.md',
  task_ids: ['30', '31'],
  status: 'in_progress' as const,
  phase: 'Phase 1',
};

const VALID_ROOT = {
  document_name: 'umbrellas' as const,
  document_purpose:
    'Curated umbrella groupings of Tasks (Linear-Initiative analogue).',
  last_updated:
    'kh-prod-readiness-S66 W2 close-out — initial umbrellas-schema authored',
  related_documents: [
    'docs/specs/canonical-pipeline-task-list-migration/TECH.md',
  ],
  umbrellas: [VALID_ENTRY],
};

// ──────────────────────────────────────────────────────────────────────────────
// UmbrellaStatus enum (PRODUCT inv 8)
// ──────────────────────────────────────────────────────────────────────────────

describe('UmbrellaStatus enum', () => {
  it('contains exactly the 4 ratified values', () => {
    expect(UmbrellaStatus.options).toHaveLength(4);
    expect(UmbrellaStatus.options).toEqual(
      expect.arrayContaining(['proposed', 'in_progress', 'done', 'archived']),
    );
  });

  it('accepts status: proposed', () => {
    expect(UmbrellaStatus.safeParse('proposed').success).toBe(true);
  });

  it('accepts status: in_progress', () => {
    expect(UmbrellaStatus.safeParse('in_progress').success).toBe(true);
  });

  it('accepts status: done', () => {
    expect(UmbrellaStatus.safeParse('done').success).toBe(true);
  });

  it('accepts status: archived', () => {
    expect(UmbrellaStatus.safeParse('archived').success).toBe(true);
  });

  it('rejects unknown status values', () => {
    expect(UmbrellaStatus.safeParse('pending').success).toBe(false);
    expect(UmbrellaStatus.safeParse('blocked').success).toBe(false);
    expect(UmbrellaStatus.safeParse('').success).toBe(false);
    expect(UmbrellaStatus.safeParse('IN_PROGRESS').success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// UmbrellaEntrySchema — valid entry per each status value
// ──────────────────────────────────────────────────────────────────────────────

describe('UmbrellaEntrySchema — valid entry per UmbrellaStatus value', () => {
  it('accepts a valid entry with status: proposed', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'prod-readiness',
      status: 'proposed',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid entry with status: in_progress', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      status: 'in_progress',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid entry with status: done', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'past-initiative',
      status: 'done',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid entry with status: archived', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'old-initiative',
      status: 'archived',
    });
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// UmbrellaEntrySchema — `id` kebab-case regex
// ──────────────────────────────────────────────────────────────────────────────

describe('UmbrellaEntrySchema id kebab-case regex', () => {
  it('accepts simple kebab-case (lowercase + hyphens)', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'canonical-pipeline',
    });
    expect(result.success).toBe(true);
  });

  it('accepts single-word lowercase id', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'ux',
    });
    expect(result.success).toBe(true);
  });

  it('accepts kebab-case with digits in the middle', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'phase-2-readiness',
    });
    expect(result.success).toBe(true);
  });

  it('rejects CamelCase id', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'CanonicalPipeline',
    });
    expect(result.success).toBe(false);
  });

  it('rejects id starting with a digit', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: '1-pipeline',
    });
    expect(result.success).toBe(false);
  });

  it('rejects id with trailing dash', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'canonical-pipeline-',
    });
    expect(result.success).toBe(false);
  });

  it('rejects id with leading dash', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: '-canonical-pipeline',
    });
    expect(result.success).toBe(false);
  });

  it('rejects id with uppercase letters', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'canonical-Pipeline',
    });
    expect(result.success).toBe(false);
  });

  it('rejects id with internal whitespace', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: 'canonical pipeline',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      id: '',
    });
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// UmbrellaEntrySchema — task_ids[] BARE_ID_REGEX enforcement
// ──────────────────────────────────────────────────────────────────────────────

describe('UmbrellaEntrySchema task_ids[] BARE_ID_REGEX', () => {
  it('accepts empty task_ids[] array', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      task_ids: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts bare-digit task ids (single)', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      task_ids: ['31'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts bare-digit task ids (multiple)', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      task_ids: ['1', '2', '15', '31', '99', '100'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects task_id with BID- prefix (legacy form)', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      task_ids: ['BID-5'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects task_id with dotted-decimal form (Subtask id shape)', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      task_ids: ['9.5'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects task_id with leading ID- prefix', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      task_ids: ['ID-31'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects task_id with mixed valid + invalid entries (whole array fails)', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      task_ids: ['31', 'BID-5'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects task_id with leading whitespace', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      task_ids: [' 31'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty-string task_id', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      task_ids: [''],
    });
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// UmbrellaEntrySchema — required field enforcement + strict-mode
// ──────────────────────────────────────────────────────────────────────────────

describe('UmbrellaEntrySchema required fields + strict-mode', () => {
  it('rejects entry missing required id field', () => {
    const { id: _, ...withoutId } = VALID_ENTRY;
    expect(UmbrellaEntrySchema.safeParse(withoutId).success).toBe(false);
  });

  it('rejects entry missing required title field', () => {
    const { title: _, ...withoutTitle } = VALID_ENTRY;
    expect(UmbrellaEntrySchema.safeParse(withoutTitle).success).toBe(false);
  });

  it('rejects entry missing required substrate_doc field', () => {
    const { substrate_doc: _, ...withoutSubstrateDoc } = VALID_ENTRY;
    expect(UmbrellaEntrySchema.safeParse(withoutSubstrateDoc).success).toBe(
      false,
    );
  });

  it('rejects entry missing required task_ids field', () => {
    const { task_ids: _, ...withoutTaskIds } = VALID_ENTRY;
    expect(UmbrellaEntrySchema.safeParse(withoutTaskIds).success).toBe(false);
  });

  it('rejects entry missing required status field', () => {
    const { status: _, ...withoutStatus } = VALID_ENTRY;
    expect(UmbrellaEntrySchema.safeParse(withoutStatus).success).toBe(false);
  });

  it('rejects entry missing required phase field', () => {
    const { phase: _, ...withoutPhase } = VALID_ENTRY;
    expect(UmbrellaEntrySchema.safeParse(withoutPhase).success).toBe(false);
  });

  it('rejects entry with empty-string title', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      title: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects entry with empty-string substrate_doc', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      substrate_doc: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects entry with empty-string phase', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      phase: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict mode)', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      unknown_field: 'should be rejected',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an alias like `tags` (strict mode catches renames)', () => {
    const result = UmbrellaEntrySchema.safeParse({
      ...VALID_ENTRY,
      tags: ['phase-1'],
    });
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// UmbrellasSchema (root) — valid document + multi-membership
// ──────────────────────────────────────────────────────────────────────────────

describe('UmbrellasSchema root document', () => {
  it('accepts a valid minimal root document', () => {
    const result = UmbrellasSchema.safeParse(VALID_ROOT);
    expect(result.success).toBe(true);
  });

  it('accepts an empty umbrellas[] array', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      umbrellas: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts multi-membership: same task id in multiple umbrella entries (PRODUCT inv 8 many-to-many)', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      umbrellas: [
        { ...VALID_ENTRY, id: 'canonical-pipeline', task_ids: ['31', '32'] },
        { ...VALID_ENTRY, id: 'prod-readiness', task_ids: ['31', '40'] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects root with wrong document_name literal', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      document_name: 'umbrella',
    });
    expect(result.success).toBe(false);
  });

  it('rejects root missing related_documents[]', () => {
    const { related_documents: _, ...withoutRelatedDocs } = VALID_ROOT;
    expect(UmbrellasSchema.safeParse(withoutRelatedDocs).success).toBe(false);
  });

  it('rejects root missing umbrellas[]', () => {
    const { umbrellas: _, ...withoutUmbrellas } = VALID_ROOT;
    expect(UmbrellasSchema.safeParse(withoutUmbrellas).success).toBe(false);
  });

  it('rejects unknown root-level fields (strict mode)', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      extra_field: 'should be rejected',
    });
    expect(result.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// UmbrellasSchema last_updated discipline (mirrors task-list-schema)
// ──────────────────────────────────────────────────────────────────────────────

describe('UmbrellasSchema last_updated discipline', () => {
  it('accepts the canonical one-line freshness marker', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      last_updated:
        'kh-prod-readiness-S66 W2 close-out — umbrellas-schema landed',
    });
    expect(result.success).toBe(true);
  });

  it('accepts main-track session-id prefix variant', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      last_updated: 'kh-main-S5 WP1 close-out — first main-track umbrella add',
    });
    expect(result.success).toBe(true);
  });

  it('rejects values exceeding 200 chars (anti-bloat cap)', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      last_updated:
        'kh-prod-readiness-S66 W2 close-out — ' + 'x'.repeat(200),
    });
    expect(result.success).toBe(false);
  });

  it('rejects multi-session-id append (diary-style concat)', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      last_updated:
        'kh-prod-readiness-S66 W2 close-out — fix. Earlier: kh-prod-readiness-S65 WP3 — schema seeded',
    });
    expect(result.success).toBe(false);
  });

  it('rejects multi-line values (newline embedded)', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      last_updated:
        'kh-prod-readiness-S66 W2 close-out\nadditional narrative on second line',
    });
    expect(result.success).toBe(false);
  });

  it('rejects values without canonical kh-{track}-S{N} prefix', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      last_updated: 'session 66 wave 2 close-out — added umbrellas schema',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty last_updated', () => {
    const result = UmbrellasSchema.safeParse({
      ...VALID_ROOT,
      last_updated: '',
    });
    expect(result.success).toBe(false);
  });
});
