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
import { describe, it, expect } from 'vitest';

import {
  CONCEPT_TYPE_VALUES,
  CONFIDENCE_VALUES,
  parseConceptFrontmatter,
} from '@/lib/ontology/concept-schema';

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

  it('rejects a concept whose type is outside the concept-type set', () => {
    const badType = WELL_FORMED_FRONTMATTER.replace(
      'type: topic',
      'type: not-a-real-type',
    );

    expect(() => parseConceptFrontmatter(conceptMarkdown(badType))).toThrow();
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

  it('accepts a BI-8 query-form canonical://q_a_pairs?domain=&subtopic= resource', () => {
    const queryFormResource = WELL_FORMED_FRONTMATTER.replace(
      WELL_FORMED_RESOURCE_LINE,
      'resource: "canonical://q_a_pairs?domain=energy&subtopic=solar"',
    );

    const parsed = parseConceptFrontmatter(conceptMarkdown(queryFormResource));

    expect(parsed.resource).toBe(
      'canonical://q_a_pairs?domain=energy&subtopic=solar',
    );
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
