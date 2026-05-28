/**
 * Integration test — PRODUCT Inv-18 (`faiss-cpu==1.14.2` pinned + importable).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-18 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-18):
 *
 * > "`requirements.txt` carries `faiss-cpu==1.14.2` exactly (the cocoindex
 * > spike-verified pin). Verifiable: `grep faiss-cpu requirements.txt`
 * > returns `faiss-cpu==1.14.2`; `import faiss; faiss.__version__ == '1.14.2'`
 * > in the sidecar's Python environment."
 *
 * This is the ONE Stage-5 invariant test that does NOT depend on the
 * fixture-staging service: it asserts the pin (file grep) and the runtime
 * importability + version of faiss (a real `python3 -c` invocation). It MUST
 * actually run — not skip — wherever a `python3` with faiss-cpu installed is
 * on PATH (the canonical pipeline dependency surface). The pin-grep half runs
 * unconditionally.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-18.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-12.
 *   - requirements.txt (the pin source-of-truth).
 *   - docs/reference/test-philosophy.md (behaviour-not-implementation —
 *     this verifies faiss is genuinely importable, not a mocked stub).
 */

import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { promisify } from 'util';

import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(__dirname, '../../..');
const REQUIREMENTS_PATH = resolve(REPO_ROOT, 'requirements.txt');

const EXPECTED_PIN = 'faiss-cpu==1.14.2';
const EXPECTED_VERSION = '1.14.2';

/**
 * Probe whether `python3 -c "import faiss"` succeeds. Returns true when faiss
 * is importable in the local python3 environment, false otherwise (e.g. a
 * machine that has not run `pip install -r requirements.txt`). The runtime
 * half of the test gates on this so it RUNS where faiss is present and
 * skip-cleans where it is absent — while the pin-grep half always runs.
 */
async function faissImportable(): Promise<boolean> {
  try {
    await execFileAsync('python3', ['-c', 'import faiss'], {
      timeout: 30_000,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    return true;
  } catch {
    return false;
  }
}

// Resolved in beforeAll so the runtime probe gates `it.runIf` below without
// a top-level await. The pin-grep test runs unconditionally; the runtime
// import test runs only when faiss is importable in this environment.
let faissImportableResult = false;

describe('Inv-18 — faiss-cpu pin + importability', () => {
  beforeAll(async () => {
    faissImportableResult = await faissImportable();
  }, 35_000);

  it('requirements.txt pins faiss-cpu==1.14.2 exactly (no range pin)', () => {
    const contents = readFileSync(REQUIREMENTS_PATH, 'utf8');
    const lines = contents.split('\n').map((l) => l.trim());

    // Exact-pin discipline (Inv-18 rejects range pins like >=1.14.2,<2.0).
    const exactPinLines = lines.filter((l) => l === EXPECTED_PIN);
    expect(exactPinLines.length).toBe(1);

    // No stray faiss-cpu line with a different operator / version.
    const allFaissLines = lines.filter((l) => /^faiss-cpu\b/.test(l));
    expect(allFaissLines).toEqual([EXPECTED_PIN]);
  });

  it('python3 imports faiss and reports version 1.14.2 with IndexFlatIP accessible', async (ctx) => {
    // Runtime gate (not collection-time): when faiss is not importable in
    // this environment (machine without `pip install -r requirements.txt`),
    // skip cleanly rather than fail — the pin-grep test above is the
    // unconditional half. Where faiss IS present (the canonical pipeline
    // dependency surface) this RUNS and asserts the real version.
    if (!faissImportableResult) {
      ctx.skip();
      return;
    }
    // Real runtime probe — `import faiss; assert version; touch IndexFlatIP`.
    // IndexFlatIP is the inner-product index resolve_entities relies on; a
    // version skew that drops/renames it would break Stage-5 silently, so we
    // touch it here as part of the pin's behavioural contract.
    const script =
      'import faiss; ' +
      'print(faiss.__version__); ' +
      'assert faiss.__version__ == "1.14.2", faiss.__version__; ' +
      'assert hasattr(faiss, "IndexFlatIP"), "IndexFlatIP missing"';

    const { stdout } = await execFileAsync('python3', ['-c', script], {
      timeout: 30_000,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    // The version printed to stdout matches the pin (the script's assert
    // already enforces this; we re-assert on stdout for an explicit
    // behaviour-level check independent of the in-script assert).
    expect(stdout.trim()).toBe(EXPECTED_VERSION);
  }, 35_000);
});
