/**
 * __tests__/validation/corpus-manifest.test.ts
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
 * TIER: this lives in `__tests__/validation/`, not `__tests__/integration/`,
 * per TECH §1. It reads only the filesystem and `git ls-files` — no DB, no
 * sidecar, no network — so it belongs in the always-on lane rather than the
 * integration lane the source guard sat in. That tier move is deliberate: the
 * source guard's placement under `integration/cocoindex/` meant a pure
 * filesystem assertion was gated behind integration substrate.
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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CORPUS_MANIFEST_PATH,
  REPO_ROOT,
  loadCorpusManifest,
  verifyDriverDestPaths,
  type FixtureEntry,
} from '@/lib/corpus/fixture-manifest';

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
  // node:crypto via require-less import keeps this file dependency-light.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
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
      const offenders = manifest.fixtures
        .filter((f) => f.tree === 'form-templates')
        .filter((f) => !['per-test', 'verify-driver'].includes(f.staging_mode))
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
});
