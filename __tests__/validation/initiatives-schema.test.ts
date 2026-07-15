/**
 * initiatives-schema.test.ts
 *
 * Unit tests for `lib/validation/initiatives-schema.ts` (ID-148.5 / TECH §3.2).
 *
 * Fixture: `__tests__/fixtures/ledger/initiatives.json` — a synthetic,
 * de-identified document DERIVED from the live docs-site
 * `ledgers/initiatives.json` structure (not read at test runtime; see
 * TECH §1.4). Captures the shapes the schema must tolerate:
 *   - a dirty/out-of-enum legacy project `status` (INV-1 / INV-3 lenient read)
 *   - an initiative carrying `linked_tasks`/`linked_backlog` at the
 *     initiative level rather than under a project (transitional tolerance,
 *     audit A3, INV-2)
 *   - a sub-initiative with no `substrate_doc` field at all (INV-2)
 *   - a `substrate_doc` pointing into each of the two git-ignored dirs
 *     (`.user-scratch/`, `.lavish/`) — non-fatal warning (D2 / INV-2)
 *   - two-level recursive `sub-initiatives[]` nesting (z.lazy)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'node:path';
import {
  INITIATIVE_STATUSES,
  PROJECT_STATUSES,
  ProjectSchema,
  SubInitiativeSchema,
  InitiativeSchema,
  InitiativesSchema,
  INITIATIVES_BUDGETS,
  parseInitiativesWithWarnings,
} from '@/lib/validation/initiatives-schema';

const FIXTURE_PATH = resolve(__dirname, '../fixtures/ledger/initiatives.json');

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
}

// ──────────────────────────────────────────────────────────────────────────
// Status vocabularies (§2 behaviour contract)
// ──────────────────────────────────────────────────────────────────────────

describe('INITIATIVE_STATUSES / PROJECT_STATUSES', () => {
  it('INITIATIVE_STATUSES has exactly the 5 documented values', () => {
    expect(INITIATIVE_STATUSES).toEqual([
      'proposed',
      'planned',
      'active',
      'completed',
      'cancelled',
    ]);
  });

  it('PROJECT_STATUSES has exactly the 11 documented values', () => {
    expect(PROJECT_STATUSES).toEqual([
      'idea',
      'proposal',
      'backlog',
      'discovery',
      'accepted',
      'ready',
      'paused',
      'in-progress',
      'maintenance',
      'completed',
      'cancelled',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Lenient read on `status` (INV-1, INV-3) — z.string(), never z.enum/.catch()
// ──────────────────────────────────────────────────────────────────────────

const VALID_PROJECT = {
  id: 'fixture-project',
  title: 'Fixture project',
  summary: 'One-line summary.',
  description: 'Longer description.',
  substrate_doc: 'docs/fixture/project.md',
  status: 'in-progress',
  blocked_by: [],
  blocking: [],
  linked_tasks: [],
  linked_backlog: [],
  originating_session: [],
};

describe('ProjectSchema — lenient status read (INV-1 / INV-3)', () => {
  it('accepts every canonical PROJECT_STATUSES value', () => {
    for (const status of PROJECT_STATUSES) {
      const result = ProjectSchema.safeParse({ ...VALID_PROJECT, status });
      expect(result.success, `expected status "${status}" to parse`).toBe(true);
    }
  });

  it('accepts an out-of-enum dirty legacy status value without rejection', () => {
    const result = ProjectSchema.safeParse({
      ...VALID_PROJECT,
      status: 'some-legacy-value-not-in-the-enum',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Lenient read preserves the original string verbatim — no coercion.
      expect(result.data.status).toBe('some-legacy-value-not-in-the-enum');
    }
  });

  it('rejects a project missing a required field (id)', () => {
    const { id: _id, ...withoutId } = VALID_PROJECT;
    expect(ProjectSchema.safeParse(withoutId).success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// SubInitiativeSchema — optional substrate_doc (INV-2), recursive nesting
// ──────────────────────────────────────────────────────────────────────────

describe('SubInitiativeSchema — optional substrate_doc + recursion (INV-2)', () => {
  it('accepts a sub-initiative with substrate_doc entirely absent', () => {
    const result = SubInitiativeSchema.safeParse({
      id: '1',
      title: 'No substrate doc',
      description: '',
      status: 'active',
      projects: [],
      originating_session: [],
      'sub-initiatives': [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a sub-initiative with substrate_doc: ""', () => {
    const result = SubInitiativeSchema.safeParse({
      id: '1',
      title: 'Empty substrate doc',
      description: '',
      substrate_doc: '',
      status: 'active',
      projects: [],
      originating_session: [],
      'sub-initiatives': [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts two levels of recursive sub-initiatives[] nesting', () => {
    const result = SubInitiativeSchema.safeParse({
      id: '2',
      title: 'Parent',
      description: '',
      status: 'planned',
      projects: [],
      originating_session: [],
      'sub-initiatives': [
        {
          id: '1',
          title: 'Nested child',
          description: '',
          status: 'proposed',
          projects: [VALID_PROJECT],
          originating_session: [],
          'sub-initiatives': [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// InitiativeSchema — transitional linked_tasks/linked_backlog tolerance
// ──────────────────────────────────────────────────────────────────────────

describe('InitiativeSchema — transitional off-project links (INV-2 / audit A3)', () => {
  it('accepts an initiative with no linked_tasks/linked_backlog (the common case)', () => {
    const result = InitiativeSchema.safeParse({
      id: '1',
      title: 'Ordinary initiative',
      description: '',
      status: 'active',
      projects: [],
      originating_session: [],
      'sub-initiatives': [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an initiative carrying initiative-level linked_tasks/linked_backlog', () => {
    const result = InitiativeSchema.safeParse({
      id: '4',
      title: 'SDLC-style initiative',
      description: '',
      status: 'active',
      projects: [],
      linked_tasks: ['10', '20'],
      linked_backlog: ['5'],
      originating_session: [],
      'sub-initiatives': [],
    });
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// InitiativesSchema — root document + no .strict() on record objects
// ──────────────────────────────────────────────────────────────────────────

describe('InitiativesSchema — root document shape', () => {
  it('rejects a document_name other than the literal', () => {
    const doc = loadFixture() as Record<string, unknown>;
    const result = InitiativesSchema.safeParse({
      ...doc,
      document_name: 'Some Other Document',
    });
    expect(result.success).toBe(false);
  });

  it('ProjectSchema/SubInitiativeSchema/InitiativeSchema tolerate incidental unknown fields (not .strict())', () => {
    const result = ProjectSchema.safeParse({
      ...VALID_PROJECT,
      unexpected_incidental_field: 'should not be rejected',
    });
    expect(result.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Live-derived fixture — full round-trip parse (Checker acceptance line 1)
// ──────────────────────────────────────────────────────────────────────────

describe('initiatives.json fixture round-trip (INV-1 / INV-2 / INV-3)', () => {
  it('parses the live-derived fixture ok:true via InitiativesSchema', () => {
    const doc = loadFixture();
    const result = InitiativesSchema.safeParse(doc);
    expect(result.success).toBe(true);
  });

  it('preserves the dirty out-of-enum project status verbatim after parse', () => {
    const doc = loadFixture();
    const parsed = InitiativesSchema.parse(doc);
    const initiative1 = parsed.initiatives.find((i) => i.id === '1');
    const sub1 = initiative1?.['sub-initiatives'].find((s) => s.id === '1');
    const project = sub1?.projects[0];
    expect(project?.status).toBe('todo');
  });

  it('parses the initiative-4-style off-project linked_tasks/linked_backlog', () => {
    const doc = loadFixture();
    const parsed = InitiativesSchema.parse(doc);
    const initiative4 = parsed.initiatives.find((i) => i.id === '4');
    expect(initiative4?.linked_tasks).toEqual(['10', '20']);
    expect(initiative4?.linked_backlog).toEqual(['5']);
  });

  it('parses a sub-initiative with substrate_doc entirely absent', () => {
    const doc = loadFixture();
    const parsed = InitiativesSchema.parse(doc);
    const initiative1 = parsed.initiatives.find((i) => i.id === '1');
    const sub1 = initiative1?.['sub-initiatives'].find((s) => s.id === '1');
    expect(sub1).toBeDefined();
    expect(sub1?.substrate_doc).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// D2 — non-fatal git-ignored substrate_doc warning (warn-now / reject-later)
// ──────────────────────────────────────────────────────────────────────────

describe('parseInitiativesWithWarnings — D2 git-ignored substrate_doc warning', () => {
  it('still returns ok (does not throw) when substrate_doc targets .user-scratch/', () => {
    const doc = loadFixture();
    const { value } = parseInitiativesWithWarnings(doc);
    expect(value.initiatives.find((i) => i.id === '1')).toBeDefined();
  });

  it('emits a non-fatal warning for a substrate_doc under .user-scratch/', () => {
    const doc = loadFixture();
    const { warnings } = parseInitiativesWithWarnings(doc);
    const hit = warnings.find((w) =>
      w.message.includes('.user-scratch/fixture-notes.md'),
    );
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('git-ignored');
  });

  it('emits a non-fatal warning for a substrate_doc under .lavish/', () => {
    const doc = loadFixture();
    const { warnings } = parseInitiativesWithWarnings(doc);
    const hit = warnings.find((w) =>
      w.message.includes('.lavish/fixture-scratch.md'),
    );
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('git-ignored');
  });

  it('does NOT warn for an ordinary tracked substrate_doc path', () => {
    const doc = loadFixture();
    const { warnings } = parseInitiativesWithWarnings(doc);
    const hit = warnings.find((w) =>
      w.message.includes('docs/fixture/nested.md'),
    );
    expect(hit).toBeUndefined();
  });

  it('does NOT false-positive on a path segment that merely contains the dir name as a substring', () => {
    const doc = {
      ...(loadFixture() as Record<string, unknown>),
    };
    const result = parseInitiativesWithWarnings({
      ...doc,
      initiatives: [
        {
          id: '99',
          title: 'Substring trap',
          description: '',
          substrate_doc: 'docs/my.lavish-report/notes.md',
          status: 'active',
          projects: [],
          originating_session: [],
          'sub-initiatives': [],
        },
      ],
    });
    const hit = result.warnings.find((w) =>
      w.message.includes('my.lavish-report'),
    );
    expect(hit).toBeUndefined();
  });

  it('is empty for a document with no git-ignored substrate_doc pointers', () => {
    const { warnings } = parseInitiativesWithWarnings({
      document_name: 'Canonical Platform - Initiatives',
      document_purpose: 'clean fixture',
      date: '2026-07-15',
      status: 'active',
      related_documents: [],
      last_updated: 'fixture',
      initiatives: [
        {
          id: '1',
          title: 'Clean initiative',
          description: 'short',
          substrate_doc: 'docs/fixture/clean.md',
          status: 'active',
          projects: [],
          originating_session: [],
          'sub-initiatives': [],
        },
      ],
    });
    expect(warnings).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// INITIATIVES_BUDGETS — cap-free parse; soft warnings only, never rejections
// ──────────────────────────────────────────────────────────────────────────

describe('INITIATIVES_BUDGETS — soft field-length warnings, never schema rejections', () => {
  it('registers numeric caps for initiative.description and project.summary/description', () => {
    expect(typeof INITIATIVES_BUDGETS.initiative.description).toBe('number');
    expect(typeof INITIATIVES_BUDGETS.project.summary).toBe('number');
    expect(typeof INITIATIVES_BUDGETS.project.description).toBe('number');
  });

  it('parses an over-budget description without rejection (cap-free schema)', () => {
    const longDescription = 'x'.repeat(
      INITIATIVES_BUDGETS.initiative.description + 500,
    );
    const result = InitiativeSchema.safeParse({
      id: '1',
      title: 'Over-budget initiative',
      description: longDescription,
      status: 'active',
      projects: [],
      originating_session: [],
      'sub-initiatives': [],
    });
    expect(result.success).toBe(true);
  });

  it('emits a soft warning when an initiative description exceeds its budget', () => {
    const longDescription = 'x'.repeat(
      INITIATIVES_BUDGETS.initiative.description + 500,
    );
    const { warnings } = parseInitiativesWithWarnings({
      document_name: 'Canonical Platform - Initiatives',
      document_purpose: 'budget fixture',
      date: '2026-07-15',
      status: 'active',
      related_documents: [],
      last_updated: 'fixture',
      initiatives: [
        {
          id: '1',
          title: 'Over-budget initiative',
          description: longDescription,
          status: 'active',
          projects: [],
          originating_session: [],
          'sub-initiatives': [],
        },
      ],
    });
    const hit = warnings.find((w) => w.message.includes('description'));
    expect(hit).toBeDefined();
  });
});
