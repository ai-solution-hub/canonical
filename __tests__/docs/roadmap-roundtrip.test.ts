/**
 * Roadmap MD ↔ JSON round-trip CI guard — kh-prod-readiness-S39 W1 Phase 2.
 *
 * Asserts that `docs/reference/product-roadmap.md` is in sync with the
 * authoritative `docs/reference/product-roadmap.json` per the §6.1 step 5
 * ratification (JSON authoritative, MD generated). The check is one-way
 * by design: render the JSON via the same pipeline `bun run roadmap:render`
 * uses, then compare the freshly-rendered output against the on-disk MD
 * after both sides are normalised.
 *
 * Normalisation rules (per `roadmap-conversion-approach.md` §5):
 *   - Strip trailing whitespace from every line.
 *   - Collapse pipe-padding to single space (` *\| *` → ` | `).
 *   - Collapse multiple blank lines to a single blank line.
 *   - Trim trailing newlines from end-of-file.
 *
 * Normalisation is whitespace-only; word streams must match. Acceptable
 * delta: pipe-padding, multi-blank collapse. Unacceptable delta: missing
 * words, dropped links, reordered phrases.
 *
 * Failure recovery: run `bun run roadmap:render` and commit both files.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = process.cwd();
const ROADMAP_MD = resolve(REPO_ROOT, 'docs/reference/product-roadmap.md');
const ROADMAP_RENDER_SCRIPT = 'scripts/roadmap-from-json.ts';

function renderRoadmapToTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-rt-'));
  const out = join(dir, 'rendered.md');
  execFileSync(
    'bun',
    ['run', ROADMAP_RENDER_SCRIPT, '--output=' + out],
    {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  return readFileSync(out, 'utf-8');
}

function normalise(md: string): string {
  return md
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .map((line) => line.replace(/[ \t]*\|[ \t]+/g, ' | '))
    .map((line) => line.replace(/[ \t]+\|/g, ' |'))
    .map((line) => line.replace(/[ \t]{2,}/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/g, '\n');
}

function tokenise(md: string): string[] {
  return md
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== '|' && !/^-+$/.test(t));
}

describe('product-roadmap.md round-trip with product-roadmap.json', () => {
  it('rendered output matches on-disk MD after whitespace normalisation', () => {
    const rendered = renderRoadmapToTmp();
    const onDisk = readFileSync(ROADMAP_MD, 'utf-8');

    const normalisedRendered = normalise(rendered);
    const normalisedOnDisk = normalise(onDisk);

    expect(
      normalisedRendered,
      'docs/reference/product-roadmap.md is out of sync with product-roadmap.json. ' +
        'JSON is authoritative — run `bun run roadmap:render` and commit both files. ' +
        'Per `.planning/.research/s37-housekeeping/roadmap-conversion-approach.md` §6.1 step 5.',
    ).toEqual(normalisedOnDisk);
  });

  it('word-token streams match exactly between rendered and on-disk MD', () => {
    const rendered = renderRoadmapToTmp();
    const onDisk = readFileSync(ROADMAP_MD, 'utf-8');

    const renderedTokens = tokenise(rendered);
    const onDiskTokens = tokenise(onDisk);

    expect(
      renderedTokens.length,
      'Token count differs — content has been added or dropped between JSON and MD. ' +
        'rendered=' +
        renderedTokens.length +
        ', on-disk=' +
        onDiskTokens.length,
    ).toBe(onDiskTokens.length);

    for (let i = 0; i < renderedTokens.length; i++) {
      if (renderedTokens[i] !== onDiskTokens[i]) {
        expect.fail(
          'Token mismatch at index ' +
            i +
            ': rendered="' +
            renderedTokens[i] +
            '" vs on-disk="' +
            onDiskTokens[i] +
            '" — context: ...' +
            renderedTokens.slice(Math.max(0, i - 3), i + 4).join(' ') +
            '...',
        );
      }
    }
  });
});
