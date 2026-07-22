/**
 * test-classname-token-coupling.test.ts — W-RH regression guard.
 *
 * Fails the build if a component BEHAVIOUR test (`__tests__/components/**`,
 * excluding `*.contract.test.tsx`) couples an assertion to a Warm Meridian
 * SEMANTIC DESIGN-SYSTEM STATE TOKEN class string.
 *
 * Why: the W-RE sweep decoupled ~98 such sites — behaviour tests must assert
 * user-observable state (visible text, accessible name, `data-*`/`role`),
 * never the internal token a component happens to render. The ONE sanctioned
 * place to pin the state -> token mapping is each component's
 * `*.contract.test.tsx` (excluded below). W-RD-style regrowth happened once
 * because no guard existed; this is that guard.
 *
 * If this guard flags a site, it is a STRAGGLER the W-RE sweep missed. FIX it
 * the W-RE way — assert via getByRole/getByText/aria/data-state, OR relocate
 * the token assertion into that component's `*.contract.test.tsx`. Do NOT
 * weaken the guard to make it pass; only narrow a regex for a genuine
 * false-positive, with an inline comment explaining why.
 *
 * Per docs/reference/testing/test-philosophy.md — pure file-read + regex, no fixtures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'tinyglobby';

const PROJECT_ROOT = join(__dirname, '../..');
const COMPONENTS_DIR = join(PROJECT_ROOT, '__tests__/components');

// ---------------------------------------------------------------------------
// What counts as a className assertion site.
// We only inspect lines that assert against a class string — the three
// W-RE-banned shapes plus querySelector('.tok').
// ---------------------------------------------------------------------------
const ASSERTION_SITE = /toHaveClass\(|\.className\)?\s*\)?\.(toContain|toMatch)\(|querySelector\(\s*['"`]\./;

// ---------------------------------------------------------------------------
// SEMANTIC DESIGN-SYSTEM STATE TOKENS (the thing a behaviour test must not
// couple to). Two shapes:
//   1. (text|bg|border)-(quality|freshness|confidence|status|bid|relevance)-…
//      — the Warm Meridian state-token families, e.g. text-quality-good,
//        bg-freshness-stale-bg, border-status-warning. We also match the bare
//        family substring (e.g. `freshness-stale`) because some sites assert
//        the token without its utility prefix.
//   2. bg-accent, and STATE uses of text-primary / bg-primary (the "Good"
//      quality band and similar map onto the primary token).
// ---------------------------------------------------------------------------
const STATE_TOKEN_FAMILY =
  /(?:text|bg|border)-(?:quality|freshness|confidence|status|bid|relevance)-|(?:^|['"`\s.])(?:quality|freshness|confidence|status|bid|relevance)-(?:good|moderate|poor|fresh|aging|stale|expired|high|medium|low|warning|success|error|won|lost|pending)/;
const EXTRA_STATE_TOKENS = /\bbg-accent\b|\btext-primary\b|\bbg-primary\b/;

// ---------------------------------------------------------------------------
// ALLOW-LIST — never flag these, even on an assertion site. Layout /
// typography / structural / animation / behavioural / CSS-variable utilities,
// none of which are semantic STATE tokens.
// ---------------------------------------------------------------------------
const ALLOWED = [
  // CSS-variable assertions — `border-l-[var(--status-warning)]`, `var(--…)`.
  // The token lives in a CSS var, not a literal utility class; this is the
  // design-system-correct way to reference a token and is not coupling.
  /\[var\(/,
  /var\(--/,
  // Typography scale.
  /\btext-(?:xs|sm|base|lg|xl|\dxl)\b/,
  /\btext-\[/, // arbitrary text sizes e.g. text-[10px]
  // Spacing / sizing.
  /\b(?:px|py|p|pt|pr|pb|pl|mx|my|m|mt|mr|mb|ml|h|w|size|gap|space)-/,
  // Structure / animation.
  /\banimate-/,
  /\brounded-/,
  /\bgrid\b/,
  /\bflex\b/,
  /\bhidden\b/,
  // Behavioural / accessibility / interaction.
  /\bsr-only\b/,
  /\bdark:/,
  /\bcursor-/,
];

interface Violation {
  file: string;
  line: number;
  text: string;
}

function isAllowed(line: string): boolean {
  return ALLOWED.some((re) => re.test(line));
}

function scan(): Violation[] {
  const files = globSync(['**/*.test.ts', '**/*.test.tsx'], {
    cwd: COMPONENTS_DIR,
    ignore: ['**/*.contract.test.tsx'],
  });

  const violations: Violation[] = [];
  for (const rel of files) {
    const abs = join(COMPONENTS_DIR, rel);
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!ASSERTION_SITE.test(line)) return;
      if (isAllowed(line)) return;
      if (STATE_TOKEN_FAMILY.test(line) || EXTRA_STATE_TOKENS.test(line)) {
        violations.push({
          file: `__tests__/components/${rel}`,
          line: i + 1,
          text: line.trim(),
        });
      }
    });
  }
  return violations;
}

describe('className semantic-token coupling guard (W-RH)', () => {
  it('no component BEHAVIOUR test couples to a semantic design-system state token', () => {
    const violations = scan();

    const report = violations
      .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`)
      .join('\n');

    expect(
      violations.length,
      violations.length === 0
        ? ''
        : `Found ${violations.length} className→semantic-token coupling(s) in component behaviour tests.\n` +
            `Each is a W-RE straggler. FIX the W-RE way: assert via ` +
            `getByRole/getByText/aria/data-state, OR relocate the token assert ` +
            `into that component's *.contract.test.tsx (the sanctioned coupling ` +
            `point). Do NOT weaken this guard.\n\n${report}\n`,
    ).toBe(0);
  });
});
