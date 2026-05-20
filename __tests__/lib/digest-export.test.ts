import { describe, it, expect } from 'vitest';
import { digestToMarkdown } from '@/lib/change-reports/change-reports-export';
import type { Digest } from '@/types/digest';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeDigest(overrides: Partial<Digest> = {}): Digest {
  return {
    id: 'digest-001',
    digest_type: 'weekly',
    period_start: '2026-01-25T00:00:00Z',
    period_end: '2026-02-24T00:00:00Z',
    item_count: 42,
    generated_at: '2026-02-24T12:00:00Z',
    generated_by: 'claude',
    tokens_used: 1500,
    created_at: '2026-02-24T12:00:00Z',
    narrative_summary:
      'A busy week across AI tooling, product launches, and strategic insights.',
    domain_summaries: [
      {
        domain: 'SECURITY',
        item_count: 15,
        summary:
          'Significant developments in agent frameworks and LLM tooling.',
        top_items: [
          {
            id: 'item-1',
            title: 'Claude Code goes GA',
            content_type: 'article',
            why_notable: 'Major product launch from Anthropic',
          },
          {
            id: 'item-2',
            title: 'OpenAI Agents SDK',
            content_type: 'blog',
            why_notable: null as unknown as undefined,
          },
        ],
        key_themes: ['AI agents', 'developer tools'],
      },
      {
        domain: 'COMPLIANCE',
        item_count: 8,
        summary: 'Enterprise AI adoption continues to accelerate.',
        top_items: [
          {
            id: 'item-3',
            title: 'Enterprise AI Playbook',
            content_type: 'pdf',
            why_notable: 'Comprehensive guide for CTOs',
          },
        ],
        key_themes: ['enterprise adoption'],
      },
    ],
    theme_clusters: [
      {
        theme: 'AI-powered development',
        item_count: 12,
        description: 'Tools and practices for AI-assisted software development',
      },
      {
        theme: 'Enterprise readiness',
        item_count: 7,
        description: 'Maturation of AI tools for enterprise use cases',
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — updated for "Change Report" vocabulary
// ---------------------------------------------------------------------------

describe('digestToMarkdown', () => {
  it('should produce output with all fields present', () => {
    const digest = makeDigest();
    const md = digestToMarkdown(digest);

    // Title (auto-generated from type + dates) — now "Change Report"
    expect(md).toContain('# Weekly Change Report: 25 Jan 2026 -- 24 Feb 2026');

    // Metadata line
    expect(md).toContain('*42 items | Generated 24 Feb 2026*');

    // Narrative summary section — now "Overview" instead of "Summary"
    expect(md).toContain('## Overview');
    expect(md).toContain('A busy week across AI tooling');

    // Domain sections
    expect(md).toContain('## SECURITY (15 items)');
    expect(md).toContain(
      'Significant developments in agent frameworks and LLM tooling.',
    );
    expect(md).toContain('### Top Items');
    expect(md).toContain('**Claude Code goes GA** (article)');
    expect(md).toContain('-- Major product launch from Anthropic');
    expect(md).toContain('**OpenAI Agents SDK** (blog)');

    // Key themes
    expect(md).toContain('*Themes: AI agents, developer tools*');

    // Second domain
    expect(md).toContain('## COMPLIANCE (8 items)');
    expect(md).toContain('**Enterprise AI Playbook** (pdf)');

    // Theme clusters
    expect(md).toContain('## Cross-Domain Themes');
    expect(md).toContain(
      '**AI-powered development** (12 items) -- Tools and practices',
    );
    expect(md).toContain(
      '**Enterprise readiness** (7 items) -- Maturation of AI tools',
    );
  });

  it('should render governance summary as "Review Activity This Period" with deltas', () => {
    const digest = makeDigest({
      governance_summary: {
        items_modified: 24,
        items_verified: 12,
        items_flagged: 3,
        freshness_breakdown: {
          fresh: 30,
          aging: 8,
          stale: 3,
          expired: 1,
        },
      },
    });
    const md = digestToMarkdown(digest);

    expect(md).toContain('## Review Activity This Period');
    expect(md).not.toContain('## KB Health');
    expect(md).toContain('**Items modified:** +24');
    expect(md).toContain('**Items verified:** +12');
    expect(md).toContain('**Items flagged:** +3');
    expect(md).toContain(
      '**Freshness:** 30 fresh, 8 aging, 3 stale, 1 expired',
    );
  });

  it('should format zero deltas without plus sign', () => {
    const digest = makeDigest({
      governance_summary: {
        items_modified: 0,
        items_verified: 0,
        items_flagged: 0,
      },
    });
    const md = digestToMarkdown(digest);

    expect(md).toContain('**Items modified:** 0');
    expect(md).toContain('**Items verified:** 0');
    expect(md).toContain('**Items flagged:** 0');
  });

  it('should render item links when includeItemLinks and itemUrls are provided', () => {
    const digest = makeDigest();
    const md = digestToMarkdown(digest, {
      includeItemLinks: true,
      itemUrls: {
        'item-1': 'https://example.com/items/item-1',
        'item-3': 'https://example.com/items/item-3',
      },
    });

    // item-1 should be a link
    expect(md).toContain(
      '[Claude Code goes GA](https://example.com/items/item-1)',
    );
    // item-2 has no URL mapping, so should be bold
    expect(md).toContain('**OpenAI Agents SDK**');
    // item-3 should also be a link
    expect(md).toContain(
      '[Enterprise AI Playbook](https://example.com/items/item-3)',
    );
  });

  it('should render bold titles when includeItemLinks is false even with itemUrls', () => {
    const digest = makeDigest();
    const md = digestToMarkdown(digest, {
      includeItemLinks: false,
      itemUrls: {
        'item-1': 'https://example.com/items/item-1',
      },
    });

    // Should NOT be a link
    expect(md).not.toContain('[Claude Code goes GA]');
    // Should be bold
    expect(md).toContain('**Claude Code goes GA**');
  });

  it('should omit narrative summary section when narrative_summary is null', () => {
    const digest = makeDigest({ narrative_summary: null });
    const md = digestToMarkdown(digest);

    expect(md).not.toContain('## Overview');
  });

  it('should handle empty domain summaries', () => {
    const digest = makeDigest({
      domain_summaries: [],
      theme_clusters: [],
    });
    const md = digestToMarkdown(digest);

    // Should still have the title and metadata — now "Change Report"
    expect(md).toContain('# Weekly Change Report:');
    expect(md).toContain('*42 items |');

    // Should not have any domain or theme sections
    expect(md).not.toContain('### Top Items');
    expect(md).not.toContain('## Cross-Domain Themes');
  });

  it('should handle domain with no top items and no key themes', () => {
    const digest = makeDigest({
      domain_summaries: [
        {
          domain: 'CORPORATE',
          item_count: 2,
          summary: 'Personal reflections.',
          top_items: [],
          key_themes: [],
        },
      ],
    });
    const md = digestToMarkdown(digest);

    expect(md).toContain('## CORPORATE (2 items)');
    expect(md).toContain('Personal reflections.');
    // No top items or themes sections
    expect(md).not.toContain('### Top Items');
    expect(md).not.toContain('*Themes:');
  });

  it('should handle daily digest type label', () => {
    const digest = makeDigest({ digest_type: 'daily' });
    const md = digestToMarkdown(digest);

    expect(md).toContain('# Daily Change Report:');
  });

  it('should handle custom digest type label', () => {
    const digest = makeDigest({ digest_type: 'custom' });
    const md = digestToMarkdown(digest);

    expect(md).toContain('# Custom Change Report:');
  });

  it('should handle unknown digest type label gracefully', () => {
    const digest = makeDigest({ digest_type: 'monthly' });
    const md = digestToMarkdown(digest);

    expect(md).toContain('# Change Report:');
  });

  it('should not contain trailing whitespace on content lines', () => {
    const digest = makeDigest();
    const md = digestToMarkdown(digest);
    const lines = md.split('\n');

    for (const line of lines) {
      if (line.length > 0) {
        expect(line).toBe(line.trimEnd());
      }
    }
  });

  it('should handle null theme_clusters', () => {
    const digest = makeDigest({
      theme_clusters: null as unknown as undefined,
    });
    const md = digestToMarkdown(digest);

    expect(md).toContain('# Weekly Change Report:');
    expect(md).not.toContain('## Cross-Domain Themes');
  });

  it('should handle domain_summaries with missing top_items field', () => {
    const digest = makeDigest({
      domain_summaries: [
        {
          domain: 'SECURITY',
          item_count: 5,
          summary: 'Updates in AI.',
          top_items: undefined as unknown as [],
          key_themes: ['AI'],
        },
      ],
    });
    const md = digestToMarkdown(digest);

    expect(md).toContain('## SECURITY (5 items)');
    expect(md).toContain('Updates in AI.');
  });
});
