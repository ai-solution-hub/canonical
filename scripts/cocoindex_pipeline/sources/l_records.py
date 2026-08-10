"""The L-records Source adapter — ID-132 {132.4} G-SOURCE, the one bespoke
piece of the OKF concept producer (TECH.md §"The Source adapter over
L-records").

Implements the `Source` protocol — since ID-427 {427.4}, this repo's OWN
`sources/base.py` (which also hosts `ConceptKey`/`ConceptRaw`), itself a
native re-implementation of the reference_agent's external, never-vendored
`sources/base.py` ABC shape — over the
ID-131 typed L-records tables: `list_concepts()` / `read_concept(key)` are
the ABC-equivalent abstract methods; `sample_rows(key, n)` / `find(query)`
are the concrete helpers. **`read_concept_raw` is the agent-tool wrapper**
`producer/agent_loop.py` exposes to the Pass-1 tool-use loop ({132.5}) and
`enrich_concept` wires it onto `LRecordsSource.read_concept` at {132.8} —
NOT built here (TECH:164-166 is explicit that the adapter itself exposes
`read_concept`, never a `read_concept_raw` method).

Shape mirrors `scripts/cocoindex_pipeline/url_source.py` (structural
`runtime_checkable` protocol conformance, NO eager `cocoindex` import —
collection safety for the bare-MagicMock pipeline unit tests, TECH:41/135).
Unlike `url_source.py`'s `LiveMapView` snapshot-iterator shape (this module
is not `mount_each`-mounted the same way — {132.8}'s `enrich_concept`
component owns the `mount_each` wiring over `list_concepts()`), the `Source`
protocol is a structural mirror of the external reference_agent ABC, so a
future consumer can `isinstance()`-check any Source implementation without
importing cocoindex. **{427.4}:** that protocol was declared LOCALLY here
until `sources/base.py` was created to hold the one shared declaration —
`repo_docs.py` had been carrying a hand-synced duplicate of it.

Read posture (TECH §"Read-path posture"): direct Postgres on `public.*`,
the same connection posture `flow.py`'s `postgres` connector /
`mount_table_target` already use — NO `api.*` view dependency. The ID-115
schema-isolation boundary governs the supabase-js/PostgREST APP surface
only; a direct Python DB reader is out of its scope.

**Per-GRAIN table/join grid** (ID-427 {427.7}, TECH §1; was "per-concept-
type"). A grain is a declared object — `_BUILTIN_GRAINS` at the foot of this
module — carrying its own `directory`, `type_label`, enumeration, read and
sample. `ConceptKey.grain` is the dispatch key; `concept_type` is the emitted
LABEL and routes nothing. Two grains may emit the same label (both
`case_study` grains do), and relabelling a grain changes what the bundle says
without moving a file (PI-5). There is **no** ratified type set: {427.5}
deleted all four registries under DR-141, and `metric`/`playbook`/`dataset`
are ordinary free-form tags with no register behind them.

**A `q_a_pair` is NEVER enumerated as a concept** (BI-3) —
`ConceptKey.__post_init__` makes this a runtime invariant, not a convention,
and it is the one refusal that outlived the registers.

The rows below are named by the label each grain emits, which is how the
shipped bundle reads; the grain NAMES are in the registry.

| type            | `list_concepts()` grain                          | `read_concept()` joins |
|------------------|---------------------------------------------------|-------------------------|
| `topic`          | distinct `q_a_pairs.scope_tag` values (the domain/subtopic fallback grain retired S531 — DR-125 expiry ruled) | the q_a_pairs cluster + their `source_document_id` parents + `record_lifecycle` (both owner kinds) + `entity_mentions`/`entity_relationships` neighbourhood |
| `product`        | distinct `entity_mentions.canonical_name` where `entity_type='product'` | `source_documents` (filename/logical_path match) + product-scoped `q_a_pairs` |
| `company`        | singleton, iff a company-overview/team-structure `source_documents` row exists | `source_documents` (company-overview, team-structure) + the company `entity_mentions` graph |
| `certification`  | distinct `entity_mentions.canonical_name` where `entity_type='certification'` | `source_documents` (compliance) + the certification's own `entity_mentions` (by canonical_name, across all docs — external evidence) |
| `case_study`     | distinct named-client `entity_mentions.canonical_name` (`entity_type='organisation'`) mentioned in the named-clients doc, PLUS one per BUYER of a `won` procurement bid (S443 amendment / DR-029) | named-clients grain: `source_documents` (named-clients) + supporting `q_a_pairs`. won-bid grain (`key.form_instance_id` set): `derived_from_form_response` `q_a_pairs` (by `source_form_instance_id`, published-only) + the won `form_instances` row itself (`issuing_organisation`/`name`/`outcome_notes`) — see the {145.24} note below |

**Won-bid case_study grain (S443 amendment / DR-029; re-pointed {145.24}
post-{145.6} W1e).** A `won` procurement form is a first-class case_study
source. Originally (pre-ID-145) enumeration joined `workspaces` →
`application_types` (`key='procurement'`) → `form_templates`
(`outcome='won'`), and buyer identity/outcome_notes were split across a
`workspaces` row and a `form_templates` row. {145.6}'s W1e migration
wholesale-deletes every procurement `workspaces` row (R3/R10) and W1c drops
the `form_instances.workspace_id` column entirely — the join target is GONE, not merely
renamed, and `form_instances` is exclusively procurement's own table (no
`application_types` discriminator needed). Ground truth
(`supabase/migrations/20260712062000_id145_w1c_rename_reshape.sql`,
`…w1e_drop_workspace_stratum.sql`) shows every engagement fact the old
`workspaces` row supplied is ALREADY denormalised directly onto the form
(`form_instances.issuing_organisation`/`name` NOT NULL/`outcome`/
`outcome_notes`), so post-{145.6} enumeration reads `form_instances` alone —
no join, no `workspaces` fetch. The `q_a_pairs.source_workspace_id` column is
dropped in the same batch; its replacement lineage column is
`source_form_instance_id` (the renamed `source_form_template_id`).
`ConceptKey.form_instance_id` holds the won form's own `form_instances.id`,
not a `workspaces.id` — it was called `workspace_id` until **ID-427 {427.12}**
renamed it (closing id-358), which is why the SQL below aliases the same value
`form_instance_id` rather than the `workspace_id` it aliased before. Nothing
about the value or the BI-28 slot it feeds changed. This grain is
READ-ONLY against the `derived_from_form_response` q_a_pair write path
({131.28}, `b89ae76a`) — it never writes q_a_pairs or content_items. Buyer =
`COALESCE(issuing_organisation, name)` (falls back to the form's own
NOT-NULL `name` column now that there is no `workspaces.name` to fall back
to).

**Owner-discretion filename patterns.** `company`/`certification`/
`case_study` source_documents are located by filename/logical_path
substring match against the de-identified structure-file names PRODUCT.md
§"The first client's corpus" already names in the ratified spec
(`01-company-overview`, `05-team-structure-and-key-people`,
`07-compliance-governance-and-certifications`,
`04-named-clients-and-case-studies`) — no client name appears here. This is
the bespoke, PRODUCT-level judgement call TECH:162-163 flags as "the one
part that cannot be lifted, because it encodes *which records back which
concept type*"; a future Subtask may need to widen these patterns as the
real corpus is walked end-to-end.

**Built against fixtures, not a live DB** (per the {132.4} dispatch brief):
every query goes through the injected `pool` (an asyncpg-`Pool`-shaped
object exposing `async def fetch(query, *args)`, mirroring
`url_source.py`'s `FeedUrlSource` constructor contract) so this module is
fully exercisable against a `FakePool` test double — see
`scripts/tests/test_l_records_source.py`.
"""

from __future__ import annotations

from typing import (
    Any,
    Iterable,
    Mapping,
    Sequence,
)

# ID-427 {427.4}: the concept model + the `Source` protocol this adapter
# implements now live in the neutral `sources/base.py` (id-362 F1 leg 1) —
# `repo_docs.py` imports the SAME declarations, so the two adapters are no
# longer parallel implementations of one idea. {427.5} then deleted
# `CONCEPT_TYPES` and the {132.36} `_permit_overlay_concept_types` widener
# that had travelled with `ConceptKey`: with `concept_type` validated by
# shape rather than membership (DR-141) there is no gate left for a feeder
# config to widen. {427.7} adds the grain vocabulary and `mint_concept_slug`
# there too — both are format-level, not adapter-level, facts.
from scripts.cocoindex_pipeline.sources.base import (
    ConceptKey,
    ConceptRaw,
    Coverage,
    GrainEnumeration,
    GrainSpec,
    mint_concept_slug,
)

# Owner-discretion filename/logical_path substring patterns (ILIKE ANY),
# grounded in PRODUCT.md §"The first client's corpus" (already de-identified
# in the ratified spec — these are generic structure-file name fragments,
# never a client name).
_COMPANY_FILENAME_PATTERNS: tuple[str, ...] = (
    "%company-overview%",
    "%team-structure%",
)
_CERTIFICATION_FILENAME_PATTERNS: tuple[str, ...] = ("%compliance%",)
_CASE_STUDY_FILENAME_PATTERNS: tuple[str, ...] = ("%named-client%",)


# ── SQL — every query this adapter issues, named for the join grid row it
# serves. Every SELECT carries a deterministic ORDER BY so a concept's raw
# join result is reproducible across runs (matters for the bundle-writer's
# delta-only regeneration downstream, BI-18). ──────────────────────────────

_SQL_TOPIC_SCOPE_TAGS = (
    "SELECT DISTINCT unnest(scope_tag) AS scope_tag FROM q_a_pairs "
    "WHERE publication_status = 'published' AND scope_tag IS NOT NULL "
    "AND array_length(scope_tag, 1) > 0 ORDER BY 1"
)

_QA_COLUMNS = (
    "id, question_text, answer_standard, answer_advanced, scope_tag, "
    "anti_scope_tag, source_document_id, origin_kind, publication_status, "
    "valid_from, valid_to, created_at, updated_at"
)

_SQL_QA_BY_SCOPE_TAG = (
    f"SELECT {_QA_COLUMNS} FROM q_a_pairs "
    "WHERE scope_tag @> ARRAY[$1]::text[] AND publication_status = 'published' "
    "ORDER BY id"
)

_SQL_QA_BY_SOURCE_DOCS_OR_ENTITY = (
    f"SELECT {_QA_COLUMNS} FROM q_a_pairs "
    "WHERE (source_document_id = ANY($1::uuid[]) "
    "OR scope_tag @> ARRAY[$2]::text[]) "
    "AND publication_status = 'published' ORDER BY id"
)

# id-392 NOTE: `extracted_text` is a documented residual here — permanently
# NULL on the pipeline path (the body lives in content_chunks). It stays in
# the payload so pre-pivot rows keep their evidence text for the producer;
# retargeting this source to compose chunk bodies is pipeline-rebase-charter
# scope.
# DR-130 (DDL companion): the subject-classification family (primary_domain/
# primary_subtopic/secondary_domain/secondary_subtopic/summary/
# suggested_title) and source_url are DROPPED from source_documents — trimmed
# from this SELECT in the same deploy window. Concept payloads simply lose
# those keys (rows ride into ConceptRaw as opaque mappings; no keyed reads).
_SOURCE_DOCUMENT_COLUMNS = (
    "id, filename, logical_path, content_type, "
    "publication_status, extraction_method, "
    "extracted_text, created_at, updated_at"
)

_SQL_SOURCE_DOCUMENTS_BY_IDS = (
    f"SELECT {_SOURCE_DOCUMENT_COLUMNS} FROM source_documents "
    "WHERE id = ANY($1::uuid[]) ORDER BY id"
)

_SQL_SOURCE_DOCUMENTS_BY_FILENAME_PATTERNS = (
    f"SELECT {_SOURCE_DOCUMENT_COLUMNS} FROM source_documents "
    "WHERE filename ILIKE ANY($1::text[]) OR logical_path ILIKE ANY($1::text[]) "
    "ORDER BY id"
)

_SQL_SOURCE_DOCUMENT_EXISTS_BY_PATTERNS = (
    "SELECT id FROM source_documents "
    "WHERE filename ILIKE ANY($1::text[]) OR logical_path ILIKE ANY($1::text[]) "
    "LIMIT 1"
)

# DR-130 ruling (coordinator, from DR-124 + the DELETE-entirely frame): the
# producer's ri evidence legs retired with the ri↔sd join path (DR-124 —
# the join existed only because of the synthetic sd mint the unwind
# removed; a reference item is a standalone record with no sd). Reference
# re-entry into concept building is id-422's open question — do not re-key
# these reads mechanically. `_SQL_REFERENCE_ITEMS_BY_SOURCE_DOCS`, its
# fetch helper, the version-fingerprint ri terms, and every read method's
# ri leg are deleted; `ConceptRaw.reference_items` stays (always empty) as
# the enrich.py-facing seam id-422 may repopulate.

_SQL_RECORD_LIFECYCLE_FOR_OWNERS = (
    "SELECT id, owner_kind, source_document_id, q_a_pair_id, owner_id, "
    "domain, governance_review_status, governance_review_due, freshness, "
    "freshness_checked_at, lifecycle_type, expiry_date, next_review_date, "
    "created_at, updated_at FROM record_lifecycle "
    "WHERE (owner_kind = 'source_document' AND source_document_id = ANY($1::uuid[])) "
    "OR (owner_kind = 'q_a_pair' AND q_a_pair_id = ANY($2::uuid[])) ORDER BY id"
)

_SQL_ENTITY_MENTIONS_BY_SOURCE_DOCS = (
    "SELECT id, source_document_id, entity_type, entity_name, "
    "canonical_name, confidence, context_snippet, metadata, created_at "
    "FROM entity_mentions WHERE source_document_id = ANY($1::uuid[]) ORDER BY id"
)

_SQL_ENTITY_MENTIONS_BY_TYPE_AND_NAME = (
    "SELECT id, source_document_id, entity_type, entity_name, "
    "canonical_name, confidence, context_snippet, metadata, created_at "
    "FROM entity_mentions WHERE entity_type = $1 AND canonical_name = $2 "
    "ORDER BY id"
)

_SQL_ENTITY_RELATIONSHIPS_BY_SOURCE_DOCS = (
    "SELECT id, source_entity, relationship_type, target_entity, "
    "source_document_id, confidence, created_at FROM entity_relationships "
    "WHERE source_document_id = ANY($1::uuid[]) ORDER BY id"
)

_SQL_DISTINCT_ENTITY_CANONICAL_NAMES = (
    "SELECT DISTINCT canonical_name FROM entity_mentions "
    "WHERE entity_type = $1 ORDER BY 1"
)

_SQL_DISTINCT_CASE_STUDY_ENTITIES = (
    "SELECT DISTINCT em.canonical_name FROM entity_mentions em "
    "JOIN source_documents sd ON sd.id = em.source_document_id "
    "WHERE em.entity_type = 'organisation' "
    "AND (sd.filename ILIKE ANY($1::text[]) OR sd.logical_path ILIKE ANY($1::text[])) "
    "ORDER BY 1"
)

# ── won-bid case_study grain (S443 amendment / DR-029 / TECH G-SOURCE
# amendment; re-pointed {145.24} post-{145.6} W1e workspace-stratum drop).
# A `won` procurement form is a first-class case_study source. Enumeration:
# `form_instances` rows with `outcome = 'won'` — NO join to `workspaces`/
# `application_types`. Pre-{145.6}, this joined workspaces -> application_types
# -> form_templates (procurement-discriminated via apt.key); post-{145.6},
# form_instances IS exclusively procurement's own table (no other app_type
# writes it), so the discriminator join is gone along with the workspace
# stratum it discriminated. Buyer = COALESCE(issuing_organisation, name) —
# `form_instances.name` (NOT NULL since table creation, squash_baseline.sql)
# replaces the old `workspaces.name` fallback; `workspaces.domain_metadata`
# is no longer read at all (every procurement workspace row is wholesale
# DELETEd by W1e — there is nothing left to join to). ─────────────────────
_SQL_WON_BID_CASE_STUDIES = (
    "SELECT DISTINCT id AS form_instance_id, "
    "COALESCE(issuing_organisation, name) AS buyer "
    "FROM form_instances "
    "WHERE outcome = 'won' "
    "AND COALESCE(issuing_organisation, name) IS NOT NULL "
    "ORDER BY 2, 1"
)

# {145.24}: `_WORKSPACE_COLUMNS`/`_SQL_WORKSPACE_BY_ID` (a `SELECT ... FROM
# workspaces WHERE id = $1` fetch feeding `ConceptRaw.workspaces`) are REMOVED
# — W1e wholesale-deletes every procurement `workspaces` row, so this fetch
# would always return zero rows post-push; buyer identity/outcome_notes now
# come straight off the `form_instances` row itself (see
# `_SQL_WON_FORM_TEMPLATES_BY_FORM_INSTANCE` below). `ConceptRaw.workspaces`
# stays in the dataclass shape (structural stability for `enrich.py`'s
# `list(raw.workspaces)` — outside this Subtask's rename-blast-radius
# concern) but `_read_won_bid_case_study` now always populates it `[]`.

# Won-bid-provenance q_a_pairs (the {131.28} write path, origin_kind
# 'derived_from_form_response'), surfaced only once PROMOTED (published)
# through the DR-025 knowledge-admission gate — the same published-only read
# posture the topic/product grains take. Provenance columns
# (source_form_instance_id/source_form_response_id/source_question_id) are
# carried so downstream (BI-28 proposal shaping) keeps won-bid lineage.
# {145.24}: the `q_a_pairs.source_workspace_id` COLUMN is DROPPED by {145.6}
# W1c (STEP 5) — its replacement lineage column is `source_form_instance_id`
# (the renamed `source_form_template_id`), which already carries the same
# "which form" provenance the workspace column duplicated (ARCH-REVIEW §2 C8).
# Verified against Platform staging this pass ({427.12}): `q_a_pairs` exposes
# `source_form_instance_id` and no `source_workspace_id`.
_QA_WON_COLUMNS = (
    f"{_QA_COLUMNS}, source_form_instance_id, source_form_response_id, "
    "source_question_id"
)

_SQL_WON_BID_QA_BY_FORM_INSTANCE = (
    f"SELECT {_QA_WON_COLUMNS} FROM q_a_pairs "
    "WHERE source_form_instance_id = $1 "
    "AND origin_kind = 'derived_from_form_response' "
    "AND publication_status = 'published' ORDER BY id"
)

# {145.24}: table renamed form_templates -> form_instances; the
# `form_instances.workspace_id` COLUMN is DROPPED by W1c — `key.form_instance_id`
# (the ConceptKey locator, named `workspace_id` until {427.12} renamed it)
# carries the won form's own `form_instances.id`, so this filters on the form's
# OWN id rather than a workspace grouping id. A single row (0 or 1) in practice —
# `_SQL_WON_BID_CASE_STUDIES` already enumerates one row per won form.
_SQL_WON_FORM_TEMPLATES_BY_FORM_INSTANCE = (
    "SELECT id, name, form_type, outcome, outcome_notes, "
    "outcome_recorded_at, outcome_recorded_by, issuing_organisation, "
    "created_at, updated_at FROM form_instances "
    "WHERE id = $1 AND outcome = 'won' ORDER BY id"
)

# ── ID-132 {132.38} G-MEMO-DELTA — the `content_version` aggregate signal
# (MD-3/5/6/7, DR-060). One SET-BASED aggregate query per enumeration branch
# (never per-concept, MD-5), grouped by the SAME identity the enumeration
# query groups by, covering the SAME backing tables `read_concept` reads for
# that type (the MD-7 read grid). Every table in every read grid now carries
# `updated_at` — `q_a_pairs`/`source_documents`/
# `record_lifecycle`/`form_instances` always did; `entity_mentions`/
# `entity_relationships` gained it + an `ON UPDATE` trigger via the {132.40}
# migration (`20260716150000_id132_entity_updated_at.sql`, DR-060 OQ-MD-2) —
# so the aggregate is UNIFORMLY `count(*) + max(updated_at)` per table, no
# content-hash fallback needed anywhere (MD-7's original content-hash
# requirement for those two tables is SUPERSEDED). Terms are combined by
# `_combine_content_version` in FIXED table order (module-level constant per
# type) — deterministic, no wall-clock, no run timestamp (MD-6). ──────────


def _version_term(count: "int | None", max_ts: Any) -> str:
    """One table's `count(*) + max(updated_at)` term, rendered deterministic
    (`datetime.isoformat()` — never a wall-clock read; the value comes
    straight off the aggregate row). `count` is coerced to `0` and `max_ts`
    to `""` when a LEFT JOIN yields no matching rows for that table."""
    ts = max_ts.isoformat() if hasattr(max_ts, "isoformat") else (max_ts or "")
    return f"{count or 0}:{ts}"


def _combine_content_version(*terms: str) -> str:
    """Combine per-table `_version_term` strings, in the FIXED table order
    the caller supplies them, into one `ConceptKey.content_version` value."""
    return "|".join(terms)


# topic (MD-7 grid: q_a_pairs, source_documents, record_lifecycle,
# entity_mentions, entity_relationships — matches `_read_topic`'s assembly
# order; the reference_items leg retired with the ri<->sd join path, DR-124).
_SQL_TOPIC_SCOPE_TAG_VERSION = (
    "SELECT t.tag AS tag, "
    "count(DISTINCT qa.id) AS qa_count, max(qa.updated_at) AS qa_max, "
    "count(DISTINCT sd.id) AS sd_count, max(sd.updated_at) AS sd_max, "
    "count(DISTINCT rl.id) AS rl_count, max(rl.updated_at) AS rl_max, "
    "count(DISTINCT em.id) AS em_count, max(em.updated_at) AS em_max, "
    "count(DISTINCT er.id) AS er_count, max(er.updated_at) AS er_max "
    "FROM (SELECT DISTINCT unnest(scope_tag) AS tag FROM q_a_pairs "
    "WHERE publication_status = 'published' AND scope_tag IS NOT NULL "
    "AND array_length(scope_tag, 1) > 0) t "
    "JOIN q_a_pairs qa ON qa.scope_tag @> ARRAY[t.tag]::text[] "
    "AND qa.publication_status = 'published' "
    "LEFT JOIN source_documents sd ON sd.id = qa.source_document_id "
    "LEFT JOIN entity_mentions em ON em.source_document_id = sd.id "
    "LEFT JOIN entity_relationships er ON er.source_document_id = sd.id "
    "LEFT JOIN record_lifecycle rl ON "
    "(rl.owner_kind = 'source_document' AND rl.source_document_id = sd.id) "
    "OR (rl.owner_kind = 'q_a_pair' AND rl.q_a_pair_id = qa.id) "
    "GROUP BY t.tag ORDER BY t.tag"
)

# product (MD-7 grid: source_documents, q_a_pairs — matches
# `_read_product`'s assembly order; ri leg retired, DR-124), grouped by
# canonical_name.
_SQL_PRODUCT_VERSION = (
    "SELECT p.canonical_name AS canonical_name, "
    "count(DISTINCT sd.id) AS sd_count, max(sd.updated_at) AS sd_max, "
    "count(DISTINCT qa.id) AS qa_count, max(qa.updated_at) AS qa_max "
    "FROM (SELECT DISTINCT canonical_name FROM entity_mentions "
    "WHERE entity_type = $1) p "
    "LEFT JOIN source_documents sd ON "
    "sd.filename ILIKE ('%' || p.canonical_name || '%') "
    "OR sd.logical_path ILIKE ('%' || p.canonical_name || '%') "
    "LEFT JOIN q_a_pairs qa ON qa.source_document_id = sd.id "
    "OR qa.scope_tag @> ARRAY[p.canonical_name]::text[] "
    "GROUP BY p.canonical_name ORDER BY p.canonical_name"
)

# company (MD-7 grid: source_documents, entity_mentions — matches
# `_read_company`'s assembly order; ri leg retired, DR-124). Singleton — no
# GROUP BY.
_SQL_COMPANY_VERSION = (
    "SELECT count(DISTINCT sd.id) AS sd_count, max(sd.updated_at) AS sd_max, "
    "count(DISTINCT em.id) AS em_count, max(em.updated_at) AS em_max "
    "FROM source_documents sd "
    "LEFT JOIN entity_mentions em ON em.source_document_id = sd.id "
    "WHERE sd.filename ILIKE ANY($1::text[]) OR sd.logical_path ILIKE ANY($1::text[])"
)

# certification (MD-7 grid: source_documents, entity_mentions — matches
# `_read_certification`'s assembly order; ri leg retired, DR-124). The
# `source_documents` set is the SAME compliance-doc set for every
# certification (one shared term); `entity_mentions` is grouped by
# canonical_name (the certification's OWN mentions, across all docs —
# mirrors `_read_certification`).
_SQL_CERTIFICATION_SD_VERSION = (
    "SELECT count(DISTINCT sd.id) AS sd_count, max(sd.updated_at) AS sd_max "
    "FROM source_documents sd "
    "WHERE sd.filename ILIKE ANY($1::text[]) OR sd.logical_path ILIKE ANY($1::text[])"
)

_SQL_CERTIFICATION_ENTITY_MENTIONS_VERSION = (
    "SELECT canonical_name, count(*) AS em_count, max(updated_at) AS em_max "
    "FROM entity_mentions WHERE entity_type = $1 GROUP BY canonical_name ORDER BY 1"
)

# case_study, named-clients grain (MD-7 grid: source_documents, q_a_pairs —
# matches `_read_case_study`'s assembly order; ri leg retired, DR-124).
# Grouped by the SAME named-client `entity_mentions.canonical_name` the
# enumeration query (`_SQL_DISTINCT_CASE_STUDY_ENTITIES`) groups by;
# `source_documents` is the shared named-clients doc set, `q_a_pairs` is the
# per-entity union `_SQL_QA_BY_SOURCE_DOCS_OR_ENTITY` selects (shared docs OR
# this entity's scope_tag).
_SQL_CASE_STUDY_NAMED_CLIENT_VERSION = (
    "SELECT c.canonical_name AS canonical_name, "
    "count(DISTINCT sd.id) AS sd_count, max(sd.updated_at) AS sd_max, "
    "count(DISTINCT qa.id) AS qa_count, max(qa.updated_at) AS qa_max "
    "FROM (SELECT DISTINCT em.canonical_name FROM entity_mentions em "
    "JOIN source_documents sd0 ON sd0.id = em.source_document_id "
    "WHERE em.entity_type = 'organisation' "
    "AND (sd0.filename ILIKE ANY($1::text[]) OR sd0.logical_path ILIKE ANY($1::text[]))) c "
    "LEFT JOIN source_documents sd ON "
    "sd.filename ILIKE ANY($1::text[]) OR sd.logical_path ILIKE ANY($1::text[]) "
    "LEFT JOIN q_a_pairs qa ON qa.source_document_id = sd.id "
    "OR qa.scope_tag @> ARRAY[c.canonical_name]::text[] "
    "GROUP BY c.canonical_name ORDER BY c.canonical_name"
)

# case_study, won-bid grain (MD-7 grid: q_a_pairs, form_instances — matches
# `_read_won_bid_case_study`'s assembly order), grouped by the won form's own
# id (the `ConceptKey.form_instance_id` locator, {145.24}).
_SQL_WON_BID_CASE_STUDY_VERSION = (
    "SELECT w.form_instance_id AS form_instance_id, "
    "count(DISTINCT qa.id) AS qa_count, max(qa.updated_at) AS qa_max, "
    "count(DISTINCT fi.id) AS fi_count, max(fi.updated_at) AS fi_max "
    "FROM (SELECT DISTINCT id AS form_instance_id FROM form_instances "
    "WHERE outcome = 'won') w "
    "LEFT JOIN q_a_pairs qa ON qa.source_form_instance_id = w.form_instance_id "
    "AND qa.origin_kind = 'derived_from_form_response' "
    "AND qa.publication_status = 'published' "
    "LEFT JOIN form_instances fi ON fi.id = w.form_instance_id AND fi.outcome = 'won' "
    "GROUP BY w.form_instance_id ORDER BY w.form_instance_id"
)

def _dedupe_ids(ids: "Iterable[Any]") -> "list[Any]":
    """Order-independent, deterministic id dedup (sorted by string form so
    the result is stable whether `ids` carries `uuid.UUID` or `str` values —
    matters for reproducible `= ANY($1::uuid[])` args, mirroring
    `url_source.py`'s `dict.fromkeys` order-preserving-dedup precedent)."""
    return sorted(dict.fromkeys(ids), key=str)


def _concept_haystack(key: ConceptKey) -> str:
    return " ".join(
        v
        for v in (key.rel_path, key.scope_tag, key.entity_id)
        if v
    ).casefold()


class LRecordsSource:
    """cocoindex Source adapter over ID-131 L-records — NET-NEW, the
    producer's one bespoke piece (TECH §"The Source adapter over
    L-records"). Structurally conforms to `sources/base.py`'s shared
    `Source` protocol as `Source[ConceptKey, ConceptRaw]` ({427.4}); never
    imports `cocoindex` (collection safety, mirrors `url_source.py`).

    Constructed with the shared asyncpg-`Pool`-shaped object
    (`coco.use_context(DB_CTX)` at the producer's app_main call site, per
    `flow.py`'s existing convention) — the same `pool.fetch(query, *args)`
    contract `url_source.py`'s `FeedUrlSource` uses.

    `concept_feeder_config` (ID-132 {132.36} G-CONCEPT-FEEDER) is the
    optional, already-validated `{concept_type: {"grain": ..., "entity_
    type": ..., "directory": ...}, ...}` mapping `producer/bundle_writer.
    read_concept_feeder_config` reads from the client-authored
    `concept-feeder.json` — see that function's docstring for the schema.
    `None`/omitted (every pre-{132.36} call site) is exactly `{}` — zero
    behaviour change.

    **ID-427 {427.7}: every grain is a registry entry** (`_BUILTIN_GRAINS`
    below, plus one per feeder-config declaration). `read_concept` /
    `sample_rows` resolve `self._grains[key.grain]`; neither reads
    `concept_type` at all.
    """

    def __init__(
        self,
        pool: Any,
        *,
        concept_feeder_config: "Mapping[str, Mapping[str, str]] | None" = None,
    ) -> None:
        self._pool = pool
        # Trusts its shape (already validated by `read_concept_feeder_
        # config`'s file-reading call site — single source of truth for the
        # schema check, mirroring how `bundle_writer.write_bundle`'s
        # `client_ontology_overlay` kwarg trusts an explicitly-supplied
        # mapping rather than re-validating).
        self._concept_feeder_config: "Mapping[str, Mapping[str, str]]" = (
            concept_feeder_config or {}
        )
        self._feeder_entity_types: "dict[str, str]" = {}
        # Read as a module global (not captured at class-definition time) so
        # a caller — a test registering a grain, most importantly — extends
        # the registry and nothing else.
        self._grains: "dict[str, GrainSpec]" = {
            spec.name: spec
            for spec in (*_BUILTIN_GRAINS, *self._feeder_grains())
        }

    def _feeder_grains(self) -> "list[GrainSpec]":
        """ID-132 {132.36} G-CONCEPT-FEEDER, re-described by ID-427 {427.7}
        (TECH §2.7): a feeder entry is **a client-declared preferred-routing
        grain** — the same object as a built-in one, built from config
        instead of from a module constant. The half of {132.36} that widened
        the type gate died with the gate in {427.5}; this is the half that
        was always a grain.

        v1 supports exactly ONE grain strategy — `entity_mention` —
        deliberately: this module's own docstring already names the per-type
        join grid as "the one part that cannot be lifted, because it encodes
        *which records back which concept type*" (TECH:162-163); a generic
        client-authored SQL DSL would both contradict that judgement call and
        open a real query-injection surface. `entity_mention` generalises the
        EXISTING `product`/`certification` join pattern (a parametrised
        `entity_type`) — the one shape already proven safe and reusable.
        Adding a second strategy is a code change, not a config-time escape
        hatch."""
        grains: "list[GrainSpec]" = []
        for concept_type, grain_config in self._concept_feeder_config.items():
            strategy = grain_config["grain"]
            if strategy != "entity_mention":
                # Unreachable via the validated read path
                # (`producer/bundle_writer.read_concept_feeder_config`'s
                # closed grain enum) — guards a caller that constructs
                # `LRecordsSource` directly with an unvalidated
                # `concept_feeder_config`.
                raise ValueError(
                    f"unsupported concept-feeder grain {strategy!r} for "
                    f"concept type {concept_type!r}"
                )
            name = f"{_FEEDER_GRAIN_PREFIX}{concept_type}"
            self._feeder_entity_types[name] = grain_config["entity_type"]
            grains.append(
                GrainSpec(
                    name=name,
                    # TECH §2.7: `directory` is an explicit config key now
                    # that type and directory decouple. It defaults to the
                    # declared type name — `iri_projection.slug()` is
                    # identity on every shape-valid label ({427.5} measured
                    # it over 9,100), so "defaults to slug(type)" and
                    # "defaults to the type name" are the same string, and
                    # the pre-{427.7} `{concept_type}/` layout is preserved
                    # byte-for-byte.
                    directory=grain_config.get("directory") or concept_type,
                    type_label=concept_type,
                    list=lambda src, spec: src._list_feeder_grain(spec),
                    read=lambda src, spec, key: src._read_entity_pattern_grain(key),
                    sample=lambda src, spec, key, n: (
                        src._sample_entity_pattern_grain(key, n)
                    ),
                )
            )
        return grains

    async def _list_feeder_grain(self, spec: GrainSpec) -> GrainEnumeration:
        """A feeder grain's enumeration: the SAME `entity_mention` pass a
        built-in grain uses, parametrised by the `entity_type` its config
        declared. Looked up by the grain's NAME (never by its label — the
        label is relabellable, the dispatch key is not)."""
        return await self._list_entity_mention_grain_concepts(
            spec, self._feeder_entity_types[spec.name]
        )

    def grain_for(self, key: ConceptKey) -> GrainSpec:
        """The registered `GrainSpec` `key` routes to. PUBLIC: `producer/
        enrich.py`'s tool executor asks the grain what its `sample_rows`
        returns (`GrainSpec.sample_kind`) rather than re-deriving it from
        `concept_type`, which is how a fourth `concept_type` dispatcher
        used to live in that module."""
        spec = self._grains.get(key.grain)
        if spec is None:
            raise ValueError(
                f"unknown grain {key.grain!r} for concept {key.rel_path!r} — "
                f"registered grains: {sorted(self._grains)}"
            )
        # The locator-ownership rule that left `ConceptKey.__post_init__` in
        # {427.7}. It was `concept_type != 'case_study'` there, which a
        # `type_label` relabel would have turned into a spurious rejection
        # (PI-5). Keyed on the grain and held HERE, where the registry that
        # knows which grain declares the locator actually lives.
        if key.form_instance_id is not None and spec.name != WON_BID_GRAIN:
            raise ValueError(
                f"ConceptKey.form_instance_id is the {WON_BID_GRAIN!r} grain's "
                f"locator (S443 amendment / DR-029); it is set on "
                f"{key.rel_path!r}, which routes to grain {spec.name!r}"
            )
        return spec

    # ── list_concepts (abstract, base.py) ───────────────────────────────

    async def list_concepts(self) -> "list[ConceptKey]":
        """Enumerate the concept set by **iterating the grain registry** —
        the built-in grains plus any the client's `concept-feeder.json`
        declares (absent/`{}`: zero extra concepts).

        **Never enumerates a q_a_pair as a concept** (BI-3) — structurally
        guaranteed by `ConceptKey.__post_init__`'s unconditional `q_a_pair`
        check, in addition to no grain below ever constructing one.

        ID-427 {427.7}: this loop is the whole enumeration. A grain added to
        the registry is enumerated here with no edit to this method, which
        is the property whose absence produced the inversion.

        Each grain returns a `GrainEnumeration` carrying a `Coverage`, and
        this method currently **discards** it — the seam exists, nothing
        populates or reads it yet. {427.9} unions the coverages and reports
        the census; {427.10} runs the residual grain over the complement. Do
        not read today's empty `Coverage` as a measurement of what a grain
        reaches."""
        keys: "list[ConceptKey]" = []
        for spec in self._grains.values():
            enumeration = await spec.list(self, spec)
            keys.extend(enumeration.keys)
        return keys

    def _key(
        self,
        spec: GrainSpec,
        *,
        basename: str,
        **fields: Any,
    ) -> ConceptKey:
        """Mint one key FROM its grain: the directory and the type label are
        read off `spec`, never inlined. This is the mechanical reason a
        relabel cannot move a file (PI-5) and a re-homed grain cannot keep
        emitting the old label."""
        return ConceptKey(
            rel_path=f"{spec.directory}/{basename}.md",
            concept_type=spec.type_label,
            grain=spec.name,
            **fields,
        )

    async def _list_entity_mention_grain_concepts(
        self, spec: GrainSpec, entity_type: str
    ) -> GrainEnumeration:
        """The `entity_mention` grain's enumeration — reuses
        `_SQL_DISTINCT_ENTITY_CANONICAL_NAMES`/`_SQL_PRODUCT_VERSION`
        VERBATIM, parametrised by `entity_type` (both queries already take
        it as a bind parameter — no new SQL). Serves the built-in `product`
        grain and every feeder-declared grain alike: they differ only in
        their registry entry."""
        rows = await self._pool.fetch(
            _SQL_DISTINCT_ENTITY_CANONICAL_NAMES, entity_type
        )
        version_by_name = {
            row["canonical_name"]: _combine_content_version(
                _version_term(row.get("sd_count"), row.get("sd_max")),
                _version_term(row.get("qa_count"), row.get("qa_max")),
            )
            for row in await self._pool.fetch(_SQL_PRODUCT_VERSION, entity_type)
        }
        return GrainEnumeration(
            keys=tuple(
                self._key(
                    spec,
                    basename=mint_concept_slug(row["canonical_name"]),
                    entity_id=row["canonical_name"],
                    content_version=version_by_name.get(row["canonical_name"], ""),
                )
                for row in rows
            ),
            covers=Coverage(),
        )

    async def _list_topic_concepts(self, spec: GrainSpec) -> GrainEnumeration:
        """{132.38} MD-5: a set-based aggregate query populates
        `content_version` — grouped by the SAME key the enumeration uses,
        never a per-concept round-trip. (Scope_tag is the only topic grain
        since S531 — the domain/subtopic fallback branch retired under
        DR-125's expiry ruling.)"""
        keys: "list[ConceptKey]" = []
        scope_tag_rows = await self._pool.fetch(_SQL_TOPIC_SCOPE_TAGS)
        version_by_tag = {
            row["tag"]: _combine_content_version(
                _version_term(row.get("qa_count"), row.get("qa_max")),
                _version_term(row.get("sd_count"), row.get("sd_max")),
                _version_term(row.get("rl_count"), row.get("rl_max")),
                _version_term(row.get("em_count"), row.get("em_max")),
                _version_term(row.get("er_count"), row.get("er_max")),
            )
            for row in await self._pool.fetch(_SQL_TOPIC_SCOPE_TAG_VERSION)
        }
        for row in scope_tag_rows:
            tag = row["scope_tag"]
            keys.append(
                self._key(
                    spec,
                    basename=mint_concept_slug(tag),
                    scope_tag=tag,
                    content_version=version_by_tag.get(tag, ""),
                )
            )
        return GrainEnumeration(keys=tuple(keys), covers=Coverage())

    async def _list_company_concepts(self, spec: GrainSpec) -> GrainEnumeration:
        rows = await self._pool.fetch(
            _SQL_SOURCE_DOCUMENT_EXISTS_BY_PATTERNS, list(_COMPANY_FILENAME_PATTERNS)
        )
        if not rows:
            return GrainEnumeration()
        version_rows = await self._pool.fetch(
            _SQL_COMPANY_VERSION, list(_COMPANY_FILENAME_PATTERNS)
        )
        content_version = (
            _combine_content_version(
                _version_term(version_rows[0].get("sd_count"), version_rows[0].get("sd_max")),
                _version_term(version_rows[0].get("em_count"), version_rows[0].get("em_max")),
            )
            if version_rows
            else ""
        )
        return GrainEnumeration(
            keys=(
                self._key(
                    spec, basename="overview", content_version=content_version
                ),
            ),
            covers=Coverage(),
        )

    async def _list_certification_concepts(self, spec: GrainSpec) -> GrainEnumeration:
        """{132.38} MD-7: `source_documents` is the SAME shared
        compliance-doc set for every certification (one un-grouped
        aggregate; the ri leg retired with DR-124); `entity_mentions` is the
        certification's OWN mentions, grouped by `canonical_name` (mirrors
        `_read_certification`)."""
        rows = await self._pool.fetch(
            _SQL_DISTINCT_ENTITY_CANONICAL_NAMES, "certification"
        )
        sd_version_rows = await self._pool.fetch(
            _SQL_CERTIFICATION_SD_VERSION, list(_CERTIFICATION_FILENAME_PATTERNS)
        )
        shared_term = (
            _version_term(
                sd_version_rows[0].get("sd_count"), sd_version_rows[0].get("sd_max")
            )
            if sd_version_rows
            else _version_term(0, None)
        )
        em_by_name = {
            row["canonical_name"]: _version_term(row.get("em_count"), row.get("em_max"))
            for row in await self._pool.fetch(
                _SQL_CERTIFICATION_ENTITY_MENTIONS_VERSION, "certification"
            )
        }
        return GrainEnumeration(
            keys=tuple(
                self._key(
                    spec,
                    basename=mint_concept_slug(row["canonical_name"]),
                    entity_id=row["canonical_name"],
                    content_version=_combine_content_version(
                        shared_term,
                        em_by_name.get(row["canonical_name"], _version_term(0, None)),
                    ),
                )
                for row in rows
            ),
            covers=Coverage(),
        )

    async def _list_case_study_concepts(self, spec: GrainSpec) -> GrainEnumeration:
        rows = await self._pool.fetch(
            _SQL_DISTINCT_CASE_STUDY_ENTITIES, list(_CASE_STUDY_FILENAME_PATTERNS)
        )
        version_by_name = {
            row["canonical_name"]: _combine_content_version(
                _version_term(row.get("sd_count"), row.get("sd_max")),
                _version_term(row.get("qa_count"), row.get("qa_max")),
            )
            for row in await self._pool.fetch(
                _SQL_CASE_STUDY_NAMED_CLIENT_VERSION, list(_CASE_STUDY_FILENAME_PATTERNS)
            )
        }
        return GrainEnumeration(
            keys=tuple(
                self._key(
                    spec,
                    basename=mint_concept_slug(row["canonical_name"]),
                    entity_id=row["canonical_name"],
                    content_version=version_by_name.get(row["canonical_name"], ""),
                )
                for row in rows
            ),
            covers=Coverage(),
        )

    async def _list_won_bid_case_study_concepts(
        self, spec: GrainSpec
    ) -> GrainEnumeration:
        """The won-bid case_study grain (S443 amendment / DR-029): one
        case_study per BUYER of a won procurement bid. The rows arrive ordered
        by (buyer, form_instance_id), so deduping by buyer keeps the earliest
        won form instance deterministically — a single case study per buyer
        (BI-2), even when a buyer has won multiple bids. Additive to the
        named-clients grain. {132.38} MD-7: `content_version` is grouped by
        the won form's own id (the `form_instance_id` locator).

        Shares `directory` with the named-clients grain for now, so the
        {132.29} write-time redirect still applies — **{427.8}** is the
        subtask that gives this grain `case-studies/won-bid` of its own and
        deletes the redirect."""
        rows = await self._pool.fetch(_SQL_WON_BID_CASE_STUDIES)
        version_by_form_instance = {
            row["form_instance_id"]: _combine_content_version(
                _version_term(row.get("qa_count"), row.get("qa_max")),
                _version_term(row.get("fi_count"), row.get("fi_max")),
            )
            for row in await self._pool.fetch(_SQL_WON_BID_CASE_STUDY_VERSION)
        }
        keys: "list[ConceptKey]" = []
        seen_buyers: "set[str]" = set()
        for row in rows:
            buyer = row["buyer"]
            if buyer in seen_buyers:
                continue
            seen_buyers.add(buyer)
            keys.append(
                self._key(
                    spec,
                    basename=mint_concept_slug(buyer),
                    entity_id=buyer,
                    content_version=version_by_form_instance.get(
                        row["form_instance_id"], ""
                    ),
                    form_instance_id=row["form_instance_id"],
                )
            )
        return GrainEnumeration(keys=tuple(keys), covers=Coverage())

    # ── read_concept (abstract, base.py) ────────────────────────────────

    async def read_concept(self, key: ConceptKey) -> ConceptRaw:
        """Run `key`'s grain's read and return the raw backing rows.

        ID-427 {427.7}: this was a five-way `concept_type` cascade with a
        nested `form_instance_id` sub-branch (TECH §1's dispatcher 1 of three).
        It is now a registry lookup — a new grain reaches its own read with
        no edit here."""
        spec = self.grain_for(key)
        return await spec.read(self, spec, key)

    async def _topic_qa_rows(
        self, key: ConceptKey, *, limit: "int | None" = None
    ) -> "list[Mapping[str, Any]]":
        if key.scope_tag is None:
            raise ValueError(
                "a topic ConceptKey needs scope_tag set (BI-8 locator "
                f"contract; sole topic grain since S531); got {key!r}"
            )
        sql, args = _SQL_QA_BY_SCOPE_TAG, [key.scope_tag]
        if limit is not None:
            sql = f"{sql} LIMIT ${len(args) + 1}"
            args = [*args, limit]
        return await self._pool.fetch(sql, *args)

    async def _source_documents_by_ids(
        self, ids: "Sequence[Any]"
    ) -> "list[Mapping[str, Any]]":
        if not ids:
            return []
        return await self._pool.fetch(_SQL_SOURCE_DOCUMENTS_BY_IDS, list(ids))

    async def _entity_mentions_by_source_docs(
        self, ids: "Sequence[Any]"
    ) -> "list[Mapping[str, Any]]":
        if not ids:
            return []
        return await self._pool.fetch(_SQL_ENTITY_MENTIONS_BY_SOURCE_DOCS, list(ids))

    async def _entity_relationships_by_source_docs(
        self, ids: "Sequence[Any]"
    ) -> "list[Mapping[str, Any]]":
        if not ids:
            return []
        return await self._pool.fetch(
            _SQL_ENTITY_RELATIONSHIPS_BY_SOURCE_DOCS, list(ids)
        )

    async def _source_documents_by_patterns(
        self, patterns: "Sequence[str]"
    ) -> "list[Mapping[str, Any]]":
        """The shared "filename/logical_path pattern match" source_documents
        read. Every grain that uses it hands in its OWN patterns.

        ID-427 {427.7} — TECH §1's dispatcher 2 of three. This was
        `_source_documents_for_key(key)`, a five-way `concept_type` cascade
        that chose the patterns *for* the caller and raised a `ValueError`
        naming `topic` in its else-arm. TECH §3 specifies it "takes
        `patterns`"; once it does, `key` is unread, so the parameter goes
        with the cascade rather than surviving as a vestige — the name
        follows. `topic` still never calls it (it derives source_documents
        from its q_a_pairs cluster's parents, `_read_topic`), but that is
        now a fact about which grains declare patterns, not a branch to
        maintain here."""
        return await self._pool.fetch(
            _SQL_SOURCE_DOCUMENTS_BY_FILENAME_PATTERNS, list(patterns)
        )

    async def _read_topic(self, key: ConceptKey) -> ConceptRaw:
        qa_rows = await self._topic_qa_rows(key)
        sd_ids = _dedupe_ids(
            row["source_document_id"]
            for row in qa_rows
            if row.get("source_document_id") is not None
        )
        qa_ids = [row["id"] for row in qa_rows]
        sd_rows = await self._source_documents_by_ids(sd_ids)
        rl_rows = await self._pool.fetch(
            _SQL_RECORD_LIFECYCLE_FOR_OWNERS, sd_ids, qa_ids
        )
        em_rows = await self._entity_mentions_by_source_docs(sd_ids)
        er_rows = await self._entity_relationships_by_source_docs(sd_ids)
        return ConceptRaw(
            q_a_pairs=qa_rows,
            source_documents=sd_rows,
            record_lifecycle=rl_rows,
            entity_mentions=em_rows,
            entity_relationships=er_rows,
        )

    async def _read_entity_pattern_grain(self, key: ConceptKey) -> ConceptRaw:
        """The read shared by the `product` grain and every `entity_mention`
        feeder grain: source_documents whose filename/logical_path matches
        the entity's own canonical name, plus the q_a_pairs those documents
        parent OR that carry the entity as a scope_tag.

        {427.7} folds `_read_product` and `_read_feeder_concept` together.
        They were byte-identical bodies behind two names, which is the same
        parallel-implementation defect {427.4} retired for the `Source`
        protocol; a feeder grain was never a different read, only a
        different registry entry."""
        sd_rows = await self._source_documents_by_patterns([f"%{key.entity_id}%"])
        sd_ids = [row["id"] for row in sd_rows]
        qa_rows = await self._pool.fetch(
            _SQL_QA_BY_SOURCE_DOCS_OR_ENTITY, sd_ids, key.entity_id
        )
        return ConceptRaw(source_documents=sd_rows, q_a_pairs=qa_rows)

    async def _read_company(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_by_patterns(
            _COMPANY_FILENAME_PATTERNS
        )
        sd_ids = [row["id"] for row in sd_rows]
        em_rows = await self._entity_mentions_by_source_docs(sd_ids)
        return ConceptRaw(source_documents=sd_rows, entity_mentions=em_rows)

    async def _read_certification(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_by_patterns(
            _CERTIFICATION_FILENAME_PATTERNS
        )
        em_rows = await self._pool.fetch(
            _SQL_ENTITY_MENTIONS_BY_TYPE_AND_NAME, "certification", key.entity_id
        )
        return ConceptRaw(source_documents=sd_rows, entity_mentions=em_rows)

    async def _read_case_study(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_by_patterns(
            _CASE_STUDY_FILENAME_PATTERNS
        )
        sd_ids = [row["id"] for row in sd_rows]
        qa_rows = await self._pool.fetch(
            _SQL_QA_BY_SOURCE_DOCS_OR_ENTITY, sd_ids, key.entity_id
        )
        return ConceptRaw(source_documents=sd_rows, q_a_pairs=qa_rows)

    async def _read_won_bid_case_study(self, key: ConceptKey) -> ConceptRaw:
        """The won-bid case_study grain read (S443 amendment / DR-029, TECH
        G-SOURCE amendment; re-pointed {145.24} post-{145.6} W1e): won-bid-
        provenance `q_a_pairs` (the {131.28} `derived_from_form_response`
        write path, once promoted/published through the DR-025 admission
        gate, keyed by `source_form_instance_id`) + the won `form_instances`
        row itself (`issuing_organisation`/`name`/`outcome_notes`).

        No `workspaces` fetch: {145.6} W1e wholesale-deletes every procurement
        `workspaces` row, so a `workspaces`-table read would always return
        zero rows post-push — buyer identity now comes straight off the
        `form_instances` row (`_SQL_WON_FORM_TEMPLATES_BY_FORM_INSTANCE`).
        `ConceptRaw.workspaces` stays `[]` for this grain (dataclass shape
        preserved for `enrich.py`'s consumption, per that field's own note).

        Read-only against the won-bid write path — this method writes nothing.
        Anchors (BI-9): the q_a_pairs land in the `q_a_pairs` bucket (anchored
        downstream via the BI-8 `canonical://q_a_pairs?…` query form, NEVER a
        q_a_pair master uuid — BI-3); `source_documents` stays empty for
        this grain (no named-clients doc backs a won bid)."""
        qa_rows = await self._pool.fetch(
            _SQL_WON_BID_QA_BY_FORM_INSTANCE, key.form_instance_id
        )
        ft_rows = await self._pool.fetch(
            _SQL_WON_FORM_TEMPLATES_BY_FORM_INSTANCE, key.form_instance_id
        )
        return ConceptRaw(
            workspaces=[], q_a_pairs=qa_rows, form_templates=ft_rows
        )

    # ── sample_rows (concrete helper, base.py) ──────────────────────────

    async def sample_rows(self, key: ConceptKey, n: int) -> "list[Mapping[str, Any]]":
        """A bounded sample of the concept's backing rows for the Pass-1
        prompt context window.

        ID-427 {427.7} — TECH §1's dispatcher 3 of three. Was a four-arm
        `concept_type` cascade with a `form_instance_id` sub-branch and an
        implicit fallthrough; now the grain's own `sample`. Which KIND of
        row a grain samples is `GrainSpec.sample_kind`, read by
        `producer/enrich.py` so it can mint the BI-6 anchor a sampled
        `source_documents` row needs."""
        if n <= 0:
            return []
        spec = self.grain_for(key)
        return await spec.sample(self, spec, key, n)

    async def _sample_entity_pattern_grain(
        self, key: ConceptKey, n: int
    ) -> "list[Mapping[str, Any]]":
        """The q_a_pairs sample for the pattern-matched entity grains
        (`product`, named-client `case_study`, every feeder grain)."""
        sd_rows = await self._source_documents_by_patterns([f"%{key.entity_id}%"])
        sd_ids = [row["id"] for row in sd_rows]
        sql = f"{_SQL_QA_BY_SOURCE_DOCS_OR_ENTITY} LIMIT $3"
        return await self._pool.fetch(sql, sd_ids, key.entity_id, n)

    async def _sample_case_study(
        self, key: ConceptKey, n: int
    ) -> "list[Mapping[str, Any]]":
        """The named-client `case_study` grain's q_a_pairs sample — the same
        query as `_sample_entity_pattern_grain`, over the named-clients
        document patterns rather than the entity's own name (matching
        `_read_case_study`)."""
        sd_rows = await self._source_documents_by_patterns(
            _CASE_STUDY_FILENAME_PATTERNS
        )
        sd_ids = [row["id"] for row in sd_rows]
        sql = f"{_SQL_QA_BY_SOURCE_DOCS_OR_ENTITY} LIMIT $3"
        return await self._pool.fetch(sql, sd_ids, key.entity_id, n)

    async def _sample_won_bid_case_study(
        self, key: ConceptKey, n: int
    ) -> "list[Mapping[str, Any]]":
        """Sample the won-bid-provenance q_a_pairs directly by
        `source_form_instance_id` ({145.24} — no named-clients
        source_documents exist for this grain)."""
        sql = f"{_SQL_WON_BID_QA_BY_FORM_INSTANCE} LIMIT $2"
        return await self._pool.fetch(sql, key.form_instance_id, n)

    async def _sample_source_documents(
        self, key: ConceptKey, n: int
    ) -> "list[Mapping[str, Any]]":
        """The `source_documents` sample for grains that carry no q_a_pairs
        component per their join grid (`company`, `certification`). Every
        grain declaring this as its `sample` MUST also declare
        `sample_kind="source_documents"`, or `producer/enrich.py` will hand
        the model un-minted real record ids that its own BI-17 provenance
        gate then refuses."""
        raw = await self.read_concept(key)
        return list(raw.source_documents[:n])

    # ── find (concrete helper, base.py) ─────────────────────────────────

    async def find(self, query: str) -> "list[ConceptKey]":
        """Case-insensitive substring search over the enumerated concept
        set's identity fields — a thin filter over `list_concepts()`, not a
        bespoke query (mirrors the reference_agent's base.py default-helper
        shape rather than the per-type join tier above)."""
        if not query:
            return []
        needle = query.casefold()
        keys = await self.list_concepts()
        return [k for k in keys if needle in _concept_haystack(k)]


# ─────────────────────────────────────────────────────────────────────────
# The grain registry (ID-427 {427.7}, TECH §1)
#
# **This tuple is the whole extension point.** Adding a grain is one entry
# here — no `read_concept` arm, no `sample_rows` arm, no
# `_source_documents_*` arm, no directory literal repeated in an enumeration
# method, and (since {427.5}) no type register. That is the property whose
# absence produced the inversion DR-141 names: the old shape cost four edits
# in four places, which is *why* nobody added a catch-all.
#
# Declared AFTER the class because each entry's callables name its methods;
# the lambdas resolve at call time, and `__init__` reads this module global
# at construction time, so a caller that extends the tuple — a test
# registering a grain, or {427.10} adding the residual grain — gets its
# grain enumerated, read and sampled with no edit to any of the three.
#
# Directories are the SAME five the bundle already ships (RESEARCH M5 / C2 —
# they were always grain constants, never a type materialisation), so no
# concept file moves. Both `case_study` grains share `case-studies` for now:
# id-429 IA-4 permits many-to-one, and {427.8} is the subtask that gives the
# won-bid grain `case-studies/won-bid` and deletes the {132.29} write-time
# redirect that currently stands in for it.
# ─────────────────────────────────────────────────────────────────────────

WON_BID_GRAIN = "case_study_won_bid"
"""The one grain that declares `ConceptKey.form_instance_id` as its locator
(S443 amendment / DR-029).

PUBLIC because two rules key on it and both must key on the same string:
`grain_for`'s locator-ownership guard here, and the {132.29} write-path
redirect in `producer/bundle_writer.py`. Both were keyed on the
`'case_study'` LABEL before {427.7}, which a `type_label` relabel would have
broken in opposite ways — the guard by rejecting every won-bid key, the
redirect by silently ceasing to fire and letting won-bid concepts collide
with same-slug named-client ones. **{427.8} retires the redirect** (the grain
gets `case-studies/won-bid` as its own declared directory), after which this
constant has one consumer again."""

_FEEDER_GRAIN_PREFIX = "feeder:"
"""Namespace for client-declared grains, so a `concept-feeder.json` entry can
never collide with a built-in grain's dispatch key even if the collision
guard in `producer/bundle_writer._validate_concept_feeder_schema` were
bypassed by a caller constructing `LRecordsSource` directly."""

_BUILTIN_GRAINS: "tuple[GrainSpec, ...]" = (
    GrainSpec(
        name="topic_scope_tag",
        directory="topics",
        type_label="topic",
        list=lambda src, spec: src._list_topic_concepts(spec),
        read=lambda src, spec, key: src._read_topic(key),
        sample=lambda src, spec, key, n: src._topic_qa_rows(key, limit=n),
    ),
    GrainSpec(
        name="product_entity_mention",
        directory="products",
        type_label="product",
        list=lambda src, spec: src._list_entity_mention_grain_concepts(
            spec, "product"
        ),
        read=lambda src, spec, key: src._read_entity_pattern_grain(key),
        sample=lambda src, spec, key, n: src._sample_entity_pattern_grain(key, n),
    ),
    GrainSpec(
        name="company_singleton",
        directory="company",
        type_label="company",
        list=lambda src, spec: src._list_company_concepts(spec),
        read=lambda src, spec, key: src._read_company(key),
        sample=lambda src, spec, key, n: src._sample_source_documents(key, n),
        sample_kind="source_documents",
    ),
    GrainSpec(
        name="certification_entity_mention",
        directory="certifications",
        type_label="certification",
        list=lambda src, spec: src._list_certification_concepts(spec),
        read=lambda src, spec, key: src._read_certification(key),
        sample=lambda src, spec, key, n: src._sample_source_documents(key, n),
        sample_kind="source_documents",
    ),
    GrainSpec(
        name="case_study_named_client",
        directory="case-studies",
        type_label="case_study",
        list=lambda src, spec: src._list_case_study_concepts(spec),
        read=lambda src, spec, key: src._read_case_study(key),
        sample=lambda src, spec, key, n: src._sample_case_study(key, n),
    ),
    GrainSpec(
        name=WON_BID_GRAIN,
        directory="case-studies",
        type_label="case_study",
        list=lambda src, spec: src._list_won_bid_case_study_concepts(spec),
        read=lambda src, spec, key: src._read_won_bid_case_study(key),
        sample=lambda src, spec, key, n: src._sample_won_bid_case_study(key, n),
    ),
)

BUILTIN_GRAIN_TYPE_LABELS = frozenset(spec.type_label for spec in _BUILTIN_GRAINS)
"""The `type` labels the built-in grains emit — **derived from the registry,
never hand-listed**.

ID-427 {427.5} parked a hand-mirrored copy of this in
`producer/bundle_writer.py` as `_BUILTIN_GRAIN_TYPE_LABELS`, with an explicit
{427.7} expiry; this is the promised source and that constant is retired.

**It is not a type register** (DR-141). It gates a CONFIG FILE — a
`concept-feeder.json` declaring one of these labels would be enumerated by
its own grain AND shadowed by a built-in one, an ambiguity that surfaces
later as an opaque write-path collision. It never gates a concept's `type`:
any grain, built-in or client-declared, may mint any well-shaped label."""

BUILTIN_GRAIN_DIRECTORIES = frozenset(spec.directory for spec in _BUILTIN_GRAINS)
"""The bundle directories the built-in grains own. Exported for callers that
need the shipped layout without importing the registry itself; **not** a
uniqueness constraint — id-429 IA-4 states many-to-one is fine, and the two
`case_study` grains already share one."""
