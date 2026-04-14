import { describe, it, expect } from 'vitest';
import {
  jaccardSimilarity,
  domainDistribution,
  domainDeltas,
  cosineSimilarity,
} from '@/scripts/compare-quality';

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('returns 1 for two empty sets', () => {
    expect(jaccardSimilarity(new Set<string>(), new Set<string>())).toBe(1);
  });

  it('computes intersection over union', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 4, 10);
  });

  it('is symmetric', () => {
    const a = new Set(['x', 'y']);
    const b = new Set(['y', 'z', 'w']);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(jaccardSimilarity(b, a), 10);
  });
});

describe('domainDistribution', () => {
  it('counts each primary_domain once per item', () => {
    const items = [
      mkSnapshot({ id: '1', primary_domain: 'policy' }),
      mkSnapshot({ id: '2', primary_domain: 'policy' }),
      mkSnapshot({ id: '3', primary_domain: 'finance' }),
    ];
    const dist = domainDistribution(items);
    expect(dist.get('policy')).toBe(2);
    expect(dist.get('finance')).toBe(1);
  });

  it('buckets null domains under "(unclassified)"', () => {
    const items = [
      mkSnapshot({ id: '1', primary_domain: null }),
      mkSnapshot({ id: '2', primary_domain: null }),
    ];
    const dist = domainDistribution(items);
    expect(dist.get('(unclassified)')).toBe(2);
  });
});

describe('domainDeltas', () => {
  it('surfaces domains losing > 10%', () => {
    const oldDist = new Map([
      ['policy', 100],
      ['finance', 50],
    ]);
    const newDist = new Map([
      ['policy', 80],
      ['finance', 55],
    ]);
    const deltas = domainDeltas(oldDist, newDist);
    const policyDelta = deltas.find((d) => d.domain === 'policy');
    expect(policyDelta?.deltaPct).toBeCloseTo(-0.2, 5);
    const financeDelta = deltas.find((d) => d.domain === 'finance');
    expect(financeDelta?.deltaPct).toBeCloseTo(0.1, 5);
  });

  it('handles new domains appearing (old count 0)', () => {
    const oldDist = new Map<string, number>();
    const newDist = new Map([['emerging', 10]]);
    const deltas = domainDeltas(oldDist, newDist);
    expect(deltas[0].oldCount).toBe(0);
    expect(deltas[0].newCount).toBe(10);
    expect(deltas[0].deltaPct).toBe(Infinity);
  });

  it('handles domains disappearing entirely', () => {
    const oldDist = new Map([['deprecated', 5]]);
    const newDist = new Map<string, number>();
    const deltas = domainDeltas(oldDist, newDist);
    expect(deltas[0].deltaPct).toBeCloseTo(-1, 5);
  });
});

describe('cosineSimilarity (compare-quality copy)', () => {
  it('matches the embedding-smoke-test copy on identical inputs', () => {
    expect(cosineSimilarity([0.3, 0.4], [0.3, 0.4])).toBeCloseTo(1, 10);
  });
});

function mkSnapshot(overrides: Partial<ContentSnapshotLike>): ContentSnapshotLike {
  return {
    id: 'id',
    title: 'title',
    content_type: 'article',
    source_url: null,
    content_length: 100,
    primary_domain: null,
    primary_subtopic: null,
    classification_confidence: null,
    ai_keywords: null,
    embedding: null,
    entity_count: 0,
    summary_length: null,
    word_count: 20,
    chunk_count: 1,
    created_at: '2026-01-01T00:00:00Z',
    freshness: null,
    ...overrides,
  };
}

interface ContentSnapshotLike {
  id: string;
  title: string;
  content_type: string;
  source_url: string | null;
  content_length: number;
  primary_domain: string | null;
  primary_subtopic: string | null;
  classification_confidence: number | null;
  ai_keywords: string[] | null;
  embedding: number[] | null;
  entity_count: number;
  summary_length: number | null;
  word_count: number;
  chunk_count: number;
  created_at: string;
  freshness: string | null;
}
