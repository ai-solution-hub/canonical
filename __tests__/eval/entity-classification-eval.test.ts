/**
 * Entity Classification Eval — scoring unit tests.
 *
 * Unit coverage for the scoring logic in
 * `scripts/eval-entity-classification.ts`. These tests import and exercise the
 * REAL exported `scoreItem` (not a divergent local copy), so they also cover the
 * richer matching the script actually uses — `alternate_names` aliasing and
 * `alternate_types` acceptance.
 *
 * The full DB eval (cached scoring of entity_mentions against the gold standard)
 * now runs via the script itself —
 * `bun run scripts/eval-entity-classification.ts` (package script `eval:entity`,
 * chained into `eval:all`) — rather than a gated vitest block. That keeps the
 * eval entry point consistent with the other `eval:*` suites and removes the
 * inert env-gated block that never ran in CI.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreItem,
  type GoldStandardItem,
  type DbEntity,
} from '../../scripts/eval-entity-classification';

describe('Entity Classification Eval — scoring logic', () => {
  it('scores a perfect match correctly', () => {
    const gold: GoldStandardItem = {
      content_item_id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      title: 'Test item',
      domain: 'security',
      content_type: 'article',
      expected_entities: [
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
        },
      ],
      excluded_entities: [{ name: 'encryption', reason: 'generic concept' }],
    };

    const extracted: DbEntity[] = [
      {
        entity_type: 'certification',
        entity_name: 'ISO 27001',
        canonical_name: 'iso 27001',
      },
    ];

    const result = scoreItem(gold, extracted);
    expect(result.precision).toBe(1.0);
    expect(result.recall).toBe(1.0);
    expect(result.type_accuracy).toBe(1.0);
    expect(result.exclusion_compliance).toBe(1.0);
  });

  it('detects false positives', () => {
    const gold: GoldStandardItem = {
      content_item_id: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
      title: 'Test item',
      domain: 'security',
      content_type: 'article',
      expected_entities: [
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
        },
      ],
      excluded_entities: [],
    };

    const extracted: DbEntity[] = [
      {
        entity_type: 'certification',
        entity_name: 'ISO 27001',
        canonical_name: 'iso 27001',
      },
      {
        entity_type: 'organisation',
        entity_name: 'Some Corp',
        canonical_name: 'some corp',
      },
      {
        entity_type: 'technology',
        entity_name: 'Cloud Platform',
        canonical_name: 'cloud platform',
      },
    ];

    const result = scoreItem(gold, extracted);
    expect(result.precision).toBeCloseTo(1 / 3, 5);
    expect(result.recall).toBe(1.0);
    expect(result.false_positives.length).toBe(2);
  });

  it('detects false negatives', () => {
    const gold: GoldStandardItem = {
      content_item_id: '3a4b5c6d-7e8f-4a9b-0c1d-2e3f4a5b6c7d',
      title: 'Test item',
      domain: 'corporate',
      content_type: 'q_a_pair',
      expected_entities: [
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
        },
        {
          name: 'Cyber Essentials',
          type: 'certification',
          canonical_name: 'cyber essentials',
        },
        { name: 'UK GDPR', type: 'regulation', canonical_name: 'uk gdpr' },
      ],
      excluded_entities: [],
    };

    const extracted: DbEntity[] = [
      {
        entity_type: 'certification',
        entity_name: 'ISO 27001',
        canonical_name: 'iso 27001',
      },
    ];

    const result = scoreItem(gold, extracted);
    expect(result.precision).toBe(1.0);
    expect(result.recall).toBeCloseTo(1 / 3, 5);
    expect(result.false_negatives.length).toBe(2);
  });

  it('detects type errors', () => {
    const gold: GoldStandardItem = {
      content_item_id: '4a5b6c7d-8e9f-4a0b-1c2d-3e4f5a6b7c8d',
      title: 'Test item',
      domain: 'security',
      content_type: 'article',
      expected_entities: [
        {
          name: 'ISO 27001',
          type: 'certification',
          canonical_name: 'iso 27001',
        },
      ],
      excluded_entities: [],
    };

    const extracted: DbEntity[] = [
      {
        entity_type: 'regulation',
        entity_name: 'ISO 27001',
        canonical_name: 'iso 27001',
      },
    ];

    const result = scoreItem(gold, extracted);
    expect(result.type_accuracy).toBe(0);
    expect(result.type_errors.length).toBe(1);
  });

  it('detects exclusion failures', () => {
    const gold: GoldStandardItem = {
      content_item_id: '5a6b7c8d-9e0f-4a1b-2c3d-4e5f6a7b8c9d',
      title: 'Test item',
      domain: 'security',
      content_type: 'article',
      expected_entities: [],
      excluded_entities: [
        { name: 'encryption', reason: 'generic concept' },
        { name: 'Data Protection Officer', reason: 'job title' },
      ],
    };

    const extracted: DbEntity[] = [
      {
        entity_type: 'technology',
        entity_name: 'encryption',
        canonical_name: 'encryption',
      },
    ];

    const result = scoreItem(gold, extracted);
    expect(result.exclusion_compliance).toBe(0.5);
    expect(result.exclusion_failures.length).toBe(1);
  });

  it('fuzzy-matches via Ltd/Limited normalisation', () => {
    const gold: GoldStandardItem = {
      content_item_id: '6a7b8c9d-0e1f-4a2b-3c4d-5e6f7a8b9c0d',
      title: 'Test item',
      domain: 'corporate',
      content_type: 'q_a_pair',
      expected_entities: [
        {
          name: 'Example Client Ltd',
          type: 'organisation',
          canonical_name: 'example client limited',
        },
      ],
      excluded_entities: [],
    };

    const extracted: DbEntity[] = [
      {
        entity_type: 'organisation',
        entity_name: 'Example Client Ltd.',
        canonical_name: 'example client limited',
      },
    ];

    const result = scoreItem(gold, extracted);
    expect(result.true_positives.length).toBe(1);
    expect(result.precision).toBe(1.0);
  });

  it('returns 1.0 precision for empty extraction with no expected', () => {
    const gold: GoldStandardItem = {
      content_item_id: '7a8b9c0d-1e2f-4a3b-4c5d-6e7f8a9b0c1d',
      title: 'Test item',
      domain: 'security',
      content_type: 'article',
      expected_entities: [],
      excluded_entities: [],
    };

    const result = scoreItem(gold, []);
    expect(result.precision).toBe(1.0);
    expect(result.recall).toBe(1.0);
  });

  it('matches an alias listed in alternate_names', () => {
    const gold: GoldStandardItem = {
      content_item_id: '8a9b0c1d-2e3f-4a4b-5c6d-7e8f9a0b1c2d',
      title: 'Test item',
      domain: 'security',
      content_type: 'article',
      expected_entities: [
        {
          name: 'CREST',
          type: 'certification',
          canonical_name: 'crest',
          alternate_names: ['council of registered ethical security testers'],
        },
      ],
      excluded_entities: [],
    };

    const extracted: DbEntity[] = [
      {
        entity_type: 'certification',
        entity_name: 'Council of Registered Ethical Security Testers',
        canonical_name: 'council of registered ethical security testers',
      },
    ];

    const result = scoreItem(gold, extracted);
    expect(result.true_positives.length).toBe(1);
    expect(result.recall).toBe(1.0);
  });

  it('accepts a type listed in alternate_types without a type error', () => {
    const gold: GoldStandardItem = {
      content_item_id: '9a0b1c2d-3e4f-4a5b-6c7d-8e9f0a1b2c3d',
      title: 'Test item',
      domain: 'security',
      content_type: 'article',
      expected_entities: [
        {
          name: 'CREST',
          type: 'organisation',
          canonical_name: 'crest',
          alternate_types: ['certification'],
        },
      ],
      excluded_entities: [],
    };

    const extracted: DbEntity[] = [
      {
        entity_type: 'certification',
        entity_name: 'CREST',
        canonical_name: 'crest',
      },
    ];

    const result = scoreItem(gold, extracted);
    expect(result.true_positives.length).toBe(1);
    expect(result.type_accuracy).toBe(1.0);
    expect(result.type_errors.length).toBe(0);
  });
});
