"""The L-records Source adapter — ID-132 {132.4} G-SOURCE, the one bespoke
piece of the OKF concept producer (TECH.md §"The Source adapter over
L-records").

Implements the reference_agent's Source protocol shape (`sources/base.py`,
external — NOT vendored in this repo, re-implemented natively) over the
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
protocol below is a LOCAL structural mirror of the external reference_agent
ABC (no `sources.base` module exists to import), so a future consumer can
`isinstance()`-check any Source implementation without importing cocoindex.

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
| `topic`          | distinct `q_a_pairs.scope_tag` values, PLUS distinct `(primary_domain, primary_subtopic)` pairs for scope-tag-less pairs | the q_a_pairs cluster + their `source_document_id` parents + `reference_items` of those parents + `record_lifecycle` (both owner kinds) + `entity_mentions`/`entity_relationships` neighbourhood |
| `product`        | distinct `entity_mentions.canonical_name` where `entity_type='product'` | `source_documents` (filename/logical_path match) + product-scoped `q_a_pairs` + `reference_items` |
| `company`        | singleton, iff a company-overview/team-structure `source_documents` row exists | `source_documents` (company-overview, team-structure) + `reference_items` + the company `entity_mentions` graph |
| `certification`  | distinct `entity_mentions.canonical_name` where `entity_type='certification'` | `source_documents` (compliance) + `reference_items` + the certification's own `entity_mentions` (by canonical_name, across all docs — external evidence) |
| `case_study`     | distinct named-client `entity_mentions.canonical_name` (`entity_type='organisation'`) mentioned in the named-clients doc | `source_documents` (named-clients) + supporting `q_a_pairs` + `reference_items` |

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
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Protocol, Sequence, runtime_checkable

# ── BI-4: the ratified concept-type set (topic/product/company/certification/
# case_study — metric/playbook/dataset stay tags on `topic`, not types). ─────
CONCEPT_TYPES: frozenset[str] = frozenset(
    {"topic", "product", "company", "certification", "case_study"}
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


@dataclass(frozen=True)  # frozen → deterministic cocoindex memo key (BI-18)
class ConceptKey:
    """A concept's identity + the locator fields its `read_concept` join
    needs. Frozen: this is the memo-keyed component argument the {132.8}
    `enrich_concept` component will key `@coco.fn(memo=True)` on (the
    `url_source.py` `UrlItem` / EXECUTOR-VERIFY-1 precedent — equal-valued
    distinct instances memo-hit; a bumped field re-executes).
    """

    rel_path: str
    """Concept identity — the bundle rel_path (BI-2) — the cocoindex memo
    key. A concept has no DB row and no uuid of its own; renaming this path
    changes the concept's identity."""

    concept_type: str
    """One of the BI-4 ratified set (`CONCEPT_TYPES`) — never `'q_a_pair'`
    (BI-3: a Q&A pair is never a concept). Validated in `__post_init__`."""

    scope_tag: "str | None" = None
    """`topic` locator: a single `q_a_pairs.scope_tag` array element this
    concept clusters. Mutually exclusive with `domain`/`subtopic` (mirrors
    `producer/resource_uri.py:build_q_a_pairs_query_uri`'s BI-8 locator
    contract) — a topic concept sets EITHER this OR the domain/subtopic
    pair, never both."""

    domain: "str | None" = None
    """`topic` locator (fallback grouping): the parent source_document's
    `primary_domain`, paired with `subtopic`, for scope-tag-less q_a_pairs
    clusters."""

    subtopic: "str | None" = None
    """`topic` locator: the parent source_document's `primary_subtopic`,
    paired with `domain`."""

    entity_id: "str | None" = None
    """`product`/`certification`/`case_study` locator: the entity's
    `entity_mentions.canonical_name` (or, for `product`, the filename-match
    token) identifying which single entity this concept represents. Unused
    (`None`) for `topic` and the singleton `company` type."""

    def __post_init__(self) -> None:
        if not self.rel_path:
            raise ValueError(
                "ConceptKey.rel_path must be non-empty (BI-2: concept "
                "identity = bundle rel_path = the cocoindex memo key)"
            )
        if self.concept_type not in CONCEPT_TYPES:
            raise ValueError(
                f"ConceptKey.concept_type must be one of "
                f"{sorted(CONCEPT_TYPES)} (BI-4 ratified set); a q_a_pair "
                f"is never a concept (BI-3). Got {self.concept_type!r}."
            )
        if self.scope_tag is not None and (
            self.domain is not None or self.subtopic is not None
        ):
            raise ValueError(
                "ConceptKey.scope_tag is mutually exclusive with "
                "domain/subtopic (BI-8 locator contract, mirrors "
                "producer/resource_uri.py:build_q_a_pairs_query_uri); got "
                f"scope_tag={self.scope_tag!r} domain={self.domain!r} "
                f"subtopic={self.subtopic!r}"
            )


@dataclass
class ConceptRaw:
    """The raw joined L-record rows backing one concept — `read_concept`'s
    return shape. Each field is populated only where the TECH §"Per-
    concept-type table/join grid" names that table for the concept's
    `concept_type` (e.g. `product`/`case_study` never populate
    `record_lifecycle`/`entity_relationships`; `company`/`certification`
    never populate `q_a_pairs`/`record_lifecycle`/`entity_relationships`).

    Never frozen (unlike `ConceptKey`): this is a per-call return value, not
    a cocoindex memo key.
    """

    source_documents: "list[Mapping[str, Any]]" = field(default_factory=list)
    q_a_pairs: "list[Mapping[str, Any]]" = field(default_factory=list)
    reference_items: "list[Mapping[str, Any]]" = field(default_factory=list)
    record_lifecycle: "list[Mapping[str, Any]]" = field(default_factory=list)
    entity_mentions: "list[Mapping[str, Any]]" = field(default_factory=list)
    entity_relationships: "list[Mapping[str, Any]]" = field(default_factory=list)


@runtime_checkable
class Source(Protocol):
    """Structural mirror of the reference_agent's `sources/base.py` Source
    ABC (external, not vendored — TECH §"The Source adapter over
    L-records"). `LRecordsSource` conforms to this shape; declared LOCALLY
    (never imported from a `sources.base` module, because none exists in
    this repo) so a future consumer can `isinstance()`-check any Source
    implementation without importing cocoindex or the external
    reference_agent package — same collection-safety property `url_source.py`
    preserves for `LiveMapView`.
    """

    async def list_concepts(self) -> "list[ConceptKey]": ...

    async def read_concept(self, key: ConceptKey) -> ConceptRaw: ...

    async def sample_rows(
        self, key: ConceptKey, n: int
    ) -> "list[Mapping[str, Any]]": ...

    async def find(self, query: str) -> "list[ConceptKey]": ...


# ── SQL — every query this adapter issues, named for the join grid row it
# serves. Every SELECT carries a deterministic ORDER BY so a concept's raw
# join result is reproducible across runs (matters for the bundle-writer's
# delta-only regeneration downstream, BI-18). ──────────────────────────────

_SQL_TOPIC_SCOPE_TAGS = (
    "SELECT DISTINCT unnest(scope_tag) AS scope_tag FROM q_a_pairs "
    "WHERE publication_status = 'published' AND scope_tag IS NOT NULL "
    "AND array_length(scope_tag, 1) > 0 ORDER BY 1"
)

_SQL_TOPIC_DOMAIN_SUBTOPICS = (
    "SELECT DISTINCT sd.primary_domain AS domain, "
    "sd.primary_subtopic AS subtopic FROM q_a_pairs qa "
    "JOIN source_documents sd ON sd.id = qa.source_document_id "
    "WHERE qa.publication_status = 'published' "
    "AND (qa.scope_tag IS NULL OR array_length(qa.scope_tag, 1) IS NULL) "
    "AND sd.primary_domain IS NOT NULL AND sd.primary_subtopic IS NOT NULL "
    "ORDER BY 1, 2"
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

_SQL_QA_BY_DOMAIN_SUBTOPIC = (
    "SELECT qa.id, qa.question_text, qa.answer_standard, "
    "qa.answer_advanced, qa.scope_tag, qa.anti_scope_tag, "
    "qa.source_document_id, qa.origin_kind, qa.publication_status, "
    "qa.valid_from, qa.valid_to, qa.created_at, qa.updated_at "
    "FROM q_a_pairs qa "
    "JOIN source_documents sd ON sd.id = qa.source_document_id "
    "WHERE sd.primary_domain = $1 AND sd.primary_subtopic = $2 "
    "AND qa.publication_status = 'published' ORDER BY qa.id"
)

_SQL_QA_BY_SOURCE_DOCS_OR_ENTITY = (
    f"SELECT {_QA_COLUMNS} FROM q_a_pairs "
    "WHERE (source_document_id = ANY($1::uuid[]) "
    "OR scope_tag @> ARRAY[$2]::text[]) "
    "AND publication_status = 'published' ORDER BY id"
)

_SOURCE_DOCUMENT_COLUMNS = (
    "id, filename, logical_path, primary_domain, primary_subtopic, "
    "secondary_domain, secondary_subtopic, content_type, summary, "
    "suggested_title, publication_status, source_url, extraction_method, "
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

_SQL_REFERENCE_ITEMS_BY_SOURCE_DOCS = (
    "SELECT id, title, body, summary, source_url, published_at, "
    "primary_domain, primary_subtopic, layer, source_document_id, "
    "ingestion_source, created_at, updated_at FROM reference_items "
    "WHERE source_document_id = ANY($1::uuid[]) ORDER BY id"
)

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
        for v in (key.rel_path, key.scope_tag, key.domain, key.subtopic, key.entity_id)
        if v
    ).casefold()


class LRecordsSource:
    """cocoindex Source adapter over ID-131 L-records — NET-NEW, the
    producer's one bespoke piece (TECH §"The Source adapter over
    L-records"). Structurally conforms to the local `Source` protocol
    above; never imports `cocoindex` (collection safety, mirrors
    `url_source.py`).

    Constructed with the shared asyncpg-`Pool`-shaped object
    (`coco.use_context(DB_CTX)` at the producer's app_main call site, per
    `flow.py`'s existing convention) — the same `pool.fetch(query, *args)`
    contract `url_source.py`'s `FeedUrlSource` uses.
    """

    def __init__(self, pool: Any) -> None:
        self._pool = pool

    # ── list_concepts (abstract, base.py) ───────────────────────────────

    async def list_concepts(self) -> "list[ConceptKey]":
        """Enumerate the concept set across all 5 ratified types (BI-4).
        **Never enumerates a q_a_pair as a concept** (BI-3) — structurally
        guaranteed by `ConceptKey.__post_init__`'s `CONCEPT_TYPES` check, in
        addition to no branch below ever constructing one."""
        keys: "list[ConceptKey]" = []
        keys.extend(await self._list_topic_concepts())
        keys.extend(await self._list_product_concepts())
        keys.extend(await self._list_company_concepts())
        keys.extend(await self._list_certification_concepts())
        keys.extend(await self._list_case_study_concepts())
        return keys

    async def _list_topic_concepts(self) -> "list[ConceptKey]":
        keys: "list[ConceptKey]" = []
        for row in await self._pool.fetch(_SQL_TOPIC_SCOPE_TAGS):
            tag = row["scope_tag"]
            keys.append(
                ConceptKey(
                    rel_path=f"topics/{_slugify(tag)}.md",
                    concept_type="topic",
                    scope_tag=tag,
                )
            )
        for row in await self._pool.fetch(_SQL_TOPIC_DOMAIN_SUBTOPICS):
            domain, subtopic = row["domain"], row["subtopic"]
            keys.append(
                ConceptKey(
                    rel_path=f"topics/{_slugify(domain)}--{_slugify(subtopic)}.md",
                    concept_type="topic",
                    domain=domain,
                    subtopic=subtopic,
                )
            )
        return keys

    async def _list_product_concepts(self) -> "list[ConceptKey]":
        rows = await self._pool.fetch(_SQL_DISTINCT_ENTITY_CANONICAL_NAMES, "product")
        return [
            ConceptKey(
                rel_path=f"products/{_slugify(row['canonical_name'])}.md",
                concept_type="product",
                entity_id=row["canonical_name"],
            )
            for row in rows
        ]

    async def _list_company_concepts(self) -> "list[ConceptKey]":
        rows = await self._pool.fetch(
            _SQL_SOURCE_DOCUMENT_EXISTS_BY_PATTERNS, list(_COMPANY_FILENAME_PATTERNS)
        )
        if not rows:
            return []
        return [ConceptKey(rel_path="company/overview.md", concept_type="company")]

    async def _list_certification_concepts(self) -> "list[ConceptKey]":
        rows = await self._pool.fetch(
            _SQL_DISTINCT_ENTITY_CANONICAL_NAMES, "certification"
        )
        return [
            ConceptKey(
                rel_path=f"certifications/{_slugify(row['canonical_name'])}.md",
                concept_type="certification",
                entity_id=row["canonical_name"],
            )
            for row in rows
        ]

    async def _list_case_study_concepts(self) -> "list[ConceptKey]":
        rows = await self._pool.fetch(
            _SQL_DISTINCT_CASE_STUDY_ENTITIES, list(_CASE_STUDY_FILENAME_PATTERNS)
        )
        return [
            ConceptKey(
                rel_path=f"case-studies/{_slugify(row['canonical_name'])}.md",
                concept_type="case_study",
                entity_id=row["canonical_name"],
            )
            for row in rows
        ]

    # ── read_concept (abstract, base.py) ────────────────────────────────

    async def read_concept(self, key: ConceptKey) -> ConceptRaw:
        """Run the per-type join grid (TECH §"Per-concept-type table/join
        grid") and return the raw backing rows. `key.concept_type` is
        validated at `ConceptKey` construction time, so the else-branch
        below is unreachable in practice — kept as a defensive guard."""
        if key.concept_type == "topic":
            return await self._read_topic(key)
        if key.concept_type == "product":
            return await self._read_product(key)
        if key.concept_type == "company":
            return await self._read_company(key)
        if key.concept_type == "certification":
            return await self._read_certification(key)
        if key.concept_type == "case_study":
            return await self._read_case_study(key)
        raise ValueError(
            f"unsupported concept_type {key.concept_type!r}"
        )  # pragma: no cover — unreachable, ConceptKey validates membership

    async def _topic_qa_rows(
        self, key: ConceptKey, *, limit: "int | None" = None
    ) -> "list[Mapping[str, Any]]":
        if key.scope_tag is not None:
            sql, args = _SQL_QA_BY_SCOPE_TAG, [key.scope_tag]
        elif key.domain is not None and key.subtopic is not None:
            sql, args = _SQL_QA_BY_DOMAIN_SUBTOPIC, [key.domain, key.subtopic]
        else:
            raise ValueError(
                "a topic ConceptKey needs scope_tag OR (domain and "
                f"subtopic) set (BI-8 locator contract); got {key!r}"
            )
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

    async def _reference_items_by_source_docs(
        self, ids: "Sequence[Any]"
    ) -> "list[Mapping[str, Any]]":
        if not ids:
            return []
        return await self._pool.fetch(_SQL_REFERENCE_ITEMS_BY_SOURCE_DOCS, list(ids))

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
        ri_rows = await self._reference_items_by_source_docs(sd_ids)
        rl_rows = await self._pool.fetch(
            _SQL_RECORD_LIFECYCLE_FOR_OWNERS, sd_ids, qa_ids
        )
        em_rows = await self._entity_mentions_by_source_docs(sd_ids)
        er_rows = await self._entity_relationships_by_source_docs(sd_ids)
        return ConceptRaw(
            q_a_pairs=qa_rows,
            source_documents=sd_rows,
            reference_items=ri_rows,
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
        ri_rows = await self._reference_items_by_source_docs(sd_ids)
        return ConceptRaw(
            source_documents=sd_rows, q_a_pairs=qa_rows, reference_items=ri_rows
        )

    async def _read_company(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_for_key(key)
        sd_ids = [row["id"] for row in sd_rows]
        ri_rows = await self._reference_items_by_source_docs(sd_ids)
        em_rows = await self._entity_mentions_by_source_docs(sd_ids)
        return ConceptRaw(
            source_documents=sd_rows, reference_items=ri_rows, entity_mentions=em_rows
        )

    async def _read_certification(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_for_key(key)
        sd_ids = [row["id"] for row in sd_rows]
        ri_rows = await self._reference_items_by_source_docs(sd_ids)
        em_rows = await self._pool.fetch(
            _SQL_ENTITY_MENTIONS_BY_TYPE_AND_NAME, "certification", key.entity_id
        )
        return ConceptRaw(
            source_documents=sd_rows, reference_items=ri_rows, entity_mentions=em_rows
        )

    async def _read_case_study(self, key: ConceptKey) -> ConceptRaw:
        sd_rows = await self._source_documents_for_key(key)
        sd_ids = [row["id"] for row in sd_rows]
        qa_rows = await self._pool.fetch(
            _SQL_QA_BY_SOURCE_DOCS_OR_ENTITY, sd_ids, key.entity_id
        )
        ri_rows = await self._reference_items_by_source_docs(sd_ids)
        return ConceptRaw(
            source_documents=sd_rows, q_a_pairs=qa_rows, reference_items=ri_rows
        )

    # ── sample_rows (concrete helper, base.py) ──────────────────────────

    async def sample_rows(self, key: ConceptKey, n: int) -> "list[Mapping[str, Any]]":
        """A bounded sample of the concept's backing rows for the Pass-1
        prompt context window. `topic`/`product`/`case_study` sample their
        `q_a_pairs` cluster (the primary per-type row source); `company`/
        `certification` carry no q_a_pairs component (per the join grid),
        so they sample their `source_documents` rows instead."""
        if n <= 0:
            return []
        if key.concept_type == "topic":
            return await self._topic_qa_rows(key, limit=n)
        if key.concept_type in ("product", "case_study"):
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
