import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ID-130 T-B9 DUAL-WRITER GUARD (split-brain prevention).
 *
 * After the umbrella re-anchor ({130.11}), the procurement engagement facts
 * `{status, outcome, deadline, submission_date, outcome_recorded_at,
 * outcome_recorded_by}` live on the FORM (`form_templates`). The two umbrella
 * write routes must NEVER persist any of those keys back into
 * `workspaces.domain_metadata` — a second writer there re-opens the split-brain
 * the migration ({130.8}) closed and silently diverges from the form-anchored
 * roll-up + win-rate engine.
 *
 * This is a SOURCE grep guard (not a behaviour test): it reads the route source
 * and fails if a `domain_metadata` object literal sets any deprecated engagement
 * key. It catches a regression that a per-call mock test would miss.
 */

const ROUTE_FILES = [
  'app/api/procurement/[id]/route.ts',
  'app/api/procurement/[id]/outcome/route.ts',
];

/** The engagement keys that moved to the form and must never be written here. */
const DEPRECATED_DOMAIN_METADATA_KEYS = [
  'status',
  'outcome',
  'deadline',
  'submission_date',
  'outcome_recorded_at',
  'outcome_recorded_by',
] as const;

/** Strip line + block comments so prose mentioning the keys never trips us. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('ID-130 dual-writer guard — no domain_metadata engagement writer', () => {
  for (const relPath of ROUTE_FILES) {
    const src = stripComments(
      readFileSync(join(process.cwd(), relPath), 'utf8'),
    );

    for (const key of DEPRECATED_DOMAIN_METADATA_KEYS) {
      it(`${relPath} never writes "${key}" into a domain_metadata literal`, () => {
        // Match a domain_metadata object literal (assigned via : or =) that sets
        // the deprecated key as a property. Reads (`current.domain_metadata`),
        // select projections (`'..., domain_metadata, ...'`), and the strip
        // destructure (`= currentMetadata`) do NOT match this write pattern.
        const writeLiteral = new RegExp(
          `domain_metadata\\s*[:=]\\s*\\{[\\s\\S]{0,800}?\\b${key}\\b\\s*:`,
        );
        expect(writeLiteral.test(src)).toBe(false);
      });
    }
  }

  it('the umbrella PATCH writes the workflow transition onto the form', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/api/procurement/[id]/route.ts'),
      'utf8',
    );
    // Positive control: the engagement write target IS form_templates.
    expect(src).toMatch(/\.from\('form_templates'\)[\s\S]*?\.update\(/);
    expect(src).toMatch(/workflow_state/);
  });

  it('the outcome route writes the outcome + audit onto the form', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/api/procurement/[id]/outcome/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/\.from\('form_templates'\)[\s\S]*?\.update\(/);
    expect(src).toMatch(/outcome_recorded_by/);
  });
});
