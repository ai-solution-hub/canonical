import { describe, it, expect } from 'vitest';
import {
  formatEntitySummary,
  formatEntityOverview,
  type EntitySummaryResult,
  type EntityRelationship,
  type EntityOverview,
} from '@/lib/mcp/formatters';

// ──────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────

const sampleSummaries: EntitySummaryResult[] = [
  {
    canonical_name: 'ISO 27001',
    entity_type: 'certification',
    mention_count: 12,
    content_item_ids: ['item-001', 'item-002', 'item-003'],
    related_entities: [
      { relationship: 'holds', source: 'Acme Ltd' },
      { relationship: 'holds', source: 'BSI' },
    ],
  },
  {
    canonical_name: 'Cyber Essentials',
    entity_type: 'certification',
    mention_count: 5,
    content_item_ids: ['item-001', 'item-004'],
    related_entities: [
      { relationship: 'holds', source: 'Acme Ltd' },
    ],
  },
];

const sampleRelationships: EntityRelationship[] = [
  {
    source_entity: 'Acme Ltd',
    relationship_type: 'holds',
    target_entity: 'ISO 27001',
    source_item_id: 'item-001',
    confidence: 0.95,
  },
  {
    source_entity: 'Acme Ltd',
    relationship_type: 'holds',
    target_entity: 'Cyber Essentials',
    source_item_id: 'item-004',
    confidence: 0.88,
  },
];

const sampleOverview: EntityOverview = {
  total_entities: 25,
  by_type: {
    certification: 8,
    organisation: 10,
    technology: 5,
    person: 2,
  },
  top_entities: [
    { canonical_name: 'ISO 27001', entity_type: 'certification', mention_count: 12 },
    { canonical_name: 'Acme Ltd', entity_type: 'organisation', mention_count: 9 },
    { canonical_name: 'Kubernetes', entity_type: 'technology', mention_count: 7 },
  ],
};

// ──────────────────────────────────────────
// formatEntitySummary
// ──────────────────────────────────────────

describe('formatEntitySummary', () => {
  it('formats entity summaries with names, types, and mention counts', () => {
    const result = formatEntitySummary('ISO 27001', 'certification', sampleSummaries, []);

    expect(result).toContain('# Entity Relationships');
    expect(result).toContain('## ISO 27001');
    expect(result).toContain('**Type:** certification');
    expect(result).toContain('**Mentions:** 12');
    expect(result).toContain('**Referenced in:** 3 content items');
  });

  it('includes related entities subsection when present', () => {
    const result = formatEntitySummary('ISO 27001', undefined, sampleSummaries, []);

    expect(result).toContain('### Related Entities');
    expect(result).toContain('Acme Ltd');
    expect(result).toContain('BSI');
    expect(result).toContain('holds');
  });

  it('formats relationships as a Markdown table', () => {
    const result = formatEntitySummary('ISO 27001', undefined, sampleSummaries, sampleRelationships);

    expect(result).toContain('## Relationships');
    expect(result).toContain('| Source | Relationship | Target | Confidence |');
    expect(result).toContain('| Acme Ltd | holds | ISO 27001 | 95% |');
    expect(result).toContain('| Acme Ltd | holds | Cyber Essentials | 88% |');
  });

  it('formats relationship types with underscores replaced by spaces', () => {
    const relationships: EntityRelationship[] = [
      {
        source_entity: 'Acme Ltd',
        relationship_type: 'complies_with',
        target_entity: 'GDPR',
        source_item_id: 'item-005',
        confidence: 0.9,
      },
    ];

    const result = formatEntitySummary('Acme Ltd', undefined, sampleSummaries, relationships);

    expect(result).toContain('| complies with |');
  });

  it('omits the relationships section when relationships array is empty', () => {
    const result = formatEntitySummary('ISO 27001', undefined, sampleSummaries, []);

    expect(result).not.toContain('## Relationships');
    expect(result).not.toContain('| Source |');
  });

  it('handles a single content item reference with singular text', () => {
    const singleItemSummary: EntitySummaryResult[] = [
      {
        canonical_name: 'GDPR',
        entity_type: 'regulation',
        mention_count: 1,
        content_item_ids: ['item-010'],
        related_entities: [],
      },
    ];

    const result = formatEntitySummary('GDPR', undefined, singleItemSummary, []);

    expect(result).toContain('**Referenced in:** 1 content item');
    // Should NOT have trailing 's'
    expect(result).not.toContain('1 content items');
  });

  it('omits related entities section when empty', () => {
    const noRelatedSummary: EntitySummaryResult[] = [
      {
        canonical_name: 'GDPR',
        entity_type: 'regulation',
        mention_count: 3,
        content_item_ids: ['item-010', 'item-011', 'item-012'],
        related_entities: [],
      },
    ];

    const result = formatEntitySummary('GDPR', undefined, noRelatedSummary, []);

    expect(result).not.toContain('### Related Entities');
  });

  describe('empty data handling', () => {
    it('returns a "no entities found" message when summaries array is empty', () => {
      const result = formatEntitySummary('Unknown Entity', undefined, [], []);

      expect(result).toContain('# Entity Relationships');
      expect(result).toContain('No entities found matching "Unknown Entity"');
    });

    it('includes entity type in the "no entities" message when provided', () => {
      const result = formatEntitySummary('Unknown', 'certification', [], []);

      expect(result).toContain('No entities found matching "Unknown" (type: certification)');
    });

    it('uses generic filter text when neither name nor type is provided', () => {
      const result = formatEntitySummary(undefined, undefined, [], []);

      expect(result).toContain('No entities found matching the specified criteria');
    });

    it('shows type-only filter when only entity type is provided', () => {
      const result = formatEntitySummary(undefined, 'technology', [], []);

      expect(result).toContain('No entities found matching type "technology"');
    });
  });

  it('formats multiple entity summaries in sequence', () => {
    const result = formatEntitySummary(undefined, 'certification', sampleSummaries, []);

    // Both summaries should appear
    expect(result).toContain('## ISO 27001');
    expect(result).toContain('## Cyber Essentials');
    expect(result).toContain('**Mentions:** 12');
    expect(result).toContain('**Mentions:** 5');
  });
});

// ──────────────────────────────────────────
// formatEntityOverview
// ──────────────────────────────────────────

describe('formatEntityOverview', () => {
  it('formats the overview header with total entity count', () => {
    const result = formatEntityOverview(sampleOverview);

    expect(result).toContain('# Entity Overview');
    expect(result).toContain('**Total entities:** 25');
  });

  it('lists entity types sorted by count in descending order', () => {
    const result = formatEntityOverview(sampleOverview);

    expect(result).toContain('## Entities by Type');
    expect(result).toContain('- **organisation:** 10');
    expect(result).toContain('- **certification:** 8');
    expect(result).toContain('- **technology:** 5');
    expect(result).toContain('- **person:** 2');

    // Verify descending order: organisation (10) before certification (8)
    const orgIndex = result.indexOf('**organisation:**');
    const certIndex = result.indexOf('**certification:**');
    expect(orgIndex).toBeLessThan(certIndex);
  });

  it('formats the top entities as a Markdown table', () => {
    const result = formatEntityOverview(sampleOverview);

    expect(result).toContain('## Top Entities');
    expect(result).toContain('| Entity | Type | Mentions |');
    expect(result).toContain('| ISO 27001 | certification | 12 |');
    expect(result).toContain('| Acme Ltd | organisation | 9 |');
    expect(result).toContain('| Kubernetes | technology | 7 |');
  });

  describe('empty data handling', () => {
    it('handles zero total entities', () => {
      const emptyOverview: EntityOverview = {
        total_entities: 0,
        by_type: {},
        top_entities: [],
      };

      const result = formatEntityOverview(emptyOverview);

      expect(result).toContain('# Entity Overview');
      expect(result).toContain('**Total entities:** 0');
      expect(result).not.toContain('## Top Entities');
    });

    it('omits top entities section when top_entities array is empty', () => {
      const noTopOverview: EntityOverview = {
        total_entities: 3,
        by_type: { certification: 3 },
        top_entities: [],
      };

      const result = formatEntityOverview(noTopOverview);

      expect(result).toContain('- **certification:** 3');
      expect(result).not.toContain('## Top Entities');
      expect(result).not.toContain('| Entity |');
    });

    it('handles a single entity type', () => {
      const singleType: EntityOverview = {
        total_entities: 1,
        by_type: { regulation: 1 },
        top_entities: [
          { canonical_name: 'GDPR', entity_type: 'regulation', mention_count: 1 },
        ],
      };

      const result = formatEntityOverview(singleType);

      expect(result).toContain('**Total entities:** 1');
      expect(result).toContain('- **regulation:** 1');
      expect(result).toContain('| GDPR | regulation | 1 |');
    });
  });
});
