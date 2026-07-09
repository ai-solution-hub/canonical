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

/**
 * A single ontology-grounded related record (ID-135 {135.20}) — the
 * §9-DROPPED `find_related_items` REPLACEMENT design. Grounded in
 * concept/entity CO-MEMBERSHIP, NOT embedding similarity — this is neither
 * the old IMS `find_related_items` (dropped in id-131, carried none of its 6
 * columns forward) nor a similarity/score-ranked result.
 *
 * Deliberately mirrors `CorpusResultBase`'s shape (`id`/`kind`/`title`
 * only) so the SAME `kind`-derived link-destination convention (BI-14)
 * applies here too — there is no separate route/destination field that
 * could disagree with `kind`, so mis-routing a related record is
 * unrepresentable.
 *
 * BI-3 (AI-invisible infrastructure): no score/similarity/model/profile
 * field — relatedness is surfaced as plain "related", never
 * "AI-suggested".
 *
 * This is the TARGET contract shape for the id-131/id-133 ontology-grounded
 * related-records RPC, which is NOT YET SHIPPED (a Task-level dependency).
 * `components/corpus-search/corpus-related-records.tsx` designs its fetcher
 * boundary against this shape today with a MOCKED (empty-set) read; once the
 * real RPC ships, only that fetcher's body needs to change — this type and
 * the hook/component public surface stay stable.
 */
export interface RelatedRecord {
  id: string;
  kind: CorpusKind;
  title: string;
}
