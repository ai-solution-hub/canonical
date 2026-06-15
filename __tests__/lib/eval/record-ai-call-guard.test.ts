/**
 * Grep-guard for `recordAiCall()` instrumentation (ID-104.10 / T16, B-INV-16).
 *
 * Forcing function: an AI touchpoint that declares itself instrumented (via the
 * greppable `@ai-touchpoint` sentinel) MUST contain the equally greppable
 * `recordAiCall(` literal — otherwise its cost + outcome signal never reach the
 * `ai_call_events` substrate (M4) and the cost-tab rollup (T17) silently
 * undercounts. This guard FAILS such a touchpoint, the same forcing-function
 * shape as `__tests__/mcp/mcp-fixture-sync.test.ts` (which FAILS a tool in
 * source but absent from the canonical fixtures). ID-71 M38 extends this pattern.
 *
 * Two sources of truth, mirroring the MCP fixture-sync precedent:
 *   1. The sentinel `@ai-touchpoint` — a file's self-declaration that it is an
 *      instrumented AI call site (the "registered" set).
 *   2. The `recordAiCall(` literal — proof the call is actually wired (the
 *      "implemented" set).
 * A touchpoint in (1) but not (2) is the silent-omission the guard catches.
 *
 * The detector is a pure function over file text so its failing direction can be
 * unit-proved with synthetic sources (no reliance on the live tree carrying an
 * omitting touchpoint to exercise the FAIL path). The real-tree sweep then holds
 * the invariant over every instrumented file as the codebase grows.
 */

import { join } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const PROJECT_ROOT = join(__dirname, '../../..');

/** The greppable literal a wired touchpoint must contain. */
const RECORD_AI_CALL_LITERAL = 'recordAiCall(';
/** The greppable sentinel a file uses to declare itself an instrumented touchpoint. */
const TOUCHPOINT_SENTINEL = '@ai-touchpoint';

/**
 * Pure detector: returns `true` when `source` declares itself an instrumented
 * AI touchpoint (carries the sentinel) but OMITS the `recordAiCall(` literal —
 * i.e. the silent-omission the guard is built to fail. Returns `false` for a
 * source that is either not a touchpoint, or is a touchpoint that wires the call.
 */
export function touchpointOmitsRecordAiCall(source: string): boolean {
  const isTouchpoint = source.includes(TOUCHPOINT_SENTINEL);
  if (!isTouchpoint) return false;
  return !source.includes(RECORD_AI_CALL_LITERAL);
}

/**
 * Recursively collect `.ts`/`.tsx` source files under `lib/`, `app/`, and
 * `scripts/` (the AI-call-bearing surfaces). Skips `node_modules`, build output,
 * and test files — a touchpoint's instrumentation lives in production code, not
 * its tests.
 */
function collectInstrumentedTouchpointFiles(): string[] {
  const roots = ['lib', 'app', 'scripts'].map((d) => join(PROJECT_ROOT, d));
  const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '__tests__']);
  const matches: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // directory absent — nothing to sweep here.
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue; // unreadable (e.g. sandbox-denied) — skip, do not crash the guard.
      }
      if (stats.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
      let content: string;
      try {
        content = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (content.includes(TOUCHPOINT_SENTINEL)) matches.push(full);
    }
  }

  for (const root of roots) walk(root);
  return matches;
}

describe('recordAiCall grep-guard — detector (forcing-function proof)', () => {
  it('FAILS an instrumented touchpoint that omits recordAiCall(', () => {
    const omitting = [
      '// @ai-touchpoint summarise',
      'const res = await client.messages.create({ model, messages });',
      '// cost capture: TODO — forgot to call the recorder',
    ].join('\n');
    expect(touchpointOmitsRecordAiCall(omitting)).toBe(true);
  });

  it('PASSES an instrumented touchpoint that wires recordAiCall(', () => {
    const wired = [
      '// @ai-touchpoint summarise',
      'const res = await client.messages.create({ model, messages });',
      "await recordAiCall({ supabase, touchpointId: 'summarise', usage: res.usage });",
    ].join('\n');
    expect(touchpointOmitsRecordAiCall(wired)).toBe(false);
  });

  it('PASSES a file that is not an instrumented touchpoint at all', () => {
    const plain = [
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
    ].join('\n');
    expect(touchpointOmitsRecordAiCall(plain)).toBe(false);
  });
});

describe('recordAiCall grep-guard — real-tree sweep', () => {
  const instrumentedFiles = collectInstrumentedTouchpointFiles();

  it('every @ai-touchpoint file wires recordAiCall(', () => {
    const omitting = instrumentedFiles.filter((file) =>
      touchpointOmitsRecordAiCall(readFileSync(file, 'utf8')),
    );
    expect(
      omitting,
      `Files declared @ai-touchpoint but missing recordAiCall(): ${omitting
        .map((f) => f.replace(`${PROJECT_ROOT}/`, ''))
        .join(', ')}`,
    ).toHaveLength(0);
  });
});
