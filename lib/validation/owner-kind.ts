/**
 * ID-151 — shared `owner_kind` / `cited_kind` polymorphism-discriminator
 * types. Bounded type-hardening (bl-412): these columns previously had only a
 * DB CHECK/enum backstop, with every TS call site typing the value as bare
 * `string` — this module is the single source of compile-time safety for them.
 *
 * A runtime Zod enum is exported for ONE domain only (`FacetOwnerKindSchema`),
 * because only that column takes a value from a request body. ID-151 originally
 * shipped a Zod enum per domain because its goal line specified "type + Zod
 * enum" uniformly; the other two had no untrusted input to validate and were
 * removed once that was measured.
 *
 * `owner_kind` is a `text` column + CHECK constraint PER TABLE — NOT a pg
 * enum (there is no `Database['public']['Enums']['...']` slot for it;
 * every generated Row/Insert/Update shape types it as bare `string`). The
 * CHECK constraint is the only source of truth, and — critically — the
 * value set DIFFERS per table. A single flat cross-table union would let a
 * call site pass a value invalid for its specific table (e.g.
 * `form_question` where only `verification_history`'s
 * {source_document, q_a_pair} is valid), which defeats the point of
 * hardening. So this module deliberately keeps the domains SEPARATE rather
 * than forcing a shared superset:
 *
 * - `FacetOwnerKind` — `record_lifecycle` + `verification_history`. These
 *   two tables share the IDENTICAL 2-value domain by design
 *   (`verification_history_owner_kind_chk` mirrors
 *   `record_lifecycle_owner_kind_chk` exactly — ID-152 migration comment).
 *   `reference_item` is deliberately EXCLUDED from both (BI-19).
 * - `RecordEmbeddingsOwnerKind` — `record_embeddings` only. Its own wider,
 *   independently-maintained CHECK; NOT type-derived from `FacetOwnerKind`
 *   even though its value set is a superset, because the two CHECKs are
 *   allowed to evolve independently (widening one must not silently widen
 *   what's valid for the other).
 *
 * `cited_kind` (`citations.cited_kind`) IS a real pg enum
 * (`cited_target_kind`) — `Database['public']['Enums']['cited_target_kind']`
 * already gives compile-time safety at typed Row/Insert/Update call sites
 * (the existing convention this module follows for the owner_kind
 * unions' shape). `CitedKind` here is a module-local alias for that enum;
 * `DraftCitedKind` — the one exported `cited_kind` type — narrows it to the
 * two grains a form-response citation may target.
 *
 * A correction worth keeping: an earlier revision claimed `satisfies` made a
 * future `ALTER TYPE ... ADD VALUE` "drift loudly". It does not. `satisfies
 * readonly CitedKind[]` is a SUBSET check — measured, adding a bogus label
 * fails, but REMOVING a real one passes silently, and an added enum label
 * leaves any subset still valid. Do not rely on it as an exhaustiveness
 * alarm; it only pins the labels named here to labels that really exist.
 */
import type { Database } from '@/supabase/types/database.types';
import { z } from 'zod';

// ── record_lifecycle + verification_history: shared 2-value facet domain ──
// Source of truth (hand-transcribed — CHECK constraints, not generated
// types): `record_lifecycle_owner_kind_chk` in
// supabase/migrations/20260628190000_id131_record_lifecycle_facet.sql and
// `verification_history_owner_kind_chk` in
// supabase/migrations/20260716123000_id152_verification_history_polymorphic.sql
// (ID-152, this lane — mirrors record_lifecycle exactly, same comment
// there). Update BOTH this array and the cited migration file's CHECK in
// lockstep if the domain ever changes.
//
// NOTE: no runtime Zod enum is exported for `record_embeddings.owner_kind` or
// for `cited_kind`. Neither column has an untrusted-input path — every write
// site passes one of our own literals, held by the unions below — so a runtime
// validator would have nothing to validate. `FacetOwnerKindSchema` exists
// precisely because its column DOES take a request-body value
// (`ReviewActionBodySchema`, lib/validation/schemas.ts).
const FACET_OWNER_KIND_VALUES = ['source_document', 'q_a_pair'] as const;
export type FacetOwnerKind = (typeof FACET_OWNER_KIND_VALUES)[number];
export const FacetOwnerKindSchema = z.enum(FACET_OWNER_KIND_VALUES);

// ── record_embeddings: its own, wider, independently-maintained domain ──
// Source of truth: `record_embeddings_owner_kind_chk` in
// supabase/migrations/20260712066000_id145_form_question_embedding_owner_kind.sql
// (latest widening — ID-145 {145.29} added `form_question`). Deliberately
// NOT derived from FacetOwnerKind (see module doc above).
// Declared as a union rather than `typeof [...] [number]`: with no runtime
// validator left, an array here would be a value nothing evaluates.
export type RecordEmbeddingsOwnerKind =
  | 'source_document'
  | 'content_chunk'
  | 'q_a_pair'
  | 'reference_item'
  | 'concept'
  | 'company_profile'
  | 'form_template_requirement'
  | 'form_question';

// ── citations.cited_kind: real pg enum (cited_target_kind) — precedent ──
// `content_item` is RETIRED (id-131 M6) but the enum label itself was
// never dropped (`ALTER TYPE ... DROP VALUE` has no cheap path) — legacy
// pre-M6 rows can still carry it, so it stays in the value set for
// read-side exhaustiveness (mirrors `CitationTargetKind` in
// app/api/source-documents/[id]/citations/route.ts, which narrows this
// same enum to the 4 LIVE-WRITABLE kinds for that route's own use case —
// left as-is, not re-pointed here, since it is itself already the
// convention this module follows).
type CitedKind = Database['public']['Enums']['cited_target_kind'];

/**
 * The two grains a FORM-RESPONSE citation can target ({131.16} BI-29: matched
 * drafting content is a `q_a_pair` or an optional `reference_item`, never a
 * `content_item`). Narrower than `CitedKind` on purpose — the wider enum still
 * admits retired and non-drafting labels.
 *
 * The `MustBeCitedKind` constraint ties both labels back to the pg enum, so
 * renaming or dropping either one fails compilation HERE rather than at the
 * first bad INSERT. Note what it does NOT catch: a label ADDED to the enum
 * leaves this a valid subset and stays silent — correct for a type whose job
 * is to be a deliberate subset, but not a general drift alarm. What DOES catch
 * a widened set is `citedTargetForDraftItem`'s `never` arm, which stops
 * compiling the moment this union grows a third member.
 */
type MustBeCitedKind<T extends CitedKind> = T;
export type DraftCitedKind = MustBeCitedKind<'q_a_pair' | 'reference_item'>;
