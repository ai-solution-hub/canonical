import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  jaccardSimilarity,
  domainDistribution,
  domainDeltas,
  cosineSimilarity,
  computePairStats,
  readSnapshot,
  snapshotPairKey,
  userTagDimStatus,
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

describe('computePairStats entity Jaccard', () => {
  it('returns 0 when canonical_name sets are disjoint even with identical counts', () => {
    const oldItem = mkSnapshot({
      id: 'same',
      canonical_names: ['Apple', 'Microsoft', 'Google'],
    });
    const newItem = mkSnapshot({
      id: 'same',
      canonical_names: ['Oracle', 'Meta', 'IBM'],
    });
    const oldMap = new Map([['same', oldItem]]);
    const newMap = new Map([['same', newItem]]);
    const stats = computePairStats(oldMap, newMap);
    expect(stats).toHaveLength(1);
    expect(stats[0].entityJaccard).toBe(0);
  });

  it('returns 1 when canonical_name sets are identical', () => {
    const names = ['Apple', 'Microsoft'];
    const oldMap = new Map([
      ['same', mkSnapshot({ id: 'same', canonical_names: names })],
    ]);
    const newMap = new Map([
      ['same', mkSnapshot({ id: 'same', canonical_names: [...names] })],
    ]);
    const stats = computePairStats(oldMap, newMap);
    expect(stats[0].entityJaccard).toBe(1);
  });

  it('returns null when both sets are empty', () => {
    const oldMap = new Map([['same', mkSnapshot({ id: 'same' })]]);
    const newMap = new Map([['same', mkSnapshot({ id: 'same' })]]);
    const stats = computePairStats(oldMap, newMap);
    expect(stats[0].entityJaccard).toBeNull();
  });
});

describe('userTagDimStatus', () => {
  it('returns N/A when old has zero user tags and new has any', () => {
    // Net-gain case: re-ingestion produced user_tags where the baseline
    // had none. Not a regression — there is nothing to "preserve".
    expect(userTagDimStatus(0, 221, NaN, 0)).toBe('N/A');
  });

  it('returns N/A when no paired items have a Jaccard score', () => {
    expect(userTagDimStatus(10, 10, NaN, 0)).toBe('N/A');
  });

  it('returns PASS when both populated and Jaccard equals 1.0', () => {
    expect(userTagDimStatus(50, 50, 1.0, 25)).toBe('PASS');
  });

  it('returns FAIL when both populated and Jaccard < 1.0', () => {
    expect(userTagDimStatus(50, 50, 0.85, 25)).toBe('FAIL');
  });

  it('returns FAIL on net-loss (old populated, new empty, paired items present)', () => {
    expect(userTagDimStatus(50, 0, 0, 25)).toBe('FAIL');
  });
});

describe('snapshotPairKey', () => {
  it('returns id under the id strategy', () => {
    expect(
      snapshotPairKey({ id: 'abc', title: 'X', content_type: 'article' }, 'id'),
    ).toBe('abc');
  });

  it('normalises title (trim + lowercase + collapsed ws) for composite key', () => {
    const key = snapshotPairKey(
      { id: 'abc', title: '  Hello   World  ', content_type: 'article' },
      'title+content_type',
    );
    expect(key).toBe('hello world|article');
  });

  it('distinguishes same title across content types', () => {
    const a = snapshotPairKey(
      { id: '1', title: 'Overview', content_type: 'article' },
      'title+content_type',
    );
    const b = snapshotPairKey(
      { id: '2', title: 'Overview', content_type: 'question_answer' },
      'title+content_type',
    );
    expect(a).not.toBe(b);
  });
});

describe('readSnapshot with composite pair key', () => {
  function writeJsonl(rows: Record<string, unknown>[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-quality-'));
    const p = path.join(dir, 'snap.jsonl');
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'));
    return p;
  }

  it('keys by id by default', () => {
    const p = writeJsonl([
      {
        id: 'a',
        title: 'T',
        content_type: 'article',
        content_length: 10,
        word_count: 2,
        heading_count: 0,
        chunk_count: 1,
        canonical_names: [],
        created_at: '2026-01-01',
        classification_confidence: null,
        primary_domain: null,
        primary_subtopic: null,
        summary_length: null,
        source_url: null,
        ai_keywords: null,
        user_tags: null,
        embedding: null,
        freshness: null,
      },
    ]);
    const { map, collisions, total } = readSnapshot(p, 'id');
    expect(map.has('a')).toBe(true);
    expect(collisions).toBe(0);
    expect(total).toBe(1);
  });

  it('pairs cross-project items sharing title + content_type', () => {
    const rowA = {
      id: 'OLD-1',
      title: 'How do you handle GDPR?',
      content_type: 'question_answer',
      content_length: 100,
      word_count: 20,
      heading_count: 0,
      chunk_count: 1,
      canonical_names: [],
      created_at: '2026-01-01',
      classification_confidence: 0.9,
      primary_domain: 'compliance',
      primary_subtopic: null,
      summary_length: null,
      source_url: null,
      ai_keywords: null,
      user_tags: null,
      embedding: null,
      freshness: null,
    };
    const rowB = { ...rowA, id: 'NEW-1' };
    const pOld = writeJsonl([rowA]);
    const pNew = writeJsonl([rowB]);
    const oldRead = readSnapshot(pOld, 'title+content_type');
    const newRead = readSnapshot(pNew, 'title+content_type');
    const pairs = computePairStats(oldRead.map, newRead.map);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].oldId).toBe('OLD-1');
    expect(pairs[0].newId).toBe('NEW-1');
    expect(pairs[0].pairKey).toBe('how do you handle gdpr?|question_answer');
  });

  it('reports collisions when multiple rows share the composite key', () => {
    const base = {
      title: 'Duplicate',
      content_type: 'article',
      content_length: 10,
      word_count: 2,
      heading_count: 0,
      chunk_count: 1,
      canonical_names: [],
      created_at: '2026-01-01',
      classification_confidence: null,
      primary_domain: null,
      primary_subtopic: null,
      summary_length: null,
      source_url: null,
      ai_keywords: null,
      user_tags: null,
      embedding: null,
      freshness: null,
    };
    const p = writeJsonl([
      { ...base, id: '1' },
      { ...base, id: '2' },
      { ...base, id: '3' },
    ]);
    const { map, collisions, total } = readSnapshot(p, 'title+content_type');
    expect(map.size).toBe(1);
    expect(collisions).toBe(2);
    expect(total).toBe(3);
  });
});

describe('computePairStats heading ratio', () => {
  it('derives headingRatio from new/old heading counts', () => {
    const oldMap = new Map([
      ['same', mkSnapshot({ id: 'same', heading_count: 10 })],
    ]);
    const newMap = new Map([
      ['same', mkSnapshot({ id: 'same', heading_count: 8 })],
    ]);
    const stats = computePairStats(oldMap, newMap);
    expect(stats[0].headingRatio).toBeCloseTo(0.8, 10);
  });

  it('returns null for headingRatio when old heading_count is 0', () => {
    const oldMap = new Map([
      ['same', mkSnapshot({ id: 'same', heading_count: 0 })],
    ]);
    const newMap = new Map([
      ['same', mkSnapshot({ id: 'same', heading_count: 5 })],
    ]);
    const stats = computePairStats(oldMap, newMap);
    expect(stats[0].headingRatio).toBeNull();
  });
});

function mkSnapshot(
  overrides: Partial<ContentSnapshotLike>,
): ContentSnapshotLike {
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
    user_tags: null,
    embedding: null,
    canonical_names: [],
    summary_length: null,
    word_count: 20,
    heading_count: 0,
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
  user_tags: string[] | null;
  embedding: number[] | null;
  canonical_names: string[];
  summary_length: number | null;
  word_count: number;
  heading_count: number;
  chunk_count: number;
  created_at: string;
  freshness: string | null;
}
