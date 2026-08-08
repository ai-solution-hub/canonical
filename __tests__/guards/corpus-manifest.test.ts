/**
 * __tests__/guards/corpus-manifest.test.ts
 *
 * id-406 — the conformance guard for the corpus fixture manifest. The
 * generalisation of `__tests__/integration/cocoindex/platform-corpus-shape.test.ts`
 * that id-396 TECH §1 specified and nobody built.
 *
 * WHAT MAKES THIS MORE THAN A LIST: the orphan rule. A fixture with zero
 * declared consumers FAILS. Location rules (DR-117) cannot see an orphan — a
 * file sitting in exactly the right directory with nothing loading it is
 * invisible to any path convention. That rule is why the register exists at all;
 * DR-117 removed the scatter the rest of it was compensating for, so what
 * remains is an **orphan-and-integrity register, not a location register**.
 *
 * TIER: this lives in `__tests__/guards/`, not `__tests__/integration/`, per
 * TECH §1 (it sat in `__tests__/validation/` until the guards directory was
 * created). It reads only the filesystem and `git ls-files` — no DB, no
 * sidecar, no network — so it belongs in the always-on lane rather than the
 * integration lane the source guard sat in. That tier move is deliberate: the
 * source guard's placement under `integration/cocoindex/` meant a pure
 * filesystem assertion was gated behind integration substrate. It scans source
 * (`verify_driver.py`) and tracked bytes rather than exercising an export, so
 * it has no production module to mirror — hence `guards/`.
 *
 * WHY `git ls-files` AND NOT A FILESYSTEM WALK: the corpus is defined by what is
 * COMMITTED. The source guard recursed the working tree, so the gitignored
 * `.DS_Store` that Finder writes into any browsed directory failed both its
 * exactly-ten-entries and `synthetic-` assertions — untracked, so CI stayed
 * green while every Mac checkout went red (patched at `caf85711` with a dotfile
 * skip, which is a stopgap). That failure mode gets four times worse across four
 * more trees, three of which humans browse. Asserting about tracked content
 * directly removes the whole class: editor droppings, `__pycache__`, build
 * output and local scratch are all invisible to `git ls-files`.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CORPUS_MANIFEST_PATH,
  REPO_ROOT,
  loadCorpusManifest,
  verifyDriverDestPaths,
  walkedBaselinePathPrefixes,
  walkedBaselinePathSet,
  type FixtureEntry,
} from '@/lib/corpus/fixture-manifest';
import { SWEEP_STORAGE_PATH_PREFIX_FAMILIES } from '@/lib/corpus/sweep-scope';

const manifest = loadCorpusManifest();
const treeById = new Map(manifest.trees.map((t) => [t.id, t]));

/** Tracked files under `root`, repo-relative, POSIX-separated, sorted. */
function trackedFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', root], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean).sort();
}

function sha256(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

const abs = (e: FixtureEntry) => join(REPO_ROOT, e.path);

describe('corpus fixture manifest (id-396 TECH §1, DR-118)', () => {
  describe('the register covers exactly what is committed', () => {
    it.each(manifest.trees.map((t) => [t.id, t.root] as const))(
      'tree %s registers exactly the tracked files under %s',
      (treeId, root) => {
        const declared = manifest.fixtures
          .filter((f) => f.tree === treeId)
          .map((f) => f.path)
          .sort();
        expect(declared).toEqual(trackedFiles(root));
      },
    );

    it('every registered path is tracked by git', () => {
      const allTracked = new Set(
        manifest.trees.flatMap((t) => trackedFiles(t.root)),
      );
      const untracked = manifest.fixtures
        .map((f) => f.path)
        .filter((p) => !allTracked.has(p));
      expect(untracked, 'manifest registers files git does not track').toEqual(
        [],
      );
    });

    it('every fixture names a declared tree', () => {
      const unknown = manifest.fixtures
        .filter((f) => !treeById.has(f.tree))
        .map((f) => f.id);
      expect(unknown).toEqual([]);
    });

    it('fixture ids are unique', () => {
      const ids = manifest.fixtures.map((f) => f.id);
      expect(ids.length).toBe(new Set(ids).size);
    });
  });

  describe('integrity — the bytes are what the register says they are', () => {
    it.each(manifest.fixtures.map((f) => [f.id, f] as const))(
      '%s matches its declared sha256 and byte length',
      (_id, entry) => {
        const path = abs(entry);
        expect(sha256(path)).toBe(entry.sha256);
        expect(readFileSync(path).byteLength).toBe(entry.bytes);
      },
    );

    it('no two fixtures share bytes (distinct-bytes default, TECH §3)', () => {
      const bySha = new Map<string, string[]>();
      for (const f of manifest.fixtures) {
        bySha.set(f.sha256, [...(bySha.get(f.sha256) ?? []), f.id]);
      }
      const collisions = [...bySha.values()].filter((ids) => ids.length > 1);
      expect(
        collisions,
        'byte-identical fixtures collide on rel_path-seeded PKs',
      ).toEqual([]);
    });

    it('no fixture is empty', () => {
      const empty = manifest.fixtures
        .filter((f) => f.bytes === 0)
        .map((f) => f.id);
      expect(empty).toEqual([]);
    });
  });

  describe('real binaries — magic bytes (carried over from the source guard)', () => {
    const pdfs = manifest.fixtures.filter((f) => f.format === 'pdf');
    const ooxml = manifest.fixtures.filter((f) =>
      ['docx', 'xlsx', 'pptx'].includes(f.format),
    );
    const ole = manifest.fixtures.filter((f) =>
      ['doc', 'xls', 'ppt'].includes(f.format),
    );

    it.each(pdfs.map((f) => [f.id, f] as const))(
      '%s starts with the %%PDF signature',
      (_id, entry) => {
        expect(Array.from(readFileSync(abs(entry)).subarray(0, 4))).toEqual([
          0x25, 0x50, 0x44, 0x46,
        ]);
      },
    );

    it.each(ooxml.map((f) => [f.id, f] as const))(
      '%s is a real OOXML zip (PK\\x03\\x04)',
      (_id, entry) => {
        expect(Array.from(readFileSync(abs(entry)).subarray(0, 4))).toEqual([
          0x50, 0x4b, 0x03, 0x04,
        ]);
      },
    );

    it('every .docx contains word/document.xml', () => {
      for (const entry of ooxml.filter((f) => f.format === 'docx')) {
        expect(
          readFileSync(abs(entry)).includes(Buffer.from('word/document.xml')),
          `${entry.id} should be a real .docx`,
        ).toBe(true);
      }
    });

    it.each(ole.map((f) => [f.id, f] as const))(
      '%s is a real OLE2 compound file (D0 CF 11 E0)',
      (_id, entry) => {
        expect(Array.from(readFileSync(abs(entry)).subarray(0, 4))).toEqual([
          0xd0, 0xcf, 0x11, 0xe0,
        ]);
      },
    );
  });

  describe('the orphan rule — THE anti-drift mechanism (TECH §1)', () => {
    it('no fixture has zero declared consumers', () => {
      const orphans = manifest.fixtures
        .filter((f) => !f.orphan_exempt && f.consumers.length === 0)
        .map((f) => f.id);
      expect(
        orphans,
        'a fixture nothing consumes is drift — declare a consumer or delete it',
      ).toEqual([]);
    });

    it('every exemption carries a written justification', () => {
      const unjustified = manifest.fixtures
        .filter((f) => f.orphan_exempt && f.notes.trim().length === 0)
        .map((f) => f.id);
      expect(unjustified).toEqual([]);
    });

    it('every declared consumer exists — a dead consumer is a silent orphan', () => {
      const tracked = new Set(
        execFileSync('git', ['ls-files', '-z'], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        })
          .split('\0')
          .filter(Boolean),
      );
      const dangling = manifest.fixtures.flatMap((f) =>
        f.consumers
          .filter((c) => !tracked.has(c))
          .map((c) => `${f.id} -> ${c}`),
      );
      expect(dangling).toEqual([]);
    });
  });

  describe('staging_mode agrees with location (DR-117 cross-check)', () => {
    /**
     * DR-117 filed the fixture trees by owning domain, which means the
     * walked-vs-staged split is now carried in TWO places: the directory and
     * this field. That is strictly stronger than a hand-declared field nobody
     * can check — so assert they AGREE. A manifest entry whose staging_mode
     * contradicts its tree is a detectable defect (id-406 AC-8).
     */
    it('walked-baseline is exclusive to the Platform corpus', () => {
      const offenders = manifest.fixtures
        .filter((f) => f.staging_mode === 'walked-baseline')
        .filter((f) => f.tree !== 'platform-corpus')
        .map((f) => f.id);
      expect(offenders).toEqual([]);
    });

    it('every Platform-corpus fixture IS the walked baseline', () => {
      const offenders = manifest.fixtures
        .filter((f) => f.tree === 'platform-corpus')
        .filter((f) => f.staging_mode !== 'walked-baseline')
        .map((f) => `${f.id} (${f.staging_mode})`);
      expect(
        offenders,
        'the Platform corpus is walked, not staged — this is the S522 finding in enforceable form',
      ).toEqual([]);
    });

    it('form templates are staged, never walked', () => {
      // `never-staged` admitted by id-412 (S524) when malformed/corrupt.pdf
      // joined this tree. It is read straight off disk by pytest and is never
      // staged into any corpus — further from "corpus content" than the two
      // staged modes, not closer, so it honours this assertion's intent. The
      // list stays an explicit allowlist rather than becoming
      // "anything but walked-baseline": the invariant being protected is that
      // a blank extraction form can never become the walked baseline, and an
      // allowlist makes a new staging_mode value fail here for a ruling
      // instead of silently passing.
      const offenders = manifest.fixtures
        .filter((f) => f.tree === 'form-templates')
        .filter(
          (f) =>
            !['per-test', 'verify-driver', 'never-staged'].includes(
              f.staging_mode,
            ),
        )
        .map((f) => `${f.id} (${f.staging_mode})`);
      expect(
        offenders,
        'blank extraction forms are per-test inputs, not corpus content',
      ).toEqual([]);
    });

    it('a verify-driver fixture declares its verify_dest', () => {
      expect(() => verifyDriverDestPaths(manifest)).not.toThrow();
    });

    it('verify_dest values are the flat verify/<basename> scheme (c64be60b)', () => {
      for (const f of manifest.fixtures.filter((x) => x.verify_dest)) {
        expect(f.verify_dest).toBe(`verify/${f.path.split('/').pop()}`);
      }
    });

    /**
     * THE THIRD COPY. Retiring `cocoindex-census-gate.ts`'s hardcoded
     * `DRIVER_MANIFEST_DEST_PATHS` unified two lists — but `verify_driver.py`
     * FIXTURE_SETS['templates'] is a third, and it is the one that actually
     * stages the files. Without this assertion, "the lists cannot drift apart"
     * is true of two of three, which is how the original duplication arose.
     *
     * Parsed rather than imported because it is Python. Deliberately strict: if
     * the parse finds nothing the test FAILS instead of silently comparing an
     * empty set — a guard that expects N and accepts 0 is the failure mode this
     * whole task exists to remove.
     */
    it('verify_driver.py FIXTURE_SETS agrees with the manifest', () => {
      const src = readFileSync(
        join(REPO_ROOT, 'scripts/cocoindex_pipeline/verify_driver.py'),
        'utf8',
      );
      const templates = src.match(
        /"templates":\s*\(([\s\S]*?)\n\s{4}\),?\n\}/,
      )?.[1];
      expect(
        templates,
        'FIXTURE_SETS["templates"] block not found',
      ).toBeTruthy();

      const driverDests = [
        ...(templates ?? '').matchAll(/dest_path="([^"]+)"/g),
      ].map((m) => m[1]);
      expect(
        driverDests.length,
        'parsed zero dest_path entries — the parse broke, not the data',
      ).toBeGreaterThan(0);

      expect(driverDests.sort()).toEqual(
        verifyDriverDestPaths(manifest).sort(),
      );
    });

    it('verify_driver.py stages exactly the fixtures the manifest gives a verify_dest', () => {
      const src = readFileSync(
        join(REPO_ROOT, 'scripts/cocoindex_pipeline/verify_driver.py'),
        'utf8',
      );
      // fixture_path values are line-wrapped string concatenations; rejoin them.
      const driverPaths = [
        ...src.matchAll(/fixture_path=\(([\s\S]*?)\),/g),
      ].map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((s) => s[1]).join(''));
      expect(driverPaths.length).toBeGreaterThan(0);
      // verify_dest presence is the staged-set marker, not staging_mode: the
      // driver's fixtures are form templates, which are already `per-test`
      // because individual specs stage them too. A file can be staged by both.
      const declared = manifest.fixtures
        .filter((f) => f.verify_dest !== undefined)
        .map((f) => f.path);
      expect(driverPaths.sort()).toEqual(declared.sort());
    });
  });

  describe('Platform-corpus invariants carried over UNCHANGED', () => {
    const corpus = manifest.fixtures.filter(
      (f) => f.tree === 'platform-corpus',
    );
    const relPaths = corpus.map((f) =>
      f.path.replace(`${treeById.get('platform-corpus')!.root}/`, ''),
    );

    it('has no forms/ tree (DR-014)', () => {
      expect(relPaths.filter((p) => p.startsWith('forms/'))).toEqual([]);
    });

    it('the reserved __qa__/ prefix is absent (RATIFY-2)', () => {
      expect(relPaths.filter((p) => p.includes('__qa__/'))).toEqual([]);
    });

    it('carries the content/qa/edge seam coverage (§2.2)', () => {
      expect(relPaths).toContain('content/synthetic-methodology.md');
      expect(relPaths).toContain('content/synthetic-capability-statement.pdf');
      expect(relPaths).toContain('content/synthetic-sector-intel.docx');
      expect(relPaths).toContain('qa/synthetic-qa-pairs.md');
      expect(relPaths).toContain('edge/synthetic-sparse-edge.md');
    });

    it('carries the ID-132.30 G-CORPUS-ENRICH grain-bearing files', () => {
      for (const rel of [
        'content/synthetic-named-client-engagements.md',
        'content/synthetic-company-overview.md',
        'content/synthetic-team-structure.md',
        'content/synthetic-compliance-certifications.md',
        'content/synthetic-product-catalogue.md',
      ]) {
        expect(relPaths, `${rel} backs an l_records filename gate`).toContain(
          rel,
        );
      }
    });
  });

  describe('no client IP in synthetic trees (§2.2 / BI-3)', () => {
    it.each(
      manifest.trees.filter((t) => t.synthetic).map((t) => [t.id] as const),
    )('every basename in %s carries the synthetic- prefix', (treeId) => {
      const offenders = manifest.fixtures
        .filter((f) => f.tree === treeId)
        .map((f) => f.path.split('/').pop() ?? f.path)
        .filter((base) => !base.startsWith('synthetic-'));
      expect(offenders).toEqual([]);
    });
  });

  describe('the register is reachable by exactly one path (DR-118)', () => {
    it('resolves from the module anchor, not the caller cwd', () => {
      expect(CORPUS_MANIFEST_PATH).toMatch(
        /docs\/reference\/testing\/corpus-manifest\.json$/,
      );
      expect(() => loadCorpusManifest()).not.toThrow();
    });
  });

  describe('showcase content is protected from the sweep (S511 D1)', () => {
    // id-396 TECH.md:107-111, owner amendment S511: "showcase/platform content
    // is never sweep-eligible". `cocoindex-nightly-sweep.ts` enforces it by
    // asserting no delete candidate's FROZEN storage_path falls under these
    // prefixes. S539 measured the sweep deleting a Platform-corpus document
    // twice, because its predicate read the MUTABLE logical_path, which
    // resolve_or_mint_source_identity re-points at a test on any byte-identical
    // re-stage.
    it('derives the walked baseline directories from the manifest', () => {
      const prefixes = walkedBaselinePathPrefixes(manifest);
      expect(prefixes.length).toBeGreaterThan(0);
      for (const p of prefixes) expect(p.endsWith('/')).toBe(true);

      // Every walked-baseline fixture must be covered by some prefix — that is
      // the property the sweep guard depends on, and it is what breaks if a
      // baseline file is ever added at the tree root.
      const treeRoots = new Map(manifest.trees.map((t) => [t.id, t.root]));
      const baseline = manifest.fixtures.filter(
        (f) => f.staging_mode === 'walked-baseline',
      );
      expect(baseline.length).toBeGreaterThan(0);
      const uncovered = baseline.filter((f) => {
        const root = treeRoots.get(f.tree) ?? '';
        const rel = f.path.slice(root.length + 1);
        return !prefixes.some((p) => rel.startsWith(p));
      });
      expect(uncovered.map((f) => f.id)).toEqual([]);
    });

    it('never overlaps the verify-lane dest paths the sweep DOES delete', () => {
      // The sweep deletes `verify/…` rows and must never delete `content/…`
      // ones, so the two namespaces have to stay disjoint.
      const prefixes = walkedBaselinePathPrefixes(manifest);
      const collisions = verifyDriverDestPaths(manifest).filter((dest) =>
        prefixes.some((p) => dest.startsWith(p)),
      );
      expect(collisions).toEqual([]);
    });

    /**
     * THE SAME INVARIANT, IN THE DIRECTION IT ACTUALLY BREAKS.
     *
     * The assertion above was written to stop the sweep and the NM-6 showcase
     * guard contradicting each other, and it cannot do it. It asks whether a
     * `verify/…` dest sits under a baseline DIRECTORY prefix (`content/`,
     * `qa/`, `edge/`), which is impossible by construction — so it passes
     * vacuously.
     *
     * The break runs the other way. `acceptablePaths` is what the NM-6 guard
     * protects, and it included the three `verify_dest` values, every one of
     * which starts with the sweep's `verify/` SELECTION prefix. The sweep
     * therefore selected two Platform-corpus rows on every run and the guard
     * refused to let them go: abort, zero deletes, nightly dead at step 1,
     * indefinitely. The guard meant to prevent that watched a direction the
     * defect never travelled in.
     *
     * Compare the two lists that actually govern the collision: every path the
     * NM-6 guard protects, against every prefix the sweep claims.
     */
    it('no protected baseline path sits inside a sweep selection prefix', () => {
      const protectedPaths = [...walkedBaselinePathSet(manifest)];
      expect(protectedPaths.length).toBeGreaterThan(0);

      const collisions = protectedPaths.filter((p) =>
        SWEEP_STORAGE_PATH_PREFIX_FAMILIES.some((prefix) =>
          p.startsWith(prefix),
        ),
      );
      expect(
        collisions,
        'the sweep would select these rows and the NM-6 guard would refuse to delete them — ' +
          'every nightly run aborts with zero deletes until one list changes',
      ).toEqual([]);
    });
  });

  /**
   * DR-133 AS AMENDED (S543) — ONE PER-TEST FIXTURE, ONE CONSUMING SPEC.
   *
   * The original ruling covered the test ↔ walked-baseline axis. Nightly run
   * `31271744240` measured the second axis: **ten** integration specs staged
   * `form-templates/csp-cloud-security-principles/Cloud Security Principles
   * Checklist V5_3.xlsx`. Identity is content-hash FIRST, so all ten shared one
   * `source_documents` row — `storage_path` frozen by the first stager,
   * `filename` overwritten by the last, and `ingest_file`'s `memo=True` meaning
   * every later staging produced no rows at all. Five specs failed and which
   * five was decided by Vitest's file scheduling.
   *
   * The manifest already carried the evidence: that entry's `consumers` array
   * listed all ten, in plain sight, for months. Nothing read it as a violation
   * because nothing had been told it was one. This is that check.
   */
  describe('per-test fixtures are not shared between specs (DR-133, amended S543)', () => {
    /**
     * Pre-existing sharing, enumerated so it is countable and shrinking rather
     * than invisible. Every entry is a REAL instance of the same defect that
     * broke run `31271744240`; each survives only because no failure has yet
     * been attributed to it, which is exactly what was true of the CSP
     * checklist until S543. Deleting an entry here is the goal; adding one
     * needs a reason written beside it.
     */
    const KNOWN_SHARED_PENDING_SPLIT = new Map<string, string>([
      [
        'cocoindex-chunking/long-terms.md',
        'Chunking-boundary fixture shared by 3 specs. Unowned — no task claims the chunking tree.',
      ],
      [
        'cocoindex-chunking/short-clause.md',
        'Chunking-boundary fixture shared by 5 specs. Unowned — no task claims the chunking tree.',
      ],
      [
        'entity-variants/certification-variant-space.md',
        'Cross-document minimal pair shared by 3 Stage-5 specs. Splitting means one distinct-token PAIR per spec, not one document.',
      ],
      [
        'entity-variants/certification-variant-nospace.md',
        'Cross-document minimal pair shared by 3 Stage-5 specs. Splitting means one distinct-token PAIR per spec, not one document.',
      ],
      [
        'form-templates/sq-standard-selection-questionnaire/standard-selection-questionnaire-ppn-03-24.pdf',
        'Shared by sidecar-cold-start and sidecar-mime-coverage. Both are form-plane specs, so the split needs a second real form PDF rather than a content document.',
      ],
    ]);

    /** Consumers that actually STAGE — Python tests and scripts read fixtures without minting a row. */
    const stagingConsumers = (e: FixtureEntry) =>
      e.consumers.filter(
        (c) => c.startsWith('__tests__/integration/') && c.endsWith('.test.ts'),
      );

    it('no per-test fixture is staged by more than one integration spec', () => {
      const shared = manifest.fixtures
        .filter((e) => e.staging_mode === 'per-test')
        .map((e) => ({ id: e.id, specs: stagingConsumers(e) }))
        .filter(
          (e) => e.specs.length > 1 && !KNOWN_SHARED_PENDING_SPLIT.has(e.id),
        );

      expect(
        shared,
        'each of these per-test fixtures is staged by several specs, so they share ONE ' +
          'source_documents row: storage_path freezes to whichever spec stages first, filename ' +
          'is overwritten by whichever stages last, and every later staging memo-SKIPs. Give each ' +
          'spec its own distinct-bytes fixture, or add it to KNOWN_SHARED_PENDING_SPLIT with a ' +
          'reason. Do NOT resolve this by making the specs run in a particular order.',
      ).toEqual([]);
    });

    it('every KNOWN_SHARED_PENDING_SPLIT entry is still a real, still-shared fixture', () => {
      // A waiver that outlives its defect is worse than no waiver: it teaches
      // the next reader that the list is noise.
      const stale = [...KNOWN_SHARED_PENDING_SPLIT.keys()].filter((id) => {
        const entry = manifest.fixtures.find((f) => f.id === id);
        return !entry || stagingConsumers(entry).length <= 1;
      });
      expect(
        stale,
        'these waivers no longer describe anything — the fixture was split, renamed or removed. ' +
          'Delete the entry.',
      ).toEqual([]);
    });
  });

  /**
   * THE PER-TEST CONTENT TREE'S TOKENS ARE WHAT ITS SPECS MEASURE.
   *
   * `mock_llm.py::_echo_entity_tokens` echoes every token matching
   * `[A-Z]{2,6} ?[0-9]{3,6}` verbatim at its real offsets, and those echoes are
   * the `entity_mentions` rows these specs assert over. Two consequences that
   * are not obvious from reading a fixture:
   *
   * 1. Two fixtures sharing a token produce mentions that near-match across
   *    documents. For `inv-20-unresolved-mention.md`, whose whole assertion is
   *    `stage_counts.entity_resolution === 0`, that is fatal.
   * 2. The extractor sees the WHOLE converted document, including HTML
   *    comments. Naming another fixture's token in a comment publishes it as a
   *    mention. That mistake was made while authoring this tree and caught by
   *    running this regex over the files — which is why it is a guard now and
   *    not a habit.
   */
  describe('per-test-content entity tokens (S543)', () => {
    const CERT_TOKEN = /\b[A-Z]{2,6} ?\d{3,6}\b/g;
    const tokensOf = (e: FixtureEntry) =>
      new Set(readFileSync(abs(e), 'utf8').match(CERT_TOKEN) ?? []);

    /** The one fixture that pairs two surface forms ON PURPOSE — Inv-14's tier-break needs an ambiguous pair. */
    const DELIBERATE_INTERNAL_PAIR = new Set([
      'per-test-content/synthetic-inv-14-pair-resolver-determinism.md',
      'per-test-content/synthetic-inv-09-admin-merge-run-a.md',
      'per-test-content/synthetic-inv-09-admin-merge-run-b.md',
    ]);

    const perTestContent = manifest.fixtures.filter(
      (e) => e.tree === 'per-test-content',
    );

    it('the tree is registered and non-empty', () => {
      expect(perTestContent.length).toBeGreaterThan(0);
    });

    it('no per-test-content document shares a token with the walked baseline', () => {
      const baselineTokens = new Set<string>();
      for (const e of manifest.fixtures.filter(
        (f) => f.staging_mode === 'walked-baseline' && f.format === 'md',
      )) {
        for (const t of tokensOf(e)) baselineTokens.add(t);
      }
      expect(baselineTokens.size).toBeGreaterThan(0);

      const offenders = perTestContent
        .map((e) => ({
          id: e.id,
          shared: [...tokensOf(e)].filter((t) => baselineTokens.has(t)),
        }))
        .filter((o) => o.shared.length > 0);

      expect(
        offenders,
        'these per-test documents name a token the walked baseline also carries, so their ' +
          'mentions near-match a corpus document. Choose a token no other fixture uses — and ' +
          'note the extractor reads HTML comments too, so an example token in a comment counts.',
      ).toEqual([]);
    });

    it('no token appears in two per-test-content documents, outside the declared pairs', () => {
      const owner = new Map<string, string>();
      const clashes: { token: string; a: string; b: string }[] = [];
      for (const e of perTestContent) {
        if (DELIBERATE_INTERNAL_PAIR.has(e.id)) continue;
        for (const t of tokensOf(e)) {
          const prior = owner.get(t);
          if (prior) clashes.push({ token: t, a: prior, b: e.id });
          else owner.set(t, e.id);
        }
      }
      expect(
        clashes,
        'one token, one document — a token in two documents makes two specs measure each ' +
          "other's fixtures",
      ).toEqual([]);
    });

    it('inv-20 carries exactly one token, because its assertion is that nothing resolves', () => {
      const inv20 = perTestContent.find((e) =>
        e.id.endsWith('inv-20-unresolved-mention.md'),
      );
      expect(inv20).toBeDefined();
      expect(
        [...tokensOf(inv20!)],
        'Inv-20 asserts stage_counts.entity_resolution === 0. A second token gives Stage-5 ' +
          'something to resolve and the assertion stops being about unresolved mentions.',
      ).toHaveLength(1);
    });
  });
});
