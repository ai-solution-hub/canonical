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
 * bl-456 routing hints (`purpose`/`task`/`audience`, free optional
 * strings), mirroring the landed Python emitter/validator
 * (`producer/frontmatter.py` / `producer/validator.py`). The bl-477 A19
 * `confidence` enum that used to sit alongside them is retired (id-428);
 * it is covered below as an ordinary §4.1 passthrough key.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { parseConceptFrontmatter } from '@/lib/ontology/concept-schema';

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

  // INVERTED by ID-427 {427.6} / DR-141 from `exposes the concept-type set
  // as a single ratifiable source of truth`, which pinned
  // `CONCEPT_TYPE_VALUES` to the base-5 array. Pinning a concept-type
  // vocabulary is the thing DR-141 withdrew, and the const itself is
  // deleted — so the claim inverts: the reader parses the types the
  // producer will actually emit after this wave, none of which any
  // ratified base-5 array ever held. (Absence of the export is enforced by
  // the compiler — `bun run typecheck`, NOT `bun run test`, which is
  // `vitest run` and does not type-check — so a re-added
  // `CONCEPT_TYPE_VALUES` would not be caught by this file alone.)
  it.each([
    'reference',
    'document',
    'questionnaire_response',
    'answer_set',
    'procurement_policy',
  ])('parses a concept typed %s, which no base vocabulary held', (openType) => {
    const parsed = parseConceptFrontmatter(
      conceptMarkdown(
        WELL_FORMED_FRONTMATTER.replace('type: topic', `type: ${openType}`),
      ),
    );

    expect(parsed.type).toBe(openType);
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

  it('accepts a concept missing description — a RECOMMENDED key, not a required one (id-439)', () => {
    /**
     * This assertion used to read `.toThrow()`. It encoded the §11
     * violation id-439 fixes: `description` is RECOMMENDED by §4.1, and
     * §11 forbids rejecting a bundle for a missing optional field. `type`
     * remains the only key whose absence throws — see the §11 block below.
     */
    const missingDescription = WELL_FORMED_FRONTMATTER.split('\n')
      .filter((line) => !line.startsWith('description:'))
      .join('\n');

    const parsed = parseConceptFrontmatter(conceptMarkdown(missingDescription));

    expect(parsed.description).toBeUndefined();
    expect(parsed.type).toBe('topic');
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

// ────────────────────────────────────────
// id-439 — the two §11 MUST-NOT-reject duties this reader was still
// violating, closed in step with id-428's producer-side retirement.
// ────────────────────────────────────────

describe('parseConceptFrontmatter — §11 MUST-NOT-reject (id-439)', () => {
  it('parses a concept carrying ONLY type', () => {
    /**
     * §4.1: "`type` is the only always-required key; a concept carrying
     * just `type` is fully conformant (§11)." This reader required
     * `title`, `description` AND `tags` and called `.parse()`, so the
     * spec's own minimal conformant document threw — the sharpest form of
     * the §11 duty "MUST NOT reject a bundle because of missing optional
     * frontmatter fields".
     */
    const parsed = parseConceptFrontmatter(conceptMarkdown('type: topic'));

    expect(parsed.type).toBe('topic');
    expect(parsed.title).toBeUndefined();
    expect(parsed.description).toBeUndefined();
    expect(parsed.tags).toBeUndefined();
  });

  it.each([
    ['title', 'title: Photovoltaic Panels'],
    ['description', 'description: A concept.'],
    ['tags', 'tags:\n  - solar'],
  ])('parses a concept missing only %s', (_label, omittedLine) => {
    const all = [
      'type: topic',
      'title: Photovoltaic Panels',
      'description: A concept.',
      'tags:\n  - solar',
    ];
    const withoutOne = all.filter((line) => line !== omittedLine).join('\n');

    expect(() =>
      parseConceptFrontmatter(conceptMarkdown(withoutOne)),
    ).not.toThrow();
  });

  it('still rejects a concept with no type at all (§11 clause 2)', () => {
    /** The one thing §11 DOES require: a non-empty `type`. Loosening the
     * optional families must not loosen this. */
    expect(() =>
      parseConceptFrontmatter(conceptMarkdown('title: No type here')),
    ).toThrow();
  });

  it('keeps the §11 duties intact on a type-only concept', () => {
    const minimal = [
      'type: topic',
      'verified:',
      '  by: sme@example.com',
      '  at: "2026-08-09T00:00:00Z"',
      'unknown_future_key: kept',
    ].join('\n');

    const parsed = parseConceptFrontmatter(conceptMarkdown(minimal));

    expect(parsed.verified).toEqual([
      { by: 'sme@example.com', at: '2026-08-09T00:00:00Z' },
    ]);
    expect(parsed.unknown_future_key).toBe('kept');
  });
});

describe('parseConceptFrontmatter — confidence is a passthrough key (id-439/id-428)', () => {
  /**
   * id-428 retired `confidence` from the emission contract (SPEC §5.1
   * refuses a stored credibility score). Bundles published BEFORE that
   * still carry it, so this reader must keep parsing them — and since
   * there is no vocabulary left to gate against, the field is now an
   * ordinary §4.1 extension key: preserved, never validated, never a
   * reason to reject.
   */
  const LEGACY = [
    'type: topic',
    'title: Data Encryption',
    'description: Encryption at rest.',
    'tags:\n  - security',
  ].join('\n');

  it.each(['strong', 'partial', 'no-content', 'needs-SME'])(
    'parses a previously-published bundle carrying confidence: %s',
    (value) => {
      const parsed = parseConceptFrontmatter(
        conceptMarkdown(`${LEGACY}\nconfidence: ${value}`),
      );
      expect(parsed.confidence).toBe(value);
    },
  );

  it('no longer rejects an out-of-vocabulary confidence value', () => {
    /** The z.enum used to throw here. With the vocabulary retired there is
     * nothing for a value to be outside OF, and §11 forbids rejecting a
     * concept over an unrecognised key's contents. */
    const parsed = parseConceptFrontmatter(
      conceptMarkdown(`${LEGACY}\nconfidence: banana`),
    );

    expect(parsed.confidence).toBe('banana');
  });

  it('does not require confidence on a new bundle', () => {
    const parsed = parseConceptFrontmatter(conceptMarkdown(LEGACY));
    expect(parsed.confidence).toBeUndefined();
  });
});
