/**
 * retro-ledger-roundtrip.test.ts — CI regression guard (ID-48.3).
 *
 * Parses the live `docs/reference/product-retros.json` through
 * `parseRetrosWithWarnings()` on every CI run. Catches structural drift,
 * invalid field values, and id-uniqueness violations before they reach main.
 *
 * Mirrors `backlog-schema-roundtrip.test.ts` (ID-68): pure schema parse, no
 * Supabase fixtures, no chain-method asserts. Per `docs/reference/test-philosophy.md`.
 *
 * Asserts (beyond `RetrosSchema.safeParse()` success):
 *   1. Root document carries the literal `document_name` "Knowledge Hub Retros".
 *   2. retros[] is non-empty (S264 migrated as the inaugural record).
 *   3. Every record id is unique (refine surface from RetrosSchema).
 *   4. Each record carries the structured-provenance triple + the 6 category arrays.
 *   5. **S271 §13.4 schema delta:** the four soft-delete / adjudication fields
 *      default correctly when omitted from input (deprecated=false,
 *      deprecation_reason=null, superseding_record_id=null, last_conflict_check=null).
 *
 * Failure recovery:
 *   - Run `RetrosSchema.safeParse(JSON.parse(fs.readFileSync(RETROS_PATH)))` in
 *     a REPL to get the full Zod error path.
 *   - Fix the offending field in `docs/reference/product-retros.json`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  RetrosSchema,
  RetroRecordSchema,
  parseRetrosWithWarnings,
} from '@/lib/validation/retro-schema';

const RETROS_PATH = resolve(__dirname, '../fixtures/ledger/product-retros.json');

describe('product-retros.json schema roundtrip (RetrosSchema)', () => {
  it('parses the live JSON file without throwing', () => {
    const raw = readFileSync(RETROS_PATH, 'utf-8');
    const json: unknown = JSON.parse(raw);

    const result = RetrosSchema.safeParse(json);

    if (!result.success) {
      const issues = result.error.issues
        .map(
          (issue) =>
            `  [${issue.path.join('.')}] ${issue.code}: ${issue.message}`,
        )
        .join('\n');
      expect.fail(
        `RetrosSchema.parse() failed for docs/reference/product-retros.json.\n` +
          `Fix the offending fields and re-run.\n\n` +
          `Zod issues (${result.error.issues.length}):\n${issues}`,
      );
    }

    expect(result.success).toBe(true);
  });

  it('parseRetrosWithWarnings returns the live document plus empty warnings', () => {
    const raw = readFileSync(RETROS_PATH, 'utf-8');
    const { value, warnings } = parseRetrosWithWarnings(JSON.parse(raw));

    expect(value.document_name).toBe('Knowledge Hub Retros');
    // No char budgets registered for the retro surface yet — warnings always empty.
    expect(warnings).toEqual([]);
  });

  it('parsed document carries expected root metadata fields', () => {
    const raw = readFileSync(RETROS_PATH, 'utf-8');
    const result = RetrosSchema.parse(JSON.parse(raw));

    expect(result.document_name).toBe('Knowledge Hub Retros');
    expect(typeof result.document_purpose).toBe('string');
    expect(result.document_purpose.length).toBeGreaterThan(0);
    expect(Array.isArray(result.related_documents)).toBe(true);
    expect(typeof result.last_updated).toBe('string');
    expect(result.last_updated.length).toBeGreaterThan(0);
  });

  it('retros array is non-empty (S1 present as synthetic fixture record)', () => {
    const raw = readFileSync(RETROS_PATH, 'utf-8');
    const result = RetrosSchema.parse(JSON.parse(raw));

    expect(result.retros.length).toBeGreaterThan(0);
    // Fixture uses synthetic id S1 (replaced real S264 per ID-68.35 ledger relocation).
    expect(result.retros.some((r) => r.id === 'S1')).toBe(true);
  });

  it('all parsed record ids are unique (id-uniqueness refine)', () => {
    const raw = readFileSync(RETROS_PATH, 'utf-8');
    const result = RetrosSchema.parse(JSON.parse(raw));

    const ids = result.retros.map((r) => r.id);
    const uniqueIds = new Set(ids);

    expect(
      uniqueIds.size,
      `Duplicate ids found — every retro record must have a unique id. ` +
        `Total: ${ids.length}, unique: ${uniqueIds.size}. ` +
        `Duplicates: ${ids.filter((id, idx) => ids.indexOf(id) !== idx).join(', ')}`,
    ).toBe(ids.length);
  });

  it('every record carries the structured-provenance triple + 6 category arrays', () => {
    const raw = readFileSync(RETROS_PATH, 'utf-8');
    const result = RetrosSchema.parse(JSON.parse(raw));

    const missing: string[] = [];
    for (const record of result.retros) {
      if (!Array.isArray(record.session_refs))
        missing.push(`id=${record.id}: missing session_refs`);
      if (!Array.isArray(record.commit_refs))
        missing.push(`id=${record.id}: missing commit_refs`);
      if (!Array.isArray(record.cross_doc_links))
        missing.push(`id=${record.id}: missing cross_doc_links`);

      for (const cat of [
        'bugs_discovered',
        'failed_assumptions',
        'architecture_decisions',
        'rejected_approaches',
        'workflow_improvements',
        'unresolved_questions',
      ] as const) {
        if (!Array.isArray(record[cat]))
          missing.push(`id=${record.id}: missing category ${cat}`);
      }
    }

    expect(
      missing,
      `Structured-provenance triple + 6 category arrays required on every record.\n` +
        `Offenders:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('id-uniqueness refine rejects a synthetically duplicated document', () => {
    const raw = readFileSync(RETROS_PATH, 'utf-8');
    const liveDoc = JSON.parse(raw) as { retros: unknown[] } & Record<
      string,
      unknown
    >;

    const original = liveDoc.retros[0] as Record<string, unknown>;
    const duplicate = { ...original, id: original['id'] };
    const docWithDuplicate = {
      ...liveDoc,
      retros: [original, duplicate],
    };

    const result = RetrosSchema.safeParse(docWithDuplicate);

    expect(
      result.success,
      'RetrosSchema should reject a document with duplicate record ids',
    ).toBe(false);

    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(
        messages,
        'Error message should mention uniqueness',
      ).toMatch(/unique/i);
    }
  });
});

describe('RetroRecordSchema — S271 §13.4 soft-delete field defaults', () => {
  // The 4 soft-delete fields (deprecated, deprecation_reason,
  // superseding_record_id, last_conflict_check) must default correctly when
  // omitted from input — this is what makes them cheap-to-introduce-now /
  // expensive-to-retrofit-later. Verifying the default mechanism here
  // protects against accidental future changes that make any of them required.

  const minimalRecord = {
    id: 'S999',
    session_id: 'kh-test-S999',
    date: '2026-01-01',
    track: 'test',
    session_refs: [],
    commit_refs: [],
    cross_doc_links: [],
    bugs_discovered: [],
    failed_assumptions: [],
    architecture_decisions: [],
    rejected_approaches: [],
    workflow_improvements: [],
    unresolved_questions: [],
    // Soft-delete fields omitted on purpose — testing defaults.
  };

  it('deprecated defaults to false when omitted', () => {
    const parsed = RetroRecordSchema.parse(minimalRecord);
    expect(parsed.deprecated).toBe(false);
  });

  it('deprecation_reason defaults to null when omitted', () => {
    const parsed = RetroRecordSchema.parse(minimalRecord);
    expect(parsed.deprecation_reason).toBeNull();
  });

  it('superseding_record_id defaults to null when omitted', () => {
    const parsed = RetroRecordSchema.parse(minimalRecord);
    expect(parsed.superseding_record_id).toBeNull();
  });

  it('last_conflict_check defaults to null when omitted', () => {
    const parsed = RetroRecordSchema.parse(minimalRecord);
    expect(parsed.last_conflict_check).toBeNull();
  });

  it('accepts a fully-populated soft-delete adjudication', () => {
    const adjudicated = {
      ...minimalRecord,
      id: 'S998',
      deprecated: true,
      deprecation_reason: 'conflict-resolution:superseded-by:S999',
      superseding_record_id: 'S999',
      last_conflict_check: '2026-05-28T12:34:56.000Z',
    };
    const parsed = RetroRecordSchema.parse(adjudicated);
    expect(parsed.deprecated).toBe(true);
    expect(parsed.deprecation_reason).toBe(
      'conflict-resolution:superseded-by:S999',
    );
    expect(parsed.superseding_record_id).toBe('S999');
    expect(parsed.last_conflict_check).toBe('2026-05-28T12:34:56.000Z');
  });

  it('rejects a non-session-id form (must match /^S\\d+$/)', () => {
    const bad = { ...minimalRecord, id: '264' }; // missing leading S
    const result = RetroRecordSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO date', () => {
    const bad = { ...minimalRecord, date: '25/05/2026' };
    const result = RetroRecordSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO last_conflict_check', () => {
    const bad = { ...minimalRecord, last_conflict_check: '2026-05-28' };
    const result = RetroRecordSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields (strict root)', () => {
    const bad = { ...minimalRecord, unknown_field: 'oops' };
    const result = RetroRecordSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
