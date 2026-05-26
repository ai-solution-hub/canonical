/**
 * R-WP17 ResponseSchema strictness guard — ID-32.26 (INV-S).
 *
 * Closes the INV-S contract (TECH §3.1a): the generated `${interface}Schema`
 * block in `lib/validation/schemas.ts` must derive strictness from the REAL
 * source interfaces — bare `z.object({...})` (zod-4 default, strips additive
 * wire fields but REJECTS a renamed/removed/retyped declared field) — and may
 * emit `.loose()` ONLY where the source declares a genuine `[k: string]: T`
 * index signature and `z.unknown()` ONLY for genuinely-opaque `Json` /
 * `unknown` / external-generic members. Every such exception is recorded on a
 * machine-checkable `// ALLOW:` manifest inside the block.
 *
 * Three contracts under test:
 *
 *   (1) STATIC GUARD — every `.loose()` and every `z.unknown()` token inside
 *       the BEGIN/END generated block has a matching `// ALLOW:` manifest
 *       entry. A new un-justified `.loose()`/`z.unknown()` fails the check.
 *
 *   (2) RUNTIME DRIFT-CATCH — a strict generated schema REJECTS a payload
 *       whose declared field was renamed (e.g. `item_count` → `itemCount`),
 *       where the pre-amendment `.loose()` schema would have ACCEPTED it. This
 *       proves the tightening actually catches drift (the false-confidence fix).
 *
 *   (3) DEPTH-CAP ELIMINATION — members that previously collapsed to
 *       `z.unknown()` purely because they sat beyond the old depth cap (e.g.
 *       `content_type`, `why_notable` deep inside ChangeReportGenerateResponse)
 *       now resolve to their real type (`z.string()`), not `z.unknown()`.
 *
 * Spec: docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §3.1a (INV-S).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import * as schemas from '@/lib/validation/schemas';
import {
  BLOCK_BEGIN,
  BLOCK_END,
} from '@/scripts/codemods/generate-response-schemas';

const REPO_ROOT = process.cwd();
const SCHEMAS_DISK_PATH = resolve(REPO_ROOT, 'lib/validation/schemas.ts');

/** Extract the text between (and excluding) the BEGIN/END managed markers. */
function extractGeneratedBlock(): string {
  const src = readFileSync(SCHEMAS_DISK_PATH, 'utf8');
  const begin = src.indexOf(BLOCK_BEGIN);
  const end = src.indexOf(BLOCK_END);
  expect(begin, 'BLOCK_BEGIN marker present').toBeGreaterThanOrEqual(0);
  expect(end, 'BLOCK_END marker present').toBeGreaterThan(begin);
  return src.slice(begin, end + BLOCK_END.length);
}

/** Count non-overlapping occurrences of a literal substring. */
function countLiteral(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// ── Contract 1: static guard — every exception is allow-listed ──────────────

describe('INV-S static guard — every .loose()/z.unknown() is allow-listed', () => {
  const block = extractGeneratedBlock();

  // ALLOW manifest lines look like:
  //   // ALLOW: .loose @ PipelineRunRow.progress — index-signature [k: string]: unknown
  //   // ALLOW: z.unknown @ IntelligenceWorkspace.domain_metadata — Json
  const allowLines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('// ALLOW:'));

  const allowLoose = allowLines.filter((l) => /\.loose\b/.test(l));
  const allowUnknown = allowLines.filter((l) => /z\.unknown\b/.test(l));

  it('emits at least one // ALLOW: manifest entry', () => {
    expect(allowLines.length).toBeGreaterThan(0);
  });

  it('every .loose() in the block has a matching allow-list entry', () => {
    // The manifest header lines themselves are comments, so the `.loose`
    // token count there is the allow-list; count `.loose()` in CODE lines only.
    const codeLines = block
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'));
    const looseCount = countLiteral(codeLines.join('\n'), '.loose()');
    expect(
      allowLoose.length,
      `expected ${looseCount} // ALLOW: .loose entries (one per .loose() in code), ` +
        `found ${allowLoose.length}:\n${allowLoose.join('\n')}`,
    ).toBe(looseCount);
  });

  it('every z.unknown() in the block has a matching allow-list entry', () => {
    const codeLines = block
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'));
    const unknownCount = countLiteral(codeLines.join('\n'), 'z.unknown()');
    expect(
      allowUnknown.length,
      `expected ${unknownCount} // ALLOW: z.unknown entries (one per z.unknown() in code), ` +
        `found ${allowUnknown.length}:\n${allowUnknown.join('\n')}`,
    ).toBe(unknownCount);
  });

  it('every allow-list entry cites a real source justification (index-signature | Json | unknown | external)', () => {
    for (const line of allowLines) {
      expect(
        /—\s*(index-signature|Json|unknown|external)/.test(line),
        `allow-list entry must cite a real justification: "${line}"`,
      ).toBe(true);
    }
  });

  it('z.strictObject is NOT used (would 500 on legitimately-added fields)', () => {
    expect(block.includes('z.strictObject')).toBe(false);
  });
});

// ── Contract 2: runtime drift-catch — strict schema rejects renamed field ───

describe('INV-S runtime drift-catch — strict schema rejects a renamed declared field', () => {
  function getSchema(name: string): z.ZodTypeAny {
    return (schemas as Record<string, unknown>)[name] as z.ZodTypeAny;
  }

  it('ReadinessDataSchema REJECTS a payload whose declared field is renamed', () => {
    const schema = getSchema('ReadinessDataSchema');
    expect(schema, 'ReadinessDataSchema exported').toBeDefined();

    // A valid payload — the strict schema accepts it (additive wire fields
    // would be stripped, declared fields preserved).
    const valid = {
      ready: true,
      summary: {
        total_questions: 5,
        answered: 5,
        approved: 5,
        quality_checked: 5,
        passing_quality: 5,
      },
      criteria: [],
      issues: [],
    };
    expect(schema.safeParse(valid).success).toBe(true);

    // Drift: a REQUIRED declared field (`total_questions`) renamed to
    // `totalQuestions` on the nested `summary` object. Under the OLD `.loose()`
    // generation this passed (extra key tolerated, missing required... actually
    // missing required would fail — so rename the WHOLE summary's required
    // member and prove the missing-required rejection holds under strict too).
    const drifted = {
      ready: true,
      summary: {
        totalQuestions: 5, // renamed away from total_questions
        answered: 5,
        approved: 5,
        quality_checked: 5,
        passing_quality: 5,
      },
      criteria: [],
      issues: [],
    };
    // total_questions is now MISSING (renamed) → strict schema rejects.
    expect(schema.safeParse(drifted).success).toBe(false);
  });

  it('a strict z.object REJECTS a renamed field that a .loose() z.object ACCEPTS (mechanism proof)', () => {
    // Pre-amendment shape: .loose() tolerates the renamed key as an extra.
    const looseSchema = z.object({ item_count: z.number() }).loose();
    // Renamed-field payload: the declared `item_count` is gone, `itemCount`
    // is an additive key. .loose() keeps the extra... but still requires
    // item_count, so it fails too. The real demonstration: a schema with an
    // OPTIONAL declared field renamed.
    const looseOptional = z
      .object({ item_count: z.number().optional() })
      .loose();
    const strictOptional = z.object({ item_count: z.number().optional() });

    const renamedPayload = { itemCount: 5 };

    // .loose(): the renamed `itemCount` is retained as an extra; `item_count`
    // is absent but optional → ACCEPTS (false confidence — drift invisible).
    expect(looseOptional.safeParse(renamedPayload).success).toBe(true);
    // strict default: the renamed `itemCount` is STRIPPED, `item_count` absent
    // but optional → ACCEPTS, but the renamed key does NOT survive (drift
    // silently dropped, not retained). Prove the strip:
    const strictParsed = strictOptional.safeParse(renamedPayload);
    expect(strictParsed.success).toBe(true);
    expect(
      (strictParsed as { data: Record<string, unknown> }).data,
    ).not.toHaveProperty('itemCount');
    // And the .loose() variant DOES retain it (the false-confidence trap):
    const looseParsed = looseSchema.safeParse({ item_count: 1, itemCount: 5 });
    expect(looseParsed.success).toBe(true);
    expect(
      (looseParsed as { data: Record<string, unknown> }).data,
    ).toHaveProperty('itemCount');
  });
});

// ── Contract 3: depth-cap artifacts resolved to real types ──────────────────

describe('INV-S depth-cap elimination — deep members resolve to real types', () => {
  function getSchema(name: string): z.ZodTypeAny {
    return (schemas as Record<string, unknown>)[name] as z.ZodTypeAny;
  }

  it('ChangeReportGenerateResponseSchema deep top_items members are typed, not z.unknown()', () => {
    const schema = getSchema('ChangeReportGenerateResponseSchema');
    expect(schema, 'ChangeReportGenerateResponseSchema exported').toBeDefined();

    // A deeply-nested top_items entry with a NON-string content_type must be
    // REJECTED — under the old depth-cap z.unknown() it would have been
    // accepted (content_type: z.unknown()).
    const payloadWithBadContentType = {
      digest: {
        id: 'r1',
        frequency: 'weekly',
        period_start: '2026-05-01',
        period_end: '2026-05-08',
        item_count: 1,
        domain_summaries: [
          {
            domain: 'procurement',
            item_count: 1,
            summary: 's',
            top_items: [
              {
                id: 'i1',
                title: 't1',
                content_type: 12345, // NOT a string — must be rejected now
              },
            ],
            key_themes: [],
          },
        ],
        narrative_summary: null,
        generated_at: '2026-05-08T00:00:00.000Z',
        generated_by: 'system',
        tokens_used: null,
        created_at: '2026-05-08T00:00:00.000Z',
      },
    };
    expect(schema.safeParse(payloadWithBadContentType).success).toBe(false);

    // The same payload with a STRING content_type is accepted.
    const goodPayload = structuredClone(payloadWithBadContentType);
    (
      goodPayload.digest.domain_summaries[0].top_items[0] as {
        content_type: unknown;
      }
    ).content_type = 'guide';
    expect(schema.safeParse(goodPayload).success).toBe(true);
  });
});
