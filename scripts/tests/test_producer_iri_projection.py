"""Tests for producer/iri_projection.py — the bl-457 IRI mint module
(ID-132 {132.43} G-IRI-PROJECTION).

Covers IRI-1 (deterministic mint), IRI-2 (base/overlay namespace split),
IRI-3 (versionless base IRIs — no version segment ever appears), IRI-7
(slug determinism + collision posture), and IRI-8 (the reserved,
NOT-yet-populated alias-affordance shape).

Spec slice: IRI-PROJECTION.md §Projection mechanics + §Design decisions
1-4 + invariants IRI-1/2/3/7/8.
"""

from __future__ import annotations

import logging

import pytest

from scripts.cocoindex_pipeline.producer import iri_projection as ip
from scripts.cocoindex_pipeline.producer.validator import (
    ALLOWED_CONCEPT_TYPES,
    ALLOWED_ENTITY_TYPES,
    ALLOWED_RELATIONSHIP_TYPES,
    EffectiveOntology,
)

_ALL_BASE_TERMS = sorted(
    ALLOWED_CONCEPT_TYPES | ALLOWED_ENTITY_TYPES | ALLOWED_RELATIONSHIP_TYPES
)


# ──────────────────────────────────────────
# (a) determinism + idempotence on base terms (IRI-1, IRI-7)
# ──────────────────────────────────────────


class TestDeterminismAndIdempotence:
    @pytest.mark.parametrize("term", _ALL_BASE_TERMS)
    def test_slug_is_identity_on_snake_case_base_terms(self, term):
        """IRI-7: slug() is idempotent identity on every ratified base
        term (5 concept + 12 entity + 10 relationship types) — they
        already contain only [a-z_]."""
        assert ip.slug(term) == term

    def test_slug_is_idempotent_when_applied_twice(self):
        for term in _ALL_BASE_TERMS:
            once = ip.slug(term)
            assert ip.slug(once) == once

    def test_mint_iri_deterministic_across_repeated_calls(self):
        first = ip.mint_iri("case_study", scope=None)
        second = ip.mint_iri("case_study", scope=None)
        assert first == second

    def test_mint_iri_no_clock_or_uuid_nondeterminism(self):
        """Same (term, scope) input mints byte-identical IRIs regardless
        of call count / ordering — a pure function of its inputs."""
        results = {ip.mint_iri("topic", scope=None) for _ in range(5)}
        assert len(results) == 1

    def test_project_context_deterministic_across_calls(self):
        eo = EffectiveOntology.base_only()
        first = ip.project_context(eo, client_id=None)
        second = ip.project_context(eo, client_id=None)
        assert first == second

    def test_project_context_deterministic_with_client_id(self):
        eo = EffectiveOntology.compose({"concept_types": ["Acme Widget"]})
        first = ip.project_context(eo, client_id="Acme Corp")
        second = ip.project_context(eo, client_id="Acme Corp")
        assert first == second


# ──────────────────────────────────────────
# (b) base vs client separation + overlay-never-under-base (IRI-2, IRI-3)
# ──────────────────────────────────────────


class TestBaseVsClientSeparation:
    def test_base_namespace_and_client_namespace_are_distinct(self):
        assert ip._base_namespace() != ip._client_namespace("acme")
        assert ip._base_namespace() == f"{ip.IRI_BASE_NAMESPACE}/base"
        assert ip._client_namespace("acme") == f"{ip.IRI_BASE_NAMESPACE}/client/acme"

    def test_namespace_resolves_none_scope_to_base(self):
        assert ip.namespace(None) == ip._base_namespace()

    def test_namespace_resolves_string_scope_to_client(self):
        assert ip.namespace("acme") == ip._client_namespace("acme")

    def test_base_term_mint_never_under_client_namespace(self):
        iri = ip.mint_iri("case_study", scope=None)
        assert iri == f"{ip.IRI_BASE_NAMESPACE}/base#case_study"
        assert "/client/" not in iri

    def test_overlay_term_mint_never_under_base_namespace(self):
        iri = ip.mint_iri("acme_only_term", scope="acme")
        assert "/base#" not in iri
        assert iri == f"{ip.IRI_BASE_NAMESPACE}/client/acme#acme_only_term"

    def test_base_iri_carries_no_version_segment(self):
        """IRI-3: the mint is versionless — no vN/date segment appears in
        a minted IRI."""
        iri = ip.mint_iri("case_study", scope=None)
        assert "/v1" not in iri and "/v2" not in iri

    def test_project_context_base_only_has_no_client_prefix(self):
        eo = EffectiveOntology.base_only()
        result = ip.project_context(eo, client_id=None)
        assert "client" not in result["@context"]

    def test_project_context_with_client_id_projects_overlay_under_client_ns(self):
        eo = EffectiveOntology.compose({"concept_types": ["acme_widget"]})
        result = ip.project_context(eo, client_id="acme")
        context = result["@context"]
        assert context["client"] == f"{ip._client_namespace('acme')}#"
        assert context["acme_widget"] == ip.mint_iri("acme_widget", scope="acme")
        assert "/base#" not in context["acme_widget"]

    def test_project_context_base_terms_all_under_base_namespace(self):
        eo = EffectiveOntology.base_only()
        result = ip.project_context(eo, client_id=None)
        context = result["@context"]
        for term in ALLOWED_CONCEPT_TYPES:
            assert context[term] == f"{ip.IRI_BASE_NAMESPACE}/base#{term}"

    def test_project_context_diagnostics_empty_when_no_collision_or_overlay(self):
        eo = EffectiveOntology.base_only()
        result = ip.project_context(eo, client_id="acme")
        assert result["diagnostics"] == {"collisions": [], "unprojected_overlay": []}


# ──────────────────────────────────────────
# (c) slug of arbitrary strings (IRI-7)
# ──────────────────────────────────────────


class TestSlugArbitraryStrings:
    def test_slug_lowercases_and_replaces_spaces(self):
        assert ip.slug("Product Line") == "product-line"

    def test_slug_folds_accents(self):
        assert ip.slug("café") == "cafe"

    def test_slug_collapses_runs_of_invalid_characters(self):
        assert ip.slug("foo   bar") == "foo-bar"

    def test_slug_collapses_dashes_split_by_valid_dash(self):
        assert ip.slug("foo - bar") == "foo-bar"

    def test_slug_strips_leading_and_trailing_invalid_characters(self):
        assert ip.slug("  foo  ") == "foo"
        assert ip.slug("--foo--") == "foo"

    def test_slug_preserves_underscores_and_does_not_collapse_them(self):
        assert ip.slug("foo__bar") == "foo__bar"

    def test_slug_preserves_digits(self):
        assert ip.slug("ISO 9001:2015") == "iso-9001-2015"

    def test_slug_of_empty_string_is_empty(self):
        assert ip.slug("") == ""

    def test_slug_of_all_invalid_characters_is_empty(self):
        assert ip.slug("!!!") == ""


# ──────────────────────────────────────────
# (d) collision -> first-wins + diagnostic (IRI-7)
# ──────────────────────────────────────────


class TestCollisionGuard:
    def test_mint_bucket_slug_collision_keeps_sorted_first(self, caplog):
        eo = EffectiveOntology.compose(
            {"concept_types": ["Foo Bar", "foo-bar"]}
        )
        with caplog.at_level(logging.WARNING):
            result = ip.project_context(eo, client_id="acme")

        context = result["@context"]
        # sorted(["Foo Bar", "foo-bar"]) == ["Foo Bar", "foo-bar"] (ASCII
        # uppercase < lowercase) -> "Foo Bar" is kept, "foo-bar" dropped.
        assert "Foo Bar" in context
        assert "foo-bar" not in context
        assert context["Foo Bar"] == ip.mint_iri("Foo Bar", scope="acme")

        collisions = result["diagnostics"]["collisions"]
        assert collisions == [
            {
                "scope": "client/acme",
                "dimension": "concept_types",
                "slug": "foo-bar",
                "kept": "Foo Bar",
                "dropped": "foo-bar",
            }
        ]

    def test_collision_never_raises(self):
        eo = EffectiveOntology.compose({"concept_types": ["Foo Bar", "foo-bar"]})
        # Must not raise despite the collision.
        ip.project_context(eo, client_id="acme")

    def test_collision_logs_warning(self, caplog):
        eo = EffectiveOntology.compose({"concept_types": ["Foo Bar", "foo-bar"]})
        with caplog.at_level(logging.WARNING):
            ip.project_context(eo, client_id="acme")
        assert any(
            "collision" in record.message.lower() for record in caplog.records
        )

    def test_no_collision_when_terms_are_in_different_dimensions(self):
        """Cross-dimension identical raw term names (e.g. 'certification'
        is a member of both ALLOWED_CONCEPT_TYPES and
        ALLOWED_ENTITY_TYPES) are processed as separate (scope, dimension)
        buckets and never flagged as a collision — both mint to the same
        base IRI regardless."""
        eo = EffectiveOntology.base_only()
        result = ip.project_context(eo, client_id=None)
        assert result["diagnostics"]["collisions"] == []
        assert result["@context"]["certification"] == (
            f"{ip.IRI_BASE_NAMESPACE}/base#certification"
        )


# ──────────────────────────────────────────
# ({132.44} rider A — {132.43} checker-nit) reserved-prefix-key guard
# ──────────────────────────────────────────


class TestReservedPrefixKeyGuard:
    """A term whose `slug()` equals the reserved `"base"`/`"client"` prefix
    key is a collision against that reserved key — logged + recorded in
    `diagnostics.collisions` — never a silent `dict` overwrite of the
    namespace-prefix entry. Currently unreachable via the ratified base
    vocabulary (no base term is named `base`/`client`); exercised here via
    an overlay term, the only reachable path today."""

    def test_overlay_term_slugging_to_base_is_dropped_not_overwritten(self):
        eo = EffectiveOntology.compose({"concept_types": ["base"]})
        result = ip.project_context(eo, client_id="acme")
        context = result["@context"]

        # The reserved "base" prefix key still holds the base NAMESPACE —
        # never clobbered by the "base" overlay term's own minted IRI.
        assert context["base"] == f"{ip._base_namespace()}#"

        collisions = result["diagnostics"]["collisions"]
        assert any(
            c["slug"] == "base" and c["dropped"] == "base" for c in collisions
        )

    def test_overlay_term_slugging_to_client_is_dropped_not_overwritten(self):
        eo = EffectiveOntology.compose({"entity_types": ["client"]})
        result = ip.project_context(eo, client_id="acme")
        context = result["@context"]

        assert context["client"] == f"{ip._client_namespace('acme')}#"

        collisions = result["diagnostics"]["collisions"]
        assert any(
            c["slug"] == "client" and c["dropped"] == "client" for c in collisions
        )

    def test_reserved_prefix_collision_never_raises(self):
        eo = EffectiveOntology.compose({"concept_types": ["base"]})
        # Must not raise despite the reserved-key collision.
        ip.project_context(eo, client_id="acme")

    def test_reserved_prefix_collision_logs_warning(self, caplog):
        eo = EffectiveOntology.compose({"concept_types": ["base"]})
        with caplog.at_level(logging.WARNING):
            ip.project_context(eo, client_id="acme")
        assert any(
            "reserved" in record.message.lower() for record in caplog.records
        )


# ──────────────────────────────────────────
# (e) client_id=None -> base-only + diagnostic (IRI-6)
# ──────────────────────────────────────────


class TestClientIdNone:
    def test_client_id_none_omits_client_prefix(self):
        eo = EffectiveOntology.compose({"concept_types": ["acme_widget"]})
        result = ip.project_context(eo, client_id=None)
        assert "client" not in result["@context"]

    def test_client_id_none_omits_overlay_term_entries(self):
        eo = EffectiveOntology.compose({"concept_types": ["acme_widget"]})
        result = ip.project_context(eo, client_id=None)
        assert "acme_widget" not in result["@context"]

    def test_client_id_none_records_unprojected_overlay_diagnostic(self):
        eo = EffectiveOntology.compose({"concept_types": ["acme_widget"]})
        result = ip.project_context(eo, client_id=None)
        assert result["diagnostics"]["unprojected_overlay"] == [
            {"term": "acme_widget", "dimension": "concept_types"}
        ]

    def test_client_id_none_still_projects_base_terms(self):
        eo = EffectiveOntology.compose({"concept_types": ["acme_widget"]})
        result = ip.project_context(eo, client_id=None)
        for term in ALLOWED_CONCEPT_TYPES:
            assert result["@context"][term] == (
                f"{ip.IRI_BASE_NAMESPACE}/base#{term}"
            )

    def test_client_id_none_never_raises(self):
        eo = EffectiveOntology.compose(
            {
                "concept_types": ["acme_widget"],
                "entity_types": ["acme_entity"],
                "relationship_types": ["acme_relation"],
            }
        )
        # Must not raise despite three un-projected overlay dimensions.
        ip.project_context(eo, client_id=None)

    def test_client_id_none_logs_warning(self, caplog):
        eo = EffectiveOntology.compose({"concept_types": ["acme_widget"]})
        with caplog.at_level(logging.WARNING):
            ip.project_context(eo, client_id=None)
        assert any(
            "un-projected" in record.message or "client_id is none" in record.message.lower()
            for record in caplog.records
        )

    def test_base_only_effective_ontology_has_no_unprojected_overlay(self):
        eo = EffectiveOntology.base_only()
        result = ip.project_context(eo, client_id=None)
        assert result["diagnostics"]["unprojected_overlay"] == []


# ──────────────────────────────────────────
# IRI-8: alias affordance is a reserved, unpopulated hook this wave
# ──────────────────────────────────────────


class TestAliasAffordanceReserved:
    def test_alias_shape_example_documents_id_and_sameas_keys(self):
        assert set(ip.ALIAS_SHAPE_EXAMPLE.keys()) == {"@id", "sameAs"}

    def test_project_context_never_emits_samAs_this_wave(self):
        eo = EffectiveOntology.compose({"concept_types": ["acme_widget"]})
        result = ip.project_context(eo, client_id="acme")
        for value in result["@context"].values():
            assert not isinstance(value, dict)
