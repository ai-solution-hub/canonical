import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  CorpusKind,
  CorpusSearchResult,
  CorpusSearchFilters,
} from '@/types/corpus-search';
import { queryKeys } from '@/lib/query/query-keys';

/**
 * `keyof` distributed over the union — the set of every field name that
 * appears on ANY variant. Used to assert no scoring/ranking field leaks into
 * the display shape (BI-3), regardless of which variant carries it.
 */
type KeysOf<U> = U extends unknown ? keyof U : never;
type AllCorpusSearchResultKeys = KeysOf<CorpusSearchResult>;

/**
 * Test-only exhaustive narrowing helper — mirrors the destination-routing
 * decision each variant is responsible for (BI-14: mis-routing is
 * unrepresentable because the destination is derived from `kind`, not a
 * separate field that could disagree with it). A missing `case` here would
 * fail to compile, so this doubles as a closed-union check.
 */
function linkTargetFor(result: CorpusSearchResult): string {
  switch (result.kind) {
    case 'answer':
      return '/library';
    case 'document':
      return `/documents/${result.id}`;
    case 'reference':
      return `/reference/${result.id}`;
  }
}

const answer: CorpusSearchResult = {
  id: 'answer-1',
  kind: 'answer',
  title: 'What is VAT registration?',
  answerSnippet: 'VAT registration is required once turnover exceeds...',
  scopeTags: ['tax'],
  primaryDomain: 'finance',
  primarySubtopic: 'vat',
};

const document: CorpusSearchResult = {
  id: 'document-1',
  kind: 'document',
  title: 'Supplier terms.pdf',
  summary: 'Standard supplier terms and conditions.',
  primaryDomain: 'procurement',
  primarySubtopic: 'contracts',
};

const reference: CorpusSearchResult = {
  id: 'reference-1',
  kind: 'reference',
  title: 'GOV.UK — VAT registration',
  sourceUrl: 'https://www.gov.uk/vat-registration',
};

describe('CorpusSearchResult discriminated union', () => {
  it('narrows to the answer variant and resolves the /library link target', () => {
    expect(linkTargetFor(answer)).toBe('/library');
    if (answer.kind === 'answer') {
      expect(answer.answerSnippet).toContain('VAT');
      expect(answer.scopeTags).toEqual(['tax']);
      expect(answer.primaryDomain).toBe('finance');
      expect(answer.primarySubtopic).toBe('vat');
    }
  });

  it('narrows to the document variant and resolves the /documents/[id] link target', () => {
    expect(linkTargetFor(document)).toBe(`/documents/${document.id}`);
    if (document.kind === 'document') {
      expect(document.summary).toBe('Standard supplier terms and conditions.');
      expect(document.primaryDomain).toBe('procurement');
      expect(document.primarySubtopic).toBe('contracts');
    }
  });

  it('narrows to the reference variant and resolves the /reference/[id] link target', () => {
    expect(linkTargetFor(reference)).toBe(`/reference/${reference.id}`);
    if (reference.kind === 'reference') {
      expect(reference.sourceUrl).toBe('https://www.gov.uk/vat-registration');
    }
  });

  it('allows a null sourceUrl on the reference variant', () => {
    const referenceWithoutUrl: CorpusSearchResult = {
      id: 'reference-2',
      kind: 'reference',
      title: 'A reference with no captured source URL',
      sourceUrl: null,
    };
    expect(linkTargetFor(referenceWithoutUrl)).toBe(
      `/reference/${referenceWithoutUrl.id}`,
    );
  });

  it('allows null primaryDomain/primarySubtopic/summary on the document variant', () => {
    const unclassifiedDocument: CorpusSearchResult = {
      id: 'document-2',
      kind: 'document',
      title: 'Unclassified upload.pdf',
      summary: null,
      primaryDomain: null,
      primarySubtopic: null,
    };
    expect(linkTargetFor(unclassifiedDocument)).toBe(
      `/documents/${unclassifiedDocument.id}`,
    );
  });

  it('every variant carries its own id, so mis-routing is unrepresentable (BI-14)', () => {
    for (const result of [answer, document, reference]) {
      expect(typeof result.id).toBe('string');
      expect(result.id.length).toBeGreaterThan(0);
    }
  });

  it('exposes no score/similarity/model/profile field on any variant at runtime (BI-3)', () => {
    for (const result of [answer, document, reference]) {
      expect(result).not.toHaveProperty('score');
      expect(result).not.toHaveProperty('similarity');
      expect(result).not.toHaveProperty('model');
      expect(result).not.toHaveProperty('profile');
    }
  });

  it('exposes no score/similarity/model/profile field on any variant at the type level (BI-3)', () => {
    type Banned = 'score' | 'similarity' | 'model' | 'profile';
    type Overlap = Extract<AllCorpusSearchResultKeys, Banned>;
    expectTypeOf<Overlap>().toEqualTypeOf<never>();
  });

  it('rejects an answer result missing its required answerSnippet field', () => {
    // @ts-expect-error — answerSnippet is required on the 'answer' variant
    const incomplete: CorpusSearchResult = {
      id: 'answer-3',
      kind: 'answer',
      title: 'Missing snippet',
    };
    void incomplete;
  });

  it('rejects a kind outside the closed CorpusKind union', () => {
    const bad: CorpusSearchResult = {
      id: 'x',
      // @ts-expect-error — 'chunk' is not a member of CorpusKind
      kind: 'chunk',
      title: 'Not a real kind',
    };
    void bad;
  });
});

describe('CorpusKind', () => {
  it('is exactly the closed union answer | document | reference', () => {
    expectTypeOf<CorpusKind>().toEqualTypeOf<
      'answer' | 'document' | 'reference'
    >();
  });
});

describe('CorpusSearchFilters', () => {
  it('accepts an empty filter set — every field is optional', () => {
    const empty: CorpusSearchFilters = {};
    expect(empty).toEqual({});
  });

  it('accepts a domain/subtopic/date filter combination', () => {
    const filters: CorpusSearchFilters = {
      domain: 'finance',
      subtopic: 'vat',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
    };
    expect(filters).toEqual({
      domain: 'finance',
      subtopic: 'vat',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
    });
  });
});

describe('queryKeys.corpusSearch (new namespace)', () => {
  it('exposes a stable `all` root key', () => {
    expect(queryKeys.corpusSearch.all).toEqual(['corpus-search']);
  });

  it('search() returns a stable key incorporating query, kind, and filters', () => {
    const filters: CorpusSearchFilters = { domain: 'finance' };
    const key1 = queryKeys.corpusSearch.search('vat', 'answer', filters);
    const key2 = queryKeys.corpusSearch.search('vat', 'answer', filters);
    expect(key1).toEqual(key2);
    expect(key1[0]).toBe('corpus-search');
  });

  it('search() differentiates keys when the query, kind, or filters differ', () => {
    const base = queryKeys.corpusSearch.search('vat', 'answer', {});
    const differentQuery = queryKeys.corpusSearch.search('paye', 'answer', {});
    const differentKind = queryKeys.corpusSearch.search('vat', 'document', {});
    const differentFilters = queryKeys.corpusSearch.search('vat', 'answer', {
      domain: 'finance',
    });

    expect(base).not.toEqual(differentQuery);
    expect(base).not.toEqual(differentKind);
    expect(base).not.toEqual(differentFilters);
  });

  it('search() accepts an undefined kind (ALL-grain default scope)', () => {
    const key = queryKeys.corpusSearch.search('vat', undefined, {});
    expect(key[0]).toBe('corpus-search');
  });
});

describe('queryKeys.sourceDocuments (extended members)', () => {
  it('detail() returns a stable, correctly-shaped key', () => {
    const key1 = queryKeys.sourceDocuments.detail('doc-1');
    const key2 = queryKeys.sourceDocuments.detail('doc-1');
    expect(key1).toEqual(key2);
    expect(key1).toEqual(['source-documents', 'detail', 'doc-1']);
  });

  it('versions() returns a stable, correctly-shaped key', () => {
    const key1 = queryKeys.sourceDocuments.versions('doc-1');
    const key2 = queryKeys.sourceDocuments.versions('doc-1');
    expect(key1).toEqual(key2);
    expect(key1).toEqual(['source-documents', 'versions', 'doc-1']);
  });

  it('citations() returns a stable, correctly-shaped key', () => {
    const key1 = queryKeys.sourceDocuments.citations('doc-1');
    const key2 = queryKeys.sourceDocuments.citations('doc-1');
    expect(key1).toEqual(key2);
    expect(key1).toEqual(['source-documents', 'citations', 'doc-1']);
  });

  it('derivedPairs() returns a stable, correctly-shaped key', () => {
    const key1 = queryKeys.sourceDocuments.derivedPairs('doc-1');
    const key2 = queryKeys.sourceDocuments.derivedPairs('doc-1');
    expect(key1).toEqual(key2);
    expect(key1).toEqual(['source-documents', 'derived-pairs', 'doc-1']);
  });

  it('the existing sourceDocuments members remain byte-identical (additive-only edit)', () => {
    expect(queryKeys.sourceDocuments.all).toEqual(['source-documents']);
    expect(queryKeys.sourceDocuments.diff('doc-1')).toEqual([
      'source-documents',
      'diff',
      'doc-1',
    ]);
    expect(queryKeys.sourceDocuments.history('doc-1')).toEqual([
      'source-documents',
      'history',
      'doc-1',
    ]);
    expect(queryKeys.sourceDocuments.sourceFiles).toEqual([
      'source-documents',
      'source-files',
    ]);
  });
});
