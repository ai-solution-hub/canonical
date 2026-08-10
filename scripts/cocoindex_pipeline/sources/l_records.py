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

Per-concept-type table/join grid (TECH §"Per-concept-type table/join grid",
BI-3/BI-4/BI-5). The ratified type set is `{topic, product, company,
certification, case_study}` — `metric`/`playbook`/`dataset` stay distinct
tags on `topic` concepts, not separate types (BI-4). **A `q_a_pair` is
NEVER enumerated as a concept** (BI-3) — `ConceptKey.__post_init__` makes
this a runtime invariant, not just a convention: constructing a
`ConceptKey` with any `concept_type` outside the ratified set raises
`ValueError`.

| type            | `list_concepts()` grain                          | `read_concept()` joins |
|------------------|---------------------------------------------------|-------------------------|
| `topic`          | distinct `q_a_pairs.scope_tag` values (the domain/subtopic fallback grain retired S531 — DR-125 expiry ruled) | the q_a_pairs cluster + their `source_document_id` parents + `record_lifecycle` (both owner kinds) + `entity_mentions`/`entity_relationships` neighbourhood |
| `product`        | distinct `entity_mentions.canonical_name` where `entity_type='product'` | `source_documents` (filename/logical_path match) + product-scoped `q_a_pairs` |
| `company`        | singleton, iff a company-overview/team-structure `source_documents` row exists | `source_documents` (company-overview, team-structure) + the company `entity_mentions` graph |
| `certification`  | distinct `entity_mentions.canonical_name` where `entity_type='certification'` | `source_documents` (compliance) + the certification's own `entity_mentions` (by canonical_name, across all docs — external evidence) |
| `case_study`     | distinct named-client `entity_mentions.canonical_name` (`entity_type='organisation'`) mentioned in the named-clients doc, PLUS one per BUYER of a `won` procurement bid (S443 amendment / DR-029) | named-clients grain: `source_documents` (named-clients) + supporting `q_a_pairs`. won-bid grain (`key.workspace_id` set): `derived_from_form_response` `q_a_pairs` (by `source_form_instance_id`, published-only) + the won `form_instances` row itself (`issuing_organisation`/`name`/`outcome_notes`) — see the {145.24} note below |

**Won-bid case_study grain (S443 amendment / DR-029; re-pointed {145.24}
post-{145.6} W1e).** A `won` procurement form is a first-class case_study
source. Originally (pre-ID-145) enumeration joined `workspaces` →
`application_types` (`key='procurement'`) → `form_templates`
(`outcome='won'`), and buyer identity/outcome_notes were split across a
`workspaces` row and a `form_templates` row. {145.6}'s W1e migration
wholesale-deletes every procurement `workspaces` row (R3/R10) and W1c drops
`form_instances.workspace_id` entirely — the join target is GONE, not merely
renamed, and `form_instances` is exclusively procurement's own table (no
`application_types` discriminator needed). Ground truth
(`supabase/migrations/20260712062000_id145_w1c_rename_reshape.sql`,
`…w1e_drop_workspace_stratum.sql`) shows every engagement fact the old
`workspaces` row supplied is ALREADY denormalised directly onto the form
(`form_instances.issuing_organisation`/`name` NOT NULL/`outcome`/
`outcome_notes`), so post-{145.6} enumeration reads `form_instances` alone —
no join, no `workspaces` fetch. `q_a_pairs.source_workspace_id` is dropped in
the same batch; its replacement lineage column is `source_form_instance_id`
(the renamed `source_form_template_id`). `ConceptKey.workspace_id` KEEPS its
field name (repointed to hold the won form's own `form_instances.id`, not a
`workspaces.id`) — a rename would ripple into `producer/flow_def.py`/
`producer/bundle_writer.py`/`producer/git_sync.py`, outside this Subtask's
file-ownership boundary; see that field's docstring below and the {145.24}
journal for the naming-debt this leaves for a future Subtask. This grain is
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

import re
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
# config to widen.
from scripts.cocoindex_pipeline.sources.base import (
    ConceptKey,
    ConceptRaw,
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
    "SELECT DISTINCT id AS workspace_id, "
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
# `_SQL_WON_FORM_TEMPLATES_BY_WORKSPACE` below). `ConceptRaw.workspaces`
# stays in the dataclass shape (structural stability for `enrich.py`'s
# `list(raw.workspaces)` — outside this Subtask's rename-blast-radius
# concern) but `_read_won_bid_case_study` now always populates it `[]`.

# Won-bid-provenance q_a_pairs (the {131.28} write path, origin_kind
# 'derived_from_form_response'), surfaced only once PROMOTED (published)
# through the DR-025 knowledge-admission gate — the same published-only read
# posture the topic/product grains take. Provenance columns
# (source_form_instance_id/source_form_response_id/source_question_id) are
# carried so downstream (BI-28 proposal shaping) keeps won-bid lineage.
# {145.24}: `source_workspace_id` is DROPPED by {145.6} W1c (STEP 5) — its
# replacement lineage column is `source_form_instance_id` (the renamed
# `source_form_template_id`), which already carries the same "which form"
# provenance the workspace column duplicated (ARCH-REVIEW §2 C8).
_QA_WON_COLUMNS = (
    f"{_QA_COLUMNS}, source_form_instance_id, source_form_response_id, "
    "source_question_id"
)

_SQL_WON_BID_QA_BY_WORKSPACE = (
    f"SELECT {_QA_WON_COLUMNS} FROM q_a_pairs "
    "WHERE source_form_instance_id = $1 "
    "AND origin_kind = 'derived_from_form_response' "
    "AND publication_status = 'published' ORDER BY id"
)

# {145.24}: table renamed form_templates -> form_instances; `workspace_id`
# column is DROPPED by W1c — `key.workspace_id` (the ConceptKey locator, kept
# under its pre-existing field name per the docstring above) now carries the
# won form's own `form_instances.id`, so this filters on the form's OWN id
# rather than a workspace grouping id. A single row (0 or 1) in practice —
# `_SQL_WON_BID_CASE_STUDIES` already enumerates one row per won form.
_SQL_WON_FORM_TEMPLATES_BY_WORKSPACE = (
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
# id (the `ConceptKey.workspace_id` locator, {145.24}).
_SQL_WON_BID_CASE_STUDY_VERSION = (
    "SELECT w.workspace_id AS workspace_id, "
    "count(DISTINCT qa.id) AS qa_count, max(qa.updated_at) AS qa_max, "
    "count(DISTINCT fi.id) AS fi_count, max(fi.updated_at) AS fi_max "
    "FROM (SELECT DISTINCT id AS workspace_id FROM form_instances "
    "WHERE outcome = 'won') w "
    "LEFT JOIN q_a_pairs qa ON qa.source_form_instance_id = w.workspace_id "
    "AND qa.origin_kind = 'derived_from_form_response' "
    "AND qa.publication_status = 'published' "
    "LEFT JOIN form_instances fi ON fi.id = w.workspace_id AND fi.outcome = 'won' "
    "GROUP BY w.workspace_id ORDER BY w.workspace_id"
)

_SLUG_INVALID_RE = re.compile(r"[^a-z0-9]+")


def _slugify(value: str) -> str:
    """Deterministic filename-safe slug for a bundle rel_path segment."""
    slug = _SLUG_INVALID_RE.sub("-", value.strip().lower()).strip("-")
    return slug or "untitled"


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
    type": ...}, ...}` mapping `producer/bundle_writer.read_concept_feeder_
    config` reads from the client-authored `concept-feeder.json` — see
    that function's docstring for the schema. `None`/omitted (every
    pre-{132.36} call site) is exactly `{}` — zero behaviour change.
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

    # ── list_concepts (abstract, base.py) ───────────────────────────────

    async def list_concepts(self) -> "list[ConceptKey]":
        """Enumerate the concept set across the built-in grains, PLUS —
        ID-132 {132.36} G-CONCEPT-FEEDER — any type
        `self._concept_feeder_config` declares (`{}`/absent: zero extra
        concepts). **Never enumerates a q_a_pair as a concept** (BI-3) —
        structurally guaranteed by `ConceptKey.__post_init__`'s
        unconditional `q_a_pair` check, in addition to no branch below ever
        constructing one.

        ID-427 {427.5}: the feeder pass no longer needs a type-widening
        `with` block. `ConceptKey` validates its `concept_type` by shape,
        so a feeder-declared type is constructible on the same terms as a
        built-in one — the widener existed only to lift a gate that is
        gone."""
        keys: "list[ConceptKey]" = []
        keys.extend(await self._list_topic_concepts())
        keys.extend(await self._list_product_concepts())
        keys.extend(await self._list_company_concepts())
        keys.extend(await self._list_certification_concepts())
        keys.extend(await self._list_case_study_concepts())
        keys.extend(await self._list_won_bid_case_study_concepts())
        keys.extend(await self._list_feeder_concepts())
        return keys

    async def _list_feeder_concepts(self) -> "list[ConceptKey]":
        """ID-132 {132.36} G-CONCEPT-FEEDER: enumerate every concept type
        `self._concept_feeder_config` declares. `[]` when no feeder config
        was supplied (the common case, and every bundle that never authors
        `concept-feeder.json`).

        v1 supports exactly ONE grain strategy — `entity_mention` —
        deliberately: this module's own docstring already names the
        per-type join grid as "the one part that cannot be lifted, because
        it encodes *which records back which concept type*" (TECH:162-163);
        a generic client-authored SQL DSL would both contradict that
        judgement call and open a real query-injection surface.
        `entity_mention` generalises the EXISTING `product`/`certification`
        join pattern (a parametrised `entity_type`) — the one shape already
        proven safe and reusable. Adding a second grain is a future
        Subtask's code change, not a config-time escape hatch."""
        keys: "list[ConceptKey]" = []
        for concept_type, grain_config in self._concept_feeder_config.items():
            grain = grain_config["grain"]
            if grain == "entity_mention":
                keys.extend(
                    await self._list_entity_mention_grain_concepts(
                        concept_type, grain_config["entity_type"]
                    )
                )
                continue
            # Unreachable via the validated read path
            # (`producer/bundle_writer.read_concept_feeder_config`'s closed
            # grain enum) — guards a caller that constructs `LRecordsSource`
            # directly with an unvalidated `concept_feeder_config`.
            raise ValueError(  # pragma: no cover
                f"unsupported concept-feeder grain {grain!r} for concept "
                f"type {concept_type!r}"
            )
        return keys

    async def _list_entity_mention_grain_concepts(
        self, concept_type: str, entity_type: str
    ) -> "list[ConceptKey]":
        """The `entity_mention` feeder grain's enumeration — reuses
        `_SQL_DISTINCT_ENTITY_CANONICAL_NAMES`/`_SQL_PRODUCT_VERSION`
        VERBATIM, parametrised by the feeder config's `entity_type` instead
        of `_list_product_concepts`'s hard-coded `'product'` literal (both
        queries already take `entity_type` as a bind parameter — no new
        SQL). `rel_path` uses the client's OWN concept_type name as the
        bundle directory (`{concept_type}/{slug}.md`) — never
        auto-pluralised (an arbitrary client-chosen type name has no
        principled English-plural rule)."""
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
        return [
            ConceptKey(
                rel_path=f"{concept_type}/{_slugify(row['canonical_name'])}.md",
                concept_type=concept_type,
                entity_id=row["canonical_name"],
                content_version=version_by_name.get(row["canonical_name"], ""),
            )
            for row in rows
        ]

    async def _list_topic_concepts(self) -> "list[ConceptKey]":
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
                ConceptKey(
                    rel_path=f"topics/{_slugify(tag)}.md",
                    concept_type="topic",
                    scope_tag=tag,
                    content_version=version_by_tag.get(tag, ""),
                )
            )
        return keys

    async def _list_product_concepts(self) -> "list[ConceptKey]":
        rows = await self._pool.fetch(_SQL_DISTINCT_ENTITY_CANONICAL_NAMES, "product")
        version_by_name = {
            row["canonical_name"]: _combine_content_version(
                _version_term(row.get("sd_count"), row.get("sd_max")),
                _version_term(row.get("qa_count"), row.get("qa_max")),
            )
            for row in await self._pool.fetch(_SQL_PRODUCT_VERSION, "product")
        }
        return [
            ConceptKey(
                rel_path=f"products/{_slugify(row['canonical_name'])}.md",
                concept_type="product",
                entity_id=row["canonical_name"],
                content_version=version_by_name.get(row["canonical_name"], ""),
            )
            for row in rows
        ]

    async def _list_company_concepts(self) -> "list[ConceptKey]":
        rows = await self._pool.fetch(
            _SQL_SOURCE_DOCUMENT_EXISTS_BY_PATTERNS, list(_COMPANY_FILENAME_PATTERNS)
        )
        if not rows:
            return []
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
        return [
            ConceptKey(
                rel_path="company/overview.md",
                concept_type="company",
                content_version=content_version,
            )
        ]

    async def _list_certification_concepts(self) -> "list[ConceptKey]":
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
        return [
            ConceptKey(
                rel_path=f"certifications/{_slugify(row['canonical_name'])}.md",
                concept_type="certification",
                entity_id=row["canonical_name"],
                content_version=_combine_content_version(
                    shared_term, em_by_name.get(row["canonical_name"], _version_term(0, None))
                ),
            )
            for row in rows
        ]

    async def _list_case_study_concepts(self) -> "list[ConceptKey]":
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
        return [
            ConceptKey(
                rel_path=f"case-studies/{_slugify(row['canonical_name'])}.md",
                concept_type="case_study",
                entity_id=row["canonical_name"],
                content_version=version_by_name.get(row["canonical_name"], ""),
            )
            for row in rows
        ]

    async def _list_won_bid_case_study_concepts(self) -> "list[ConceptKey]":
        """The won-bid case_study source (S443 amendment / DR-029): one
        case_study per BUYER of a won procurement bid. The rows arrive ordered
        by (buyer, workspace_id), so deduping by buyer keeps the earliest
        workspace deterministically — a single case study per buyer (BI-2),
        even when a buyer has multiple won workspaces. Additive to the
        named-clients grain above. {132.38} MD-7: `content_version` is
        grouped by the won form's own id (the `workspace_id` locator)."""
        rows = await self._pool.fetch(_SQL_WON_BID_CASE_STUDIES)
        version_by_workspace = {
            row["workspace_id"]: _combine_content_version(
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
                ConceptKey(
                    rel_path=f"case-studies/{_slugify(buyer)}.md",
                    concept_type="case_study",
                    entity_id=buyer,
                    content_version=version_by_workspace.get(row["workspace_id"], ""),
                    workspace_id=row["workspace_id"],
                )
            )
        return keys

    # ── read_concept (abstract, base.py) ────────────────────────────────

    async def read_concept(self, key: ConceptKey) -> ConceptRaw:
        """Run the per-type join grid (TECH §"Per-concept-type table/join
        grid") and return the raw backing rows. For a base ratified type,
        `key.concept_type` is validated at `ConceptKey` construction time,
        so the final else-branch below is unreachable for those — kept as a
        defensive guard. ID-132 {132.36} G-CONCEPT-FEEDER: a `key.
        concept_type` present in `self._concept_feeder_config` routes to
        `_read_feeder_concept` instead."""
        if key.concept_type == "topic":
            return await self._read_topic(key)
        if key.concept_type == "product":
            return await self._read_product(key)
        if key.concept_type == "company":
            return await self._read_company(key)
        if key.concept_type == "certification":
            return await self._read_certification(key)
        if key.concept_type == "case_study":
            if key.workspace_id is not None:
                return await self._read_won_bid_case_study(key)
            return await self._read_case_study(key)
        if key.concept_type in self._concept_feeder_config:
            return await self._read_feeder_concept(key)
        raise ValueError(
            f"unsupported concept_type {key.concept_type!r}"
        )  # pragma: no cover — unreachable, ConceptKey validates membership

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

    async def _source_documents_for_key(
        self, key: ConceptKey
    ) -> "list[Mapping[str, Any]]":
        """`company`/`certification`/`case_study`/`product` share the
        "filename/logical_path pattern match" enumeration shape — `topic`
        instead derives its source_documents from its q_a_pairs cluster's
        parents (`_read_topic`), so it is deliberately NOT handled here."""
        if key.concept_type == "product":
            patterns = [f"%{key.entity_id}%"]
        elif key.concept_type == "company":
            patterns = list(_COMPANY_FILENAME_PATTERNS)
        elif key.concept_type == "certification":
            patterns = list(_CERTIFICATION_FILENAME_PATTERNS)
        elif key.concept_type == "case_study":
            patterns = list(_CASE_STUDY_FILENAME_PATTERNS)
        elif key.concept_type in self._concept_feeder_config:
            # ID-132 {132.36}: the `entity_mention` grain shares the
            # `product` pattern shape (filename/logical_path match on the
            # entity's own canonical_name) — the only grain v1 supports.
            patterns = [f"%{key.entity_id}%"]
        else:
            raise ValueError(
                f"_source_documents_for_key does not handle "
                f"{key.concept_type!r} (topic derives source_documents "
                "from its q_a_pairs cluster's parents, not a filename "
                "pattern)"
            )
        return await self._pool.fetch(
            _SQL_SOURCE_DOCUMENTS_BY_FILENAME_PATTERNS, patterns
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

    async def _read_product(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_for_key(key)
        sd_ids = [row["id"] for row in sd_rows]
        qa_rows = await self._pool.fetch(
            _SQL_QA_BY_SOURCE_DOCS_OR_ENTITY, sd_ids, key.entity_id
        )
        return ConceptRaw(source_documents=sd_rows, q_a_pairs=qa_rows)

    async def _read_company(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_for_key(key)
        sd_ids = [row["id"] for row in sd_rows]
        em_rows = await self._entity_mentions_by_source_docs(sd_ids)
        return ConceptRaw(source_documents=sd_rows, entity_mentions=em_rows)

    async def _read_certification(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_for_key(key)
        em_rows = await self._pool.fetch(
            _SQL_ENTITY_MENTIONS_BY_TYPE_AND_NAME, "certification", key.entity_id
        )
        return ConceptRaw(source_documents=sd_rows, entity_mentions=em_rows)

    async def _read_case_study(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_for_key(key)
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
        `form_instances` row (`_SQL_WON_FORM_TEMPLATES_BY_WORKSPACE`).
        `ConceptRaw.workspaces` stays `[]` for this grain (dataclass shape
        preserved for `enrich.py`'s consumption, per that field's own note).

        Read-only against the won-bid write path — this method writes nothing.
        Anchors (BI-9): the q_a_pairs land in the `q_a_pairs` bucket (anchored
        downstream via the BI-8 `canonical://q_a_pairs?…` query form, NEVER a
        q_a_pair master uuid — BI-3); `source_documents` stays empty for
        this grain (no named-clients doc backs a won bid)."""
        qa_rows = await self._pool.fetch(
            _SQL_WON_BID_QA_BY_WORKSPACE, key.workspace_id
        )
        ft_rows = await self._pool.fetch(
            _SQL_WON_FORM_TEMPLATES_BY_WORKSPACE, key.workspace_id
        )
        return ConceptRaw(
            workspaces=[], q_a_pairs=qa_rows, form_templates=ft_rows
        )

    async def _read_feeder_concept(self, key: ConceptKey) -> ConceptRaw:
        """ID-132 {132.36} G-CONCEPT-FEEDER: the `entity_mention` grain's
        read — identical join shape to `_read_product` (source_documents by
        filename/logical_path match on `key.entity_id`, via `_source_
        documents_for_key`'s feeder branch, + q_a_pairs by
        source-docs-or-entity-scope-tag). `read_concept`
        only reaches here for a `key.concept_type` present in
        `self._concept_feeder_config`."""
        sd_rows = await self._source_documents_for_key(key)
        sd_ids = [row["id"] for row in sd_rows]
        qa_rows = await self._pool.fetch(
            _SQL_QA_BY_SOURCE_DOCS_OR_ENTITY, sd_ids, key.entity_id
        )
        return ConceptRaw(source_documents=sd_rows, q_a_pairs=qa_rows)

    # ── sample_rows (concrete helper, base.py) ──────────────────────────

    async def sample_rows(self, key: ConceptKey, n: int) -> "list[Mapping[str, Any]]":
        """A bounded sample of the concept's backing rows for the Pass-1
        prompt context window. `topic`/`product`/`case_study`/a {132.36}
        feeder-fed concept type sample their `q_a_pairs` cluster (the
        primary per-type row source); `company`/`certification` carry no
        q_a_pairs component (per the join grid), so they sample their
        `source_documents` rows instead."""
        if n <= 0:
            return []
        if key.concept_type == "topic":
            return await self._topic_qa_rows(key, limit=n)
        if key.concept_type == "case_study" and key.workspace_id is not None:
            # won-bid grain: sample the won-bid-provenance q_a_pairs directly
            # by source_form_instance_id ({145.24} — no named-clients
            # source_documents exist for this grain).
            sql = f"{_SQL_WON_BID_QA_BY_WORKSPACE} LIMIT $2"
            return await self._pool.fetch(sql, key.workspace_id, n)
        if key.concept_type in ("product", "case_study") or (
            key.concept_type in self._concept_feeder_config
        ):
            sd_rows = await self._source_documents_for_key(key)
            sd_ids = [row["id"] for row in sd_rows]
            sql = f"{_SQL_QA_BY_SOURCE_DOCS_OR_ENTITY} LIMIT $3"
            return await self._pool.fetch(sql, sd_ids, key.entity_id, n)
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
