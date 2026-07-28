/**
 * user-scratch-citations.test.ts — id-386 guard.
 *
 * Fails if a TRACKED file cites a path inside `.user-scratch/`.
 *
 * `.user-scratch/` is gitignored: it exists on one machine and nowhere else. A
 * tracked file that cites a path inside it makes a promise the repository cannot
 * keep. S506 measured what that costs — of ~101 `.user-scratch/` paths cited
 * across the two repos, **33 pointed at files that no longer existed**. The worst
 * case was a shipped production migration
 * (`supabase/migrations/20260702120000_id131_search_rpcs.sql`) naming a gitignored
 * file as its governing note, so a fresh clone could not resolve the rationale for
 * live SQL.
 *
 * What counts as a citation: `.user-scratch/` followed by a real filename
 * character. That deliberately spares the directory's own configuration —
 * `.gitignore` and `.worktreeinclude` list `.user-scratch/` bare, `eslint.config.mjs`
 * uses `.user-scratch/**`, `stryker.config.mjs` uses `/.user-scratch` — none of
 * which promise a file exists. Prose that names the directory as a concept is
 * likewise fine; only a path to a FILE inside it is a broken promise.
 *
 * Fix when this fails: migrate the cited file to a tracked home (a spec's `notes/`
 * or dated `reports/` in the private docs-site), then repoint the citation. If the
 * cited file is already gone, say so in place — an honest "evidence lost" beats a
 * path that resolves for nobody. The `/handoff` Step 2d gate catches these at
 * session close, before they land.
 *
 * The docs-site carries a mirror of this guard, which additionally exempts its
 * point-in-time surfaces (`reports/`, `ledgers/`, `continuation-prompts/`, spec
 * `notes/`) — those describe a moment rather than claiming to be current, so a
 * scratch citation in them is provenance, not a defect.
 *
 * Per docs/reference/testing/test-philosophy.md — pure file-read + regex, no fixtures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const PROJECT_ROOT = join(__dirname, '../..');

/** `.user-scratch/` followed by a filename character — a path, not a config glob. */
const SCRATCH_CITATION = /\.user-scratch\/[A-Za-z0-9_.-]/;

/**
 * `.dev-workflow/` is a vendored snapshot of the pre-Intent SDLC workflow, marked
 * "stale-by-design — never sweep that tree" at
 * `.claude/skills/propagate-workflow-change/references/surface-map.md`. Its
 * `.user-scratch/checker-artifacts/` references describe how that retired
 * orchestrator behaved; rewriting them would falsify the snapshot.
 */
const EXEMPT_PREFIXES = ['.dev-workflow/'];

const SELF = relative(PROJECT_ROOT, __filename);

const isBinary = (p: string) =>
  /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|woff2?|ttf|eot|mp4|webm|lock)$/i.test(p);

describe('no tracked file cites a path inside gitignored .user-scratch/', () => {
  it('has zero citations outside the documented exemptions', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean);

    const offenders: string[] = [];

    for (const file of tracked) {
      if (file === SELF) continue;
      if (isBinary(file)) continue;
      if (EXEMPT_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;

      let source: string;
      try {
        source = readFileSync(join(PROJECT_ROOT, file), 'utf8');
      } catch {
        continue; // deleted-but-staged, or unreadable — not this guard's concern
      }
      if (!source.includes('.user-scratch/')) continue;

      source.split('\n').forEach((line, i) => {
        if (SCRATCH_CITATION.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }

    // Rendered as a list so a failure names every citation at once.
    expect(offenders).toEqual([]);
  });
});
