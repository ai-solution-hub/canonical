// __tests__/lib/intelligence/content-type-update.test.ts
//
// SI-L3 regression suite: every value returned by inferContentType() must be
// in VALID_CONTENT_TYPES (the canonical list also enforced by the
// content_items_valid_content_type CHECK constraint, now in the squashed
// migration 20260416102457_pre_squash_reconciliation.sql).
//
// VALID_CONTENT_TYPES is the single source of truth on the application side
// (lib/validation/schemas.ts). The DB CHECK constraint mirrors it. If
// inferContentType() ever returns a value outside that list, this test fails
// and the operator can fix the divergence before any silent prod failures.
//
// We use VALID_CONTENT_TYPES as a deterministic proxy for the DB constraint
// to keep the test fast and offline. The DB-side check is exercised by the
// migration plus the constraint definition test below (which inspects the
// migration file content).

/* eslint-disable @typescript-eslint/no-explicit-any -- mock supabase clients require flexible typing */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  inferContentType,
  processFeedSource,
} from '@/lib/intelligence/pipeline';
import { VALID_CONTENT_TYPES } from '@/lib/validation/schemas';

// Mock all pipeline dependencies (mirrors __tests__/lib/intelligence/pipeline.test.ts)
vi.mock('@/lib/intelligence/feed-poller', () => ({
  pollFeed: vi.fn(),
}));
vi.mock('@/lib/intelligence/content-extractor', () => ({
  extractContent: vi.fn(),
  normaliseUrl: vi.fn((url: string) => url),
  checkFirecrawlApiKey: vi.fn(),
}));
vi.mock('@/lib/intelligence/relevance-scorer', () => ({
  embeddingPreFilter: vi.fn(),
  scoreRelevance: vi.fn(),
}));
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn(),
}));
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn(),
}));
vi.mock('@/lib/intelligence/article-summariser', () => ({
  generateArticleSummary: vi
    .fn()
    .mockResolvedValue('A concise article summary.'),
}));

/**
 * (domain, subtopic) -> expected inferred type. Each row exercises one branch
 * of inferContentType(). Together they cover every distinct return value the
 * function can produce.
 */
const inferenceCases: Array<{
  name: string;
  domain: string | null;
  subtopic: string | null;
  expected: string;
}> = [
  // policy branch
  {
    name: 'policy keyword',
    domain: 'governance',
    subtopic: 'data-policy',
    expected: 'policy',
  },
  {
    name: 'regulation keyword',
    domain: 'governance',
    subtopic: 'gdpr-regulation',
    expected: 'policy',
  },
  {
    name: 'legislation keyword',
    domain: 'governance',
    subtopic: 'eu-legislation',
    expected: 'policy',
  },

  // case_study branch (must come before research per inferContentType ordering)
  {
    name: 'case-study with hyphen',
    domain: 'sectors',
    subtopic: 'nhs-case-study',
    expected: 'case_study',
  },
  {
    name: 'case_study with underscore',
    domain: 'sectors',
    subtopic: 'mod-case_study',
    expected: 'case_study',
  },

  // research branch
  {
    name: 'research keyword',
    domain: 'evidence',
    subtopic: 'health-research',
    expected: 'research',
  },
  {
    name: 'study keyword',
    domain: 'evidence',
    subtopic: 'cohort-study',
    expected: 'research',
  },
  {
    name: 'analysis keyword',
    domain: 'evidence',
    subtopic: 'gap-analysis',
    expected: 'research',
  },

  // compliance branch
  {
    name: 'compliance keyword',
    domain: 'governance',
    subtopic: 'iso-compliance',
    expected: 'compliance',
  },
  {
    name: 'audit keyword',
    domain: 'governance',
    subtopic: 'security-audit',
    expected: 'compliance',
  },

  // certification branch
  {
    name: 'certification keyword',
    domain: 'governance',
    subtopic: 'cyber-essentials-certification',
    expected: 'certification',
  },
  {
    name: 'accreditation keyword',
    domain: 'governance',
    subtopic: 'ukas-accreditation',
    expected: 'certification',
  },

  // methodology branch
  {
    name: 'methodology in domain',
    domain: 'methodology',
    subtopic: 'agile',
    expected: 'methodology',
  },
  {
    name: 'methodology in subtopic',
    domain: 'delivery',
    subtopic: 'lean-methodology',
    expected: 'methodology',
  },
];

describe('SI-L3: inferContentType() outputs must match VALID_CONTENT_TYPES', () => {
  it.each(inferenceCases)(
    '$name -> $expected is in VALID_CONTENT_TYPES',
    ({ domain, subtopic, expected }) => {
      const result = inferContentType(domain, subtopic);
      expect(result).toBe(expected);
      expect(VALID_CONTENT_TYPES).toContain(
        result as (typeof VALID_CONTENT_TYPES)[number],
      );
    },
  );

  it('returns null when neither domain nor subtopic provided', () => {
    expect(inferContentType(null, null)).toBeNull();
  });

  it('returns null for an unrecognised subtopic (stays as article)', () => {
    expect(inferContentType('news', 'general-update')).toBeNull();
  });

  it('every distinct return value is a member of VALID_CONTENT_TYPES', () => {
    const distinctReturns = new Set(inferenceCases.map((c) => c.expected));
    for (const value of distinctReturns) {
      expect(VALID_CONTENT_TYPES).toContain(
        value as (typeof VALID_CONTENT_TYPES)[number],
      );
    }
    // Sanity: we covered all 6 distinct branches.
    expect(distinctReturns.size).toBe(6);
    expect(distinctReturns).toEqual(
      new Set([
        'policy',
        'case_study',
        'research',
        'compliance',
        'certification',
        'methodology',
      ]),
    );
  });
});

describe('SI-L3: pipeline content_type update logs errors on DB rejection', () => {
  it('logs an error and does NOT throw when supabase update returns an error', async () => {
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    const { extractContent } =
      await import('@/lib/intelligence/content-extractor');
    const { embeddingPreFilter, scoreRelevance } =
      await import('@/lib/intelligence/relevance-scorer');
    const { classifyContent } = await import('@/lib/ai/classify');

    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'src-1',
      status: 'success',
      items: [
        {
          title: 'Research piece',
          url: 'https://example.com/research-1',
          guid: 'g-1',
          publishedAt: '2026-04-01T10:00:00Z',
          summary: 'Summary',
          contentEncoded: null,
          categories: [],
        },
      ],
      etag: null,
      lastModified: null,
    });

    vi.mocked(extractContent).mockResolvedValue({
      content: 'Long content '.repeat(100),
      title: 'Research piece',
      description: 'Summary',
      thumbnailUrl: null,
      method: 'fetch',
      wordCount: 200,
    });

    vi.mocked(embeddingPreFilter).mockResolvedValue({
      similarity: 0.9,
      passed: true,
    });
    vi.mocked(scoreRelevance).mockResolvedValue({
      score: 0.8,
      category: 'high',
      reasoning: 'Highly relevant',
      matchedCategories: ['research'],
      passed: true,
    });
    vi.mocked(classifyContent).mockResolvedValue({
      primary_domain: 'evidence',
      primary_subtopic: 'cohort-study',
      secondary_domain: null,
      secondary_subtopic: null,
      confidence: 0.9,
      reasoning: 'mocked',
    } as any);

    // Capture all .from(...) chained operations
    const fromCalls: Array<{ table: string; op: string; payload?: unknown }> =
      [];

    // Each .from() call returns a fresh chain object so distinct call sites
    // (insert vs select vs update) don't share mock state.
    const makeChain = (table: string): any => {
      const chain: any = {};

      // Track whether select was called with content_type fields (for the
      // post-classification re-read path).
      let selectFields: string | null = null;

      chain.select = vi.fn((fields: string) => {
        selectFields = fields;
        return chain;
      });
      chain.eq = vi.fn(() => chain);
      chain.is = vi.fn(() => chain);
      chain.limit = vi.fn(() => chain);
      chain.then = (resolve: any) => resolve({ data: [], error: null });
      // S184 WP1: `storeAsContentItem` now queries by `source_url`
      // (existence check for D3 M2M) and `content_item_workspaces`
      // (junction pre-check) via `.maybeSingle()`. Default = no match.
      chain.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      chain.single = vi.fn(() => {
        // The post-classification re-read selects content_type, primary_domain,
        // primary_subtopic. Return a classified row to trigger inferContentType.
        if (
          table === 'content_items' &&
          selectFields &&
          selectFields.includes('content_type')
        ) {
          return Promise.resolve({
            data: {
              content_type: 'article',
              primary_domain: 'evidence',
              primary_subtopic: 'cohort-study',
            },
            error: null,
          });
        }
        // domain_metadata fetch on workspaces table
        return Promise.resolve({ data: null, error: null });
      });

      chain.update = vi.fn((payload: any) => {
        fromCalls.push({ table, op: 'update', payload });
        // updateChain supports both `.eq().eq()` chaining and being awaited
        // (PostgREST builders are thenable). Each eq returns the same chain.
        const isContentTypeUpdate =
          table === 'content_items' &&
          'content_type' in (payload as Record<string, unknown>);

        const resolved = isContentTypeUpdate
          ? {
              error: {
                message:
                  'new row for relation "content_items" violates check constraint "content_items_valid_content_type"',
                code: '23514',
              },
            }
          : { error: null };

        const updateChain: any = {
          eq: vi.fn(() => updateChain),
          // Make the chain awaitable (thenable)
          then: (resolve: any) => resolve(resolved),
        };
        return updateChain;
      });

      chain.insert = vi.fn((payload: any) => {
        fromCalls.push({ table, op: 'insert', payload });
        // For content_items insert, return chain that supports .select().single()
        const insertChain: any = {
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({ data: { id: 'item-1' }, error: null }),
            ),
          })),
          // Direct await for tables like feed_articles where the code does
          // `const { error } = await supabase.from(...).insert(...)`
          then: (resolve: any) => resolve({ error: null }),
        };
        return insertChain;
      });

      chain.upsert = vi.fn(() => Promise.resolve({ error: null }));
      return chain;
    };

    const mockSupabase: any = {
      from: vi.fn((table: string) => makeChain(table)),
    };

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const source = {
      id: 'src-1',
      workspace_id: 'ws-1',
      name: 'Research Feed',
      url: 'https://example.com/feed.atom',
      etag: null,
      last_modified: null,
      polling_interval_minutes: 30,
      consecutive_failures: 0,
      article_count: 0,
    };

    const companyContext = {
      name: 'Acme',
      sectors: ['Health'],
      services: ['Research'],
      keyTopics: ['cohort'],
      targetCustomers: 'NHS',
      valueProposition: 'Insight at scale',
    };

    // Should NOT throw — the content_type update error is a soft failure
    const result = await processFeedSource(
      mockSupabase,
      source,
      companyContext,
      [0.1, 0.2, 0.3],
    );

    // The pipeline should still report the article as passed even though
    // the content_type refinement failed (soft failure).
    expect(result.articlesPassed).toBe(1);
    expect(result.articlesFailed).toBe(0);

    // Verify the error was logged with diagnostic detail
    const errorMessages = consoleErrorSpy.mock.calls
      .map((args) => args.map(String).join(' '))
      .join('\n');

    expect(errorMessages).toContain('SI-L3: content_type update failed');
    expect(errorMessages).toContain('inferred: "research"');
    expect(errorMessages).toContain('domain: "evidence"');
    expect(errorMessages).toContain('subtopic: "cohort-study"');
    expect(errorMessages).toContain('item-1');

    // Verify the update was actually attempted with the inferred type
    const contentTypeUpdate = fromCalls.find(
      (c) =>
        c.table === 'content_items' &&
        c.op === 'update' &&
        typeof c.payload === 'object' &&
        c.payload !== null &&
        'content_type' in (c.payload as Record<string, unknown>),
    );
    expect(contentTypeUpdate).toBeDefined();
    expect(
      (contentTypeUpdate?.payload as Record<string, unknown>).content_type,
    ).toBe('research');

    consoleErrorSpy.mockRestore();
  });
});

describe('SI-L3: migration file enforces canonical CHECK constraint', () => {
  // Guard test: if anyone weakens or removes the constraint, this fails.
  // Post-squash: the constraint is inline in the CREATE TABLE statement
  // within the squashed pg_dump file.
  const migrationPath = join(
    process.cwd(),
    'supabase/migrations/20260416102457_pre_squash_reconciliation.sql',
  );

  it('migration file exists', () => {
    expect(() => readFileSync(migrationPath, 'utf-8')).not.toThrow();
  });

  it('contains the canonical content_type constraint name', () => {
    const sql = readFileSync(migrationPath, 'utf-8');
    // Post-squash: the pg_dump format includes the constraint inline
    // in the CREATE TABLE rather than as a separate DROP+ADD pair.
    expect(sql).toMatch(/content_items_valid_content_type/i);
  });

  it('constraint includes all VALID_CONTENT_TYPES', () => {
    const sql = readFileSync(migrationPath, 'utf-8');
    // Confirm the constraint is present
    expect(sql).toMatch(/content_items_valid_content_type/i);
    // Confirm every canonical type appears in the SQL body
    for (const type of VALID_CONTENT_TYPES) {
      expect(sql).toContain(`'${type}'`);
    }
  });
});
