/**
 * Corpus-search discriminated-union display shape (ID-135 {135.5}).
 *
 * The stable internal contract Surface A (corpus search/browse) and
 * Surface B (source_document detail) build against — decoupled from the
 * in-flight {131.11} polymorphic search API shape (`PolymorphicSearchResult`
 * over `record_embeddings`). The read boundary in `useCorpusSearch`
 * reconciles field names onto this union at read time (TECH §5).
 *
 * BI-3 (AI-invisible infrastructure): no score/similarity/model/profile
 * field appears on ANY variant — neither surface displays similarity
 * scores, embedding/model names, or ranking-profile internals.
 *
 * BI-14 (polymorphic id resolution): every variant carries its own `id`,
 * and the link destination is derived from `kind` alone — there is no
 * separate route/destination field that could disagree with `kind`, so
 * mis-routing is unrepresentable.
 */
export type CorpusKind = 'answer' | 'document' | 'reference';

interface CorpusResultBase {
  id: string;
  kind: CorpusKind;
  title: string;
}

export type CorpusSearchResult =
  | (CorpusResultBase & {
      // answer (q_a_pair) → links into /library for single-pair read/edit.
      kind: 'answer';
      answerSnippet: string;
      scopeTags: string[];
      primaryDomain: string | null;
      primarySubtopic: string | null;
    })
  | (CorpusResultBase & {
      // document (source_document) → links into /documents/[id] (Surface B).
      kind: 'document';
      summary: string | null;
      primaryDomain: string | null;
      primarySubtopic: string | null;
    })
  | (CorpusResultBase & {
      // reference (reference_item) → links out to /reference/[id].
      kind: 'reference';
      sourceUrl: string | null;
    });

/**
 * Surface A's reduced metadata filter set (BI-16) — domain / subtopic /
 * date, applied on top of a query to narrow the merged multi-grain result
 * list. Every field is optional; an empty object is a valid "no filters"
 * state (the default).
 */
export interface CorpusSearchFilters {
  domain?: string;
  subtopic?: string;
  dateFrom?: string;
  dateTo?: string;
}
