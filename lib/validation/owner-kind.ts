/**
 * ID-151 — shared `owner_kind` / `cited_kind` polymorphism-discriminator
 * types + Zod enums. Bounded type-hardening (bl-412): these columns
 * previously had only a DB CHECK/enum backstop, with every TS call site
 * typing the value as bare `string` — this module is the single source of
 * compile-time (TS union) + runtime (Zod enum) safety for them.
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
 * unions' shape). `CitedKind` here is a stable, non-generated import point
 * for that same enum, plus a Zod runtime validator — tied back to the DB
 * enum via `satisfies` so a future `ALTER TYPE ... ADD VALUE` drifts loudly.
 */
import type { Database } from '@/supabase/types/database.types';
import { z } from 'zod';

// ── record_lifecycle + verification_history: shared 2-value facet domain ──
// Source of truth (hand-transcribed — CHECK constraints, not generated
// types): `record_lifecycle_owner_kind_chk` in
// supabase/migrations/20260628190000_id131_record_lifecycle_facet.sql and
// `verification_history_owner_kind_chk` in
// supabase/migrations/20260716120000_id152_verification_history_polymorphic.sql
// (ID-152, this lane — mirrors record_lifecycle exactly, same comment
// there). Update BOTH this array and the cited migration file's CHECK in
// lockstep if the domain ever changes.
const FACET_OWNER_KIND_VALUES = ['source_document', 'q_a_pair'] as const;
export type FacetOwnerKind = (typeof FACET_OWNER_KIND_VALUES)[number];
export const FacetOwnerKindSchema = z.enum(FACET_OWNER_KIND_VALUES);

// ── record_embeddings: its own, wider, independently-maintained domain ──
// Source of truth: `record_embeddings_owner_kind_chk` in
// supabase/migrations/20260712066000_id145_form_question_embedding_owner_kind.sql
// (latest widening — ID-145 {145.29} added `form_question`). Deliberately
// NOT derived from FacetOwnerKind (see module doc above).
const RECORD_EMBEDDINGS_OWNER_KIND_VALUES = [
  'source_document',
  'content_chunk',
  'q_a_pair',
  'reference_item',
  'concept',
  'company_profile',
  'form_template_requirement',
  'form_question',
] as const;
export type RecordEmbeddingsOwnerKind =
  (typeof RECORD_EMBEDDINGS_OWNER_KIND_VALUES)[number];
export const RecordEmbeddingsOwnerKindSchema = z.enum(
  RECORD_EMBEDDINGS_OWNER_KIND_VALUES,
);

// ── citations.cited_kind: real pg enum (cited_target_kind) — precedent ──
// `content_item` is RETIRED (id-131 M6) but the enum label itself was
// never dropped (`ALTER TYPE ... DROP VALUE` has no cheap path) — legacy
// pre-M6 rows can still carry it, so it stays in the value set for
// read-side exhaustiveness (mirrors `CitationTargetKind` in
// app/api/source-documents/[id]/citations/route.ts, which narrows this
// same enum to the 4 LIVE-WRITABLE kinds for that route's own use case —
// left as-is, not re-pointed here, since it is itself already the
// convention this module follows).
export type CitedKind = Database['public']['Enums']['cited_target_kind'];
const CITED_KIND_VALUES = [
  'content_item',
  'q_a_pair',
  'reference_item',
  'source_document',
  'concept',
] as const satisfies readonly CitedKind[];
export const CitedKindSchema = z.enum(CITED_KIND_VALUES);
