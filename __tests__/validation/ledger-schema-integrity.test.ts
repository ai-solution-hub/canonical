/**
 * ledger-schema-integrity.test.ts
 *
 * Always-run guard test (bl-208) — strict-parses the three live planning
 * ledgers against their canonical Zod schemas so that a schema-invalid ledger
 * FAILS LOUDLY at test/CI time, not silently at the next ledger-CLI use.
 *
 * Root cause (S283): a cherry-pick carried a BUNDLED `task-list.json` edit with
 * an enum typo (`"in-progress"` instead of `in_progress`). `git apply` bypasses
 * the ledger-CLI's Zod validation, so the corruption landed on disk and the CLI
 * then refused to load the ledger. There was no test that parsed the LIVE
 * ledger files — every existing `*-schema.test.ts` only exercises inline
 * fixtures. This guard closes that gap.
 *
 * This rides the existing always-run guard-test pattern (CLAUDE.md "Guard tests
 * break on structural changes" — alongside `reference-doc-paths.test.ts`,
 * `pipeline-parity.test.ts`, `mcp-fixture-sync.test.ts`). Each ledger is parsed
 * with its strict (`.strict()`) root schema; the task-list also goes through
 * `parseTaskListWithWarnings` to mirror the CLI's loader exactly.
 *
 * Coverage:
 *   - task-list.json        → TaskListSchema (+ parseTaskListWithWarnings)
 *   - product-roadmap.json  → RoadmapSchema
 *   - product-backlog.json  → BacklogSchema
 *   - negative case         → a fixture with the exact S283 typo
 *                             (`"in-progress"`) MUST throw, proving the guard
 *                             actually catches a corrupted ledger.
 */

import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  TaskListSchema,
  parseTaskListWithWarnings,
} from '@/lib/validation/task-list-schema';
import { RoadmapSchema } from '@/lib/validation/roadmap-schema';
import { BacklogSchema } from '@/lib/validation/backlog-schema';

// Reads from the synthetic de-identified fixture dir (ID-68.35 ledger relocation).
// The live ledgers at docs/reference/ are being removed from the public repo;
// tests now use schema-valid synthetic fixtures so the parser/schema logic is
// exercised without embedding private data.
const FIXTURE_DIR = resolve(__dirname, '../fixtures/ledger');

/** Read + JSON.parse a fixture ledger file. */
function readLedger(filename: string): unknown {
  const raw = readFileSync(join(FIXTURE_DIR, filename), 'utf8');
  return JSON.parse(raw) as unknown;
}

describe('Ledger schema integrity (bl-208) — fixture ledgers strict-parse', () => {
  it('task-list.json parses against TaskListSchema (strict)', () => {
    const ledger = readLedger('task-list.json');
    expect(() => TaskListSchema.parse(ledger)).not.toThrow();
  });

  it('task-list.json parses through parseTaskListWithWarnings (CLI loader)', () => {
    const ledger = readLedger('task-list.json');
    // Mirrors the ledger-CLI's hard-fail path: throws ZodError on any schema
    // violation. Soft field-length warnings are advisory and do not fail.
    expect(() => parseTaskListWithWarnings(ledger)).not.toThrow();
  });

  it('product-roadmap.json parses against RoadmapSchema (strict)', () => {
    const ledger = readLedger('product-roadmap.json');
    expect(() => RoadmapSchema.parse(ledger)).not.toThrow();
  });

  it('product-backlog.json parses against BacklogSchema (strict)', () => {
    const ledger = readLedger('product-backlog.json');
    expect(() => BacklogSchema.parse(ledger)).not.toThrow();
  });
});

describe('Ledger schema integrity (bl-208) — negative case proves the guard bites', () => {
  // An OTHERWISE-VALID task document — every required field present and
  // well-formed — so the parse failure is attributable solely to the corrupted
  // status enum value, not to incidental shape errors.
  const validTask = {
    id: '999',
    title: 'Corrupted fixture task',
    description: 'Deliberately invalid status to exercise the guard.',
    status: 'in_progress' as const,
    priority: 'high' as const,
    dependencies: [],
    subtasks: [],
    updatedAt: '2026-05-30T00:00:00.000Z',
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
  };

  const validDoc = {
    document_name: 'Knowledge Hub Task List' as const,
    document_purpose: 'Negative-case fixture for bl-208 guard.',
    related_documents: ['docs/reference/product-roadmap.json'],
  };

  it('control: the otherwise-valid fixture parses cleanly', () => {
    // Proves the only thing wrong in the corrupted case below is the status.
    expect(() =>
      TaskListSchema.parse({ ...validDoc, tasks: [validTask] }),
    ).not.toThrow();
  });

  it('rejects a task-list with the exact S283 corruption (status "in-progress")', () => {
    // Same fixture, ONE deliberately-corrupted status enum value:
    // `"in-progress"` (hyphen) instead of the canonical `in_progress`
    // (underscore). This is the precise typo that corrupted the ledger in S283.
    const corruptedTaskList = {
      ...validDoc,
      tasks: [{ ...validTask, status: 'in-progress' }], // ← corruption
    };

    expect(() => TaskListSchema.parse(corruptedTaskList)).toThrow(ZodError);
    expect(() => parseTaskListWithWarnings(corruptedTaskList)).toThrow(
      ZodError,
    );

    // Assert the failure is attributable to the status field specifically.
    const result = TaskListSchema.safeParse(corruptedTaskList);
    expect(result.success).toBe(false);
    if (!result.success) {
      const statusIssue = result.error.issues.find((issue) =>
        issue.path.includes('status'),
      );
      expect(statusIssue).toBeDefined();
    }
  });
});
