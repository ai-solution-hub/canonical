import { describe, it, expect } from 'vitest';
import {
  formatEntitySummary,
  formatEntityOverview,
  formatCitation,
  formatContentEffectiveness,
  type EntitySummaryResult,
  type EntityRelationship,
  type EntityOverview,
  type CitationResult,
  type ContentEffectiveness,
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
    related_entities: [{ relationship: 'holds', source: 'Acme Ltd' }],
  },
];

const sampleRelationships: EntityRelationship[] = [
  {
    source_entity: 'Acme Ltd',
    relationship_type: 'holds',
    target_entity: 'ISO 27001',
    source_document_id: 'item-001',
    confidence: 0.95,
  },
  {
    source_entity: 'Acme Ltd',
    relationship_type: 'holds',
    target_entity: 'Cyber Essentials',
    source_document_id: 'item-004',
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
    {
      canonical_name: 'ISO 27001',
      entity_type: 'certification',
      mention_count: 12,
    },
    {
      canonical_name: 'Acme Ltd',
      entity_type: 'organisation',
      mention_count: 9,
    },
    {
      canonical_name: 'Kubernetes',
      entity_type: 'technology',
      mention_count: 7,
    },
  ],
};

// ──────────────────────────────────────────
// formatEntitySummary
// ──────────────────────────────────────────

describe('formatEntitySummary', () => {
  it('formats entity summaries with names, types, and mention counts', () => {
    const result = formatEntitySummary(
      'ISO 27001',
      'certification',
      sampleSummaries,
      [],
    );

    expect(result).toContain('# Entity Relationships');
    expect(result).toContain('## ISO 27001');
    expect(result).toContain('**Type:** certification');
    expect(result).toContain('**Mentions:** 12');
    expect(result).toContain('**Referenced in:** 3 content items');
  });

  it('includes related entities subsection when present', () => {
    const result = formatEntitySummary(
      'ISO 27001',
      undefined,
      sampleSummaries,
      [],
    );

    expect(result).toContain('### Related Entities');
    expect(result).toContain('Acme Ltd');
    expect(result).toContain('BSI');
    expect(result).toContain('holds');
  });

  it('formats relationships as a Markdown table', () => {
    const result = formatEntitySummary(
      'ISO 27001',
      undefined,
      sampleSummaries,
      sampleRelationships,
    );

    expect(result).toContain('## Relationships');
    expect(result).toContain('| Source | Relationship | Target | Confidence |');
    expect(result).toContain('| Acme Limited | holds | ISO 27001 | 95% |');
    expect(result).toContain(
      '| Acme Limited | holds | Cyber Essentials | 88% |',
    );
  });

  it('formats relationship types with underscores replaced by spaces', () => {
    const relationships: EntityRelationship[] = [
      {
        source_entity: 'Acme Ltd',
        relationship_type: 'complies_with',
        target_entity: 'GDPR',
        source_document_id: 'item-005',
        confidence: 0.9,
      },
    ];

    const result = formatEntitySummary(
      'Acme Ltd',
      undefined,
      sampleSummaries,
      relationships,
    );

    expect(result).toContain('| complies with |');
  });

  it('omits the relationships section when relationships array is empty', () => {
    const result = formatEntitySummary(
      'ISO 27001',
      undefined,
      sampleSummaries,
      [],
    );

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

    const result = formatEntitySummary(
      'GDPR',
      undefined,
      singleItemSummary,
      [],
    );

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

      expect(result).toContain(
        'No entities found matching "Unknown" (type: certification)',
      );
    });

    it('uses generic filter text when neither name nor type is provided', () => {
      const result = formatEntitySummary(undefined, undefined, [], []);

      expect(result).toContain(
        'No entities found matching the specified criteria',
      );
    });

    it('shows type-only filter when only entity type is provided', () => {
      const result = formatEntitySummary(undefined, 'technology', [], []);

      expect(result).toContain('No entities found matching type "technology"');
    });
  });

  it('formats multiple entity summaries in sequence', () => {
    const result = formatEntitySummary(
      undefined,
      'certification',
      sampleSummaries,
      [],
    );

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
    expect(result).toContain('| Acme Limited | organisation | 9 |');
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
          {
            canonical_name: 'GDPR',
            entity_type: 'regulation',
            mention_count: 1,
          },
        ],
      };

      const result = formatEntityOverview(singleType);

      expect(result).toContain('**Total entities:** 1');
      expect(result).toContain('- **regulation:** 1');
      expect(result).toContain('| GDPR | regulation | 1 |');
    });
  });
});

// ──────────────────────────────────────────
// formatCitation
// ──────────────────────────────────────────

describe('formatCitation', () => {
  const sampleCitation: CitationResult = {
    id: 'cit-001',
    cited_kind: 'q_a_pair',
    cited_q_a_pair_id: 'qap-abc-123',
    cited_reference_item_id: null,
    cited_source_document_id: null,
    cited_concept_path: null,
    citing_kind: 'form_response',
    citing_form_response_id: 'resp-xyz-456',
    citation_type: 'reference',
    cited_version: 3,
  };

  it('formats a citation with all fields', () => {
    const result = formatCitation(sampleCitation);

    expect(result).toContain('# Citation Recorded');
    expect(result).toContain('**Cited kind:** q_a_pair');
    expect(result).toContain('**Q&A pair:** qap-abc-123');
    expect(result).toContain('**Citing kind:** form_response');
    expect(result).toContain('**Procurement response:** resp-xyz-456');
    expect(result).toContain('**Type:** reference');
    expect(result).toContain('**Cited version:** 3');
    expect(result).toContain('**ID:** cit-001');
    expect(result).toContain('The citation has been recorded successfully.');
  });

  it('returns item ID and response ID in output', () => {
    const citation: CitationResult = {
      id: 'cit-999',
      cited_kind: 'q_a_pair',
      cited_q_a_pair_id: 'qap-id-abc',
      cited_reference_item_id: null,
      cited_source_document_id: null,
      cited_concept_path: null,
      citing_kind: 'form_response',
      citing_form_response_id: 'response-id-def',
      citation_type: 'adapted',
      cited_version: null,
    };

    const result = formatCitation(citation);

    expect(result).toContain('qap-id-abc');
    expect(result).toContain('response-id-def');
    expect(result).toContain('**Type:** adapted');
  });

  // ID-131.19 (M6, S450 GO tail): 'content_item' retired — the
  // cited_content_item_id column was dropped and the CHECK constraint no
  // longer permits new rows of this kind. A pre-M6 legacy row may still
  // carry cited_kind='content_item' (the DB enum label survives), but it has
  // no renderable target column left — this must render a "retired" label
  // rather than crash or show a blank/undefined field.
  it('renders a retired legacy content_item citation without a target column', () => {
    const citation: CitationResult = {
      id: 'cit-legacy-1',
      cited_kind: 'content_item',
      cited_q_a_pair_id: null,
      cited_reference_item_id: null,
      cited_source_document_id: null,
      cited_concept_path: null,
      citing_kind: 'form_response',
      citing_form_response_id: 'resp-legacy-1',
      citation_type: 'reference',
      cited_version: null,
    };

    const result = formatCitation(citation);

    expect(result).toContain('**Cited kind:** content_item');
    expect(result).toContain('**Content item (retired):** —');
  });

  // ID-131.28 (G-CITE-READERS) — the extended cited_target_kind contract
  // ({131.10} M4b) added q_a_pair/reference_item/source_document/concept
  // kinds. Each kind must render its own populated column, not a
  // blank/undefined field.
  it.each([
    {
      cited_kind: 'q_a_pair' as const,
      field: 'cited_q_a_pair_id' as const,
      value: 'qap-111',
      label: 'Q&A pair',
    },
    {
      cited_kind: 'reference_item' as const,
      field: 'cited_reference_item_id' as const,
      value: 'ref-222',
      label: 'Reference item',
    },
    {
      cited_kind: 'source_document' as const,
      field: 'cited_source_document_id' as const,
      value: 'sd-333',
      label: 'Source document',
    },
    {
      cited_kind: 'concept' as const,
      field: 'cited_concept_path' as const,
      value: 'concept/path/foo',
      label: 'Concept',
    },
  ])(
    'displays the $cited_kind target from $field',
    ({ cited_kind, field, value, label }) => {
      const citation: CitationResult = {
        id: 'cit-ext-1',
        cited_kind,
        cited_q_a_pair_id: null,
        cited_reference_item_id: null,
        cited_source_document_id: null,
        cited_concept_path: null,
        [field]: value,
        citing_kind: 'form_response',
        citing_form_response_id: 'resp-ext-1',
        citation_type: 'reference',
        cited_version: null,
      };

      const result = formatCitation(citation);

      expect(result).toContain(`**Cited kind:** ${cited_kind}`);
      expect(result).toContain(`**${label}:** ${value}`);
    },
  );
});

// ──────────────────────────────────────────
// formatContentEffectiveness
// ──────────────────────────────────────────

describe('formatContentEffectiveness', () => {
  it('produces "highly effective" commentary for high win rate (>= 0.7)', () => {
    const data: ContentEffectiveness = {
      q_a_pair_id: 'item-001',
      total_citations: 10,
      winning_citations: 8,
      losing_citations: 2,
      pending_citations: 0,
      win_rate: 0.8,
    };

    const result = formatContentEffectiveness(data);

    expect(result).toContain('# Content Effectiveness');
    expect(result).toContain('80%');
    expect(result).toContain('highly effective');
  });

  it('produces moderate commentary for moderate win rate (>= 0.4)', () => {
    const data: ContentEffectiveness = {
      q_a_pair_id: 'item-002',
      total_citations: 10,
      winning_citations: 5,
      losing_citations: 5,
      pending_citations: 0,
      win_rate: 0.5,
    };

    const result = formatContentEffectiveness(data);

    expect(result).toContain('50%');
    expect(result).toContain('moderate effectiveness');
  });

  it('produces low win rate commentary for win rate < 0.4', () => {
    const data: ContentEffectiveness = {
      q_a_pair_id: 'item-003',
      total_citations: 10,
      winning_citations: 2,
      losing_citations: 8,
      pending_citations: 0,
      win_rate: 0.2,
    };

    const result = formatContentEffectiveness(data);

    expect(result).toContain('20%');
    expect(result).toContain('low win rate');
  });

  it('produces "no citations" message when total_citations is 0', () => {
    const data: ContentEffectiveness = {
      q_a_pair_id: 'item-004',
      total_citations: 0,
      winning_citations: 0,
      losing_citations: 0,
      pending_citations: 0,
      win_rate: 0,
    };

    const result = formatContentEffectiveness(data);

    expect(result).toContain('**Total citations:** 0');
    expect(result).toContain('not yet been cited');
    expect(result).not.toContain('highly effective');
    expect(result).not.toContain('moderate effectiveness');
    expect(result).not.toContain('low win rate');
  });

  it('shows "Awaiting outcomes" when citations exist but no decided bids', () => {
    const data: ContentEffectiveness = {
      q_a_pair_id: 'item-005',
      total_citations: 5,
      winning_citations: 0,
      losing_citations: 0,
      pending_citations: 5,
      win_rate: 0,
    };

    const result = formatContentEffectiveness(data);

    expect(result).toContain('**Total citations:** 5');
    expect(result).toContain('Awaiting outcomes');
    expect(result).not.toContain('not yet been cited');
    expect(result).not.toContain('low win rate');
  });

  it('shows losing citations count', () => {
    const data: ContentEffectiveness = {
      q_a_pair_id: 'item-006',
      total_citations: 8,
      winning_citations: 3,
      losing_citations: 3,
      pending_citations: 2,
      win_rate: 0.5,
    };

    const result = formatContentEffectiveness(data);

    expect(result).toContain('**Losing citations:** 3');
    expect(result).toContain('**Pending citations:** 2');
  });

  it('omits pending line when pending_citations is 0', () => {
    const data: ContentEffectiveness = {
      q_a_pair_id: 'item-007',
      total_citations: 6,
      winning_citations: 4,
      losing_citations: 2,
      pending_citations: 0,
      win_rate: 0.67,
    };

    const result = formatContentEffectiveness(data);

    expect(result).not.toContain('Pending');
  });
});
