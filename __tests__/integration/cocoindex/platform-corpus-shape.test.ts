/**
 * Structural guard for the vendored Platform seam-coverage corpus tree
 * (ID-134 {134.8}, re-scoped per OQ oq-c0d96c319a2ff88a OPTION 1).
 *
 * This is a READ-ONLY shape guard, NOT a live integration test. It walks the
 * committed source-of-truth corpus at
 * `scripts/cocoindex_pipeline/fixtures/platform-corpus/` (RATIFY-1 — the
 * in-repo vendored tree, NOT the gitignored derived `local-fs-platform/corpus`)
 * and asserts its file-tree shape against TECH §2.1 / §2.2 / §7 of
 * `specs/id-134-promotion-confidence-e2e/TECH.md`.
 *
 * Why it lives here and runs ALWAYS (no `*.integration.test.ts` suffix, no
 * live gate): the vendored tree is a real deploy artifact (synced on-prem by
 * {134.4} BI-6). TECH §7 intends "the file-tree shape is guarded"; the live
 * Lane B specs deliberately self-contain (`tmp_path`) and stage REAL acquired
 * binaries, so they cannot guard the vendored tree against corpus rot in the
 * release gate. This spec closes that gap: it reads only committed files —
 * NO `COCOINDEX_SOURCE_PATH`, DB, network, or env required — so it executes in
 * every `bun run test` run.
 *
 * Behaviour-first (`reference/test-philosophy.md`): asserts observable
 * file-tree facts (entry set, magic bytes, manifest JSON shape), not pipeline
 * internals.
 *
 * The expected manifest shape is cross-checked (read-only) against TECH §2.1's
 * manifest-shape contract (previously mirrored by the `WorkspaceMapManifest`
 * interface / `buildManifest` in `scripts/seed-synthetic-corpus.ts`, retired
 * ID-145.25 — that script's mint-and-rekey machinery was purpose-obsolete
 * post-{145.6} M3).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';

import { describe, it, expect } from 'vitest';

// Resolve the vendored corpus relative to this spec's location (repo-root
// robust; never an absolute/worktree path). Spec dir is
// `__tests__/integration/cocoindex/`; corpus is three levels up under
// `scripts/cocoindex_pipeline/fixtures/platform-corpus/`.
const CORPUS_ROOT = resolve(
  __dirname,
  '../../../scripts/cocoindex_pipeline/fixtures/platform-corpus',
);

const MANIFEST_TEMPLATE = '.kh-workspace-map.json.example';

// The authoritative tree per TECH §2.1 — exactly these 11 entries, no more.
// (forms/procurement/ retired under DR-014 — ID-136 forms-route retirement.)
// The five ID-132.30 G-CORPUS-ENRICH additions are ALL .md, ALL carrying the
// synthetic- token, and satisfy the L-records grain-mechanics map's filename
// gates (`scripts/cocoindex_pipeline/sources/l_records.py:94-99`):
// %named-client% (case_study), %company-overview% / %team-structure%
// (company), %compliance% (certification); the product catalogue has no
// filename gate (product concepts enumerate off `entity_mentions` directly).
const EXPECTED_ENTRIES = [
  MANIFEST_TEMPLATE,
  'content/synthetic-methodology.md',
  'content/synthetic-capability-statement.pdf',
  'content/synthetic-sector-intel.docx',
  'content/synthetic-named-client-engagements.md',
  'content/synthetic-company-overview.md',
  'content/synthetic-team-structure.md',
  'content/synthetic-compliance-certifications.md',
  'content/synthetic-product-catalogue.md',
  'qa/synthetic-qa-pairs.md',
  'edge/synthetic-sparse-edge.md',
] as const;

const PDF_FILES = ['content/synthetic-capability-statement.pdf'] as const;

const DOCX_FILES = ['content/synthetic-sector-intel.docx'] as const;

/** Recursively list every file under `dir`, returning POSIX relative paths. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(abs));
    } else {
      out.push(relative(CORPUS_ROOT, abs).split(sep).join('/'));
    }
  }
  return out;
}

const actualEntries = walk(CORPUS_ROOT).sort();

const manifest = JSON.parse(
  readFileSync(join(CORPUS_ROOT, MANIFEST_TEMPLATE), 'utf8'),
) as {
  schema_version?: unknown;
  mappings?: Array<{
    path_prefix?: unknown;
    workspace_id?: unknown;
    route?: unknown;
  }>;
};

describe('Platform seam-coverage corpus — vendored tree shape (TECH §2.1/§2.2/§7)', () => {
  describe('tree completeness (§2.1)', () => {
    it('contains exactly the 11 expected entries — no more, no less', () => {
      expect(actualEntries).toEqual([...EXPECTED_ENTRIES].sort());
    });

    it('every binary (PDF/DOCX) is non-empty', () => {
      for (const rel of [...PDF_FILES, ...DOCX_FILES]) {
        const size = statSync(join(CORPUS_ROOT, rel)).size;
        expect(size, `${rel} should be a non-empty binary`).toBeGreaterThan(0);
      }
    });
  });

  describe('real binaries — magic bytes (§2.2 risk #2: not text-renamed)', () => {
    it('every .pdf starts with the %PDF signature (0x25 0x50 0x44 0x46)', () => {
      for (const rel of PDF_FILES) {
        const head = readFileSync(join(CORPUS_ROOT, rel)).subarray(0, 4);
        expect(Array.from(head), `${rel} should start with %PDF`).toEqual([
          0x25, 0x50, 0x44, 0x46,
        ]);
      }
    });

    it('every .docx is an OOXML zip (PK\\x03\\x04) containing word/document.xml', () => {
      for (const rel of DOCX_FILES) {
        const bytes = readFileSync(join(CORPUS_ROOT, rel));
        expect(
          Array.from(bytes.subarray(0, 4)),
          `${rel} should start with the zip signature PK\\x03\\x04`,
        ).toEqual([0x50, 0x4b, 0x03, 0x04]);
        // The zip stores entry names in plaintext (local file header +
        // central directory), so the OOXML part name is present in the raw
        // bytes — a dependency-light proof it is a genuine Word document and
        // not a text file renamed `.docx`.
        expect(
          bytes.toString('latin1').includes('word/document.xml'),
          `${rel} should be a Word OOXML package (word/document.xml part)`,
        ).toBe(true);
      }
    });
  });

  describe('manifest template shape (§2.1)', () => {
    it('parses as JSON with a schema_version and an empty mappings array (DR-014)', () => {
      expect(manifest.schema_version).toBe(1);
      expect(Array.isArray(manifest.mappings)).toBe(true);
      expect(manifest.mappings).toEqual([]);
    });
  });

  describe('seam coverage (§2.2)', () => {
    const has = (rel: string) => actualEntries.includes(rel);

    it('content branch carries md + PDF + DOCX', () => {
      expect(has('content/synthetic-methodology.md')).toBe(true);
      expect(has('content/synthetic-capability-statement.pdf')).toBe(true);
      expect(has('content/synthetic-sector-intel.docx')).toBe(true);
    });

    it('a qa/ Q&A-shaped md and an edge/ md exist', () => {
      expect(has('qa/synthetic-qa-pairs.md')).toBe(true);
      expect(has('edge/synthetic-sparse-edge.md')).toBe(true);
    });

    it('the ID-132.30 G-CORPUS-ENRICH grain-bearing files exist and hit every filename gate', () => {
      // %named-client% — case_study grain (l_records.py _CASE_STUDY_FILENAME_PATTERNS).
      expect(has('content/synthetic-named-client-engagements.md')).toBe(true);
      // %company-overview% / %team-structure% — company grain (_COMPANY_FILENAME_PATTERNS).
      expect(has('content/synthetic-company-overview.md')).toBe(true);
      expect(has('content/synthetic-team-structure.md')).toBe(true);
      // %compliance% — certification grain (_CERTIFICATION_FILENAME_PATTERNS).
      expect(has('content/synthetic-compliance-certifications.md')).toBe(true);
      // product grain enumerates off entity_mentions directly — no filename gate.
      expect(has('content/synthetic-product-catalogue.md')).toBe(true);
    });

    it('the reserved __qa__/ prefix is absent (RATIFY-2)', () => {
      const offenders = actualEntries.filter((p) => p.includes('__qa__/'));
      expect(offenders).toEqual([]);
    });

    it('has no forms/ tree and no forms route mapping (DR-014)', () => {
      const formsPaths = actualEntries.filter((p) => p.startsWith('forms/'));
      expect(formsPaths, 'no forms/ path should remain in the corpus').toEqual(
        [],
      );
      expect(
        manifest.mappings,
        'manifest.mappings must be empty (no forms route)',
      ).toEqual([]);
    });
  });

  describe('no client IP (§2.2 / BI-3)', () => {
    it('every walk file is a synthetic-* fixture (manifest template aside)', () => {
      const offenders = actualEntries
        .filter((p) => p !== MANIFEST_TEMPLATE)
        .filter((p) => {
          const base = p.split('/').pop() ?? p;
          return !base.startsWith('synthetic-');
        });
      expect(
        offenders,
        'all content/qa/edge files must use synthetic- tokens (no client IP)',
      ).toEqual([]);
    });
  });
});
