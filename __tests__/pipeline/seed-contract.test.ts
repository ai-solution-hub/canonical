/**
 * SEED-CONTRACT freeze test — ID-131 {131.5}, BI-7.
 *
 * The cocoindex pipeline mints deterministic per-document UUIDs with
 * `uuid.uuid5(_KH_PIPELINE_DOC_NS, f"<prefix>:<natural-key>")`. A subset of
 * those seeds is the CITEABLE contract: their UUIDs are the stable identifiers
 * that downstream citations + OKF bundles resolve against, so their seed FORMAT
 * (the prefix + natural-key shape) must never silently drift. This is a freeze
 * test: it reads `scripts/cocoindex_pipeline/flow.py` as TEXT and asserts the
 * frozen namespace literals and the citeable seed prefixes are still present at
 * their `uuid.uuid5(...)` call-sites.
 *
 * The contract (BI-7):
 *   - `_KH_PIPELINE_DOC_NS` is the frozen namespace for every per-document seed.
 *   - The CITEABLE seed set is EXACTLY {sd, ri, qa}. Their UUIDs are referenced
 *     externally; changing the prefix/format orphans existing citations.
 *   - `ci:` (dies with its content_items row) and `chunk:` are INTERNAL seeds —
 *     they still exist in flow.py but are explicitly NOT part of the citeable
 *     contract.
 *   - `_KH_CONCEPT_NS` is frozen here for ID-132: the concept-embedding key
 *     namespace (`record_embeddings owner_kind='concept'`). It MUST be frozen
 *     before ID-132's first OKF-bundle publish, or the bundle vector index
 *     orphans. Value is `uuid.uuid5(_KH_PIPELINE_DOC_NS, "concept")`.
 *
 * Line numbers drift as flow.py evolves, so this test asserts the VALUES and
 * seed prefixes/formats, never line positions.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FLOW_PATH = resolve(
  __dirname,
  '../../scripts/cocoindex_pipeline/flow.py',
);
const flowSource = readFileSync(FLOW_PATH, 'utf8');

/** The frozen per-document namespace literal (substrate for every seed). */
const KH_PIPELINE_DOC_NS = 'fbfaf1ff-1ee4-583c-9757-1674465b2ec1';

/** The frozen concept-embedding namespace literal (ID-132 bundle keys). */
const KH_CONCEPT_NS = 'fd4ba596-2223-591b-b25c-1046022aced5';

/** The citeable seed contract — externally-referenced UUIDs. */
const CITEABLE_SEED_PREFIXES = ['sd', 'ri', 'qa'] as const;

/** Internal-only seeds — present in flow.py but NOT citeable. */
const EXCLUDED_INTERNAL_SEED_PREFIXES = ['ci', 'chunk'] as const;

/**
 * Matches an actual `uuid.uuid5(_KH_PIPELINE_DOC_NS, f"<prefix>:...")` seed
 * call-site. `\s*` spans newlines so multi-line call-sites match too.
 */
function seedCallSite(prefix: string): RegExp {
  return new RegExp(
    String.raw`uuid\.uuid5\(\s*_KH_PIPELINE_DOC_NS,\s*f"${prefix}:`,
  );
}

describe('SEED-CONTRACT freeze (BI-7)', () => {
  it('freezes the per-document namespace UUID seeding every pipeline seed', () => {
    expect(flowSource).toContain(
      `_KH_PIPELINE_DOC_NS = uuid.UUID("${KH_PIPELINE_DOC_NS}")`,
    );
  });

  it('freezes the concept-embedding namespace UUID for ID-132 bundle keys', () => {
    expect(flowSource).toContain(
      `_KH_CONCEPT_NS = uuid.UUID("${KH_CONCEPT_NS}")`,
    );
  });

  it('mints every citeable seed (sd, ri, qa) from the frozen namespace', () => {
    for (const prefix of CITEABLE_SEED_PREFIXES) {
      expect(
        seedCallSite(prefix).test(flowSource),
        `expected a uuid5 "${prefix}:" seed call-site in flow.py`,
      ).toBe(true);
    }
  });

  it('seeds the citeable sd: UUID from both the file (rel_path) and URL branches', () => {
    // sd: is minted on the content branch (rel_path) AND the URL-landing branch
    // (item.url). Both branches must keep the sd: prefix so a citation resolves
    // identically regardless of how the document was ingested.
    expect(flowSource).toContain('f"sd:{rel_path}"');
    expect(flowSource).toContain('f"sd:{item.url}"');
  });

  it('keeps citeable seeds in their frozen natural-key formats', () => {
    // The prefix AND the natural-key shape are frozen — a citation reproduces
    // the exact seed string to recompute the UUID.
    expect(flowSource).toContain('f"sd:{rel_path}"');
    expect(flowSource).toContain('f"ri:{item.url}"');
    expect(flowSource).toContain('f"qa:{rel_path}:{idx}"');
  });

  it('excludes the internal ci: and chunk: seeds from the citeable contract', () => {
    const citeable = new Set<string>(CITEABLE_SEED_PREFIXES);
    for (const prefix of EXCLUDED_INTERNAL_SEED_PREFIXES) {
      // Not a member of the citeable set...
      expect(citeable.has(prefix)).toBe(false);
      // ...but still present in flow.py as an internal seed.
      expect(
        seedCallSite(prefix).test(flowSource),
        `expected the internal "${prefix}:" seed to still exist in flow.py`,
      ).toBe(true);
    }
  });

  it('defines the citeable seed set as exactly {sd, ri, qa}', () => {
    // Guard against silent expansion/contraction of the citeable contract.
    expect([...CITEABLE_SEED_PREFIXES].sort()).toEqual(['qa', 'ri', 'sd']);
    for (const excluded of EXCLUDED_INTERNAL_SEED_PREFIXES) {
      expect(CITEABLE_SEED_PREFIXES).not.toContain(excluded);
    }
  });
});
