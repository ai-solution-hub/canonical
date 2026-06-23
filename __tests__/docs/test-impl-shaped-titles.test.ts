/**
 * test-impl-shaped-titles.test.ts — W-RH regression RATCHET.
 *
 * Counts `it()` / `test()` titles whose FIRST word is an implementation-
 * mechanics verb (passes / configures / wraps / forwards / sets / applies /
 * uses). Such titles describe HOW the component is wired rather than the
 * behaviour a user observes — the W-RF antipattern.
 *
 * This is a RATCHET, not a zero-tolerance gate: the W-RF long-tail is
 * intentionally not yet fully cleaned. The guard asserts the count is <= a
 * BASELINE constant.
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ BASELINE MAY ONLY EVER BE DECREASED.                                 │
 *   │ Lower it when you clean impl-titles; NEVER raise it. A raise means a │
 *   │ NEW impl-shaped title was introduced — rename it to describe the     │
 *   │ user-observable behaviour instead (see W-RF / test-philosophy.md).   │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * `calls` is deliberately EXCLUDED: `calls X with <payload>` is a legitimate
 * contract assertion, too nuanced for a hard guard.
 *
 * Per docs/reference/test-philosophy.md — pure file-read + regex, no fixtures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'tinyglobby';

const PROJECT_ROOT = join(__dirname, '../..');
const TESTS_DIR = join(PROJECT_ROOT, '__tests__');

// Current measured count of impl-shaped titles in the tree. Ratchet downward
// only — see the box above. Last measured: 262 (W-RH authoring pass).
const BASELINE = 262;

const IMPL_VERBS = [
  'passes',
  'configures',
  'wraps',
  'forwards',
  'sets',
  'applies',
  'uses',
] as const;

// Matches `it(` / `test(` (and modifiers like it.each / test.skip) where the
// title's FIRST word is an impl-mechanics verb. The quote class immediately
// before the verb anchors it to the start of the title string.
const IMPL_TITLE = new RegExp(
  `\\b(?:it|test)(?:\\.\\w+)?\\(\\s*['"\`](?:${IMPL_VERBS.join('|')})\\b`,
  'g',
);

interface Offender {
  file: string;
  count: number;
}

function scan(): { total: number; offenders: Offender[] } {
  const files = globSync(['**/*.test.ts', '**/*.test.tsx'], {
    cwd: TESTS_DIR,
  });

  let total = 0;
  const offenders: Offender[] = [];
  for (const rel of files) {
    const body = readFileSync(join(TESTS_DIR, rel), 'utf8');
    const count = (body.match(IMPL_TITLE) ?? []).length;
    if (count > 0) {
      total += count;
      offenders.push({ file: `__tests__/${rel}`, count });
    }
  }
  offenders.sort((a, b) => b.count - a.count);
  return { total, offenders };
}

describe('impl-shaped test-title ratchet (W-RH)', () => {
  it(`impl-shaped title count stays at or below the baseline (${BASELINE})`, () => {
    const { total, offenders } = scan();

    const topOffenders = offenders
      .slice(0, 15)
      .map((o) => `  ${o.count.toString().padStart(3)}  ${o.file}`)
      .join('\n');

    const overBaseline = total > BASELINE;
    const message = overBaseline
      ? `Impl-shaped title count is ${total}, ABOVE the baseline of ${BASELINE}.\n` +
        `A NEW impl-shaped title (first word: ${IMPL_VERBS.join(' / ')}) was ` +
        `introduced. Rename it to describe the user-observable behaviour ` +
        `(W-RF / test-philosophy.md). Do NOT raise the baseline.\n\n` +
        `Worst offending files:\n${topOffenders}\n`
      : '';

    expect(total, message).toBeLessThanOrEqual(BASELINE);
  });
});
