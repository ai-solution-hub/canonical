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
 */
import { describe, it, expect } from 'vitest';

import {
  CONCEPT_TYPE_VALUES,
  parseConceptFrontmatter,
} from '@/lib/ontology/concept-schema';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

/** Wrap a YAML frontmatter block into full concept `.md` text. */
function conceptMarkdown(frontmatterYaml: string, body = 'Body text.'): string {
  return `---\n${frontmatterYaml}\n---\n\n${body}\n`;
}

const WELL_FORMED_FRONTMATTER = [
  'type: topic',
  'title: Photovoltaic Panels',
  'description: A concept describing photovoltaic panel technology.',
  'timestamp: "2026-07-05T00:00:00.000Z"',
  `resource: "canonical://q_a_pairs/${VALID_UUID}"`,
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
      resource: `canonical://q_a_pairs/${VALID_UUID}`,
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
      `resource: "canonical://q_a_pairs/${VALID_UUID}"`,
      'resource: "not-a-canonical-uri"',
    );

    expect(() =>
      parseConceptFrontmatter(conceptMarkdown(badResource)),
    ).toThrow();
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
      `resource: "canonical://q_a_pairs/${VALID_UUID}"`,
      'resource: "canonical://q_a_pairs?scope_tag=solar-metrics"',
    );

    const parsed = parseConceptFrontmatter(conceptMarkdown(queryFormResource));

    expect(parsed.resource).toBe(
      'canonical://q_a_pairs?scope_tag=solar-metrics',
    );
  });

  it('accepts a BI-8 query-form canonical://q_a_pairs?domain=&subtopic= resource', () => {
    const queryFormResource = WELL_FORMED_FRONTMATTER.replace(
      `resource: "canonical://q_a_pairs/${VALID_UUID}"`,
      'resource: "canonical://q_a_pairs?domain=energy&subtopic=solar"',
    );

    const parsed = parseConceptFrontmatter(conceptMarkdown(queryFormResource));

    expect(parsed.resource).toBe(
      'canonical://q_a_pairs?domain=energy&subtopic=solar',
    );
  });

  it('still rejects a malformed resource URI resembling the query form on a non-canonical scheme', () => {
    const badResource = WELL_FORMED_FRONTMATTER.replace(
      `resource: "canonical://q_a_pairs/${VALID_UUID}"`,
      'resource: "not-canonical://q_a_pairs?scope_tag=solar"',
    );

    expect(() =>
      parseConceptFrontmatter(conceptMarkdown(badResource)),
    ).toThrow();
  });
});
