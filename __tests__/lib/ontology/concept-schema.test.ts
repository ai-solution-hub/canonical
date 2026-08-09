/**
 * Behaviour tests for `lib/ontology/concept-schema.ts` (BI-6,
 * TECH.md §BI-6 enforcement-semantics invariant).
 *
 * Real-behaviour: no mocks. Drives `parseConceptFrontmatter` end-to-end
 * against realistic concept `.md` text (frontmatter + body) via
 * `gray-matter`, asserting the observable outcome — accept a well-formed
 * concept, throw on a malformed one — rather than poking
 * `ConceptFrontmatterSchema` internals directly.
 *
 * ID-132 owns the producer call site; this Subtask (ID-133) owns only the
 * frontmatter contract, so no wiring/caller is exercised here.
 *
 * {132.41} FRONTMATTER-WAVE.md §"Shared frontmatter contract extension":
 * bl-456 routing hints (`purpose`/`task`/`audience`, free optional strings)
 * + bl-477 A19 `confidence` enum — both OPTIONAL, mirroring the landed
 * Python emitter/validator (`producer/frontmatter.py` /
 * `producer/validator.py`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import {
  CONCEPT_TYPE_VALUES,
  CONFIDENCE_VALUES,
  parseConceptFrontmatter,
} from '@/lib/ontology/concept-schema';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

/**
 * The well-formed per-row anchor resource line. BI-6: the per-row uuid form is
 * admissible ONLY for `source_documents | reference_items` — never `q_a_pairs`
 * (its opaque, re-minting `gen_random_uuid()` PK is cited via the BI-8 query
 * form instead, mirroring `producer/validator.py`'s allowlist). Named so the
 * reject/query-form tests below swap it out by reference rather than repeating a
 * brittle string literal that must stay in lock-step with the fixture.
 */
const WELL_FORMED_RESOURCE_LINE = `resource: "canonical://source_documents/${VALID_UUID}"`;

/** Wrap a YAML frontmatter block into full concept `.md` text. */
function conceptMarkdown(frontmatterYaml: string, body = 'Body text.'): string {
  return `---\n${frontmatterYaml}\n---\n\n${body}\n`;
}

const WELL_FORMED_FRONTMATTER = [
  'type: topic',
  'title: Photovoltaic Panels',
  'description: A concept describing photovoltaic panel technology.',
  'timestamp: "2026-07-05T00:00:00.000Z"',
  WELL_FORMED_RESOURCE_LINE,
  'tags:',
  '  - renewable-energy',
  '  - hardware',
].join('\n');

describe('parseConceptFrontmatter', () => {
  it('accepts a well-formed concept: type in set, required keys, canonical resource URI, tags array', () => {
    const parsed = parseConceptFrontmatter(
      conceptMarkdown(WELL_FORMED_FRONTMATTER),
    );

    expect(parsed).toEqual({
      type: 'topic',
      title: 'Photovoltaic Panels',
      description: 'A concept describing photovoltaic panel technology.',
      timestamp: '2026-07-05T00:00:00.000Z',
      resource: `canonical://source_documents/${VALID_UUID}`,
      tags: ['renewable-energy', 'hardware'],
    });
  });

  it('exposes the concept-type set as a single ratifiable source of truth', () => {
    expect(CONCEPT_TYPE_VALUES).toEqual([
      'topic',
      'product',
      'company',
      'certification',
      'case_study',
    ]);
  });

  it('accepts a concept type outside the base concept-type set (ID-132 {132.36} G-CONCEPT-FEEDER parity: this reader-side contract does not gate type membership — the Python producer validator only gates it against a per-run EffectiveOntology, base ∪ client overlay, that this static schema cannot replicate; see module docstring)', () => {
    const overlayType = WELL_FORMED_FRONTMATTER.replace(
      'type: topic',
      'type: partner',
    );

    const parsed = parseConceptFrontmatter(conceptMarkdown(overlayType));

    expect(parsed.type).toBe('partner');
  });

  it('still rejects an empty type (BI-12 required-key shape, unaffected by the {132.36} relaxation)', () => {
    const emptyType = WELL_FORMED_FRONTMATTER.replace(
      'type: topic',
      'type: ""',
    );

    expect(() => parseConceptFrontmatter(conceptMarkdown(emptyType))).toThrow();
  });

  it('rejects a concept missing a required key (description)', () => {
    const missingDescription = WELL_FORMED_FRONTMATTER.split('\n')
      .filter((line) => !line.startsWith('description:'))
      .join('\n');

    expect(() =>
      parseConceptFrontmatter(conceptMarkdown(missingDescription)),
    ).toThrow();
  });

  it('rejects a concept whose resource: URI does not match canonical://<table>/<uuid>', () => {
    const badResource = WELL_FORMED_FRONTMATTER.replace(
      WELL_FORMED_RESOURCE_LINE,
      'resource: "not-a-canonical-uri"',
    );

    expect(() =>
      parseConceptFrontmatter(conceptMarkdown(badResource)),
    ).toThrow();
  });

  it('rejects a q_a_pairs per-row uuid resource (BI-6 parity with validator.py: q_a_pairs is never cited in the per-row form, only the BI-8 query form)', () => {
    const qaPerRowResource = WELL_FORMED_FRONTMATTER.replace(
      WELL_FORMED_RESOURCE_LINE,
      `resource: "canonical://q_a_pairs/${VALID_UUID}"`,
    );

    expect(() =>
      parseConceptFrontmatter(conceptMarkdown(qaPerRowResource)),
    ).toThrow();
  });

  it('accepts a reference_items per-row uuid resource (BI-6: the second per-row-admissible table)', () => {
    const referenceItemsResource = WELL_FORMED_FRONTMATTER.replace(
      WELL_FORMED_RESOURCE_LINE,
      `resource: "canonical://reference_items/${VALID_UUID}"`,
    );

    const parsed = parseConceptFrontmatter(
      conceptMarkdown(referenceItemsResource),
    );

    expect(parsed.resource).toBe(`canonical://reference_items/${VALID_UUID}`);
  });

  it('accepts a concept with no resource: field at all (BI-12: resource is required only "where one exists")', () => {
    const resourceAbsent = WELL_FORMED_FRONTMATTER.split('\n')
      .filter((line) => !line.startsWith('resource:'))
      .join('\n');

    const parsed = parseConceptFrontmatter(conceptMarkdown(resourceAbsent));

    expect(parsed.resource).toBeUndefined();
    expect(parsed).toMatchObject({
      type: 'topic',
      title: 'Photovoltaic Panels',
      tags: ['renewable-energy', 'hardware'],
    });
  });

  it('accepts a BI-8 query-form canonical://q_a_pairs?scope_tag=<tag> resource (never a row uuid for the q_a_pairs corpus)', () => {
    const queryFormResource = WELL_FORMED_FRONTMATTER.replace(
      WELL_FORMED_RESOURCE_LINE,
      'resource: "canonical://q_a_pairs?scope_tag=solar-metrics"',
    );

    const parsed = parseConceptFrontmatter(conceptMarkdown(queryFormResource));

    expect(parsed.resource).toBe(
      'canonical://q_a_pairs?scope_tag=solar-metrics',
    );
  });

  it('rejects the retired q_a_pairs?domain=&subtopic= resource form (S531, DR-125 expiry)', () => {
    const queryFormResource = WELL_FORMED_FRONTMATTER.replace(
      WELL_FORMED_RESOURCE_LINE,
      'resource: "canonical://q_a_pairs?domain=energy&subtopic=solar"',
    );

    expect(() =>
      parseConceptFrontmatter(conceptMarkdown(queryFormResource)),
    ).toThrow(/resource must match/);
  });

  it('still rejects a malformed resource URI resembling the query form on a non-canonical scheme', () => {
    const badResource = WELL_FORMED_FRONTMATTER.replace(
      WELL_FORMED_RESOURCE_LINE,
      'resource: "not-canonical://q_a_pairs?scope_tag=solar"',
    );

    expect(() =>
      parseConceptFrontmatter(conceptMarkdown(badResource)),
    ).toThrow();
  });

  // ────────────────────────────────────────
  // {132.41} bl-456 routing hints + bl-477 A19 confidence
  // ────────────────────────────────────────

  it('exposes the A19 confidence vocabulary as a single ratifiable source of truth', () => {
    expect(CONFIDENCE_VALUES).toEqual([
      'strong',
      'partial',
      'no-content',
      'needs-SME',
    ]);
  });

  it('accepts a concept carrying all four routing-hint + confidence fields', () => {
    const withHints = [
      WELL_FORMED_FRONTMATTER,
      'purpose: Explain photovoltaic panel options',
      'task: answer a procurement question',
      'audience: SME buyer',
      'confidence: strong',
    ].join('\n');

    const parsed = parseConceptFrontmatter(conceptMarkdown(withHints));

    expect(parsed).toMatchObject({
      purpose: 'Explain photovoltaic panel options',
      task: 'answer a procurement question',
      audience: 'SME buyer',
      confidence: 'strong',
    });
  });

  it('accepts a concept with none of the four fields (all optional)', () => {
    const parsed = parseConceptFrontmatter(
      conceptMarkdown(WELL_FORMED_FRONTMATTER),
    );

    expect(parsed.purpose).toBeUndefined();
    expect(parsed.task).toBeUndefined();
    expect(parsed.audience).toBeUndefined();
    expect(parsed.confidence).toBeUndefined();
  });

  it.each(['strong', 'partial', 'no-content', 'needs-SME'])(
    'accepts confidence value %s',
    (value) => {
      const withConfidence = `${WELL_FORMED_FRONTMATTER}\nconfidence: ${value}`;
      const parsed = parseConceptFrontmatter(conceptMarkdown(withConfidence));
      expect(parsed.confidence).toBe(value);
    },
  );

  it('rejects an out-of-vocabulary confidence value via ZodError', () => {
    const badConfidence = `${WELL_FORMED_FRONTMATTER}\nconfidence: banana`;

    expect(() =>
      parseConceptFrontmatter(conceptMarkdown(badConfidence)),
    ).toThrow();
  });
});

// ────────────────────────────────────────
// OKF v0.2 consumer alignment (id-439, S546 rulings + id-426 emission
// contract): `generated` replaces `timestamp`, `sources[]` is the
// provenance list, §4.1 unknown-key tolerance, §11 optional-family duties.
// ────────────────────────────────────────

describe('parseConceptFrontmatter — OKF v0.2 (id-439)', () => {
  /** The v0.2 emission shape: generated + sources, NO timestamp. */
  const V02_FRONTMATTER = [
    'type: topic',
    'title: Data Encryption',
    'description: Encryption at rest and in transit.',
    'generated:',
    '  by: kh-concept-producer/claude-sonnet-4-5',
    '  at: "2026-08-08T12:00:00Z"',
    'sources:',
    '  - id: src-handbook',
    `    resource: "canonical://source_documents/${VALID_UUID}"`,
    '    title: Security Handbook',
    '  - id: src-standard',
    '    resource: "https://example.com/iso-27001"',
    '  - id: src-cert',
    '    resource: "/certifications/iso-27001.md"',
    'tags:',
    '  - security',
  ].join('\n');

  it('accepts a v0.2 concept: generated { by, at } + sources[], with no timestamp at all', () => {
    const parsed = parseConceptFrontmatter(conceptMarkdown(V02_FRONTMATTER));

    expect(parsed.timestamp).toBeUndefined();
    expect(parsed.generated).toMatchObject({
      by: 'kh-concept-producer/claude-sonnet-4-5',
      at: '2026-08-08T12:00:00Z',
    });
    expect(parsed.sources).toEqual([
      {
        id: 'src-handbook',
        resource: `canonical://source_documents/${VALID_UUID}`,
        title: 'Security Handbook',
      },
      { id: 'src-standard', resource: 'https://example.com/iso-27001' },
      { id: 'src-cert', resource: '/certifications/iso-27001.md' },
    ]);
  });

  it('still accepts a legacy v0.1 concept carrying timestamp + canonical resource (§13.1: previously-published bundles keep parsing)', () => {
    const parsed = parseConceptFrontmatter(
      conceptMarkdown(WELL_FORMED_FRONTMATTER),
    );

    expect(parsed.timestamp).toBe('2026-07-05T00:00:00.000Z');
    expect(parsed.generated).toBeUndefined();
    expect(parsed.sources).toBeUndefined();
  });

  it('parses BOTH on-disk fixture generations — the v0.2 sources concept and the v0.1 legacy concept', () => {
    const v02 = parseConceptFrontmatter(
      readFileSync(
        resolve(REPO_ROOT, '__tests__/fixtures/okf/concept-v02-sources.md'),
        'utf8',
      ),
    );
    const v01 = parseConceptFrontmatter(
      readFileSync(
        resolve(REPO_ROOT, '__tests__/fixtures/okf/concept-v01-legacy.md'),
        'utf8',
      ),
    );

    expect(v02.generated?.by).toBe('kh-concept-producer/claude-sonnet-4-5');
    expect(v02.sources).toHaveLength(3);
    expect(v02.timestamp).toBeUndefined();

    expect(v01.timestamp).toBe('2026-07-05T00:00:00.000Z');
    expect(v01.resource).toBe(
      'canonical://source_documents/3fa85f64-5717-4562-b3fc-2c963f66afa6',
    );
    expect(v01.sources).toBeUndefined();
  });

  it('accepts a v0.2 reference concept whose top-level resource: is a plain https URL (emission-contract item 4)', () => {
    const referenceConcept = WELL_FORMED_FRONTMATTER.replace(
      WELL_FORMED_RESOURCE_LINE,
      'resource: "https://example.com/standards/iso-27001"',
    );

    const parsed = parseConceptFrontmatter(conceptMarkdown(referenceConcept));

    expect(parsed.resource).toBe('https://example.com/standards/iso-27001');
  });

  it('never rejects a concept for missing optional families (§11): required keys alone parse', () => {
    const minimal = [
      'type: topic',
      'title: Bare Concept',
      'description: Nothing optional at all.',
      'tags: []',
    ].join('\n');

    const parsed = parseConceptFrontmatter(conceptMarkdown(minimal));

    expect(parsed).toMatchObject({ type: 'topic', title: 'Bare Concept' });
    expect(parsed.timestamp).toBeUndefined();
    expect(parsed.generated).toBeUndefined();
    expect(parsed.sources).toBeUndefined();
    expect(parsed.verified).toBeUndefined();
  });

  it('never rejects unknown frontmatter keys, and preserves them (§4.1)', () => {
    const withUnknownKeys = [
      V02_FRONTMATTER,
      'future_family: some-value',
      'another_extension:',
      '  nested: true',
    ].join('\n');

    const parsed = parseConceptFrontmatter(conceptMarkdown(withUnknownKeys));

    expect(parsed.future_family).toBe('some-value');
    expect(parsed.another_extension).toEqual({ nested: true });
  });

  it('normalises a bare verified: mapping to a one-element list (§11, forward-compatible with id-428)', () => {
    const bareMapping = [
      V02_FRONTMATTER,
      'verified:',
      '  by: sme@example.com',
      '  at: "2026-08-09T00:00:00Z"',
    ].join('\n');

    const parsed = parseConceptFrontmatter(conceptMarkdown(bareMapping));

    expect(parsed.verified).toEqual([
      { by: 'sme@example.com', at: '2026-08-09T00:00:00Z' },
    ]);
  });

  it('passes a verified: list through unchanged', () => {
    const list = [
      V02_FRONTMATTER,
      'verified:',
      '  - by: sme@example.com',
      '  - by: second@example.com',
    ].join('\n');

    const parsed = parseConceptFrontmatter(conceptMarkdown(list));

    expect(parsed.verified).toEqual([
      { by: 'sme@example.com' },
      { by: 'second@example.com' },
    ]);
  });
});
