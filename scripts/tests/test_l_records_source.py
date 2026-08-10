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

from scripts.cocoindex_pipeline.sources.base import (
    ConceptKey,
    ConceptRaw,
    Source,
)

from scripts.cocoindex_pipeline.sources import l_records  # noqa: E402
from scripts.cocoindex_pipeline.sources.l_records import (  # noqa: E402
    BUILTIN_GRAIN_TYPE_LABELS as _BUILTIN_GRAIN_LABELS,
    LRecordsSource,
)

# ID-427 {427.7}: the built-in grains' type labels are now DERIVED from the
# grain registry (`_BUILTIN_GRAINS`) rather than hand-listed here — {427.5}
# left this set as a literal with an explicit {427.7} expiry, and importing
# it is what makes that expiry real. Still NOT a register the producer holds
# (DR-141): it is what those grains happen to emit, and any grain may emit
# any well-shaped label.

# ID-427 {427.10}: the registry now holds two KINDS of grain, and several
# assertions below have to say which they mean. A preferred grain enumerates
# from its own evidence; a residual grain enumerates the complement of what
# the preferred ones covered, so it contributes nothing to a corpus with no
# residue. Both are derived from the registry — spelling either out by hand
# would reintroduce exactly the hand-mirrored list {427.7} retired.
_RESIDUAL_GRAIN_LABELS = frozenset(
    spec.type_label for spec in l_records._BUILTIN_GRAINS if spec.runs_last
)
_PREFERRED_GRAIN_LABELS = frozenset(
    spec.type_label for spec in l_records._BUILTIN_GRAINS if not spec.runs_last
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

    def when_first(self, marker: str, rows: list[dict], *, arg_matcher=None) -> "FakePool":
        """Register a rule at the FRONT of the match order, so it OVERRIDES
        an already-registered rule for the same query. ID-427 {427.9}: the
        shared enumeration fixtures below register the census/coverage
        queries as empty by default, and a test that asserts on the census
        re-registers them with real rows — front-insertion is what lets the
        two compose without every fixture growing census parameters."""
        self._rules.insert(0, (marker, rows, arg_matcher))
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
        key = ConceptKey(
            rel_path="topics/gdpr.md", concept_type="topic", grain="topic_scope_tag"
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            key.rel_path = "topics/tampered.md"

    def test_equal_by_value(self):
        a = ConceptKey(
            rel_path="topics/gdpr.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="gdpr",
        )
        b = ConceptKey(
            rel_path="topics/gdpr.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="gdpr",
        )
        assert a == b
        assert hash(a) == hash(b)

    def test_rejects_empty_rel_path(self):
        with pytest.raises(ValueError, match="rel_path"):
            ConceptKey(rel_path="", concept_type="topic", grain="topic_scope_tag")

    def test_domain_subtopic_locator_fields_are_retired(self):
        """S531 (DR-125 expiry ruled): the domain/subtopic fallback topic
        grain is deleted — `ConceptKey` must not silently re-grow the
        fields, because a rel_path minted from them is a DIFFERENT concept
        identity under BI-2."""
        with pytest.raises(TypeError):
            ConceptKey(
                rel_path="topics/gdpr.md",
                concept_type="topic",
                grain="topic_scope_tag",
                scope_tag="gdpr",
                domain="security",
                subtopic="data-protection",
            )

    def test_a_concept_key_accepts_a_type_no_register_ever_held(self):
        # REPLACES `test_concept_types_is_the_5_ratified_bi4_set`, which
        # pinned the deleted `CONCEPT_TYPES` frozenset. ID-427 {427.5} /
        # DR-141: the Source model imposes no vocabulary, so a grain can
        # mint a label this codebase has never contained without editing
        # anything. `procurement_policy` was in no register, ever.
        key = ConceptKey(
            rel_path="topics/procurement-policy.md",
            concept_type="procurement_policy",
            grain="topic_scope_tag",
        )
        assert key.concept_type == "procurement_policy"


class TestBI3AQaPairIsNeverAConcept:
    """BI-3: no bundle file represents a single q_a_pair — a Q&A pair is a
    *record*, never a concept. UNCONDITIONAL, and deliberately untouched by
    {427.5}: BI-3 is a reserved NAME, not a permitted-value register."""

    def test_constructing_a_q_a_pair_concept_key_raises(self):
        with pytest.raises(ValueError, match="q_a_pair"):
            ConceptKey(
                rel_path="q_a_pairs/1.md",
                concept_type="q_a_pair",
                grain="topic_scope_tag",
            )

    def test_rejects_a_malformed_type_label(self):
        # REPLACES `test_rejects_any_type_outside_the_ratified_set`, which
        # asserted `metric` was refused for being outside the BI-4 set —
        # `metric` is now a perfectly good label and is accepted. What the
        # key still refuses is a label that is not well FORMED.
        # no longer raises
        ConceptKey(rel_path="x.md", concept_type="metric", grain="g")
        for malformed in ("Q A Pair!", "x", "a_very_long_five_word_type_label", ""):
            with pytest.raises(ValueError, match="well-formed OKF type label"):
                ConceptKey(rel_path="x.md", concept_type=malformed, grain="g")

    def test_list_concepts_never_yields_a_q_a_pair_type(self):
        pool = _five_type_pool()
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert keys, "the fixture corpus must yield at least one concept"
        assert all(k.concept_type != "q_a_pair" for k in keys)
        assert all(k.concept_type in _BUILTIN_GRAIN_LABELS for k in keys)


# ── Source protocol conformance ─────────────────────────────────────────


class TestSourceProtocolConformance:
    def test_l_records_source_conforms_to_the_local_source_protocol(self):
        assert isinstance(LRecordsSource(pool=FakePool()), Source)


def _census_queries(
    pool: "FakePool",
    *,
    topic: "list[dict] | None" = None,
    documents: "list[dict] | None" = None,
    pairs: "list[dict] | None" = None,
    won_bid_pairs: "list[dict] | None" = None,
    totals: "dict | None" = None,
    residual_documents: "list[dict] | None" = None,
    residual_pairs: "list[dict] | None" = None,
) -> "FakePool":
    """ID-427 {427.9}: register the coverage + corpus-total rules every
    enumerating fixture now needs.

    `list_concepts()` issues one set-based coverage query per unit kind each
    grain can reach (TECH §2.1 — coverage is not a static predicate, so
    every grain declares its own), and `census()` issues the corpus totals.
    That is a real change to what the adapter asks the pool for, so
    `FakePool`'s unmatched-query `AssertionError` fires until a fixture says
    so — deliberately left strict rather than softened to a silent `[]`,
    because that assertion is what catches query drift.

    ID-427 {427.10} adds the two RESIDUAL anti-joins (TECH §2.1) to the same
    list. They run on every enumeration — the residual grains are registry
    entries like any other — and returning empty for both is the fixture
    saying "this corpus has no residue", which is what every pre-{427.10}
    test in this module was implicitly asserting. A test that wants residue
    passes `residual_documents=`/`residual_pairs=` and registers the
    downstream reads itself; `_residual_pool` below is the shared way to do
    that.

    Defaults are empty/zero: the fixtures below assert on ENUMERATION, and
    a census they do not exercise must contribute nothing. Registered via
    `when_first`, so a census-asserting test can call this a SECOND time on
    the same fixture's pool and have its rows win — see
    `TestTheCensusIsAMeasurementNotADefault`."""
    pool.when_first("AS q_a_pair_id", topic if topic is not None else [])
    pool.when_first(
        "FROM source_documents WHERE publication_status = 'published' AND id <> ALL",
        residual_documents if residual_documents is not None else [],
    )
    pool.when_first(
        "FROM q_a_pairs WHERE publication_status = 'published' AND id <> ALL",
        residual_pairs if residual_pairs is not None else [],
    )
    pool.when_first(
        "SELECT id FROM source_documents WHERE (filename ILIKE",
        documents if documents is not None else [],
    )
    pool.when_first("OR scope_tag && $2::text[]", pairs if pairs is not None else [])
    pool.when_first(
        "source_form_instance_id = ANY($1::uuid[])",
        won_bid_pairs if won_bid_pairs is not None else [],
    )
    pool.when_first(
        "count(*) FROM source_documents WHERE publication_status",
        [totals if totals is not None else {"source_documents": 0, "q_a_pairs": 0}],
    )
    return pool


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
    pool.when("sd_max FROM source_documents sd", [])
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
    pool.when("w.form_instance_id AS form_instance_id", [])
    return _census_queries(pool)


class TestListConceptsFiveTypeSet:
    """BI-4/BI-5: the ratified 5-type set enumerates against a fixture
    corpus carrying evidence for every type."""

    def test_enumerates_all_5_ratified_types(self):
        """ID-427 {427.10}: the comparison set narrows from *every* built-in
        grain label to the PREFERRED grains' labels. `BUILTIN_GRAIN_TYPE_
        LABELS` now also contains `document`/`questionnaire_response`/
        `answer_set`, and those three appear only where the corpus has
        residue — this fixture's does not. The narrowing is not a weakening:
        the second assertion below turns what used to be implicit into a
        stated claim, and it is the claim {427.10} could most easily get
        wrong (an always-present empty placeholder)."""
        src = LRecordsSource(_five_type_pool())

        keys = _run(src.list_concepts())

        assert {k.concept_type for k in keys} == _PREFERRED_GRAIN_LABELS
        assert _RESIDUAL_GRAIN_LABELS <= _BUILTIN_GRAIN_LABELS

    def test_a_corpus_with_no_residue_mints_no_residual_concept(self):
        """The absence half of {427.10}'s AC. A fully-covered corpus must
        produce no `documents/`, no `questionnaire-responses/` and above all
        no `unattributed-answers/` placeholder — a bundle that always carries
        an empty "we could not attribute these" page asserts a hole that does
        not exist, which is the mirror image of the silence the residual
        grain removes."""
        src = LRecordsSource(_five_type_pool())

        keys = _run(src.list_concepts())

        assert not [k for k in keys if k.concept_type in _RESIDUAL_GRAIN_LABELS]
        assert not [k for k in keys if k.rel_path.startswith("unattributed-answers/")]

    def test_topic_concepts_enumerate_scope_tags_only(self):
        """S531: scope_tag is the sole topic grain — no `--` fallback
        rel_paths may appear (a fallback path minted here would be a NEW
        concept identity under BI-2)."""
        src = LRecordsSource(_five_type_pool())

        keys = _run(src.list_concepts())
        topics = [k for k in keys if k.concept_type == "topic"]

        assert {k.rel_path for k in topics} == {
            "topics/gdpr.md",
            "topics/encryption.md",
        }
        assert all(k.scope_tag is not None for k in topics)
        assert not any("--" in k.rel_path for k in topics)

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
        by_type = {
            t: [k for k in keys if k.concept_type == t]
            for t in _BUILTIN_GRAIN_LABELS
        }

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
    """topic: q_a_pairs cluster + source_document parents + record_lifecycle
    (both owner kinds) + entity_mentions/relationships. (The reference_items
    leg retired with the ri<->sd join path — DR-124.)"""

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

    def test_read_concept_returns_all_five_topic_anchors(self):
        key = ConceptKey(
            rel_path="topics/gdpr.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="gdpr",
        )
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert isinstance(raw, ConceptRaw)
        assert [r["id"] for r in raw.q_a_pairs] == ["qa-1"]
        assert [r["id"] for r in raw.source_documents] == ["sd-1"]
        # DR-124: the ri evidence leg retired with the ri<->sd join path.
        assert raw.reference_items == []
        assert {r["owner_kind"] for r in raw.record_lifecycle} == {
            "source_document",
            "q_a_pair",
        }
        assert [r["id"] for r in raw.entity_mentions] == ["em-1"]
        assert [r["id"] for r in raw.entity_relationships] == ["er-1"]

    def test_topic_key_without_a_locator_raises(self):
        key = ConceptKey(
            rel_path="topics/orphan.md",
            concept_type="topic",
            grain="topic_scope_tag",
        )
        src = LRecordsSource(self._pool())

        with pytest.raises(ValueError, match="needs scope_tag"):
            _run(src.read_concept(key))


class TestReadConceptProduct:
    """product: source_documents (product docs) + product-scoped q_a_pairs.
    No record_lifecycle/entity_mentions in the grid (ri leg retired, DR-124)."""

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
        return pool

    def test_read_concept_returns_the_2_product_anchors_only(self):
        key = ConceptKey(
            rel_path="products/lms.md",
            concept_type="product",
            grain="product_entity_mention",
            entity_id="LMS",
        )
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert [r["id"] for r in raw.source_documents] == ["sd-lms"]
        assert [r["id"] for r in raw.q_a_pairs] == ["qa-lms-1"]
        # DR-124: the ri evidence leg retired with the ri<->sd join path.
        assert raw.reference_items == []
        assert raw.record_lifecycle == []
        assert raw.entity_mentions == []
        assert raw.entity_relationships == []


class TestReadConceptCompany:
    """company: source_documents (company-overview, team-structure) + the
    company entity_mentions graph (ri leg retired, DR-124)."""

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
        pool.when(
            "FROM entity_mentions WHERE source_document_id = ANY($1::uuid[])",
            [{"id": "em-co-1", "entity_type": "person", "canonical_name": "Jane Doe"}],
        )
        return pool

    def test_read_concept_returns_the_company_anchors_and_no_q_a_pairs(self):
        key = ConceptKey(
            rel_path="company/overview.md",
            concept_type="company",
            grain="company_singleton",
        )
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert {r["id"] for r in raw.source_documents} == {"sd-co", "sd-team"}
        # DR-124: the ri evidence leg retired with the ri<->sd join path.
        assert raw.reference_items == []
        assert [r["id"] for r in raw.entity_mentions] == ["em-co-1"]
        assert raw.q_a_pairs == []
        assert raw.record_lifecycle == []
        assert raw.entity_relationships == []


class TestReadConceptCertification:
    """certification: source_documents (compliance) + the certification's
    own entity_mentions (by canonical_name, across all docs — external
    evidence), not just those of the compliance doc (ri leg retired,
    DR-124)."""

    def _pool(self) -> FakePool:
        pool = FakePool()
        pool.when(
            "filename ILIKE ANY($1::text[])",
            [{"id": "sd-comp", "filename": "07-compliance-governance-and-certifications.md"}],
            arg_matcher=lambda args: args == (["%compliance%"],),
        )
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
            grain="certification_entity_mention",
            entity_id="ISO 27001",
        )
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert [r["id"] for r in raw.source_documents] == ["sd-comp"]
        # DR-124: the ri evidence leg retired with the ri<->sd join path.
        assert raw.reference_items == []
        assert [r["id"] for r in raw.entity_mentions] == ["em-cert-1"]
        assert raw.q_a_pairs == []
        assert raw.record_lifecycle == []
        assert raw.entity_relationships == []


class TestReadConceptCaseStudy:
    """case_study: source_documents (named-clients) + supporting q_a_pairs
    (ri leg retired, DR-124)."""

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
        return pool

    def test_read_concept_returns_the_3_case_study_anchors_only(self):
        key = ConceptKey(
            rel_path="case-studies/acme-corp.md",
            concept_type="case_study",
            grain="case_study_named_client",
            entity_id="Acme Corp",
        )
        src = LRecordsSource(self._pool())

        raw = _run(src.read_concept(key))

        assert [r["id"] for r in raw.source_documents] == ["sd-clients"]
        assert [r["id"] for r in raw.q_a_pairs] == ["qa-acme-1"]
        # DR-124: the ri evidence leg retired with the ri<->sd join path.
        assert raw.reference_items == []
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
    pool.when("sd_max FROM source_documents sd", [])
    pool.when("count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", [])
    pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
    pool.when("c.canonical_name AS canonical_name", [])
    pool.when("COALESCE(issuing_organisation, name) AS buyer", won_bids)
    pool.when("w.form_instance_id AS form_instance_id", [])
    return _census_queries(pool)


class TestWonBidLocatorOwnership:
    """`form_instance_id` is the won-bid GRAIN's locator, and only that grain's.

    **ID-427 {427.7} re-keyed this rule, and moved where it is enforced.** It
    was `ConceptKey.__post_init__`'s `concept_type != 'case_study'` check —
    a rule keyed on a relabellable LABEL. `type_label` is now a grain's to
    change, and PI-5 says a relabel changes what the bundle SAYS and nothing
    else; under the old check, relabelling the won-bid grain would have made
    every one of its keys raise at construction. The rule is now keyed on
    `grain` and lives with the registry that knows which grain declares the
    locator (`LRecordsSource.grain_for`), which is also where the routing it
    protects now happens.

    The behavioural claim is unchanged: a locator set on the wrong grain is a
    loud error, not a silent mis-read."""

    def test_the_won_bid_grain_carries_its_locator(self):
        key = ConceptKey(
            rel_path="case-studies/transport-for-london.md",
            concept_type="case_study",
            grain="case_study_won_bid",
            entity_id="Transport for London",
            form_instance_id="ws-1",
        )
        assert key.form_instance_id == "ws-1"

    def test_the_locator_on_another_grain_fails_loud_at_read(self):
        src = LRecordsSource(FakePool())  # no rules — must fail before any query
        key = ConceptKey(
            rel_path="topics/gdpr.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="gdpr",
            form_instance_id="ws-1",
        )

        with pytest.raises(ValueError, match="form_instance_id"):
            _run(src.read_concept(key))

    def test_relabelling_the_won_bid_grain_does_not_trip_the_locator_rule(
        self, monkeypatch
    ):
        """The reason the rule could not stay keyed on `concept_type`. The
        won-bid grain emits a different label; its keys still construct and
        still route to the won-bid read."""
        relabelled = tuple(
            dataclasses.replace(spec, type_label="won_bid")
            if spec.name == "case_study_won_bid"
            else spec
            for spec in l_records._BUILTIN_GRAINS
        )
        monkeypatch.setattr(l_records, "_BUILTIN_GRAINS", relabelled)
        src = LRecordsSource(_won_bid_only_pool([{"form_instance_id": "ws-1", "buyer": "TfL"}]))

        keys = _run(src.list_concepts())

        won = next(k for k in keys if k.grain == "case_study_won_bid")
        assert won.concept_type == "won_bid"
        assert won.form_instance_id == "ws-1"

    def test_an_unregistered_grain_fails_loud_naming_what_is_registered(self):
        src = LRecordsSource(FakePool())
        key = ConceptKey(
            rel_path="widgets/sprocket.md",
            concept_type="widget",
            grain="widget_grain",
        )

        with pytest.raises(ValueError, match="unknown grain 'widget_grain'"):
            _run(src.read_concept(key))


class TestListConceptsWonBidCaseStudy:
    """A won procurement form (`form_instances.outcome='won'`) is a
    first-class case_study source (TECH G-SOURCE amendment; {145.24}:
    re-pointed off the deleted workspace/application_types join to a direct
    `form_instances` read post-{145.6} W1e). The ConceptKey carries the won
    form's own id (kept under the `form_instance_id` field name — see that
    field's docstring) + buyer."""

    def test_won_procurement_workspace_yields_exactly_one_case_study_for_the_buyer(self):
        pool = _won_bid_only_pool(
            [{"form_instance_id": "ws-1", "buyer": "Transport for London"}]
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        case_studies = [k for k in keys if k.concept_type == "case_study"]
        assert len(case_studies) == 1
        key = case_studies[0]
        assert key.entity_id == "Transport for London"
        assert key.form_instance_id == "ws-1"
        # ID-427 {427.8}: was `case-studies/transport-for-london.md`. The
        # won-bid grain declares `case-studies/won-bid`, so its IDENTITY is
        # now the path its file was already written to — `producer/bundle_
        # writer` used to append `won-bid/` at write time and leave identity
        # behind. The physical layout is unchanged; what moved is which of
        # the two strings the concept is called by.
        assert key.rel_path == "case-studies/won-bid/transport-for-london.md"

    def test_the_won_bid_identity_is_the_path_its_file_is_written_to(self):
        """The {427.8} collapse, asserted where it is decided.

        Before {427.8} a won-bid concept had TWO paths: an identity
        `rel_path` minted here and a physical write target `producer/
        bundle_writer._won_bid_case_study_redirect` derived from it. Every
        consumer then had to know which one it wanted, and three of them
        (the BI-9 catalogue, Pass-1's `read_concept_raw` router, the DR-016
        override key) silently wanted identity and silently got the wrong
        concept. The property that replaces all of it: the directory on the
        key is the directory the grain declares, and there is no second
        rule."""
        won_bid_spec = next(
            s for s in l_records._BUILTIN_GRAINS if s.name == l_records.WON_BID_GRAIN
        )
        assert won_bid_spec.directory == "case-studies/won-bid"

        src = LRecordsSource(
            _won_bid_only_pool([{"form_instance_id": "ws-1", "buyer": "TfL"}])
        )
        key = next(
            k
            for k in _run(src.list_concepts())
            if k.grain == l_records.WON_BID_GRAIN
        )
        assert key.rel_path.startswith(f"{won_bid_spec.directory}/")
        assert key.rel_path == "case-studies/won-bid/tfl.md"

    def test_won_bid_grain_extends_rather_than_replaces_the_named_client_grain(self):
        # The named-client (Acme Corp) grain AND the won-bid (TfL) grain both
        # contribute case_study concepts — the won-bid source is additive.
        pool = _five_type_pool(
            won_bids=[{"form_instance_id": "ws-1", "buyer": "Transport for London"}]
        )
        src = LRecordsSource(pool)

        case_studies = [
            k for k in _run(src.list_concepts()) if k.concept_type == "case_study"
        ]

        assert {k.entity_id for k in case_studies} == {"Acme Corp", "Transport for London"}
        tfl = next(k for k in case_studies if k.form_instance_id == "ws-1")
        assert tfl.entity_id == "Transport for London"
        acme = next(k for k in case_studies if k.entity_id == "Acme Corp")
        assert acme.form_instance_id is None  # named-client grain carries no form-instance locator

    def test_dedupes_multiple_won_workspaces_for_the_same_buyer(self):
        # ORDER BY buyer, form_instance_id → the earliest won form instance
        # wins deterministically (one case study per buyer, BI-2 identity).
        pool = _won_bid_only_pool(
            [
                {"form_instance_id": "ws-1", "buyer": "Transport for London"},
                {"form_instance_id": "ws-9", "buyer": "Transport for London"},
            ]
        )
        src = LRecordsSource(pool)

        case_studies = [
            k for k in _run(src.list_concepts()) if k.concept_type == "case_study"
        ]

        assert len(case_studies) == 1
        assert case_studies[0].form_instance_id == "ws-1"

    def test_no_won_bids_yields_no_won_bid_case_study(self):
        src = LRecordsSource(_won_bid_only_pool([]))

        assert _run(src.list_concepts()) == []

    def test_find_matches_a_won_bid_buyer_case_insensitively(self):
        src = LRecordsSource(
            _five_type_pool(
                won_bids=[{"form_instance_id": "ws-1", "buyer": "Transport for London"}]
            )
        )

        hits = _run(src.find("transport"))

        # {427.8}: `find` returns whatever `list_concepts` minted, so the
        # won-bid hit follows the grain's declared directory. `find` itself
        # is unchanged — it matches on the buyer, never on the path.
        assert [k.rel_path for k in hits] == [
            "case-studies/won-bid/transport-for-london.md"
        ]


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
            grain="case_study_won_bid",
            entity_id="Transport for London",
            form_instance_id="ws-1",
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
        # The won-bid grain is additive: a case_study key with NO form_instance_id
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
        key = ConceptKey(
            rel_path="case-studies/acme-corp.md",
            concept_type="case_study",
            grain="case_study_named_client",
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
            grain="case_study_won_bid",
            entity_id="Transport for London",
            form_instance_id="ws-1",
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

        key = ConceptKey(
            rel_path="t.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="x",
        )
        assert _run(src.sample_rows(key, 0)) == []
        assert _run(src.sample_rows(key, -1)) == []

    def test_topic_sample_is_limited_and_carries_the_limit_arg(self):
        pool = FakePool()
        pool.when(
            "WHERE scope_tag @> ARRAY[$1]::text[] AND publication_status",
            [{"id": "qa-1"}, {"id": "qa-2"}],
        )
        src = LRecordsSource(pool)
        key = ConceptKey(
            rel_path="topics/gdpr.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="gdpr",
        )

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
        pool.when("FROM entity_mentions WHERE source_document_id = ANY($1::uuid[])", [])
        src = LRecordsSource(pool)
        key = ConceptKey(
            rel_path="company/overview.md",
            concept_type="company",
            grain="company_singleton",
        )

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
        key = ConceptKey(
            rel_path="products/lms.md",
            concept_type="product",
            grain="product_entity_mention",
            entity_id="LMS",
        )

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

        base = dict(
            rel_path="topics/gdpr.md",
            concept_type="topic",
            grain="topic_scope_tag",
            scope_tag="gdpr",
        )
        key_a1 = ConceptKey(**base, content_version="v-a")
        key_a2 = ConceptKey(**base, content_version="v-a")
        key_b = ConceptKey(**base, content_version="v-b")

        assert bytes(memo_fingerprint(key_a1)) == bytes(memo_fingerprint(key_a2))
        assert bytes(memo_fingerprint(key_a1)) != bytes(memo_fingerprint(key_b))

    def test_concept_key_now_carries_the_content_version_delta_signal(self):
        """Evolution of the {132.35} Defect A field-set pin (MD-11): the real
        fix landed — `content_version` is `ConceptKey`'s LAST field (MD-3),
        the per-concept BI-18 delta signal `_canonicalize_dataclass`
        fingerprints like every other field.

        **ID-427 {427.7} inserts `grain` after `concept_type`** rather than
        appending it, per TECH §5, which retires the append-only convention
        for the id-427 wave. The convention's stated purpose was that         *positional*
        `ConceptKey(...)` constructions stay valid across a field addition; an
        AST projection over `scripts/` (S547) found **zero** positional
        constructions, so nothing could silently shift and the ordering is a
        readability choice. `content_version` still stays last, which is the
        half of MD-4 that carries a live requirement.

        **ID-427 {427.10} adds `source_document_id`**, the residual document
        grains' locator, immediately BEFORE `content_version` — which keeps
        the one ordering rule that carries a live requirement (MD-4:
        `content_version` last) while the new field takes the same
        end-of-locators position `form_instance_id` holds. It is a
        whole-corpus memo invalidation, and it rides the wave's single
        `version=3` bump rather than adding a second: no producer run has
        consumed that bump yet, so the re-draft it already mandates absorbs
        this field at no extra cost (the {427.12} sequencing argument,
        applied a second time).

        The field set is pinned, not just its membership: a field appearing
        here that no grain sets is a locator with no owner, and every field
        fingerprints unconditionally."""
        field_names = [f.name for f in dataclasses.fields(ConceptKey)]

        assert field_names == [
            "rel_path",
            "concept_type",
            "grain",
            "scope_tag",
            "entity_id",
            "form_instance_id",
            "source_document_id",
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
    pool.when("sd_max FROM source_documents sd", [])
    pool.when("count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", [])
    pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
    pool.when("c.canonical_name AS canonical_name", [])
    pool.when("COALESCE(issuing_organisation, name) AS buyer", [])
    pool.when("w.form_instance_id AS form_instance_id", [])
    return _census_queries(pool)


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
                        "em_count": 1,
                        "em_max": em_max,
                    }
                ],
            )
            pool.when("sd_max FROM source_documents sd", [])
            pool.when(
                "count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", []
            )
            pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
            pool.when("c.canonical_name AS canonical_name", [])
            pool.when("COALESCE(issuing_organisation, name) AS buyer", [])
            pool.when("w.form_instance_id AS form_instance_id", [])
            return _census_queries(pool)

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
                "sd_max FROM source_documents sd",
                [{"sd_count": 1, "sd_max": "t0"}],
            )
            pool.when(
                "count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions",
                [{"canonical_name": "ISO 27001", "em_count": 1, "em_max": em_max}],
                arg_matcher=lambda args: args == ("certification",),
            )
            pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
            pool.when("c.canonical_name AS canonical_name", [])
            pool.when("COALESCE(issuing_organisation, name) AS buyer", [])
            pool.when("w.form_instance_id AS form_instance_id", [])
            return _census_queries(pool)

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
            pool.when("sd_max FROM source_documents sd", [])
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
            pool.when("w.form_instance_id AS form_instance_id", [])
            return _census_queries(pool)

        before = _run(LRecordsSource(_pool("t0")).list_concepts())
        after = _run(LRecordsSource(_pool("t1")).list_concepts())
        cs_before = next(
            k for k in before if k.concept_type == "case_study" and k.form_instance_id is None
        )
        cs_after = next(
            k for k in after if k.concept_type == "case_study" and k.form_instance_id is None
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
            pool.when("sd_max FROM source_documents sd", [])
            pool.when(
                "count(*) AS em_count, max(updated_at) AS em_max FROM entity_mentions", []
            )
            pool.when("JOIN source_documents sd ON sd.id = em.source_document_id", [])
            pool.when("c.canonical_name AS canonical_name", [])
            pool.when(
                "COALESCE(issuing_organisation, name) AS buyer",
                [{"form_instance_id": "ws-1", "buyer": "Transport for London"}],
            )
            pool.when(
                "w.form_instance_id AS form_instance_id",
                [
                    {
                        "form_instance_id": "ws-1",
                        "qa_count": 1,
                        "qa_max": "t0",
                        "fi_count": 1,
                        "fi_max": fi_max,
                    }
                ],
            )
            return _census_queries(pool)

        before = _run(LRecordsSource(_pool("t0")).list_concepts())
        after = _run(LRecordsSource(_pool("t1")).list_concepts())
        wb_before = next(k for k in before if k.form_instance_id == "ws-1")
        wb_after = next(k for k in after if k.form_instance_id == "ws-1")

        assert wb_before.content_version != wb_after.content_version


# ── ID-132 {132.36} G-CONCEPT-FEEDER — client-configurable overlay-added
# concept-type feeder ────────────────────────────────────────────────────


def _feeder_pool(entity_type: str, rows: "list[dict]") -> FakePool:
    """A five-base-types-empty pool plus one `entity_mention` feeder grain
    (`entity_type`) evidence set. The feeder's own enumeration/version
    rules are registered FIRST via `arg_matcher` so they win over
    `_other_types_empty`'s generic (no-arg-matcher) catch-alls for the SAME
    marker substrings (`entity_type = $1 ORDER BY 1` / `p.canonical_name AS
    canonical_name`, which `product`'s own query also shares)."""
    pool = FakePool()
    pool.when(
        "entity_type = $1 ORDER BY 1",
        rows,
        arg_matcher=lambda args: args == (entity_type,),
    )
    pool.when(
        "p.canonical_name AS canonical_name",
        [
            {
                "canonical_name": row["canonical_name"],
                "sd_count": 1,
                "sd_max": "t0",
                "qa_count": 1,
                "qa_max": "t0",
                "ri_count": 0,
                "ri_max": None,
            }
            for row in rows
        ],
        arg_matcher=lambda args: args == (entity_type,),
    )
    pool.when("AS scope_tag FROM q_a_pairs", [])
    pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
    return _other_types_empty(pool)


class TestAFeederTypeNeedsNoWidening:
    """REPLACES `TestConceptFeederConceptKeyWidening` (ID-427 {427.5}).

    That class tested `_permit_overlay_concept_types`, the {132.36}
    contextvar that scoped a BI-4 gate LIFT to exactly the `with`-block
    constructing feeder keys. Two of its three assertions had the gate as
    their whole subject — "permitted inside the block", "rejected again
    once it exits" — and neither can be restated once the gate is deleted;
    a mechanism whose only job was lifting a gate does not survive the
    gate. Its third assertion is load-bearing and is kept verbatim in
    substance below: BI-3 was unconditional even under widening, and must
    stay unconditional now there is nothing to widen."""

    def test_a_feeder_type_is_constructible_with_no_widening_at_all(self):
        # The behaviour the deleted contextvar bought, now free: no
        # `with`-block, no config, no overlay.
        key = ConceptKey(
            rel_path="partner/contoso.md",
            concept_type="partner",
            grain="feeder:partner",
        )
        assert key.concept_type == "partner"

    def test_q_a_pair_is_still_refused_unconditionally(self):
        """BI-3 — the one refusal that outlives the register. There is no
        longer any widening mechanism to smuggle it through, so assert it
        at the only remaining construction path."""
        with pytest.raises(ValueError, match="q_a_pair"):
            ConceptKey(
                rel_path="q_a_pairs/1.md",
                concept_type="q_a_pair",
                grain="topic_scope_tag",
            )

    def test_no_widening_mechanism_survives_for_a_caller_to_reach_for(self):
        import scripts.cocoindex_pipeline.sources.base as base_module

        assert not hasattr(base_module, "_permit_overlay_concept_types")
        assert not hasattr(base_module, "_permitted_overlay_concept_types")
        assert not hasattr(base_module, "CONCEPT_TYPES")


class TestConceptFeederListConcepts:
    """`LRecordsSource(pool, concept_feeder_config=...)` enumerates an
    overlay-added concept type via the `entity_mention` grain."""

    def test_no_feeder_config_yields_zero_extra_concepts(self):
        """Zero behaviour change absent a feeder config (mirrors OV-4/
        OV-11's absence-is-not-an-error posture for the feeder)."""
        pool = _other_types_empty(FakePool())
        pool.when("AS scope_tag FROM q_a_pairs", [])
        pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert keys == []

    def test_feeder_config_enumerates_the_overlay_added_type(self):
        pool = _feeder_pool("partner", [{"canonical_name": "Contoso"}])
        src = LRecordsSource(
            pool,
            concept_feeder_config={
                "partner": {"grain": "entity_mention", "entity_type": "partner"},
            },
        )

        keys = _run(src.list_concepts())

        assert len(keys) == 1
        key = keys[0]
        assert key.concept_type == "partner"
        assert key.rel_path == "partner/contoso.md"
        assert key.entity_id == "Contoso"
        assert key.content_version != ""

    def test_feeder_type_coexists_with_the_base_5_types(self):
        pool = _five_type_pool()
        pool.when(
            "entity_type = $1 ORDER BY 1",
            [{"canonical_name": "Contoso"}],
            arg_matcher=lambda args: args == ("partner",),
        )
        src = LRecordsSource(
            pool,
            concept_feeder_config={
                "partner": {"grain": "entity_mention", "entity_type": "partner"},
            },
        )

        keys = _run(src.list_concepts())

        # {427.10}: the preferred grains' labels, not every registered one —
        # the residual grains contribute nothing to a corpus with no residue
        # (see `test_enumerates_all_5_ratified_types`).
        assert {k.concept_type for k in keys} == _PREFERRED_GRAIN_LABELS | {"partner"}

    def test_a_feeder_grain_is_covered_before_the_residual_grain_runs(self):
        """{427.10}'s `runs_last` ordering, stated as behaviour rather than
        as registry position. A client-declared feeder grain is appended to
        the registry AFTER the built-ins, so a residual grain that ran in
        tuple order would compute its complement before the feeder had
        declared anything and would report the feeder's own units as
        residue — minting a duplicate `documents/` concept for every document
        the client's grain already covers.

        The probe is the anti-join's ARGUMENT: it must carry the feeder
        grain's covered document id, which only a feeder that ran first can
        have supplied."""
        pool = _feeder_pool("partner", [{"canonical_name": "Contoso"}])
        _census_queries(pool, documents=[{"id": "sd-partner"}])
        src = LRecordsSource(
            pool,
            concept_feeder_config={
                "partner": {"grain": "entity_mention", "entity_type": "partner"},
            },
        )

        _run(src.list_concepts())

        anti_join_args = next(
            args
            for query, args in pool.calls
            if "FROM source_documents WHERE publication_status = 'published' "
            "AND id <> ALL" in query
        )
        assert anti_join_args == (["sd-partner"],)

    def test_multiple_feeder_types_all_enumerate(self):
        # Built manually (not via `_feeder_pool`, which already finalises
        # with `_other_types_empty`'s catch-all rules) so BOTH feeder
        # types' specific `arg_matcher` rules are registered — and so win
        # by registration order — BEFORE the generic no-arg-matcher
        # catch-alls that would otherwise shadow the second type.
        pool = FakePool()
        pool.when(
            "entity_type = $1 ORDER BY 1",
            [{"canonical_name": "Contoso"}],
            arg_matcher=lambda args: args == ("partner",),
        )
        pool.when(
            "p.canonical_name AS canonical_name",
            [
                {
                    "canonical_name": "Contoso",
                    "sd_count": 1,
                    "sd_max": "t0",
                    "qa_count": 1,
                    "qa_max": "t0",
                }
            ],
            arg_matcher=lambda args: args == ("partner",),
        )
        pool.when(
            "entity_type = $1 ORDER BY 1",
            [{"canonical_name": "GDPR Framework"}],
            arg_matcher=lambda args: args == ("regulation_body",),
        )
        pool.when(
            "p.canonical_name AS canonical_name",
            [
                {
                    "canonical_name": "GDPR Framework",
                    "sd_count": 1,
                    "sd_max": "t0",
                    "qa_count": 0,
                    "qa_max": None,
                }
            ],
            arg_matcher=lambda args: args == ("regulation_body",),
        )
        pool.when("AS scope_tag FROM q_a_pairs", [])
        pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
        _other_types_empty(pool)
        src = LRecordsSource(
            pool,
            concept_feeder_config={
                "partner": {"grain": "entity_mention", "entity_type": "partner"},
                "regulation_body": {
                    "grain": "entity_mention",
                    "entity_type": "regulation_body",
                },
            },
        )

        keys = _run(src.list_concepts())

        assert {k.concept_type for k in keys} == {"partner", "regulation_body"}
        assert {k.rel_path for k in keys} == {
            "partner/contoso.md",
            "regulation_body/gdpr-framework.md",
        }

    def test_unsupported_grain_raises(self):
        """Defends a caller that constructs `LRecordsSource` directly with
        an unvalidated `concept_feeder_config` (bypassing `producer/
        bundle_writer.read_concept_feeder_config`'s closed grain enum).

        ID-427 {427.7}: this now fails at CONSTRUCTION rather than at
        `list_concepts()`. The registry is built in `__init__`, so an
        unroutable strategy cannot survive as far as an enumeration pass —
        strictly earlier than the old failure point, and the same fail-loud
        posture `ConceptFeederConfigError` takes at config-read time."""
        with pytest.raises(ValueError, match="unsupported concept-feeder grain"):
            LRecordsSource(
                FakePool(),
                concept_feeder_config={
                    "widget": {"grain": "raw_sql", "entity_type": "widget"},
                },
            )


class TestConceptFeederReadConcept:
    """`read_concept`/`sample_rows` route a feeder-fed key through the
    `entity_mention` grain's join (identical shape to `_read_product`)."""

    def _pool(self) -> FakePool:
        pool = _feeder_pool("partner", [{"canonical_name": "Contoso"}])
        pool.when(
            "filename ILIKE ANY($1::text[])",
            [{"id": "sd-contoso", "filename": "partner-contoso.md"}],
            arg_matcher=lambda args: args == (["%Contoso%"],),
        )
        pool.when(
            "source_document_id = ANY($1::uuid[]) OR scope_tag @> ARRAY[$2]::text[]",
            [{"id": "qa-contoso-1", "source_document_id": "sd-contoso"}],
        )
        return pool

    def _feeder_key(self, pool: FakePool) -> "tuple[LRecordsSource, ConceptKey]":
        src = LRecordsSource(
            pool,
            concept_feeder_config={
                "partner": {"grain": "entity_mention", "entity_type": "partner"},
            },
        )
        keys = _run(src.list_concepts())
        return src, next(k for k in keys if k.concept_type == "partner")

    def test_read_concept_returns_the_2_feeder_anchors(self):
        src, key = self._feeder_key(self._pool())

        raw = _run(src.read_concept(key))

        assert [r["id"] for r in raw.source_documents] == ["sd-contoso"]
        assert [r["id"] for r in raw.q_a_pairs] == ["qa-contoso-1"]
        # DR-124: the ri evidence leg retired with the ri<->sd join path.
        assert raw.reference_items == []
        assert raw.record_lifecycle == []
        assert raw.entity_mentions == []

    def test_sample_rows_samples_the_q_a_pairs_cluster_with_limit(self):
        pool = self._pool()
        src, key = self._feeder_key(pool)

        rows = _run(src.sample_rows(key, 5))

        assert [r["id"] for r in rows] == ["qa-contoso-1"]
        query, args = pool.calls[-1]
        assert query.rstrip().endswith("LIMIT $3")
        assert args == (["sd-contoso"], "Contoso", 5)

    def test_find_surfaces_the_feeder_concept(self):
        src, _ = self._feeder_key(self._pool())

        results = _run(src.find("contoso"))

        assert [k.rel_path for k in results] == ["partner/contoso.md"]


# ── ID-427 {427.9} — the corpus census (TECH §2.11, closing AC 4) ────────
#
# DR-141's Consequences name the failure this closes: "today it cannot
# distinguish absent-because-unknown from absent-because-unrouted". These
# tests are about the SECOND number — how much of the published corpus the
# enumerated concepts actually reach.


class TestTheCensusIsAMeasurementNotADefault:
    """{427.7} introduced `Coverage` unpopulated and recorded that its empty
    value "is not a measurement". These are the tests that make the
    difference between not-measured and measured-zero enforceable."""

    def test_census_before_enumeration_raises_rather_than_reporting_zeros(self):
        """Reporting `routed 0` here would report the WHOLE corpus as
        unrouted, flip `RunSummary.is_no_op` and stage a commit for a run
        that did nothing wrong. A manufactured alarm is as much a lie as a
        manufactured silence."""
        src = LRecordsSource(FakePool())  # no rules — must fail before any query

        with pytest.raises(ValueError, match="before list_concepts"):
            _run(src.census())

    def test_a_grain_that_covers_nothing_reports_the_whole_corpus_unrouted(self):
        """The stubbed-grain case PLAN {427.9} asks for, at the Source
        level: the corpus holds units, one topic concept is enumerated, and
        the grain's coverage is empty — so every published unit is
        unrouted and the census says so with a number."""
        pool = _five_type_pool()
        _census_queries(
            pool, totals={"source_documents": 9, "q_a_pairs": 40}
        )
        src = LRecordsSource(pool)

        _run(src.list_concepts())
        census = _run(src.census())

        assert census.considered == (("source_documents", 9), ("q_a_pairs", 40))
        assert census.routed == (("source_documents", 0), ("q_a_pairs", 0))
        assert census.unrouted == (("source_documents", 9), ("q_a_pairs", 40))
        assert census.unrouted_total == 49

    def test_a_fully_covered_corpus_reports_considered_equals_routed(self):
        """The state {427.10} exists to reach. Coverage is driven from the
        REAL grain queries — the topic grain's own coverage query answers
        with every published tagged pair and its parent document — so this
        asserts the wiring from grain to census, not a hand-built value."""
        pool = _five_type_pool()
        _census_queries(
            pool,
            topic=[
                {"q_a_pair_id": "qa-1", "source_document_id": "sd-1"},
                {"q_a_pair_id": "qa-2", "source_document_id": "sd-1"},
                {"q_a_pair_id": "qa-3", "source_document_id": None},
            ],
            totals={"source_documents": 1, "q_a_pairs": 3},
        )
        src = LRecordsSource(pool)

        _run(src.list_concepts())
        census = _run(src.census())

        assert census.considered == (("source_documents", 1), ("q_a_pairs", 3))
        assert census.routed == (("source_documents", 1), ("q_a_pairs", 3))
        assert census.unrouted == ()
        assert census.unrouted_total == 0

    def test_a_unit_two_grains_both_reach_is_counted_once(self):
        """**DR-141's S546 rider, in code: coverage (>=1), not partition
        (=1).** RESEARCH C4 measured that a published pair carrying a
        `scope_tag` whose parent document also matches a pattern-matched
        grain ALREADY lands in two concepts, and ruled that overlap
        legitimate evidence reuse rather than a defect. A summing union
        would report `routed 4` against a corpus of 2 and drive `unrouted`
        negative; the set union reports what it should."""
        pool = _five_type_pool()
        _census_queries(
            pool,
            topic=[
                {"q_a_pair_id": "qa-shared", "source_document_id": "sd-shared"}
            ],
            documents=[{"id": "sd-shared"}],
            pairs=[{"id": "qa-shared"}],
            totals={"source_documents": 1, "q_a_pairs": 1},
        )
        src = LRecordsSource(pool)

        _run(src.list_concepts())
        census = _run(src.census())

        # The topic grain and the pattern-matched grains each reported the
        # same two units …
        assert census.routed == (("source_documents", 1), ("q_a_pairs", 1))
        # … and neither is double-counted, so nothing is "over-routed".
        assert census.unrouted == ()

    def test_re_enumerating_replaces_the_coverage_rather_than_accumulating(self):
        """A second `list_concepts()` on the same adapter must not union
        onto the first run's coverage — the census answers for THIS run.
        Accumulation would make `routed` grow monotonically and eventually
        exceed `considered`.

        **The corpus SHRINKS between the two enumerations, and that is the
        whole point** (ID-427 {427.17}). The S548 adversarial audit mutated
        `coverage = Coverage()` to `coverage = self._coverage if
        self._coverage is not None else Coverage()` — textbook accumulation —
        and the entire Python suite stayed green (2395/6), *including this
        guard*. Coverage is a SET union and the fixture returned identical
        rows on both calls, so accumulating was indistinguishable from
        replacing. A second enumeration that sees FEWER units is the only
        fixture that can tell them apart: under replacement the census falls
        to the shrunken corpus, under accumulation it retains the first run's
        units and reports more than the corpus holds.

        `_census_queries` registers via `when_first`, so calling it again
        front-inserts the shrunken rows and they win — the documented way to
        re-point a fixture mid-test.
        """
        pool = _five_type_pool()
        _census_queries(
            pool,
            topic=[
                {"q_a_pair_id": "qa-1", "source_document_id": "sd-1"},
                {"q_a_pair_id": "qa-2", "source_document_id": "sd-2"},
            ],
            totals={"source_documents": 2, "q_a_pairs": 2},
        )
        src = LRecordsSource(pool)

        _run(src.list_concepts())
        first = _run(src.census())
        assert first.routed == (("source_documents", 2), ("q_a_pairs", 2))

        # The corpus loses a unit of each kind before the second run — a
        # document withdrawn, its pair unpublished. `considered` follows it
        # down; `routed` must too.
        _census_queries(
            pool,
            topic=[{"q_a_pair_id": "qa-1", "source_document_id": "sd-1"}],
            totals={"source_documents": 1, "q_a_pairs": 1},
        )

        _run(src.list_concepts())
        second = _run(src.census())

        assert second.routed == (("source_documents", 1), ("q_a_pairs", 1)), (
            "the second enumeration's coverage retained units from the first "
            "— coverage is accumulating across runs, not being replaced"
        )
        # The consequence accumulation actually produces in the field: more
        # routed than the corpus holds, which drives `unrouted` negative and
        # renders a negative count into `log.md`.
        assert second.unrouted == ()
        assert all(
            routed <= considered
            for (_, routed), (_, considered) in zip(second.routed, second.considered)
        )

    def test_the_won_bid_dedupe_leaves_a_second_won_bid_uncovered(self):
        """A real, measured hole rather than a stubbed one. The won-bid
        grain dedupes by BUYER and keeps the earliest won form, so a buyer's
        second won bid mints no concept — its published pairs are covered by
        nothing. The coverage query is keyed on the form instances the grain
        ENUMERATED, not on the won-form set, which is what lets the census
        see it.

        **ID-427 {427.10} NARROWS this claim, and the title moves with it**
        ("unrouted" -> "uncovered"). What {427.9} could measure was the whole
        run's `unrouted`, because nothing downstream existed to route those
        pairs; the residual grain now gives them a home in
        `questionnaire-responses/` (`TestTheAttributionCascade`), so
        end-to-end they ARE routed. This fixture's residual anti-joins return
        nothing, which is what keeps the number below stable — so the number
        pins the WON-BID GRAIN's own coverage, not the run's outcome, and
        saying so is the difference between a live assertion and one that
        passes for a reason its title denies."""
        pool = _won_bid_only_pool(
            [
                {"form_instance_id": "fi-1", "buyer": "Transport for London"},
                {"form_instance_id": "fi-2", "buyer": "Transport for London"},
            ]
        )
        _census_queries(
            pool,
            won_bid_pairs=[{"id": "qa-from-fi-1"}],
            totals={"source_documents": 0, "q_a_pairs": 3},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())
        census = _run(src.census())

        assert len(keys) == 1  # deduped by buyer
        # The coverage query saw ONLY the enumerated form instance.
        coverage_args = next(
            args
            for query, args in pool.calls
            if "source_form_instance_id = ANY($1::uuid[])" in query
        )
        assert coverage_args == (["fi-1"],)
        assert census.unrouted == (("q_a_pairs", 2),)
        # The complement, asserted here so the narrowing above is not just a
        # comment: with those pairs actually in the residual anti-join, the
        # questionnaire-response grain takes them and the run reports zero.
        pool.when_first(
            "FROM q_a_pairs WHERE publication_status = 'published' AND id <> ALL",
            [
                {
                    "id": f"qa-from-fi-2-{n}",
                    "source_document_id": None,
                    "source_form_instance_id": "fi-2",
                    "updated_at": "t1",
                }
                for n in range(2)
            ],
        )
        pool.when_first(
            "FROM form_instances WHERE id = ANY($1::uuid[])",
            [{"id": "fi-2", "name": "TfL rebid", "issuing_organisation": None}],
        )
        pool.when_first("qa.source_form_instance_id AS form_instance_id", [])
        pool.when_first(
            "source_form_instance_id = ANY($1::uuid[]) "
            "AND publication_status = 'published' ORDER BY id",
            [{"id": "qa-from-fi-2-0"}, {"id": "qa-from-fi-2-1"}],
        )

        rerouted_keys = _run(src.list_concepts())
        rerouted = _run(src.census())

        assert "questionnaire-responses/tfl-rebid-fi-2.md" in {
            k.rel_path for k in rerouted_keys
        }
        assert rerouted.unrouted_total == 0

    def test_the_census_asks_the_pool_once_for_the_corpus_totals(self):
        """MD-5's bounded-query discipline extends to the census: the
        totals are ONE query for the whole run, never one per kind and
        never one per concept."""
        pool = _five_type_pool()
        _census_queries(pool, totals={"source_documents": 2, "q_a_pairs": 2})
        src = LRecordsSource(pool)
        _run(src.list_concepts())
        before = len(pool.calls)

        _run(src.census())

        assert len(pool.calls) - before == 1


# ── The residual grain (ID-427 {427.10}, TECH §2.1–§2.3, AC 1) ──────────
#
# What these assert, and what they deliberately do NOT: the shape of the
# cascade and the fact that the census reaches zero unrouted. Whether the
# rendered PAGE says the right thing is `test_producer_enrich.py`'s
# (`render_undistilled_draft`), and whether both measured holes reach an
# emitted bundle end-to-end is `test_producer_flow_def.py`'s.

from scripts.cocoindex_pipeline.producer.frontmatter import (  # noqa: E402
    derive_source_id,
)
from scripts.cocoindex_pipeline.producer.resource_uri import (  # noqa: E402
    contains_record_pointer,
)

_DOC_A = "aaaaaaaa-1111-4111-8111-111111111111"
_DOC_B = "bbbbbbbb-2222-4222-8222-222222222222"
_FORM_A = "ffffffff-3333-4333-8333-333333333333"


def _no_preferred_concepts_pool() -> FakePool:
    """A pool whose SIX preferred grains all enumerate nothing, so whatever a
    test puts in the two residual anti-joins is the whole bundle. Built from
    `_other_types_empty` (the {132.38} helper) plus the topic pair it does
    not itself register."""
    pool = FakePool()
    pool.when("AS scope_tag FROM q_a_pairs", [])
    pool.when("t.tag AS tag, count(DISTINCT qa.id)", [])
    return _other_types_empty(pool)


def _residual_pool(
    *,
    residual_documents: "list[dict] | None" = None,
    residual_pairs: "list[dict] | None" = None,
    published_parents: "list[dict] | None" = None,
    document_pair_ids: "list[dict] | None" = None,
    form_instances: "list[dict] | None" = None,
    totals: "dict | None" = None,
) -> FakePool:
    """A corpus whose only concepts are residual ones.

    Every rule here is a query the residual cascade issues; registering them
    explicitly (rather than leaving them to a catch-all) is what makes a
    drift in the cascade's SQL show up as an unmatched-rule `AssertionError`
    instead of a silently empty result."""
    pool = _no_preferred_concepts_pool()
    _census_queries(
        pool,
        residual_documents=residual_documents or [],
        residual_pairs=residual_pairs or [],
        totals=totals,
    )
    pool.when_first(
        "WHERE id = ANY($1::uuid[]) AND publication_status = 'published'",
        published_parents or [],
    )
    pool.when_first(
        "SELECT id, source_document_id FROM q_a_pairs", document_pair_ids or []
    )
    pool.when_first("AS d(id)", [])
    pool.when_first(
        "FROM form_instances WHERE id = ANY($1::uuid[])", form_instances or []
    )
    pool.when_first("qa.source_form_instance_id AS form_instance_id", [])
    pool.when_first(
        "source_form_instance_id = ANY($1::uuid[]) "
        "AND publication_status = 'published' ORDER BY id",
        [],
    )
    return pool


def _by_directory(keys) -> "dict[str, list]":
    grouped: "dict[str, list]" = {}
    for key in keys:
        grouped.setdefault(key.rel_path.rsplit("/", 1)[0], []).append(key)
    return grouped


class TestTheResidualGrainClosesBothMeasuredHoles:
    """AC 1, at the Source layer: the two holes RESEARCH measured stop being
    holes, and the census says so with a number rather than a claim."""

    def test_a_published_document_with_no_answer_becomes_a_documents_concept(self):
        """**Hole 2** — `source_documents` was never an enumeration grain, so
        a published document from which nothing was distilled was reachable
        in no concept at all and its absence from the answer set was
        silent."""
        pool = _residual_pool(
            residual_documents=[
                {"id": _DOC_A, "filename": "07-supplier-code.pdf", "logical_path": None}
            ],
            totals={"source_documents": 1, "q_a_pairs": 0},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())
        census = _run(src.census())

        assert len(keys) == 1
        assert keys[0].rel_path == "documents/07-supplier-code-aaaaaaaa.md"
        assert keys[0].concept_type == "document"
        assert keys[0].source_document_id == _DOC_A
        assert census.unrouted_total == 0

    def test_a_published_pair_with_an_empty_scope_tag_rides_its_parent_document(self):
        """**Hole 1** — the topic grain's SQL excludes an empty `scope_tag`
        array twice, and BI-3 forbids the pair being its own concept, so such
        a pair had nowhere to go. Cascade step 2 gives it its parent
        document's concept."""
        pool = _residual_pool(
            residual_documents=[
                {"id": _DOC_A, "filename": "retention.docx", "logical_path": None}
            ],
            residual_pairs=[
                {
                    "id": "qa-empty-scope",
                    "source_document_id": _DOC_A,
                    "source_form_instance_id": None,
                    "updated_at": "t1",
                }
            ],
            document_pair_ids=[
                {"id": "qa-empty-scope", "source_document_id": _DOC_A}
            ],
            totals={"source_documents": 1, "q_a_pairs": 1},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())
        census = _run(src.census())

        assert [k.rel_path for k in keys] == ["documents/retention-aaaaaaaa.md"]
        assert census.routed == (("source_documents", 1), ("q_a_pairs", 1))
        assert census.unrouted_total == 0

    def test_a_pair_whose_parent_is_covered_still_gets_a_documents_concept(self):
        """**A gap in TECH §2.1, found by executing it.** The spec's two
        anti-joins alone cannot close this: the `company` grain declares
        document coverage and NO pair coverage (its read grid has no pair
        leg), so a company-overview document's empty-`scope_tag` pair is
        residual while its parent is not — and the parent therefore never
        appears in the residual-document anti-join. Without the third read
        (`_SQL_PUBLISHED_SOURCE_DOCUMENTS_BY_IDS`) that pair has no home and
        `unrouted` cannot reach zero. TECH §2.2's home table already implies
        it (*"hole 2, AND hole-1 pairs that have a parent document"*); §2.1's
        SQL does not."""
        pool = _residual_pool(
            residual_pairs=[
                {
                    "id": "qa-under-covered-doc",
                    "source_document_id": _DOC_B,
                    "source_form_instance_id": None,
                    "updated_at": "t1",
                }
            ],
            published_parents=[
                {
                    "id": _DOC_B,
                    "filename": "01-company-overview.docx",
                    "logical_path": None,
                }
            ],
            document_pair_ids=[
                {"id": "qa-under-covered-doc", "source_document_id": _DOC_B}
            ],
            totals={"source_documents": 1, "q_a_pairs": 1},
        )
        # The company grain already covered the document — the pair is what
        # is left over.
        pool.when_first("LIMIT 1", [{"id": _DOC_B}])
        pool.when_first(
            "SELECT id FROM source_documents WHERE (filename ILIKE", [{"id": _DOC_B}]
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())
        census = _run(src.census())

        residual = [k for k in keys if k.concept_type == "document"]
        assert [k.rel_path for k in residual] == [
            "documents/01-company-overview-bbbbbbbb.md"
        ]
        assert census.unrouted_total == 0

    def test_a_published_pair_whose_parent_document_is_unpublished_falls_through(self):
        """The case TECH §2.2's cascade does not contemplate: step 2 is
        written as *"`unit.source_document_id` -> documents/"*, but a
        published pair may name an UNPUBLISHED parent. Minting a
        `documents/` concept for it would admit a record the DR-025
        knowledge-admission gate has not admitted; dropping the pair would
        breach DR-141's coverage guarantee. It falls through to step 4, which
        satisfies both — the pair lands, the unpublished document does not
        appear."""
        pool = _residual_pool(
            residual_pairs=[
                {
                    "id": "qa-unpublished-parent",
                    "source_document_id": _DOC_B,
                    "source_form_instance_id": None,
                    "updated_at": "t1",
                }
            ],
            # The parent is not published, so the published-parents read
            # returns nothing for it.
            published_parents=[],
            totals={"source_documents": 0, "q_a_pairs": 1},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())
        census = _run(src.census())

        assert [k.rel_path for k in keys] == [
            "unattributed-answers/published-answers.md"
        ]
        assert not _by_directory(keys).get("documents")
        assert census.unrouted_total == 0


class TestTheAttributionCascade:
    """TECH §2.2's three homes, one rule."""

    def test_form_lineage_only_lands_in_questionnaire_responses(self):
        pool = _residual_pool(
            residual_pairs=[
                {
                    "id": "qa-from-form",
                    "source_document_id": None,
                    "source_form_instance_id": _FORM_A,
                    "updated_at": "t1",
                }
            ],
            form_instances=[
                {"id": _FORM_A, "name": "PQQ 2026", "issuing_organisation": None}
            ],
            totals={"source_documents": 0, "q_a_pairs": 1},
        )
        pool.when_first(
            "source_form_instance_id = ANY($1::uuid[]) "
            "AND publication_status = 'published' ORDER BY id",
            [{"id": "qa-from-form"}],
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())
        census = _run(src.census())

        assert [k.rel_path for k in keys] == [
            "questionnaire-responses/pqq-2026-ffffffff.md"
        ]
        assert keys[0].concept_type == "questionnaire_response"
        assert census.unrouted_total == 0

    def test_the_questionnaire_concept_carries_its_form_instance_provenance(self):
        """**PQ-3/TQ-3, RULED S546** — *"yes: carry `form_instance_id`
        provenance on residual `questionnaire_response` concepts"*. Asserted
        on the KEY rather than on a BI-28 stamp, because the key is where the
        producer's own decision lives; that `flow_def`'s provenance map then
        picks it up with no edit is asserted in
        `test_producer_flow_def.py`."""
        pool = _residual_pool(
            residual_pairs=[
                {
                    "id": "qa-from-form",
                    "source_document_id": None,
                    "source_form_instance_id": _FORM_A,
                    "updated_at": "t1",
                }
            ],
            form_instances=[
                {"id": _FORM_A, "name": "PQQ 2026", "issuing_organisation": None}
            ],
            totals={"source_documents": 0, "q_a_pairs": 1},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert keys[0].form_instance_id == _FORM_A

    def test_neither_lineage_lands_in_the_single_unattributed_concept(self):
        pool = _residual_pool(
            residual_pairs=[
                {
                    "id": f"qa-orphan-{n}",
                    "source_document_id": None,
                    "source_form_instance_id": None,
                    "updated_at": f"t{n}",
                }
                for n in range(3)
            ],
            totals={"source_documents": 0, "q_a_pairs": 3},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())
        census = _run(src.census())

        # ONE concept for all three, not one each — TECH §2.2's singleton.
        assert [k.rel_path for k in keys] == [
            "unattributed-answers/published-answers.md"
        ]
        assert keys[0].concept_type == "answer_set"
        assert census.unrouted_total == 0

    def test_the_unattributed_concept_is_absent_when_no_such_pair_exists(self):
        """*"omitted entirely when empty"* (TECH §2.2). An always-present
        empty page asserts a hole that does not exist — the mirror image of
        the silence this grain removes."""
        pool = _residual_pool(
            residual_documents=[
                {"id": _DOC_A, "filename": "policy.pdf", "logical_path": None}
            ],
            totals={"source_documents": 1, "q_a_pairs": 0},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert not [
            k for k in keys if k.rel_path.startswith("unattributed-answers/")
        ]

    def test_the_unattributed_read_refuses_to_answer_before_enumeration(self):
        """"Residual" is the complement of what enumeration covered, so a
        read that answered anyway would be answering a different question
        from the one its concept asks. Same posture `census()` takes."""
        src = LRecordsSource(FakePool())  # no rules — must fail before any query
        key = ConceptKey(
            rel_path="unattributed-answers/published-answers.md",
            concept_type="answer_set",
            grain=l_records.RESIDUAL_UNATTRIBUTED_ANSWERS_GRAIN,
        )

        with pytest.raises(ValueError, match="before list_concepts"):
            _run(src.read_concept(key))

    def test_the_unattributed_read_returns_the_pairs_enumeration_attributed(self):
        """The read must survive the fact that by read time `self._coverage`
        includes this grain's OWN contribution — a re-issued anti-join would
        exclude exactly the pairs the concept is made of and return nothing.
        This is the regression that form would cause."""
        pool = _residual_pool(
            residual_pairs=[
                {
                    "id": "qa-orphan",
                    "source_document_id": None,
                    "source_form_instance_id": None,
                    "updated_at": "t1",
                }
            ],
            totals={"source_documents": 0, "q_a_pairs": 1},
        )
        pool.when_first(
            "FROM q_a_pairs WHERE id = ANY($1::uuid[])",
            [{"id": "qa-orphan", "question_text": "What is our retention period?"}],
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())
        raw = _run(src.read_concept(keys[0]))

        assert [row["id"] for row in raw.q_a_pairs] == ["qa-orphan"]


class TestTheDraftsViaSplit:
    """TECH §2.3: a document with no published answer is rendered, one with
    answers is drafted. Resolved at enumeration, as two registry entries."""

    def test_a_document_with_no_published_pair_declares_the_template_route(self):
        pool = _residual_pool(
            residual_documents=[
                {"id": _DOC_A, "filename": "unread.pdf", "logical_path": None}
            ],
            totals={"source_documents": 1, "q_a_pairs": 0},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert src.grain_for(keys[0]).drafts_via == "template"

    def test_a_residual_document_with_published_pairs_drafts_through_pass_1(self):
        pool = _residual_pool(
            residual_documents=[
                {"id": _DOC_A, "filename": "distilled.pdf", "logical_path": None}
            ],
            document_pair_ids=[{"id": "qa-1", "source_document_id": _DOC_A}],
            totals={"source_documents": 1, "q_a_pairs": 1},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert src.grain_for(keys[0]).drafts_via == "pass1"

    def test_both_halves_write_to_the_same_directory_and_type(self):
        """The split is a routing fact, not a labelling one. A document that
        gains its first published answer changes grain and re-drafts; its
        file, its identity and its BI-9 citation key do not move."""
        pool = _residual_pool(
            residual_documents=[
                {"id": _DOC_A, "filename": "shared.pdf", "logical_path": None},
                {"id": _DOC_B, "filename": "other.pdf", "logical_path": None},
            ],
            document_pair_ids=[{"id": "qa-1", "source_document_id": _DOC_A}],
            totals={"source_documents": 2, "q_a_pairs": 1},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert {k.rel_path.rsplit("/", 1)[0] for k in keys} == {"documents"}
        assert {k.concept_type for k in keys} == {"document"}
        assert {src.grain_for(k).drafts_via for k in keys} == {"pass1", "template"}


class TestResidualSlugsAndCollisions:
    def test_two_documents_with_the_same_filename_mint_two_concepts(self):
        """The unconditional `-<uuid[:8]>` suffix, stated as the behaviour it
        buys: two distinct identities, so `write_bundle`'s pre-write
        collision guard is never reached. A CONDITIONAL suffix would make one
        concept's identity depend on the other's existence — deleting the
        collider would rename the survivor and report a spurious `moved`."""
        pool = _residual_pool(
            residual_documents=[
                {"id": _DOC_A, "filename": "report.pdf", "logical_path": None},
                {"id": _DOC_B, "filename": "report.pdf", "logical_path": None},
            ],
            totals={"source_documents": 2, "q_a_pairs": 0},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert sorted(k.rel_path for k in keys) == [
            "documents/report-aaaaaaaa.md",
            "documents/report-bbbbbbbb.md",
        ]
        assert len({k.rel_path for k in keys}) == 2

    def test_a_uuid_embedding_filename_still_mints_a_concept(self):
        """A pipeline sidecar is minted from `sd:<rel_path>`, so its filename
        can embed a full uuid — TECH §2.2 names this hazard and guards the
        TITLE against it. **The PATH was left unguarded**, and this test found
        it: the slug carried the whole `8-4-4-4-12` pointer into the concept's
        identity.

        Not cosmetic. `frontmatter.derive_source_id` turns a bundle `.md` path
        into a `sources[].id`, and `build_concept_frontmatter` refuses an id
        embedding a uuid (BI-10) — so a BI-9 cross-link to this concept would
        fail to build, from a DIFFERENT concept, for a reason that names
        neither. The stem falls back to a neutral one and the unconditional
        `-<uuid[:8]>` suffix still makes it unique."""
        pool = _residual_pool(
            residual_documents=[
                {
                    "id": _DOC_A,
                    "filename": f"sd-{_DOC_B}.json",
                    "logical_path": None,
                }
            ],
            totals={"source_documents": 1, "q_a_pairs": 0},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert len(keys) == 1
        assert not contains_record_pointer(keys[0].rel_path)
        assert keys[0].rel_path == "documents/document-aaaaaaaa.md"
        # The consequence, exercised rather than argued: a cross-link to this
        # concept builds a valid `sources[].id`.
        assert not contains_record_pointer(derive_source_id(keys[0].rel_path))

    def test_a_uuid_embedding_form_name_is_guarded_the_same_way(self):
        """The same hazard on the other branch — a form's `name` is client
        data too, and a guard that covers one derived slug and not its
        sibling is a guard that will be routed around."""
        pool = _residual_pool(
            residual_pairs=[
                {
                    "id": "qa-from-form",
                    "source_document_id": None,
                    "source_form_instance_id": _FORM_A,
                    "updated_at": "t1",
                }
            ],
            form_instances=[
                {"id": _FORM_A, "name": f"PQQ {_DOC_B}", "issuing_organisation": None}
            ],
            totals={"source_documents": 0, "q_a_pairs": 1},
        )
        src = LRecordsSource(pool)

        keys = _run(src.list_concepts())

        assert not contains_record_pointer(keys[0].rel_path)
        assert keys[0].rel_path == (
            "questionnaire-responses/questionnaire-response-ffffffff.md"
        )


class TestResidualLocatorOwnership:
    def test_a_source_document_locator_on_a_foreign_grain_is_refused(self):
        src = LRecordsSource(FakePool())
        key = ConceptKey(
            rel_path="topics/gdpr.md",
            concept_type="topic",
            grain="topic_scope_tag",
            source_document_id=_DOC_A,
        )

        with pytest.raises(ValueError, match="source_document_id"):
            src.grain_for(key)

    def test_the_form_instance_locator_now_has_two_owners(self):
        """{427.7} made this locator the won-bid grain's alone. {427.10}'s
        questionnaire grain attributes by the SAME key, which is the PQ-3
        ruling's own reasoning, so the guard names a set rather than one
        grain — and still refuses everything outside it."""
        src = LRecordsSource(FakePool())
        for grain, rel_path in (
            (l_records.WON_BID_GRAIN, "case-studies/won-bid/acme.md"),
            (
                l_records.RESIDUAL_QUESTIONNAIRE_RESPONSE_GRAIN,
                "questionnaire-responses/pqq-ffffffff.md",
            ),
        ):
            key = ConceptKey(
                rel_path=rel_path,
                concept_type="case_study",
                grain=grain,
                form_instance_id=_FORM_A,
            )
            assert src.grain_for(key).name == grain

        with pytest.raises(ValueError, match="form_instance_id"):
            src.grain_for(
                ConceptKey(
                    rel_path="topics/gdpr.md",
                    concept_type="topic",
                    grain="topic_scope_tag",
                    form_instance_id=_FORM_A,
                )
            )
