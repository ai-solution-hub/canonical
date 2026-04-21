/**
 * Pipeline Parity Drift Detection Guard Tests
 *
 * Reads both TypeScript and Python source files and asserts that key
 * parity constants match. When one pipeline adds or changes a constant,
 * these tests fail, forcing the developer to update the other pipeline.
 *
 * Pattern: same as __tests__/mcp/mcp-fixture-sync.test.ts — source file
 * reading with regex-based extraction and set comparison.
 */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const PROJECT_ROOT = join(__dirname, '../..');

function readSource(relativePath: string): string {
  return readFileSync(join(PROJECT_ROOT, relativePath), 'utf8');
}

describe('Pipeline Parity', () => {
  // ────────────────────────────────────────────────────────────────
  // 1. Classification truncation limits match
  // ────────────────────────────────────────────────────────────────

  it('classification truncation limits match between TS and Python', () => {
    const tsContent = readSource('lib/ai/classify.ts');
    const pyContent = readSource('scripts/kb_pipeline/classify.py');

    // TS: plainText.slice(0, 5000)
    const tsMatch = tsContent.match(/plainText\.slice\(0,\s*(\d+)\)/);
    expect(
      tsMatch,
      'Could not find plainText.slice(0, N) in lib/ai/classify.ts — regex may need updating',
    ).not.toBeNull();
    const tsLimit = tsMatch![1];

    // Python: content[:5000] (may have + "..." suffix)
    const pyMatch = pyContent.match(/content\[:(\d+)\]/);
    expect(
      pyMatch,
      'Could not find content[:N] in scripts/kb_pipeline/classify.py — regex may need updating',
    ).not.toBeNull();
    const pyLimit = pyMatch![1];

    expect(
      tsLimit,
      `TS truncation limit (${tsLimit}) does not match Python (${pyLimit}). ` +
        'Update the other pipeline to match: lib/ai/classify.ts or scripts/kb_pipeline/classify.py',
    ).toBe(pyLimit);
  });

  // ────────────────────────────────────────────────────────────────
  // 2. Entity type list match
  // ────────────────────────────────────────────────────────────────

  it('entity type lists match between TS and Python', () => {
    const tsContent = readSource('lib/ai/classify.ts');
    const pyContent = readSource('scripts/kb_pipeline/classify.py');

    // TS: extract from the Pass 1 tool schema enum array for entity_type
    // The enum is inside the 'type' property of the entities items schema
    // (Match the Pass 1 schema which has a description field, not the Pass 2 validation schema)
    const tsEnumMatch = tsContent.match(
      /type:\s*\{\s*\n\s*type:\s*'string',\s*\n\s*description:\s*\n[\s\S]*?enum:\s*\[([\s\S]*?)\]/,
    );
    expect(
      tsEnumMatch,
      'Could not find entity type enum in lib/ai/classify.ts tool schema — regex may need updating',
    ).not.toBeNull();
    const tsTypes = new Set(
      [...tsEnumMatch![1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
    );

    // Python: VALID_ENTITY_TYPES = frozenset([...])
    const pyEnumMatch = pyContent.match(
      /VALID_ENTITY_TYPES\s*=\s*frozenset\(\[([\s\S]*?)\]\)/,
    );
    expect(
      pyEnumMatch,
      'Could not find VALID_ENTITY_TYPES in scripts/kb_pipeline/classify.py — regex may need updating',
    ).not.toBeNull();
    const pyTypes = new Set(
      [...pyEnumMatch![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    );

    // Check TS has all Python types
    const missingFromTs = [...pyTypes].filter((t) => !tsTypes.has(t));
    expect(
      missingFromTs,
      `Entity types in Python but missing from TS: ${missingFromTs.join(', ')}. ` +
        'Update lib/ai/classify.ts tool schema enum',
    ).toHaveLength(0);

    // Check Python has all TS types
    const missingFromPy = [...tsTypes].filter((t) => !pyTypes.has(t));
    expect(
      missingFromPy,
      `Entity types in TS but missing from Python: ${missingFromPy.join(', ')}. ` +
        'Update scripts/kb_pipeline/classify.py VALID_ENTITY_TYPES',
    ).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────────
  // 3. Excluded entity pattern count match
  // ────────────────────────────────────────────────────────────────

  it('excluded entity pattern counts match between TS and Python', () => {
    const tsContent = readSource('lib/ai/classify.ts');
    const pyContent = readSource('scripts/kb_pipeline/classify.py');

    // TS: count regex patterns in EXCLUDED_PATTERNS array
    const tsBlock = tsContent.match(
      /const EXCLUDED_PATTERNS\s*=\s*\[([\s\S]*?)\];/,
    );
    expect(
      tsBlock,
      'Could not find EXCLUDED_PATTERNS in lib/ai/classify.ts — regex may need updating',
    ).not.toBeNull();
    const tsCount = [...tsBlock![1].matchAll(/\/.+\//g)].length;

    // Python: count re.compile() entries in _EXCLUDED_PATTERNS
    const pyBlock = pyContent.match(/_EXCLUDED_PATTERNS\s*=\s*\[([\s\S]*?)\]/);
    expect(
      pyBlock,
      'Could not find _EXCLUDED_PATTERNS in scripts/kb_pipeline/classify.py — regex may need updating',
    ).not.toBeNull();
    const pyCount = [...pyBlock![1].matchAll(/re\.compile\(/g)].length;

    expect(
      tsCount,
      `TS has ${tsCount} excluded patterns but Python has ${pyCount}. ` +
        'Update the other pipeline to match: lib/ai/classify.ts or scripts/kb_pipeline/classify.py',
    ).toBe(pyCount);
  });

  // ────────────────────────────────────────────────────────────────
  // 4. Temporal entity types match
  // ────────────────────────────────────────────────────────────────

  it('temporal entity types match between TS and Python', () => {
    const tsContent = readSource('lib/entities/entity-metadata-bridge.ts');
    const pyContent = readSource('scripts/kb_pipeline/temporal_bridge.py');

    // TS: TEMPORAL_ENTITY_TYPES = new Set(['certification', 'framework', 'regulation'])
    const tsMatch = tsContent.match(
      /TEMPORAL_ENTITY_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(
      tsMatch,
      'Could not find TEMPORAL_ENTITY_TYPES in lib/entities/entity-metadata-bridge.ts — regex may need updating',
    ).not.toBeNull();
    const tsTypes = new Set(
      [...tsMatch![1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
    );

    // Python: TEMPORAL_ENTITY_TYPES = frozenset(["certification", "framework", "regulation"])
    const pyMatch = pyContent.match(
      /TEMPORAL_ENTITY_TYPES\s*=\s*frozenset\(\[([\s\S]*?)\]\)/,
    );
    expect(
      pyMatch,
      'Could not find TEMPORAL_ENTITY_TYPES in scripts/kb_pipeline/temporal_bridge.py — regex may need updating',
    ).not.toBeNull();
    const pyTypes = new Set(
      [...pyMatch![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    );

    const missingFromTs = [...pyTypes].filter((t) => !tsTypes.has(t));
    expect(
      missingFromTs,
      `Temporal entity types in Python but missing from TS: ${missingFromTs.join(', ')}. ` +
        'Update lib/entities/entity-metadata-bridge.ts TEMPORAL_ENTITY_TYPES',
    ).toHaveLength(0);

    const missingFromPy = [...tsTypes].filter((t) => !pyTypes.has(t));
    expect(
      missingFromPy,
      `Temporal entity types in TS but missing from Python: ${missingFromPy.join(', ')}. ` +
        'Update scripts/kb_pipeline/temporal_bridge.py TEMPORAL_ENTITY_TYPES',
    ).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────────
  // 5. Layer inference rule count match
  // ────────────────────────────────────────────────────────────────

  it('layer inference suggestion counts match between TS and Python', () => {
    const tsContent = readSource('lib/layer-inference.ts');
    const pyContent = readSource('scripts/kb_pipeline/layer_inference.py');

    // TS: count object constructions with suggestedLayer inside return statements
    // Exclude the interface definition (suggestedLayer: string) by requiring a LAYER_ constant
    const tsCount = [...tsContent.matchAll(/suggestedLayer:\s*LAYER_/g)].length;

    // Python: count LayerSuggestion(...) constructions
    const pyCount = [...pyContent.matchAll(/LayerSuggestion\(/g)].length;

    expect(
      tsCount,
      `TS has ${tsCount} layer suggestion constructions but Python has ${pyCount}. ` +
        'Update the other pipeline to match: lib/layer-inference.ts or scripts/kb_pipeline/layer_inference.py',
    ).toBe(pyCount);
    expect(
      tsCount,
      'No layer suggestions found — regex parsing may be broken',
    ).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────
  // 6. Proper noun allowlist match
  // ────────────────────────────────────────────────────────────────

  it('proper noun allowlists match between TS and Python', () => {
    const tsContent = readSource('lib/validation/schemas.ts');
    const pyContent = readSource('scripts/kb_pipeline/classify.py');

    // TS: TAG_PROPER_NOUN_ALLOWLIST = new Map([['key', 'Value'], ...])
    // Extract the canonical values (second element of each pair)
    const tsBlock = tsContent.match(
      /TAG_PROPER_NOUN_ALLOWLIST[^=]*=\s*new Map\(\[([\s\S]*?)\]\)/,
    );
    expect(
      tsBlock,
      'Could not find TAG_PROPER_NOUN_ALLOWLIST in lib/validation/schemas.ts — regex may need updating',
    ).not.toBeNull();
    const tsValues = new Set(
      [...tsBlock![1].matchAll(/\[\s*'[^']+'\s*,\s*'([^']+)'\s*\]/g)].map(
        (m) => m[1],
      ),
    );

    // Python: PROPER_NOUN_ALLOWLIST = frozenset([...])
    const pyBlock = pyContent.match(
      /PROPER_NOUN_ALLOWLIST\s*=\s*frozenset\(\[([\s\S]*?)\]\)/,
    );
    expect(
      pyBlock,
      'Could not find PROPER_NOUN_ALLOWLIST in scripts/kb_pipeline/classify.py — regex may need updating',
    ).not.toBeNull();
    const pyValues = new Set(
      [...pyBlock![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    );

    const missingFromTs = [...pyValues].filter((v) => !tsValues.has(v));
    expect(
      missingFromTs,
      `Proper nouns in Python but missing from TS: ${missingFromTs.join(', ')}. ` +
        'Update lib/validation/schemas.ts TAG_PROPER_NOUN_ALLOWLIST',
    ).toHaveLength(0);

    const missingFromPy = [...tsValues].filter((v) => !pyValues.has(v));
    expect(
      missingFromPy,
      `Proper nouns in TS but missing from Python: ${missingFromPy.join(', ')}. ` +
        'Update scripts/kb_pipeline/classify.py PROPER_NOUN_ALLOWLIST',
    ).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────────
  // 7. Canonicalisation abbreviation count match
  // ────────────────────────────────────────────────────────────────

  it('canonicalisation abbreviation counts match between TS and Python', () => {
    const tsContent = readSource('lib/entities/entity-dedup.ts');
    const pyContent = readSource('scripts/kb_pipeline/classify.py');

    // TS: count key-value entries in ABBREVIATIONS object (key: 'VALUE' lines)
    const tsBlock = tsContent.match(
      /const ABBREVIATIONS[^=]*=\s*\{([\s\S]*?)\};/,
    );
    expect(
      tsBlock,
      'Could not find ABBREVIATIONS in lib/entities/entity-dedup.ts — regex may need updating',
    ).not.toBeNull();
    const tsCount = [...tsBlock![1].matchAll(/\w+:\s*'/g)].length;

    // Python: count key-value entries in _ABBREVIATIONS dict ("key": "VALUE" lines)
    const pyBlock = pyContent.match(/_ABBREVIATIONS\s*=\s*\{([\s\S]*?)\}/);
    expect(
      pyBlock,
      'Could not find _ABBREVIATIONS in scripts/kb_pipeline/classify.py — regex may need updating',
    ).not.toBeNull();
    const pyCount = [...pyBlock![1].matchAll(/"[^"]+"\s*:\s*"/g)].length;

    expect(
      tsCount,
      `TS has ${tsCount} abbreviation entries but Python has ${pyCount}. ` +
        'Update the other file to match: lib/entities/entity-dedup.ts or scripts/kb_pipeline/classify.py',
    ).toBe(pyCount);
    expect(
      tsCount,
      'No abbreviation entries found — regex parsing may be broken',
    ).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────
  // 8. Statutory allowlist match (internal-document filter exemptions)
  // ────────────────────────────────────────────────────────────────

  it('STATUTORY_ALLOWLIST entries match between TS and Python', () => {
    const tsContent = readSource('lib/ai/classify.ts');
    const pyContent = readSource('scripts/kb_pipeline/classify.py');

    // TS: const STATUTORY_ALLOWLIST = new Set([...])
    const tsBlock = tsContent.match(
      /STATUTORY_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(
      tsBlock,
      'Could not find STATUTORY_ALLOWLIST in lib/ai/classify.ts — regex may need updating',
    ).not.toBeNull();
    const tsValues = new Set(
      [...tsBlock![1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
    );

    // Python: _STATUTORY_ALLOWLIST = frozenset([...])
    const pyBlock = pyContent.match(
      /_STATUTORY_ALLOWLIST\s*=\s*frozenset\(\[([\s\S]*?)\]\)/,
    );
    expect(
      pyBlock,
      'Could not find _STATUTORY_ALLOWLIST in scripts/kb_pipeline/classify.py — regex may need updating',
    ).not.toBeNull();
    const pyValues = new Set(
      [...pyBlock![1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
    );

    expect(
      tsValues.size,
      'No entries parsed from TS STATUTORY_ALLOWLIST — regex may be broken',
    ).toBeGreaterThan(0);

    const missingFromTs = [...pyValues].filter((v) => !tsValues.has(v));
    expect(
      missingFromTs,
      `Statutory allowlist entries in Python but missing from TS: ${missingFromTs.join(', ')}. ` +
        'Update lib/ai/classify.ts STATUTORY_ALLOWLIST',
    ).toHaveLength(0);

    const missingFromPy = [...tsValues].filter((v) => !pyValues.has(v));
    expect(
      missingFromPy,
      `Statutory allowlist entries in TS but missing from Python: ${missingFromPy.join(', ')}. ` +
        'Update scripts/kb_pipeline/classify.py _STATUTORY_ALLOWLIST',
    ).toHaveLength(0);

    expect(
      tsValues.size,
      `TS STATUTORY_ALLOWLIST size (${tsValues.size}) does not match Python (${pyValues.size})`,
    ).toBe(pyValues.size);
  });

  // ────────────────────────────────────────────────────────────────
  // 9. Embedding model defaults match
  // ────────────────────────────────────────────────────────────────

  it('embedding model defaults match between TS and Python', () => {
    const tsContent = readSource('lib/ai/embed.ts');
    const pyContent = readSource('scripts/kb_pipeline/config.py');

    // TS: return process.env.AI_EMBEDDING_MODEL ?? 'text-embedding-3-large';
    const tsMatch = tsContent.match(
      /AI_EMBEDDING_MODEL\s*\?\?\s*'([^']+)'/,
    );
    expect(
      tsMatch,
      'Could not find AI_EMBEDDING_MODEL default in lib/ai/embed.ts',
    ).not.toBeNull();
    const tsModel = tsMatch![1];

    // Python: AI_EMBEDDING_MODEL fallback chain ending with or "default"
    const pyMatch = pyContent.match(
      /AI_EMBEDDING_MODEL[\s\S]*?or\s+"([^"]+)"\s*\n\)/,
    );
    expect(
      pyMatch,
      'Could not find AI_EMBEDDING_MODEL default in scripts/kb_pipeline/config.py',
    ).not.toBeNull();
    const pyModel = pyMatch![1];

    expect(
      tsModel,
      `Embedding model default differs: TS=${tsModel}, Python=${pyModel}. ` +
        'Both pipelines write to the same vector column — they MUST agree.',
    ).toBe(pyModel);
  });

  it('embedding dimensions defaults match between TS and Python', () => {
    const tsContent = readSource('lib/ai/embed.ts');
    const pyContent = readSource('scripts/kb_pipeline/config.py');

    // TS: if (!raw) return 1024;
    const tsMatch = tsContent.match(/if \(!raw\) return (\d+)/);
    expect(
      tsMatch,
      'Could not find AI_EMBEDDING_DIMS default in lib/ai/embed.ts',
    ).not.toBeNull();
    const tsDims = tsMatch![1];

    // Python: or "1024" at end of EMBEDDING_DIMS chain
    const pyMatch = pyContent.match(/AI_EMBEDDING_DIMS[\s\S]*?or\s+"(\d+)"/);
    expect(
      pyMatch,
      'Could not find AI_EMBEDDING_DIMS default in scripts/kb_pipeline/config.py',
    ).not.toBeNull();
    const pyDims = pyMatch![1];

    expect(
      tsDims,
      `Embedding dimensions differ: TS=${tsDims}, Python=${pyDims}. ` +
        'A mismatch corrupts vector search — both pipelines write to a vector(N) column.',
    ).toBe(pyDims);
  });

  // ────────────────────────────────────────────────────────────────
  // 10. Pipeline step presence in main entry point
  // ────────────────────────────────────────────────────────────────

  describe('pipeline step presence (pipeline.py + shared post_insert helper)', () => {
    // S185 WP-D refactored pipeline.py to delegate post-insert steps
    // (history, chunks, entities, relationships, temporal refs, bridge,
    // layer) to the shared `scripts/kb_pipeline/post_insert.py::run_post_insert`
    // helper. The guard now checks BOTH files — each required call must
    // appear in either pipeline.py OR post_insert.py (logically part of
    // the canonical Python pipeline).
    const pipelineContent = readSource('scripts/kb_pipeline/pipeline.py');
    const postInsertContent = readSource('scripts/kb_pipeline/post_insert.py');
    const combined = pipelineContent + '\n' + postInsertContent;

    const requiredCalls = [
      'store_entities',
      'store_relationships',
      'merge_item_metadata',
      'infer_layer',
      'bridge_temporal_to_entities',
    ];

    for (const fnName of requiredCalls) {
      it(`pipeline.py + post_insert.py contain ${fnName}`, () => {
        expect(
          combined.includes(fnName),
          `Neither scripts/kb_pipeline/pipeline.py nor ` +
            `scripts/kb_pipeline/post_insert.py contains "${fnName}". ` +
            'The Python pipeline is missing a required processing step.',
        ).toBe(true);
      });
    }
  });
});
