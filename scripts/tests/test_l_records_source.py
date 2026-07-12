"""Tests for the L-records Source adapter (ID-132 {132.4} G-SOURCE).

Verifies: BI-3 (a q_a_pair is never enumerated as a concept), the 5-type
concept set (`{topic, product, company, certification, case_study}`, BI-4)
enumerates against a fixture corpus, `read_concept`'s per-type join grid
returns the expected anchors (TECH §"Per-concept-type table/join grid"),
and `ConceptKey`'s frozen/deterministic memo-key shape (BI-2/BI-18).

The pool seam is faked (this is a unit test of the adapter's query/join
contract, not of asyncpg) — `l_records.py` itself never imports cocoindex,
so no conftest stubbing is needed here, mirroring `test_url_source.py`.
"""

import asyncio
import dataclasses
import threading

import pytest

from scripts.cocoindex_pipeline.sources.l_records import (
    CONCEPT_TYPES,
    ConceptKey,
    ConceptRaw,
    LRecordsSource,
    Source,
)


class FakePool:
    """Minimal asyncpg-pool stand-in. `LRecordsSource` issues several
    DISTINCT queries per call (unlike `url_source.py`'s single-query
    `FeedUrlSource`), so dispatch is by a caller-registered list of
    `(marker_substring, rows, arg_matcher)` rules matched in registration
    order — the first whose marker is a substring of the issued query (and
    whose optional `arg_matcher(args)` predicate holds, if given) wins.
    Every issued `(query, args)` pair is recorded in `.calls` for assertion.
    """

    def __init__(self) -> None:
        self._rules: list[tuple[str, list[dict], object]] = []
        self.calls: list[tuple[str, tuple]] = []

    def when(self, marker: str, rows: list[dict], *, arg_matcher=None) -> "FakePool":
        self._rules.append((marker, rows, arg_matcher))
        return self

    async def fetch(self, query: str, *args: object) -> list[dict]:
        self.calls.append((query, args))
        for marker, rows, arg_matcher in self._rules:
            if marker in query and (arg_matcher is None or arg_matcher(args)):
                return rows
        raise AssertionError(
            f"FakePool: no rule matched query (registered {len(self._rules)} "
            f"rule(s)): {query!r} args={args!r}"
        )


def _run(coro):
    return asyncio.run(coro)


# ── ConceptKey shape (BI-2/BI-3/BI-4/BI-18) ─────────────────────────────


class TestConceptKeyShape:
    """`ConceptKey` is the memo-keyed component argument the {132.8}
    `enrich_concept` component will key `@coco.fn(memo=True)` on — frozen
    for a deterministic memo fingerprint (BI-18), identity = rel_path
    (BI-2)."""

    def test_is_frozen(self):
        key = ConceptKey(rel_path="topics/gdpr.md", concept_type="topic")
        with pytest.raises(dataclasses.FrozenInstanceError):
            key.rel_path = "topics/tampered.md"

    def test_equal_by_value(self):
        a = ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")
        b = ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")
        assert a == b
        assert hash(a) == hash(b)

    def test_rejects_empty_rel_path(self):
        with pytest.raises(ValueError, match="rel_path"):
            ConceptKey(rel_path="", concept_type="topic")

    def test_rejects_scope_tag_and_domain_subtopic_both_set(self):
        """BI-8 locator contract (mirrors
        `producer/resource_uri.py:build_q_a_pairs_query_uri`, which raises
        `ValueError` on the same both-set condition): `scope_tag` is
        mutually exclusive with `domain`/`subtopic` — constructing a
        `ConceptKey` with both set must not silently pick a branch."""
        with pytest.raises(ValueError, match="mutually exclusive"):
            ConceptKey(
                rel_path="topics/gdpr.md",
                concept_type="topic",
                scope_tag="gdpr",
                domain="security",
                subtopic="data-protection",
            )

    def test_concept_types_is_the_5_ratified_bi4_set(self):
        assert CONCEPT_TYPES == {
            "topic",
            "product",
            "company",
            "certification",
            "case_study",
        }


class TestBI3AQaPairIsNeverAConcept:
    """BI-3: no bundle file represents a single q_a_pair — a Q&A pair is a
    *record*, never a concept."""

    def test_constructing_a_q_a_pair_concept_key_raises(self):
        with pytest.raises(ValueError, match="q_a_pair"):
            ConceptKey(rel_path="q_a_pairs/1.md", concept_type="q_a_pair")

    def test_rejects_any_type_outside_the_ratified_set(self):
        with pytest.raises(ValueError, match="BI-4"):
            ConceptKey(rel_path="x.md", concept_type="metric")

    def test_list_concepts_never_yields_a_q_a_pair_type(self):
        pool = _five_type_pool()
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert keys, "the fixture corpus must yield at least one concept"
        assert all(k.concept_type != "q_a_pair" for k in keys)
        assert all(k.concept_type in CONCEPT_TYPES for k in keys)


# ── Source protocol conformance ─────────────────────────────────────────


class TestSourceProtocolConformance:
    def test_l_records_source_conforms_to_the_local_source_protocol(self):
        assert isinstance(LRecordsSource(pool=FakePool()), Source)


# ── list_concepts(): the 5-type set (BI-4/BI-5) ─────────────────────────


def _five_type_pool(
    *, company_exists: bool = True, won_bids: "list[dict] | None" = None
) -> FakePool:
    pool = FakePool()
    pool.when(
        "SELECT DISTINCT unnest(scope_tag)",
        [{"scope_tag": "gdpr"}, {"scope_tag": "encryption"}],
    )
    pool.when(
        "SELECT DISTINCT sd.primary_domain AS domain",
        [{"domain": "security", "subtopic": "penetration-testing"}],
    )
    pool.when(
        "SELECT DISTINCT canonical_name FROM entity_mentions WHERE entity_type = $1",
        [{"canonical_name": "LMS"}, {"canonical_name": "Audit"}],
        arg_matcher=lambda args: args == ("product",),
    )
    pool.when(
        "SELECT DISTINCT canonical_name FROM entity_mentions WHERE entity_type = $1",
        [{"canonical_name": "ISO 27001"}],
        arg_matcher=lambda args: args == ("certification",),
    )
    pool.when(
        "LIMIT 1",
        [{"id": "sd-co"}] if company_exists else [],
    )
    pool.when(
        "SELECT DISTINCT em.canonical_name FROM entity_mentions em",
        [{"canonical_name": "Acme Corp"}],
    )
    pool.when(
        # won-bid case_study enumeration grain (S443 amendment / BI-4 / DR-029)
        "ft.outcome = 'won'",
        [] if won_bids is None else won_bids,
    )
    return pool


class TestListConceptsFiveTypeSet:
    """BI-4/BI-5: the ratified 5-type set enumerates against a fixture
    corpus carrying evidence for every type."""

    def test_enumerates_all_5_ratified_types(self):
        src = LRecordsSource(_five_type_pool())

        keys = _run(src.list_concepts())

        assert {k.concept_type for k in keys} == CONCEPT_TYPES

    def test_topic_concepts_cover_both_scope_tag_and_domain_subtopic_locators(self):
        src = LRecordsSource(_five_type_pool())

        keys = _run(src.list_concepts())
        topics = [k for k in keys if k.concept_type == "topic"]

        assert {k.rel_path for k in topics} == {
            "topics/gdpr.md",
            "topics/encryption.md",
            "topics/security--penetration-testing.md",
        }
        scope_tag_key = next(k for k in topics if k.scope_tag == "gdpr")
        assert scope_tag_key.domain is None and scope_tag_key.subtopic is None
        domain_key = next(k for k in topics if k.domain == "security")
        assert domain_key.subtopic == "penetration-testing"
        assert domain_key.scope_tag is None

    def test_company_is_a_singleton_when_evidence_exists(self):
        src = LRecordsSource(_five_type_pool())

        keys = _run(src.list_concepts())
        companies = [k for k in keys if k.concept_type == "company"]

        assert len(companies) == 1
        assert companies[0].rel_path == "company/overview.md"

    def test_company_is_absent_without_evidence(self):
        # No company/team-structure source_documents row found — the
        # singleton must not be fabricated.
        src = LRecordsSource(_five_type_pool(company_exists=False))

        keys = _run(src.list_concepts())

        assert not any(k.concept_type == "company" for k in keys)

    def test_product_and_certification_and_case_study_rel_paths(self):
        src = LRecordsSource(_five_type_pool())

        keys = _run(src.list_concepts())
        by_type = {t: [k for k in keys if k.concept_type == t] for t in CONCEPT_TYPES}

        assert {k.entity_id for k in by_type["product"]} == {"LMS", "Audit"}
        assert {k.rel_path for k in by_type["product"]} == {
            "products/lms.md",
            "products/audit.md",
        }
        assert by_type["certification"][0].entity_id == "ISO 27001"
        assert by_type["certification"][0].rel_path == "certifications/iso-27001.md"
        assert by_type["case_study"][0].entity_id == "Acme Corp"
        assert by_type["case_study"][0].rel_path == "case-studies/acme-corp.md"


# ── read_concept(): the per-type join grid ──────────────────────────────


class TestReadConceptTopic:
    """topic: q_a_pairs cluster + source_document parents + reference_items
    + record_lifecycle (both owner kinds) + entity_mentions/relationships."""

    def _pool(self) -> FakePool:
        pool = FakePool()
        pool.when(
            "WHERE scope_tag @> ARRAY[$1]::text[] AND publication_status",
            [
                {
                    "id": "qa-1",
                    "question_text": "What is our GDPR posture?",
                    "answer_standard": "We comply via ...",
                    "answer_advanced": None,
                    "scope_tag": ["gdpr"],
                    "anti_scope_tag": [],
                    "source_document_id": "sd-1",
                    "origin_kind": "extracted_from_corpus",
                    "publication_status": "published",
                    "valid_from": None,
                    "valid_to": None,
                    "created_at": "t0",
                    "updated_at": "t0",
                }
            ],
            arg_matcher=lambda args: args == ("gdpr",),
        )
        pool.when(
            "FROM source_documents WHERE id = ANY($1::uuid[])",
            [{"id": "sd-1", "filename": "master-bid-library.md"}],
        )
        pool.when(
            "FROM reference_items",
            [{"id": "ri-1", "title": "External evidence", "source_document_id": "sd-1"}],
        )
        pool.when(
            "FROM record_lifecycle",
            [
                {"id": "rl-sd-1", "owner_kind": "source_document", "source_document_id": "sd-1"},
                {"id": "rl-qa-1", "owner_kind": "q_a_pair", "q_a_pair_id": "qa-1"},
            ],
        )
        pool.when(
            "FROM entity_mentions WHERE source_document_id = ANY($1::uuid[])",
            [{"id": "em-1", "source_document_id": "sd-1", "entity_type": "regulation", "canonical_name": "GDPR"}],
        )
        pool.when(
            "FROM entity_relationships",
            [{"id": "er-1", "source_entity": "GDPR", "relationship_type": "relates_to", "target_entity": "DPA"}],
        )
        return pool

    def test_read_concept_returns_all_six_topic_anchors(self):
        key = ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert isinstance(raw, ConceptRaw)
        assert [r["id"] for r in raw.q_a_pairs] == ["qa-1"]
        assert [r["id"] for r in raw.source_documents] == ["sd-1"]
        assert [r["id"] for r in raw.reference_items] == ["ri-1"]
        assert {r["owner_kind"] for r in raw.record_lifecycle} == {
            "source_document",
            "q_a_pair",
        }
        assert [r["id"] for r in raw.entity_mentions] == ["em-1"]
        assert [r["id"] for r in raw.entity_relationships] == ["er-1"]

    def test_topic_key_without_a_locator_raises(self):
        key = ConceptKey(rel_path="topics/orphan.md", concept_type="topic")
        src = LRecordsSource(self._pool())

        with pytest.raises(ValueError, match="scope_tag OR"):
            _run(src.read_concept(key))


class TestReadConceptProduct:
    """product: source_documents (product docs) + product-scoped q_a_pairs
    + reference_items. No record_lifecycle/entity_mentions in the grid."""

    def _pool(self) -> FakePool:
        pool = FakePool()
        pool.when(
            "filename ILIKE ANY($1::text[])",
            [{"id": "sd-lms", "filename": "LMS-bid-library.md"}],
            arg_matcher=lambda args: args == (["%LMS%"],),
        )
        pool.when(
            "source_document_id = ANY($1::uuid[]) OR scope_tag @> ARRAY[$2]::text[]",
            [{"id": "qa-lms-1", "question_text": "LMS uptime SLA?", "source_document_id": "sd-lms"}],
        )
        pool.when(
            "FROM reference_items",
            [{"id": "ri-lms-1", "source_document_id": "sd-lms"}],
        )
        return pool

    def test_read_concept_returns_the_3_product_anchors_only(self):
        key = ConceptKey(rel_path="products/lms.md", concept_type="product", entity_id="LMS")
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert [r["id"] for r in raw.source_documents] == ["sd-lms"]
        assert [r["id"] for r in raw.q_a_pairs] == ["qa-lms-1"]
        assert [r["id"] for r in raw.reference_items] == ["ri-lms-1"]
        assert raw.record_lifecycle == []
        assert raw.entity_mentions == []
        assert raw.entity_relationships == []


class TestReadConceptCompany:
    """company: source_documents (company-overview, team-structure) +
    reference_items + the company entity_mentions graph."""

    def _pool(self) -> FakePool:
        pool = FakePool()
        pool.when(
            "filename ILIKE ANY($1::text[])",
            [
                {"id": "sd-co", "filename": "01-company-overview.md"},
                {"id": "sd-team", "filename": "05-team-structure-and-key-people.md"},
            ],
            arg_matcher=lambda args: args
            == (["%company-overview%", "%team-structure%"],),
        )
        pool.when("FROM reference_items", [{"id": "ri-co-1", "source_document_id": "sd-co"}])
        pool.when(
            "FROM entity_mentions WHERE source_document_id = ANY($1::uuid[])",
            [{"id": "em-co-1", "entity_type": "person", "canonical_name": "Jane Doe"}],
        )
        return pool

    def test_read_concept_returns_the_company_anchors_and_no_q_a_pairs(self):
        key = ConceptKey(rel_path="company/overview.md", concept_type="company")
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert {r["id"] for r in raw.source_documents} == {"sd-co", "sd-team"}
        assert [r["id"] for r in raw.reference_items] == ["ri-co-1"]
        assert [r["id"] for r in raw.entity_mentions] == ["em-co-1"]
        assert raw.q_a_pairs == []
        assert raw.record_lifecycle == []
        assert raw.entity_relationships == []


class TestReadConceptCertification:
    """certification: source_documents (compliance) + reference_items +
    the certification's own entity_mentions (by canonical_name, across all
    docs — external evidence), not just those of the compliance doc."""

    def _pool(self) -> FakePool:
        pool = FakePool()
        pool.when(
            "filename ILIKE ANY($1::text[])",
            [{"id": "sd-comp", "filename": "07-compliance-governance-and-certifications.md"}],
            arg_matcher=lambda args: args == (["%compliance%"],),
        )
        pool.when("FROM reference_items", [{"id": "ri-cert-1", "source_document_id": "sd-comp"}])
        pool.when(
            "FROM entity_mentions WHERE entity_type = $1 AND canonical_name = $2",
            [{"id": "em-cert-1", "entity_type": "certification", "canonical_name": "ISO 27001"}],
            arg_matcher=lambda args: args == ("certification", "ISO 27001"),
        )
        return pool

    def test_read_concept_joins_entity_mentions_by_canonical_name_not_by_doc(self):
        key = ConceptKey(
            rel_path="certifications/iso-27001.md",
            concept_type="certification",
            entity_id="ISO 27001",
        )
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert [r["id"] for r in raw.source_documents] == ["sd-comp"]
        assert [r["id"] for r in raw.reference_items] == ["ri-cert-1"]
        assert [r["id"] for r in raw.entity_mentions] == ["em-cert-1"]
        assert raw.q_a_pairs == []
        assert raw.record_lifecycle == []
        assert raw.entity_relationships == []


class TestReadConceptCaseStudy:
    """case_study: source_documents (named-clients) + supporting q_a_pairs
    + reference_items."""

    def _pool(self) -> FakePool:
        pool = FakePool()
        pool.when(
            "filename ILIKE ANY($1::text[])",
            [{"id": "sd-clients", "filename": "04-named-clients-and-case-studies.md"}],
            arg_matcher=lambda args: args == (["%named-client%"],),
        )
        pool.when(
            "source_document_id = ANY($1::uuid[]) OR scope_tag @> ARRAY[$2]::text[]",
            [{"id": "qa-acme-1", "scope_tag": ["Acme Corp"], "source_document_id": "sd-clients"}],
        )
        pool.when("FROM reference_items", [{"id": "ri-acme-1", "source_document_id": "sd-clients"}])
        return pool

    def test_read_concept_returns_the_3_case_study_anchors_only(self):
        key = ConceptKey(
            rel_path="case-studies/acme-corp.md",
            concept_type="case_study",
            entity_id="Acme Corp",
        )
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert [r["id"] for r in raw.source_documents] == ["sd-clients"]
        assert [r["id"] for r in raw.q_a_pairs] == ["qa-acme-1"]
        assert [r["id"] for r in raw.reference_items] == ["ri-acme-1"]
        assert raw.record_lifecycle == []
        assert raw.entity_mentions == []
        assert raw.entity_relationships == []


# ── case_study won-bid grain (S443 amendment / DR-029 / {132.21}) ───────


def _won_bid_only_pool(won_bids: "list[dict]") -> FakePool:
    """A corpus whose ONLY concept evidence is won procurement workspaces —
    every other enumeration query returns empty, so `list_concepts()` yields
    exactly the won-bid case_study grain."""
    pool = FakePool()
    pool.when("SELECT DISTINCT unnest(scope_tag)", [])
    pool.when("SELECT DISTINCT sd.primary_domain AS domain", [])
    pool.when(
        "SELECT DISTINCT canonical_name FROM entity_mentions WHERE entity_type = $1", []
    )
    pool.when("LIMIT 1", [])
    pool.when("SELECT DISTINCT em.canonical_name FROM entity_mentions em", [])
    pool.when("ft.outcome = 'won'", won_bids)
    return pool


class TestConceptKeyWonBidLocator:
    """The won-bid grain adds a `workspace_id` locator to `ConceptKey` — a
    case_study-only field (the workspace whose won bid seeds the case study)."""

    def test_workspace_id_is_allowed_on_a_case_study_key(self):
        key = ConceptKey(
            rel_path="case-studies/transport-for-london.md",
            concept_type="case_study",
            entity_id="Transport for London",
            workspace_id="ws-1",
        )
        assert key.workspace_id == "ws-1"

    def test_workspace_id_is_rejected_on_a_non_case_study_key(self):
        with pytest.raises(ValueError, match="workspace_id"):
            ConceptKey(
                rel_path="topics/gdpr.md",
                concept_type="topic",
                scope_tag="gdpr",
                workspace_id="ws-1",
            )


class TestListConceptsWonBidCaseStudy:
    """A won procurement workspace (`application_types.key='procurement'` with a
    `form_templates.outcome='won'` form) is a first-class case_study source
    (TECH G-SOURCE amendment). The ConceptKey carries workspace id + buyer."""

    def test_won_procurement_workspace_yields_exactly_one_case_study_for_the_buyer(self):
        pool = _won_bid_only_pool(
            [{"workspace_id": "ws-1", "buyer": "Transport for London"}]
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        case_studies = [k for k in keys if k.concept_type == "case_study"]
        assert len(case_studies) == 1
        key = case_studies[0]
        assert key.entity_id == "Transport for London"
        assert key.workspace_id == "ws-1"
        assert key.rel_path == "case-studies/transport-for-london.md"

    def test_won_bid_grain_extends_rather_than_replaces_the_named_client_grain(self):
        # The named-client (Acme Corp) grain AND the won-bid (TfL) grain both
        # contribute case_study concepts — the won-bid source is additive.
        pool = _five_type_pool(
            won_bids=[{"workspace_id": "ws-1", "buyer": "Transport for London"}]
        )
        src = LRecordsSource(pool)

        case_studies = [
            k for k in _run(src.list_concepts()) if k.concept_type == "case_study"
        ]

        assert {k.entity_id for k in case_studies} == {"Acme Corp", "Transport for London"}
        tfl = next(k for k in case_studies if k.workspace_id == "ws-1")
        assert tfl.entity_id == "Transport for London"
        acme = next(k for k in case_studies if k.entity_id == "Acme Corp")
        assert acme.workspace_id is None  # named-client grain carries no workspace locator

    def test_dedupes_multiple_won_workspaces_for_the_same_buyer(self):
        # ORDER BY buyer, workspace_id → the earliest workspace wins
        # deterministically (one case study per buyer, BI-2 identity).
        pool = _won_bid_only_pool(
            [
                {"workspace_id": "ws-1", "buyer": "Transport for London"},
                {"workspace_id": "ws-9", "buyer": "Transport for London"},
            ]
        )
        src = LRecordsSource(pool)

        case_studies = [
            k for k in _run(src.list_concepts()) if k.concept_type == "case_study"
        ]

        assert len(case_studies) == 1
        assert case_studies[0].workspace_id == "ws-1"

    def test_no_won_bids_yields_no_won_bid_case_study(self):
        src = LRecordsSource(_won_bid_only_pool([]))

        assert _run(src.list_concepts()) == []

    def test_find_matches_a_won_bid_buyer_case_insensitively(self):
        src = LRecordsSource(
            _five_type_pool(
                won_bids=[{"workspace_id": "ws-1", "buyer": "Transport for London"}]
            )
        )

        hits = _run(src.find("transport"))

        assert [k.rel_path for k in hits] == ["case-studies/transport-for-london.md"]


class TestReadConceptWonBidCaseStudy:
    """won-bid grain read (TECH G-SOURCE amendment): the workspace row (buyer
    identity via `domain_metadata`) + won-bid-provenance `q_a_pairs`
    (`origin_kind='derived_from_form_response'`, `source_workspace_id`) + the
    won `form_templates` row (`outcome_notes`). NOT the named-clients
    source_documents/reference_items grain."""

    def _pool(self) -> FakePool:
        pool = FakePool()
        pool.when(
            "FROM workspaces WHERE id = $1",
            [
                {
                    "id": "ws-1",
                    "name": "TfL cloud tender",
                    "domain_metadata": {"buyer": "Transport for London"},
                }
            ],
            arg_matcher=lambda args: args == ("ws-1",),
        )
        pool.when(
            "source_workspace_id = $1 AND origin_kind",
            [
                {
                    "id": "qa-won-1",
                    "question_text": "Describe your SOC.",
                    "origin_kind": "derived_from_form_response",
                    "source_workspace_id": "ws-1",
                    "publication_status": "published",
                }
            ],
            arg_matcher=lambda args: args == ("ws-1",),
        )
        pool.when(
            "FROM form_templates WHERE workspace_id = $1",
            [
                {
                    "id": "ft-1",
                    "workspace_id": "ws-1",
                    "outcome": "won",
                    "outcome_notes": "Won on methodology + price.",
                }
            ],
            arg_matcher=lambda args: args == ("ws-1",),
        )
        return pool

    def _key(self) -> ConceptKey:
        return ConceptKey(
            rel_path="case-studies/transport-for-london.md",
            concept_type="case_study",
            entity_id="Transport for London",
            workspace_id="ws-1",
        )

    def test_surfaces_workspace_won_qa_pairs_and_outcome_notes(self):
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(self._key()))

        assert [r["id"] for r in raw.workspaces] == ["ws-1"]
        assert raw.workspaces[0]["domain_metadata"] == {"buyer": "Transport for London"}
        assert [r["id"] for r in raw.q_a_pairs] == ["qa-won-1"]
        assert [r["outcome_notes"] for r in raw.form_templates] == [
            "Won on methodology + price."
        ]

    def test_leaves_the_named_client_anchor_buckets_empty(self):
        # BI-9/BI-3: the won-bid grain anchors its q_a_pairs via the BI-8 query
        # form downstream, never as source_documents/reference_items rows, and
        # never a q_a_pair master uuid. The adapter leaves those buckets empty.
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(self._key()))

        assert raw.source_documents == []
        assert raw.reference_items == []
        assert raw.record_lifecycle == []
        assert raw.entity_mentions == []
        assert raw.entity_relationships == []

    def test_case_study_without_workspace_locator_still_reads_the_named_client_grain(self):
        # The won-bid grain is additive: a case_study key with NO workspace_id
        # still routes to the named-clients source_documents grain unchanged.
        pool = FakePool()
        pool.when(
            "filename ILIKE ANY($1::text[])",
            [{"id": "sd-clients", "filename": "04-named-clients-and-case-studies.md"}],
            arg_matcher=lambda args: args == (["%named-client%"],),
        )
        pool.when(
            "source_document_id = ANY($1::uuid[]) OR scope_tag @> ARRAY[$2]::text[]",
            [{"id": "qa-acme-1", "source_document_id": "sd-clients"}],
        )
        pool.when("FROM reference_items", [{"id": "ri-acme-1"}])
        key = ConceptKey(
            rel_path="case-studies/acme-corp.md",
            concept_type="case_study",
            entity_id="Acme Corp",
        )
        src = LRecordsSource(pool)

        raw = _run(src.read_concept(key))

        assert [r["id"] for r in raw.source_documents] == ["sd-clients"]
        assert raw.workspaces == []
        assert raw.form_templates == []


class TestSampleRowsWonBidCaseStudy:
    def test_won_bid_sample_uses_the_source_workspace_id_query_with_limit(self):
        pool = FakePool()
        pool.when(
            "source_workspace_id = $1 AND origin_kind",
            [{"id": "qa-won-1"}, {"id": "qa-won-2"}],
        )
        src = LRecordsSource(pool)
        key = ConceptKey(
            rel_path="case-studies/transport-for-london.md",
            concept_type="case_study",
            entity_id="Transport for London",
            workspace_id="ws-1",
        )

        rows = _run(src.sample_rows(key, 2))

        assert rows == [{"id": "qa-won-1"}, {"id": "qa-won-2"}]
        query, args = pool.calls[-1]
        assert query.rstrip().endswith("LIMIT $2")
        assert args == ("ws-1", 2)


# ── sample_rows(): bounded sample for the Pass-1 prompt window ─────────


class TestSampleRows:
    def test_non_positive_n_returns_empty_without_a_query(self):
        src = LRecordsSource(FakePool())  # no rules registered — must not be called

        assert _run(src.sample_rows(ConceptKey(rel_path="t.md", concept_type="topic", scope_tag="x"), 0)) == []
        assert _run(src.sample_rows(ConceptKey(rel_path="t.md", concept_type="topic", scope_tag="x"), -1)) == []

    def test_topic_sample_is_limited_and_carries_the_limit_arg(self):
        pool = FakePool()
        pool.when(
            "WHERE scope_tag @> ARRAY[$1]::text[] AND publication_status",
            [{"id": "qa-1"}, {"id": "qa-2"}],
        )
        src = LRecordsSource(pool)
        key = ConceptKey(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")

        rows = _run(src.sample_rows(key, 2))

        assert rows == [{"id": "qa-1"}, {"id": "qa-2"}]
        query, args = pool.calls[-1]
        assert query.rstrip().endswith("LIMIT $2")
        assert args == ("gdpr", 2)

    def test_company_sample_falls_back_to_source_documents(self):
        pool = FakePool()
        pool.when(
            "filename ILIKE ANY($1::text[])",
            [{"id": "sd-co"}, {"id": "sd-team"}],
        )
        pool.when("FROM reference_items", [])
        pool.when("FROM entity_mentions WHERE source_document_id = ANY($1::uuid[])", [])
        src = LRecordsSource(pool)
        key = ConceptKey(rel_path="company/overview.md", concept_type="company")

        rows = _run(src.sample_rows(key, 1))

        assert rows == [{"id": "sd-co"}]

    def test_product_sample_uses_the_source_docs_or_entity_query_with_limit(self):
        pool = FakePool()
        pool.when("filename ILIKE ANY($1::text[])", [{"id": "sd-lms"}])
        pool.when(
            "source_document_id = ANY($1::uuid[]) OR scope_tag @> ARRAY[$2]::text[]",
            [{"id": "qa-lms-1"}],
        )
        src = LRecordsSource(pool)
        key = ConceptKey(rel_path="products/lms.md", concept_type="product", entity_id="LMS")

        rows = _run(src.sample_rows(key, 5))

        assert rows == [{"id": "qa-lms-1"}]
        query, args = pool.calls[-1]
        assert query.rstrip().endswith("LIMIT $3")
        assert args == (["sd-lms"], "LMS", 5)


# ── find(): concrete substring-search helper ────────────────────────────


class TestFind:
    def test_empty_query_returns_no_concepts_without_a_lookup(self):
        src = LRecordsSource(FakePool())  # no rules registered — must not be called

        assert _run(src.find("")) == []

    def test_find_matches_case_insensitively_across_identity_fields(self):
        src = LRecordsSource(_five_type_pool())

        gdpr_hits = _run(src.find("GDPR"))
        acme_hits = _run(src.find("acme"))

        assert [k.rel_path for k in gdpr_hits] == ["topics/gdpr.md"]
        assert [k.rel_path for k in acme_hits] == ["case-studies/acme-corp.md"]

    def test_find_with_no_match_returns_empty(self):
        src = LRecordsSource(_five_type_pool())

        assert _run(src.find("nonexistent-needle")) == []


# ── Defect A ESCALATION (ID-132 {132.35} G-DEPLOY-PROOF) — memo-key protocol ──
#
# RUN 1 of the {132.35} deploy proof crashed inside a REAL cocoindex App run:
# `enrich_concept(key, source)` is `@coco.fn(memo=True)`, and the installed
# engine's `memo_fingerprint._make_call_canonical` (cocoindex==1.0.7,
# `_internal/memo_fingerprint.py:372-401`) canonicalizes EVERY positional/
# keyword arg of a memoised call — `source` (an `LRecordsSource` wrapping a
# live `asyncpg.Pool`) included. `enrich.py`'s prior docstring claim that
# `source` "is not part of the memo fingerprint's data-varying surface" was
# never actually exercised (the S463 harness had no ambient ComponentContext,
# so `enrich_concept` ran unmemoised, silently) and is FALSE against the
# installed engine — see `enrich.py`'s corrected module docstring.
#
# This class pins the CURRENT, ESCALATED state — NOT fixed by this Subtask:
# (1) LRecordsSource is NOT memo-keyable against the REAL engine's checker
# (reproduces RUN 1's exact TypeError against a pool double shaped like the
# real asyncpg.Pool — unpicklable, holding live lock/socket state, unlike a
# plain self-contained double which would accidentally succeed via the
# pickle-fallback and mask the defect); (2) ConceptKey carries NO
# content-varying signal in ANY of its fields, so even a `source`-side-only
# fix cannot satisfy BI-18's "a targeted record change re-drafts exactly
# that concept" direction — a memo-hit on an identity-unchanged-but-
# content-changed record would silently serve a STALE draft. Kept GREEN
# deliberately: whoever implements the real fix (a per-concept content-
# versioning mechanism) must touch these assertions, forcing a conscious
# update rather than a silent staleness regression.
class TestMemoKeyProtocolEscalation:
    def test_lrecords_source_is_not_memo_keyable_against_the_installed_engine(self):
        """Reproduces RUN 1's `TypeError: Unsupported type for memoization
        key` against the REAL installed `cocoindex==1.0.7` engine — no App/
        Environment boot required: `memo_fingerprint()` is a pure
        canonicalize + hash utility (empirically verified standalone,
        unlike `coco.App(...).update_blocking()`), so this needs neither the
        bl-218/bl-239 subprocess-isolation pattern nor an engine-availability
        skipif guard.
        """
        from cocoindex._internal.memo_fingerprint import memo_fingerprint

        class _UnpicklablePool:
            """Stands in for the real `asyncpg.Pool`, which holds live
            locks/sockets and is genuinely unpicklable — a plain
            self-contained pool double would accidentally succeed via
            `_canonicalize`'s `pickle.dumps` fallback and mask the defect."""

            def __init__(self) -> None:
                self._lock = threading.Lock()

            async def fetch(self, *args: object, **kwargs: object) -> list:
                return []

        source = LRecordsSource(_UnpicklablePool())

        with pytest.raises(TypeError, match="Unsupported type for memoization key"):
            memo_fingerprint(source)

    def test_concept_key_carries_no_content_varying_signal(self):
        """The {132.35} Defect A delta-contract trace: `ConceptKey`'s fields
        are exhaustively LOCATOR/identity fields — enumerated here so this
        test breaks (forcing deliberate review) the day a content-hash/
        `updated_at`/version-shaped field is added, which is the real fix
        this Subtask escalated rather than implemented ad hoc."""
        field_names = {f.name for f in dataclasses.fields(ConceptKey)}

        assert field_names == {
            "rel_path",
            "concept_type",
            "scope_tag",
            "domain",
            "subtopic",
            "entity_id",
            "workspace_id",
        }, (
            "ConceptKey's field set changed — if a content-hash/updated_at/"
            "version field was ADDED, the {132.35} Defect A escalation "
            "(enrich_concept's memo key carries no content-varying signal) "
            "may now be resolved; update enrich.py's memoisation docstring "
            "and re-evaluate whether `source` can safely become memo-keyable."
        )
