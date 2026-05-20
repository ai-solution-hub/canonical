/**
 * migrate-legacy-ids-to-id-n.test.ts
 *
 * Tests for scripts/migrate-legacy-ids-to-id-n.ts — the Phase A backlog
 * bare-digit ID migration script.
 *
 * TECH spec: docs/specs/legacy-id-migration/TECH.md §A.0..A.7
 * Acceptance: A-INV-1, A-INV-2 (dry-run output) — 15.3 scope.
 * A-INV-3..10 are verified in 15.4 (apply step).
 *
 * Test count: 26 (expanded from migrate-roadmap-section-3.ts precedent at 8983f991 for full per-function coverage + drift WARN + schema validation; RLS-P9 sentinel removed — ID-15.4 Liam ratification: RLS-P9 removed from backlog entirely).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildMapping,
  applyMigration,
  isAlreadyMigrated,
  rewriteDependencies,
  applyLineagePrefix,
  runMigration,
  type BacklogDocument,
  type BacklogItem,
} from '../../scripts/migrate-legacy-ids-to-id-n';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<BacklogItem> & { id: string }): BacklogItem {
  return {
    description: 'Test item',
    type: 'tech_debt',
    status: 'parked',
    effort_estimate: null,
    priority: 'low',
    track: 'database',
    dependencies: [],
    surfaced: 'Test suite',
    notes: null,
    ...overrides,
  };
}

function makeDocument(items: BacklogItem[]): BacklogDocument {
  return {
    document_name: 'Product Backlog',
    document_purpose: 'Test backlog',
    last_updated: '2026-05-20',
    related_documents: [],
    items,
  };
}

// ── §1 buildMapping — mapping table construction ──────────────────────────

describe('buildMapping', () => {
  it('returns a Map with 42 entries (post-drift: AST-S3-O1/O2 absent; RLS-P9 removed)', () => {
    const mapping = buildMapping();
    expect(mapping.size).toBe(42);
  });

  it('maps AST-S10-O1 → "23" (Cluster 1 head after AST-S3 gap)', () => {
    const mapping = buildMapping();
    expect(mapping.get('AST-S10-O1')?.target).toBe('23');
  });

  it('maps OPS-43.1 → "45" with lineage flag set', () => {
    const mapping = buildMapping();
    const entry = mapping.get('OPS-43.1');
    expect(entry?.target).toBe('45');
    expect(entry?.lineagePrefix).toBe(true);
  });

  it('maps RLS-P8 → "40"', () => {
    const mapping = buildMapping();
    const entry = mapping.get('RLS-P8');
    expect(entry?.target).toBe('40');
  });

  it('does NOT contain RLS-P9 (removed — audit-confirmed-clean, Liam-ratified S58)', () => {
    const mapping = buildMapping();
    expect(mapping.has('RLS-P9')).toBe(false);
  });

  it('does NOT contain AST-S3-O1 (absent from live data — §A.0 drift)', () => {
    const mapping = buildMapping();
    expect(mapping.has('AST-S3-O1')).toBe(false);
  });

  it('does NOT contain AST-S3-O2 (absent from live data — §A.0 drift)', () => {
    const mapping = buildMapping();
    expect(mapping.has('AST-S3-O2')).toBe(false);
  });
});

// ── §2 isAlreadyMigrated — idempotence guard ──────────────────────────────

describe('isAlreadyMigrated', () => {
  it('returns false when document contains legacy IDs', () => {
    const doc = makeDocument([
      makeItem({ id: 'OPS-6' }),
      makeItem({ id: 'ID-17' }),
    ]);
    expect(isAlreadyMigrated(doc)).toBe(false);
  });

  it('returns true when all items have bare-digit or canonical IDs', () => {
    const doc = makeDocument([
      makeItem({ id: '17' }),
      makeItem({ id: '23' }),
      makeItem({ id: '42' }),
    ]);
    expect(isAlreadyMigrated(doc)).toBe(true);
  });

  it('returns false when any item is a legacy ID even if others are canonical', () => {
    const doc = makeDocument([
      makeItem({ id: '17' }),
      makeItem({ id: 'OPS-6' }),
    ]);
    expect(isAlreadyMigrated(doc)).toBe(false);
  });
});

// ── §3 rewriteDependencies — dependency id rewriting ─────────────────────

describe('rewriteDependencies', () => {
  it('rewrites a legacy dependency id to its bare-digit target', () => {
    const mapping = buildMapping();
    const result = rewriteDependencies(['OPS-29'], mapping);
    expect(result).toEqual(['33']);
  });

  it('passes through ids not in the mapping unchanged', () => {
    const mapping = buildMapping();
    const result = rewriteDependencies(['P0-TX-OPTION-E'], mapping);
    expect(result).toEqual(['P0-TX-OPTION-E']);
  });

  it('passes through already-canonical bare-digit ids unchanged', () => {
    const mapping = buildMapping();
    const result = rewriteDependencies(['17', '18'], mapping);
    expect(result).toEqual(['17', '18']);
  });

  it('handles empty dependencies array', () => {
    const mapping = buildMapping();
    expect(rewriteDependencies([], mapping)).toEqual([]);
  });
});

// ── §4 applyLineagePrefix — OPS-43.1 lineage note ────────────────────────

describe('applyLineagePrefix', () => {
  it('prepends lineage note to null notes field', () => {
    const item = makeItem({ id: 'OPS-43.1', notes: null });
    const result = applyLineagePrefix(item, 'OPS-43.1');
    expect(result.notes).toContain('Originally OPS-43.1');
    expect(result.notes).toContain('OPS-43');
  });

  it('prepends lineage note and preserves existing notes', () => {
    const item = makeItem({ id: 'OPS-43.1', notes: 'Existing note content.' });
    const result = applyLineagePrefix(item, 'OPS-43.1');
    expect(result.notes).toContain('Originally OPS-43.1');
    expect(result.notes).toContain('Existing note content.');
  });

  it('does not modify non-sub-decimal legacy ids', () => {
    const item = makeItem({ id: 'OPS-6', notes: null });
    const result = applyLineagePrefix(item, 'OPS-6');
    expect(result.notes).toBeNull();
  });
});

// ── §6 applyMigration — full document transformation ─────────────────────

describe('applyMigration', () => {
  it('migrates a known legacy id to its bare-digit target', () => {
    const doc = makeDocument([makeItem({ id: 'OPS-6' })]);
    const { document: result, skipped, warnings } = applyMigration(doc);
    const migrated = result.items.find((i) => i.id === '42');
    expect(migrated).toBeDefined();
    expect(skipped).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('leaves already-canonical IDs (ID-17, ID-18) unchanged', () => {
    const doc = makeDocument([
      makeItem({ id: 'ID-17' }),
      makeItem({ id: 'ID-18' }),
    ]);
    const { document: result } = applyMigration(doc);
    // ID-17 and ID-18 are canonical names — NOT in mapping, left as-is
    expect(result.items.some((i) => i.id === 'ID-17')).toBe(true);
    expect(result.items.some((i) => i.id === 'ID-18')).toBe(true);
  });

  it('emits a [WARN] and populates skipped[] for a legacy-format id absent from inventory (drift)', () => {
    // AST-S3-O1 matches LEGACY_ID_RE but is absent from the 43-entry inventory
    // (closed separately per Liam — TECH §A.0 drift rule). The migration script
    // must skip + WARN, not silently drop or auto-compact.
    const doc = makeDocument([makeItem({ id: 'AST-S3-O1' })]);
    const { document: result, skipped, warnings } = applyMigration(doc);
    expect(skipped).toEqual(['AST-S3-O1']);
    expect(warnings.some((w) => w.includes('[WARN]') && w.includes('AST-S3-O1'))).toBe(true);
    // Item retained with original id (no silent drop)
    expect(result.items.some((i) => i.id === 'AST-S3-O1')).toBe(true);
  });

  it('is idempotent — running twice on already-migrated data is a no-op', () => {
    const doc = makeDocument([
      makeItem({ id: 'OPS-6' }),
      makeItem({ id: 'OPS-11' }),
    ]);
    const { document: first } = applyMigration(doc);
    const { document: second } = applyMigration(first);
    expect(second.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
  });

  it('rewrites dependency ids alongside item ids', () => {
    const doc = makeDocument([
      makeItem({ id: 'OPS-28', dependencies: ['OPS-29'] }),
      makeItem({ id: 'OPS-29', dependencies: [] }),
    ]);
    const { document: result } = applyMigration(doc);
    const item34 = result.items.find((i) => i.id === '34');
    expect(item34).toBeDefined();
    expect(item34?.dependencies).toEqual(['33']);
  });
});

// ── §7 File I/O — dry-run and apply modes (A-INV-1 coverage) ─────────────

describe('file I/O integration', () => {
  let tmpDir: string;
  let tmpBacklog: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
    tmpBacklog = path.join(tmpDir, 'product-backlog.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dry-run does not write the file', () => {
    const original = JSON.stringify(
      makeDocument([makeItem({ id: 'OPS-6' })]),
      null,
      2,
    );
    fs.writeFileSync(tmpBacklog, original, 'utf-8');

    runMigration({ backlogPath: tmpBacklog, dryRun: true, verbose: false });

    const after = fs.readFileSync(tmpBacklog, 'utf-8');
    expect(after).toBe(original);
  });

  it('apply mode writes the migrated file', () => {
    const original = JSON.stringify(
      makeDocument([makeItem({ id: 'OPS-6' })]),
      null,
      2,
    );
    fs.writeFileSync(tmpBacklog, original, 'utf-8');

    runMigration({ backlogPath: tmpBacklog, dryRun: false, verbose: false });

    const after = JSON.parse(fs.readFileSync(tmpBacklog, 'utf-8'));
    expect(after.items.some((i: BacklogItem) => i.id === '42')).toBe(true);
    expect(after.items.some((i: BacklogItem) => i.id === 'OPS-6')).toBe(false);
  });

  it('apply mode on already-migrated file is a no-op (idempotent)', () => {
    const alreadyMigrated = JSON.stringify(
      makeDocument([makeItem({ id: '42' })]),
      null,
      2,
    );
    fs.writeFileSync(tmpBacklog, alreadyMigrated, 'utf-8');

    runMigration({ backlogPath: tmpBacklog, dryRun: false, verbose: false });

    const after = fs.readFileSync(tmpBacklog, 'utf-8');
    expect(JSON.parse(after).items[0].id).toBe('42');
  });
});

describe('schema validation post-migration', () => {
  // A-INV-2: BacklogSchema.parse() on migrated output succeeds (pre-tighten
  // form — id remains z.string().min(1); the regex tighten to /^\d+$/ lands
  // in 15.4 alongside the apply step).
  it('produces output that passes BacklogSchema.parse()', async () => {
    const { BacklogSchema } = await import('../../lib/validation/backlog-schema');
    const doc = makeDocument([
      makeItem({ id: 'OPS-6' }),
      makeItem({ id: 'OPS-11', dependencies: ['OPS-6'] }),
      makeItem({ id: 'OPS-43.1' }),
    ]);
    const { document: migrated } = applyMigration(doc);
    // Should not throw; if it does the test surfaces the parse error directly.
    expect(() => BacklogSchema.parse(migrated)).not.toThrow();
    // Sanity: ids are bare-digit post-migration
    const ids = migrated.items.map((i) => i.id);
    expect(ids).toContain('42'); // OPS-6 → 42
    expect(ids).toContain('43'); // OPS-11 → 43
    expect(ids).toContain('45'); // OPS-43.1 → 45 with lineage prefix
  });
});
