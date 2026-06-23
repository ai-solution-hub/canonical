/**
 * Semantic-token guard for the ID-120 {120.8} dedup-proposals UI (TECH P-4).
 *
 * Acceptance (testStrategy): the curator surface uses Warm Meridian SEMANTIC
 * design tokens only — NO raw Tailwind colour utilities (`bg-red-500`,
 * `text-green-600`, …). This source-scan fails if any new component reaches for
 * a raw palette colour instead of a semantic token (`bg-card`, `text-status-*`,
 * `border-border`, …).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENT_DIR = join(
  process.cwd(),
  'components/admin/q-a-pairs/dedup-proposals',
);

// Raw Tailwind palette families that are NOT semantic tokens. A class like
// `bg-red-500` / `text-green-600` / `border-blue-200` matches; semantic tokens
// (`bg-card`, `text-status-error`, `border-border`, `text-muted-foreground`)
// do NOT (their colour word is not followed by a numeric Tailwind shade).
const RAW_COLOUR_RE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|grey|zinc|neutral|stone)-\d{2,3}\b/;

function componentFiles(): string[] {
  return readdirSync(COMPONENT_DIR)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(COMPONENT_DIR, f));
}

describe('dedup-proposals UI — semantic tokens only', () => {
  it('ships at least the seven mirrored components', () => {
    const names = readdirSync(COMPONENT_DIR).filter((f) => f.endsWith('.tsx'));
    expect(names.length).toBeGreaterThanOrEqual(7);
  });

  it('has no raw Tailwind palette colour utilities', () => {
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, idx) => {
        if (RAW_COLOUR_RE.test(line)) {
          offenders.push(`${file}:${idx + 1} → ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
