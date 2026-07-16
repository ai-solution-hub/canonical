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
    """{132.38} MD-5/C-2: `list_concepts()` now issues one additional
    `content_version` aggregate query per enumeration branch (8 total, see
    `l_records.py`'s "content_version aggregate signal" section) — every
    marker below is chosen to be a substring of EXACTLY ONE SQL constant
    (verified: the enum-query markers were narrowed where a version-aggregate
    query embeds the SAME enumeration subquery, e.g. `AS scope_tag` vs the
    aggregate's `AS tag` alias). None of the tests built on this fixture
    assert on `content_version` values, so every aggregate rule here returns
    empty rows — dedicated realistic-data fixtures live in
    `TestContentVersionSensitivity` below."""
    pool = FakePool()
    pool.when(
        "AS scope_tag FROM q_a_pairs",
        [{"scope_tag": "gdpr"}, {"scope_tag": "encryption"}],
    )
    pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
    pool.when(
        "SELECT DISTINCT sd.primary_domain AS domain",
        [{"domain": "security", "subtopic": "penetration-testing"}],
    )
    pool.when("sd.primary_subtopic AS subtopic, count(DISTINCT qa.id)", [])
    pool.when(
        "entity_type = $1 ORDER BY 1",
        [{"canonical_name": "LMS"}, {"canonical_name": "Audit"}],
        arg_matcher=lambda args: args == ("product",),
    )
    pool.when(
        "entity_type = $1 ORDER BY 1",
        [{"canonical_name": "ISO 27001"}],
        arg_matcher=lambda args: args == ("certification",),
    )
    pool.when("p.canonical_name AS canonical_name", [])
    pool.when(
        "LIMIT 1",
        [{"id": "sd-co"}] if company_exists else [],
    )
    pool.when("em_max FROM source_documents sd", [])
    pool.when("ri_max FROM source_documents sd", [])
    pool.when(
        "count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions",
        [],
        arg_matcher=lambda args: args == ("certification",),
    )
    pool.when(
        "JOIN source_documents sd ON sd.id = em.source_document_id",
        [{"canonical_name": "Acme Corp"}],
    )
    pool.when("c.canonical_name AS canonical_name", [])
    pool.when(
        # won-bid case_study enumeration grain (S443 amendment / BI-4 / DR-029;
        # {145.24}: form_instances-direct query post-{145.6} W1e, no more
        # `ft.`-aliased join)
        "COALESCE(issuing_organisation, name) AS buyer",
        [] if won_bids is None else won_bids,
    )
    pool.when("w.workspace_id AS workspace_id", [])
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
    exactly the won-bid case_study grain. {132.38} MD-5/C-2: markers mirror
    `_five_type_pool`'s disambiguation (see that fixture's docstring)."""
    pool = FakePool()
    pool.when("AS scope_tag FROM q_a_pairs", [])
    pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
    pool.when("SELECT DISTINCT sd.primary_domain AS domain", [])
    pool.when("sd.primary_subtopic AS subtopic, count(DISTINCT qa.id)", [])
    pool.when("entity_type = $1 ORDER BY 1", [])
    pool.when("p.canonical_name AS canonical_name", [])
    pool.when("LIMIT 1", [])
    pool.when("em_max FROM source_documents sd", [])
    pool.when("ri_max FROM source_documents sd", [])
    pool.when("count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", [])
    pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
    pool.when("c.canonical_name AS canonical_name", [])
    pool.when("COALESCE(issuing_organisation, name) AS buyer", won_bids)
    pool.when("w.workspace_id AS workspace_id", [])
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
    """A won procurement form (`form_instances.outcome='won'`) is a
    first-class case_study source (TECH G-SOURCE amendment; {145.24}:
    re-pointed off the deleted workspace/application_types join to a direct
    `form_instances` read post-{145.6} W1e). The ConceptKey carries the won
    form's own id (kept under the `workspace_id` field name — see that
    field's docstring) + buyer."""

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
    """won-bid grain read (TECH G-SOURCE amendment; {145.24} re-pointed
    post-{145.6} W1e workspace-stratum drop): won-bid-provenance `q_a_pairs`
    (`origin_kind='derived_from_form_response'`, `source_form_instance_id`)
    + the won `form_instances` row itself (`outcome_notes`). NOT the
    named-clients source_documents/reference_items grain. No `workspaces`
    fetch — the procurement workspace stratum no longer exists post-W1e, so
    buyer identity/outcome_notes come straight off the form."""

    def _pool(self) -> FakePool:
        pool = FakePool()
        pool.when(
            "source_form_instance_id = $1 AND origin_kind",
            [
                {
                    "id": "qa-won-1",
                    "question_text": "Describe your SOC.",
                    "origin_kind": "derived_from_form_response",
                    "source_form_instance_id": "ws-1",
                    "publication_status": "published",
                }
            ],
            arg_matcher=lambda args: args == ("ws-1",),
        )
        pool.when(
            "WHERE id = $1 AND outcome = 'won'",
            [
                {
                    "id": "ws-1",
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

    def test_surfaces_no_workspace_row_but_won_qa_pairs_and_outcome_notes(self):
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(self._key()))

        assert raw.workspaces == []
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
    def test_won_bid_sample_uses_the_source_form_instance_id_query_with_limit(self):
        pool = FakePool()
        pool.when(
            "source_form_instance_id = $1 AND origin_kind",
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


class _UnpicklablePool:
    """Stands in for the real `asyncpg.Pool`, which holds live locks/sockets
    and is genuinely unpicklable — a plain self-contained double would
    accidentally succeed via `_canonicalize`'s `pickle.dumps` fallback and
    mask the RUN-1 defect this canary reproduces/proves-fixed."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    async def fetch(self, *args: object, **kwargs: object) -> list:
        return []


# ── Defect A FIXED (ID-132 {132.38} G-MEMO-DELTA, DR-060) — memo-key protocol ──
#
# RUN 1 of the {132.35} deploy proof crashed inside a REAL cocoindex App run:
# `enrich_concept(key, source)` was `@coco.fn(memo=True)` (no exclusion), and
# the installed engine's `memo_fingerprint._make_call_canonical`
# (cocoindex==1.0.7, `_internal/memo_fingerprint.py:372-401`) canonicalizes
# EVERY positional/keyword arg of a memoised call — `source` (an
# `LRecordsSource` wrapping a live `asyncpg.Pool`) included, raising
# `TypeError: Unsupported type for memoization key`. {132.35} escalated
# rather than shipped an ad hoc fix, because excluding `source` alone is
# identity-only and would silently serve stale drafts (DR-047).
#
# {132.38} MEMO-DELTA (owner-ratified S469, DR-060) lands the real fix, and
# this class EVOLVES from pinning the unfixed state to pinning the FIXED
# contract (MD-11): (1) `source` is EXCLUDED via `memo_key={'source': None}`
# (MD-2) — proven both ways: WITHOUT the exclusion the RUN-1 TypeError still
# reproduces (the problem this fix solves), WITH it applied the same call
# fingerprints cleanly; (2) `ConceptKey.content_version` (MD-3) now drives
# the fingerprint — two keys with identical identity but different
# `content_version` fingerprint DIFFERENTLY (re-draft), identical
# `content_version` fingerprints IDENTICALLY (memo-hit). MD-8 (drafting-config
# invalidation) is NOT probed here empirically — DR-060 (S469 ratification of
# OQ-MD-1) rejected the `deps={...}` auto-invalidation design; a config
# re-draft is a MANUAL `@coco.fn(..., version=N)` bump recorded in the
# bundle's OKF `log.md` (`bundle_writer.append_log_entry`), not an
# engine-level fingerprint input — see `enrich.py`'s decorator + module
# docstring for the authoritative statement of that contract.
class TestMemoKeyProtocolEscalation:
    def _enrich_concept_shaped(
        self, key: object, source: object, *, model: str = "m", max_tokens: int = 1
    ) -> None:
        """A plain function shaped exactly like `enrich.enrich_concept`'s
        signature (`key`, `source`, keyword-only `model`/`max_tokens`) —
        never called, only fingerprinted. Kept local (not imported from
        `enrich.py`) so this canary needs no `cocoindex` stub: it exercises
        the REAL installed engine's pure canonicalize/fingerprint utilities
        directly, no App/Environment boot required (mirrors the pre-fix
        canary's `memo_fingerprint()`-is-a-pure-utility precedent)."""
        raise NotImplementedError  # pragma: no cover — never invoked

    def test_source_arg_still_unfingerprintable_without_the_memo_key_exclusion(self):
        """The PROBLEM this fix solves, still reproducible on demand: an
        unexcluded `source` arg (shaped like the real unpicklable
        `asyncpg.Pool`-backed `LRecordsSource`) raises exactly RUN 1's
        `TypeError` when fingerprinted with no `memo_key` plan applied."""
        from cocoindex._internal.memo_fingerprint import fingerprint_call

        source = _UnpicklablePool()
        with pytest.raises(TypeError, match="Unsupported type for memoization key"):
            fingerprint_call(
                self._enrich_concept_shaped, (object(), source), {}, []
            )

    def test_memo_key_source_none_excludes_source_and_fingerprints_cleanly(self):
        """MD-2 (fixed contract): `memo_key={'source': None}` — the EXACT
        kwarg `enrich.py`'s decorator carries — strips `source` from the
        fingerprint input BEFORE canonicalization
        (`_internal/function.py:418-448` `_apply_memo_key`/
        `_normalize_memo_key`, empirically verified against
        `cocoindex==1.0.7`), so the SAME unpicklable pool double that raises
        in the test above no longer reaches `_canonicalize` and no
        `TypeError` fires."""
        from cocoindex._internal.function import _apply_memo_key, _normalize_memo_key
        from cocoindex._internal.memo_fingerprint import fingerprint_call

        source = _UnpicklablePool()
        args = (object(), source)
        plan = _normalize_memo_key(self._enrich_concept_shaped, {"source": None})
        fixed_args, fixed_kwargs = _apply_memo_key(args, {}, plan)

        assert source not in fixed_args  # excluded, not merely transformed
        fingerprint_call(self._enrich_concept_shaped, fixed_args, fixed_kwargs, [])

    def test_content_version_drives_the_fingerprint(self):
        """MD-3 (the BI-18 delta lever, fixed contract): two `ConceptKey`s
        with identical identity but DIFFERENT `content_version` fingerprint
        differently (re-draft); identical `content_version` fingerprints
        identically (memo-hit) — `_canonicalize_dataclass`
        (`memo_fingerprint.py:131-151`) fingerprints every field in
        definition order, `content_version` included."""
        from cocoindex._internal.memo_fingerprint import memo_fingerprint

        base = dict(rel_path="topics/gdpr.md", concept_type="topic", scope_tag="gdpr")
        key_a1 = ConceptKey(**base, content_version="v-a")
        key_a2 = ConceptKey(**base, content_version="v-a")
        key_b = ConceptKey(**base, content_version="v-b")

        assert bytes(memo_fingerprint(key_a1)) == bytes(memo_fingerprint(key_a2))
        assert bytes(memo_fingerprint(key_a1)) != bytes(memo_fingerprint(key_b))

    def test_concept_key_now_carries_the_content_version_delta_signal(self):
        """Evolution of the {132.35} Defect A field-set pin (MD-11): the real
        fix landed — `content_version` is `ConceptKey`'s LAST field (MD-3),
        the per-concept BI-18 delta signal `_canonicalize_dataclass`
        fingerprints like every other field. Order (not just membership) is
        pinned — MD-4 requires it stay last, appended-not-inserted, so every
        pre-existing positional `ConceptKey(...)` construction stays valid."""
        field_names = [f.name for f in dataclasses.fields(ConceptKey)]

        assert field_names == [
            "rel_path",
            "concept_type",
            "scope_tag",
            "domain",
            "subtopic",
            "entity_id",
            "workspace_id",
            "content_version",
        ]


# ── content_version aggregate signal (ID-132 {132.38} G-MEMO-DELTA) ─────
#
# MD-5 (bounded, N-independent query count), MD-6 (sensitivity — changes iff
# a backing row is inserted/deleted/edited; deterministic; no wall-clock),
# MD-7 (backing-set coverage per type's read grid, including the
# `entity_mentions` in-place-edit case now that {132.40}'s migration gives it
# `updated_at` + an `ON UPDATE` trigger, so the aggregate is uniformly
# `count(*) + max(updated_at)` — no content-hash fallback needed, DR-060).


def _other_types_empty(pool: "FakePool") -> "FakePool":
    """Register empty-returning rules for every enumeration + content_version
    aggregate query this fixture is NOT exercising, so `list_concepts()`
    (which always fans out to all six `_list_*` methods) never hits an
    unmatched-rule `AssertionError`."""
    pool.when("SELECT DISTINCT sd.primary_domain AS domain", [])
    pool.when("sd.primary_subtopic AS subtopic, count(DISTINCT qa.id)", [])
    pool.when("entity_type = $1 ORDER BY 1", [])
    pool.when("p.canonical_name AS canonical_name", [])
    pool.when("LIMIT 1", [])
    pool.when("em_max FROM source_documents sd", [])
    pool.when("ri_max FROM source_documents sd", [])
    pool.when("count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", [])
    pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
    pool.when("c.canonical_name AS canonical_name", [])
    pool.when("COALESCE(issuing_organisation, name) AS buyer", [])
    pool.when("w.workspace_id AS workspace_id", [])
    return pool


def _topic_scope_tag_pool(*, em_max: "str | None") -> "FakePool":
    """A single `topic` concept (`scope_tag='gdpr'`) with a version-aggregate
    row whose `entity_mentions` term is parameterised by `em_max` — mirrors
    an in-place edit to an EXISTING `entity_mentions` row (e.g. a
    `confidence` bump) that moves `updated_at` without touching `created_at`
    or the row count (MD-7's explicit in-place-edit case, now closed by the
    {132.40} migration's `updated_at` + trigger rather than a content hash)."""
    pool = FakePool()
    pool.when("AS scope_tag FROM q_a_pairs", [{"scope_tag": "gdpr"}])
    pool.when(
        "t.tag AS tag, count(DISTINCT qa.id)",
        [
            {
                "tag": "gdpr",
                "qa_count": 1,
                "qa_max": "t0",
                "sd_count": 1,
                "sd_max": "t0",
                "ri_count": 0,
                "ri_max": None,
                "rl_count": 0,
                "rl_max": None,
                "em_count": 1,
                "em_max": em_max,
            }
        ],
    )
    return _other_types_empty(pool)


class TestContentVersionSensitivity:
    """MD-5/MD-6/MD-7: `content_version` changes iff a backing row is
    inserted/deleted/edited (including in-place), is deterministic (no
    wall-clock), and covers the full per-type read grid via a bounded number
    of DB `fetch` calls (never O(N) concepts)."""

    def test_topic_content_version_changes_on_entity_mentions_in_place_edit(self):
        """MD-6/MD-7's explicit in-place-edit case: an `entity_mentions` row
        keeps the SAME `created_at` but its `updated_at` moves (a
        `confidence`/`context_snippet` edit, {132.40}'s trigger-maintained
        column) — the topic's `content_version` MUST change, even though no
        row was inserted or deleted."""
        before = _run(LRecordsSource(_topic_scope_tag_pool(em_max="t0")).list_concepts())
        after = _run(LRecordsSource(_topic_scope_tag_pool(em_max="t1")).list_concepts())

        topic_before = next(k for k in before if k.concept_type == "topic")
        topic_after = next(k for k in after if k.concept_type == "topic")

        assert topic_before.content_version != topic_after.content_version

    def test_topic_content_version_is_byte_identical_on_noop_reenumeration(self):
        """MD-6: a no-op re-enumeration (byte-identical backing content)
        yields a byte-identical `content_version` — no wall-clock/run
        timestamp leaks in."""
        first = _run(LRecordsSource(_topic_scope_tag_pool(em_max="t0")).list_concepts())
        second = _run(LRecordsSource(_topic_scope_tag_pool(em_max="t0")).list_concepts())

        topic_first = next(k for k in first if k.concept_type == "topic")
        topic_second = next(k for k in second if k.concept_type == "topic")

        assert topic_first.content_version == topic_second.content_version
        assert topic_first.content_version != ""

    def test_content_version_query_count_is_bounded_and_n_independent(self):
        """MD-5: enumerating issues a BOUNDED, N-independent number of DB
        `fetch` calls for the version signal — the same fixed count whether
        the corpus enumerates one topic or several (never O(N) round-trips)."""
        pool_one = _topic_scope_tag_pool(em_max="t0")
        _run(LRecordsSource(pool_one).list_concepts())
        one_topic_call_count = len(pool_one.calls)

        many_pool = FakePool()
        many_pool.when(
            "AS scope_tag FROM q_a_pairs",
            [{"scope_tag": f"tag-{i}"} for i in range(25)],
        )
        many_pool.when(
            "t.tag AS tag, count(DISTINCT qa.id)",
            [
                {
                    "tag": f"tag-{i}",
                    "qa_count": 1,
                    "qa_max": "t0",
                    "sd_count": 1,
                    "sd_max": "t0",
                    "ri_count": 0,
                    "ri_max": None,
                    "rl_count": 0,
                    "rl_max": None,
                    "em_count": 1,
                    "em_max": "t0",
                }
                for i in range(25)
            ],
        )
        _other_types_empty(many_pool)
        _run(LRecordsSource(many_pool).list_concepts())
        many_topics_call_count = len(many_pool.calls)

        assert one_topic_call_count == many_topics_call_count

    def test_product_content_version_changes_when_a_backing_row_updates(self):
        """MD-6/MD-7 for the `product` grid (source_documents + q_a_pairs +
        reference_items)."""

        def _pool(sd_max: str) -> "FakePool":
            pool = FakePool()
            pool.when("AS scope_tag FROM q_a_pairs", [])
            pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
            pool.when("SELECT DISTINCT sd.primary_domain AS domain", [])
            pool.when("sd.primary_subtopic AS subtopic, count(DISTINCT qa.id)", [])
            pool.when(
                "entity_type = $1 ORDER BY 1",
                [{"canonical_name": "LMS"}],
                arg_matcher=lambda args: args == ("product",),
            )
            pool.when(
                "p.canonical_name AS canonical_name",
                [
                    {
                        "canonical_name": "LMS",
                        "sd_count": 1,
                        "sd_max": sd_max,
                        "qa_count": 1,
                        "qa_max": "t0",
                        "ri_count": 0,
                        "ri_max": None,
                    }
                ],
            )
            return _other_types_empty(pool)

        before = _run(LRecordsSource(_pool("t0")).list_concepts())
        after = _run(LRecordsSource(_pool("t1")).list_concepts())
        product_before = next(k for k in before if k.concept_type == "product")
        product_after = next(k for k in after if k.concept_type == "product")

        assert product_before.content_version != product_after.content_version

    def test_company_content_version_changes_when_a_backing_row_updates(self):
        """MD-6/MD-7 for the `company` grid (source_documents +
        reference_items + entity_mentions), singleton — no GROUP BY."""

        def _pool(em_max: str) -> "FakePool":
            pool = FakePool()
            pool.when("AS scope_tag FROM q_a_pairs", [])
            pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
            pool.when("SELECT DISTINCT sd.primary_domain AS domain", [])
            pool.when("sd.primary_subtopic AS subtopic, count(DISTINCT qa.id)", [])
            pool.when("entity_type = $1 ORDER BY 1", [])
            pool.when("p.canonical_name AS canonical_name", [])
            pool.when("LIMIT 1", [{"id": "sd-co"}])
            pool.when(
                "em_max FROM source_documents sd",
                [
                    {
                        "sd_count": 2,
                        "sd_max": "t0",
                        "ri_count": 1,
                        "ri_max": "t0",
                        "em_count": 1,
                        "em_max": em_max,
                    }
                ],
            )
            pool.when("ri_max FROM source_documents sd", [])
            pool.when(
                "count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", []
            )
            pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
            pool.when("c.canonical_name AS canonical_name", [])
            pool.when("COALESCE(issuing_organisation, name) AS buyer", [])
            pool.when("w.workspace_id AS workspace_id", [])
            return pool

        before = _run(LRecordsSource(_pool("t0")).list_concepts())
        after = _run(LRecordsSource(_pool("t1")).list_concepts())
        company_before = next(k for k in before if k.concept_type == "company")
        company_after = next(k for k in after if k.concept_type == "company")

        assert company_before.content_version != company_after.content_version

    def test_certification_content_version_changes_on_entity_mentions_in_place_edit(
        self,
    ):
        """MD-6/MD-7's explicit in-place-edit case for `certification`: its
        OWN `entity_mentions` (by canonical_name, across all docs) is the
        per-name term — a `confidence` edit there must change that
        certification's `content_version` without touching the shared
        compliance-doc `source_documents`/`reference_items` term."""

        def _pool(em_max: str) -> "FakePool":
            pool = FakePool()
            pool.when("AS scope_tag FROM q_a_pairs", [])
            pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
            pool.when("SELECT DISTINCT sd.primary_domain AS domain", [])
            pool.when("sd.primary_subtopic AS subtopic, count(DISTINCT qa.id)", [])
            pool.when(
                "entity_type = $1 ORDER BY 1",
                [],
                arg_matcher=lambda args: args == ("product",),
            )
            pool.when(
                "entity_type = $1 ORDER BY 1",
                [{"canonical_name": "ISO 27001"}],
                arg_matcher=lambda args: args == ("certification",),
            )
            pool.when("p.canonical_name AS canonical_name", [])
            pool.when("LIMIT 1", [])
            pool.when("em_max FROM source_documents sd", [])
            pool.when(
                "ri_max FROM source_documents sd",
                [{"sd_count": 1, "sd_max": "t0", "ri_count": 1, "ri_max": "t0"}],
            )
            pool.when(
                "count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions",
                [{"canonical_name": "ISO 27001", "em_count": 1, "em_max": em_max}],
                arg_matcher=lambda args: args == ("certification",),
            )
            pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
            pool.when("c.canonical_name AS canonical_name", [])
            pool.when("COALESCE(issuing_organisation, name) AS buyer", [])
            pool.when("w.workspace_id AS workspace_id", [])
            return pool

        before = _run(LRecordsSource(_pool("t0")).list_concepts())
        after = _run(LRecordsSource(_pool("t1")).list_concepts())
        cert_before = next(k for k in before if k.concept_type == "certification")
        cert_after = next(k for k in after if k.concept_type == "certification")

        assert cert_before.content_version != cert_after.content_version

    def test_case_study_named_client_content_version_changes_when_a_row_updates(self):
        """MD-6/MD-7 for the named-clients `case_study` grid (source_documents
        + q_a_pairs + reference_items)."""

        def _pool(qa_max: str) -> "FakePool":
            pool = FakePool()
            pool.when("AS scope_tag FROM q_a_pairs", [])
            pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
            pool.when("SELECT DISTINCT sd.primary_domain AS domain", [])
            pool.when("sd.primary_subtopic AS subtopic, count(DISTINCT qa.id)", [])
            pool.when("entity_type = $1 ORDER BY 1", [])
            pool.when("p.canonical_name AS canonical_name", [])
            pool.when("LIMIT 1", [])
            pool.when("em_max FROM source_documents sd", [])
            pool.when("ri_max FROM source_documents sd", [])
            pool.when(
                "count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", []
            )
            pool.when(
                "JOIN source_documents sd ON sd.id = em.source_document_id",
                [{"canonical_name": "Acme Corp"}],
            )
            pool.when(
                "c.canonical_name AS canonical_name",
                [
                    {
                        "canonical_name": "Acme Corp",
                        "sd_count": 1,
                        "sd_max": "t0",
                        "qa_count": 1,
                        "qa_max": qa_max,
                        "ri_count": 0,
                        "ri_max": None,
                    }
                ],
            )
            pool.when("COALESCE(issuing_organisation, name) AS buyer", [])
            pool.when("w.workspace_id AS workspace_id", [])
            return pool

        before = _run(LRecordsSource(_pool("t0")).list_concepts())
        after = _run(LRecordsSource(_pool("t1")).list_concepts())
        cs_before = next(
            k for k in before if k.concept_type == "case_study" and k.workspace_id is None
        )
        cs_after = next(
            k for k in after if k.concept_type == "case_study" and k.workspace_id is None
        )

        assert cs_before.content_version != cs_after.content_version

    def test_won_bid_case_study_content_version_changes_when_a_row_updates(self):
        """MD-6/MD-7 for the won-bid `case_study` grid (q_a_pairs +
        form_instances, {145.24})."""

        def _pool(fi_max: str) -> "FakePool":
            pool = FakePool()
            pool.when("AS scope_tag FROM q_a_pairs", [])
            pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
            pool.when("SELECT DISTINCT sd.primary_domain AS domain", [])
            pool.when("sd.primary_subtopic AS subtopic, count(DISTINCT qa.id)", [])
            pool.when("entity_type = $1 ORDER BY 1", [])
            pool.when("p.canonical_name AS canonical_name", [])
            pool.when("LIMIT 1", [])
            pool.when("em_max FROM source_documents sd", [])
            pool.when("ri_max FROM source_documents sd", [])
            pool.when(
                "count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", []
            )
            pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
            pool.when("c.canonical_name AS canonical_name", [])
            pool.when(
                "COALESCE(issuing_organisation, name) AS buyer",
                [{"workspace_id": "ws-1", "buyer": "Transport for London"}],
            )
            pool.when(
                "w.workspace_id AS workspace_id",
                [
                    {
                        "workspace_id": "ws-1",
                        "qa_count": 1,
                        "qa_max": "t0",
                        "fi_count": 1,
                        "fi_max": fi_max,
                    }
                ],
            )
            return pool

        before = _run(LRecordsSource(_pool("t0")).list_concepts())
        after = _run(LRecordsSource(_pool("t1")).list_concepts())
        wb_before = next(k for k in before if k.workspace_id == "ws-1")
        wb_after = next(k for k in after if k.workspace_id == "ws-1")

        assert wb_before.content_version != wb_after.content_version
