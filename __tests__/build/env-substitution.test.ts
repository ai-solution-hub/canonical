/**
 * Build-output regression test for `NEXT_PUBLIC_*` literal substitution.
 *
 * Guards against the S7 P0 (`lib/env-client.ts:95` `safeParse(process.env)`)
 * class of regression: passing the bare `process.env` reference defeats
 * Next.js's compile-time substitution of literal `process.env.NEXT_PUBLIC_X`
 * accessors. The browser bundle then crashes at first paint because Zod
 * receives the empty `{}` polyfill and reports every required field
 * undefined. Memory: `feedback_env_client_literal_substitution.md`.
 *
 * Strategy: after a real `bun run build`, scan
 * `.next/static/chunks/*.js` for any surviving `process.env.NEXT_PUBLIC_*`
 * occurrence. None should remain — every literal accessor is replaced at
 * compile time. Also assert at least one known value appears in a chunk
 * (proves substitution actually happened, not just absence of pattern).
 *
 * Gated behind `RUN_BUILD_TESTS=1` so it does not run in the default
 * `bun run test` (which would fail without a fresh `.next` build). Run
 * locally via `bun run build && RUN_BUILD_TESTS=1 bun run test:build`;
 * runs in CI via `.github/workflows/ci.yml` after the build step.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const RUN = process.env.RUN_BUILD_TESTS === '1';
const CHUNKS_DIR = join(process.cwd(), '.next', 'static', 'chunks');
const CLIENT_LITERAL = /process\.env\.NEXT_PUBLIC_[A-Z0-9_]+/;

function readJsChunks(): { file: string; content: string }[] {
  if (!existsSync(CHUNKS_DIR)) return [];
  const files = readdirSync(CHUNKS_DIR, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.js'))
    .map((d) => join(d.parentPath ?? CHUNKS_DIR, d.name));
  return files.map((file) => ({
    file,
    content: readFileSync(file, 'utf8'),
  }));
}

describe.skipIf(!RUN)('build-output: NEXT_PUBLIC_* substitution', () => {
  it('produces a non-empty chunks directory', () => {
    expect(existsSync(CHUNKS_DIR)).toBe(true);
    const chunks = readJsChunks();
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('no chunk contains an unsubstituted process.env.NEXT_PUBLIC_* literal', () => {
    const offenders = readJsChunks()
      .map(({ file, content }) => {
        const match = content.match(CLIENT_LITERAL);
        return match ? { file, match: match[0] } : null;
      })
      .filter((x): x is { file: string; match: string } => x !== null);

    if (offenders.length > 0) {
      const summary = offenders
        .slice(0, 5)
        .map((o) => `  - ${o.file.replace(CHUNKS_DIR, '<chunks>')}: ${o.match}`)
        .join('\n');
      throw new Error(
        `Found ${offenders.length} chunk(s) with unsubstituted NEXT_PUBLIC_* references.\n` +
          `Next.js literal substitution requires direct \`process.env.NEXT_PUBLIC_X\` reads;\n` +
          `passing the bare \`process.env\` to \`safeParse\` (or any other consumer) defeats it.\n` +
          `See lib/env-client.ts:94-117 + memory feedback_env_client_literal_substitution.md.\n` +
          `First 5:\n${summary}`,
      );
    }
  });

  it('NEXT_PUBLIC_CLIENT_ID build-time value appears as a substituted literal', () => {
    const expected = process.env.NEXT_PUBLIC_CLIENT_ID;
    if (!expected) {
      console.warn(
        'NEXT_PUBLIC_CLIENT_ID not set in test env — skipping forward-direction assertion.',
      );
      return;
    }
    const chunks = readJsChunks();
    const found = chunks.some(({ content }) => content.includes(`"${expected}"`));
    expect(found, `Expected substituted NEXT_PUBLIC_CLIENT_ID="${expected}" in some chunk`).toBe(true);
  });
});
