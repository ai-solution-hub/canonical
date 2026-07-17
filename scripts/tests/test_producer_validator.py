"""Tests for producer/validator.py — the BI-13 concept-frontmatter validator
gate (ID-132 {132.7} G-VALIDATE).

Covers: BI-12 required-key check, BI-4 type-set membership, BI-6
resource-scheme validity (both the per-row anchor form AND the BI-8
q_a_pairs query form), the BI-10 "no uuid outside resource:/# Citations"
assertion, the closed 12-entity/10-relation ontology semantic lint, and the
S451 rider fold-in 2 citation-shrink DETECTION API (BI-17/BI-22/DR-016).

No concept is written/published unless it passes this gate (PRODUCT.md BI-13)
— `validate_concept` is what `{132.10}` wires onto the `declare_file` call
site; this Subtask builds the gate + its API only (no caller yet).
"""

import uuid

import pytest

from scripts.cocoindex_pipeline.producer import resource_uri as ru
from scripts.cocoindex_pipeline.producer import validator as v

_RESOURCE = ru.build_source_document_uri(uuid.uuid4())


def _valid_frontmatter(**overrides):
    fm = dict(
        type="topic",
        title="Encryption at rest",
        description="Overview of encryption-at-rest practices.",
        timestamp="2026-07-07T09:30:00Z",
        tags=["security", "encryption"],
        resource=_RESOURCE,
    )
    fm.update(overrides)
    return fm


_VALID_BODY = (
    "A distilled synthesis of encryption-at-rest practice.\n\n"
    "# Citations\n"
    f"- {_RESOURCE}\n"
)


# ──────────────────────────────────────────
# BI-12: required keys
# ──────────────────────────────────────────


def test_valid_concept_passes():
    errors = v.check_concept(_valid_frontmatter(), body=_VALID_BODY)
    assert errors == []


@pytest.mark.parametrize("missing_key", ["type", "title", "description", "timestamp", "tags"])
def test_concept_missing_a_required_key_is_rejected(missing_key):
    fm = _valid_frontmatter()
    del fm[missing_key]
    errors = v.check_concept(fm, body=_VALID_BODY)
    assert any(missing_key in err for err in errors)


def test_concept_missing_a_required_key_raises_via_validate_concept():
    fm = _valid_frontmatter()
    del fm["title"]
    with pytest.raises(v.ConceptValidationError) as excinfo:
        v.validate_concept(fm, body=_VALID_BODY)
    assert any("title" in err for err in excinfo.value.errors)


def test_resource_is_not_a_required_key():
    """PRODUCT.md BI-12: resource: is present "where one exists" — optional,
    matching the landed {132.6} frontmatter.py emitter. (Flagged spec-tension
    vs the TECH.md BI-table row and lib/ontology/concept-schema.ts, which
    both treat it as unconditionally required — see {132.7} report.)"""
    fm = _valid_frontmatter()
    del fm["resource"]
    errors = v.check_concept(fm, body="A distilled synthesis.\n")
    assert errors == []


# ──────────────────────────────────────────
# BI-4: type-set membership
# ──────────────────────────────────────────


@pytest.mark.parametrize(
    "concept_type", ["topic", "product", "company", "certification", "case_study"]
)
def test_bi4_type_set_members_are_accepted(concept_type):
    errors = v.check_concept(_valid_frontmatter(type=concept_type), body=_VALID_BODY)
    assert errors == []


@pytest.mark.parametrize("bad_type", ["metric", "playbook", "person", "not-a-type", ""])
def test_non_bi4_type_is_rejected(bad_type):
    errors = v.check_concept(_valid_frontmatter(type=bad_type), body=_VALID_BODY)
    assert any("type" in err.lower() for err in errors)


# ──────────────────────────────────────────
# BI-6: resource: scheme validity — both emitted forms
# ──────────────────────────────────────────


def test_per_row_source_document_resource_is_valid():
    errors = v.check_concept(
        _valid_frontmatter(resource=ru.build_source_document_uri(uuid.uuid4())),
        body=_VALID_BODY,
    )
    assert errors == []


def test_per_row_reference_item_resource_is_valid():
    errors = v.check_concept(
        _valid_frontmatter(resource=ru.build_reference_item_uri(uuid.uuid4())),
        body=_VALID_BODY,
    )
    assert errors == []


def test_qa_pairs_scope_tag_query_resource_is_valid():
    """BI-8: the q_a_pairs corpus is referenced via the table/query form —
    NOT the per-row uuid form the TS concept-schema.ts regex alone matches
    (RESOURCE-FORM NUANCE, {132.7} brief)."""
    resource = ru.build_q_a_pairs_query_uri(scope_tag="pricing")
    errors = v.check_concept(_valid_frontmatter(resource=resource), body=_VALID_BODY)
    assert errors == []


def test_qa_pairs_domain_subtopic_query_resource_is_valid():
    resource = ru.build_q_a_pairs_query_uri(domain="security", subtopic="encryption")
    errors = v.check_concept(_valid_frontmatter(resource=resource), body=_VALID_BODY)
    assert errors == []


@pytest.mark.parametrize(
    "bad_resource",
    [
        "https://example.com",
        "canonical://q_a_pairs/" + str(uuid.uuid4()),  # BI-7: q_a_pairs master never per-row
        "canonical://not_a_real_table/" + str(uuid.uuid4()),
        "canonical://source_documents/not-a-uuid",
    ],
)
def test_bad_resource_scheme_is_rejected(bad_resource):
    errors = v.check_concept(_valid_frontmatter(resource=bad_resource), body=_VALID_BODY)
    assert any("resource" in err.lower() for err in errors)


# ──────────────────────────────────────────
# BI-10: no uuid outside resource:/# Citations
# ──────────────────────────────────────────


def test_uuid_in_description_outside_citations_fails():
    poisoned = _valid_frontmatter(description=f"Anchor: {uuid.uuid4()}")
    errors = v.check_concept(poisoned, body=_VALID_BODY)
    assert any("BI-10" in err for err in errors)


def test_uuid_in_tag_outside_citations_fails():
    poisoned = _valid_frontmatter(tags=["security", str(uuid.uuid4())])
    errors = v.check_concept(poisoned, body=_VALID_BODY)
    assert any("BI-10" in err for err in errors)


def test_uuid_in_body_outside_citations_fails():
    body = f"See {_RESOURCE} in the prose body.\n\n# Citations\n- {_RESOURCE}\n"
    errors = v.check_concept(_valid_frontmatter(), body=body)
    assert any("BI-10" in err for err in errors)


def test_uuid_inside_citations_section_is_fine():
    errors = v.check_concept(_valid_frontmatter(), body=_VALID_BODY)
    assert errors == []


def test_uuid_in_resource_field_itself_is_fine():
    """`resource:` is the sanctioned ingress — BI-10 does not apply to it."""
    errors = v.check_concept(_valid_frontmatter(resource=_RESOURCE), body="No citations here.\n")
    assert errors == []


# ──────────────────────────────────────────
# Closed 12-entity/10-relation ontology — semantic lint
# ──────────────────────────────────────────


def test_ontology_lint_accepts_ratified_entity_and_relationship_types():
    errors = v.lint_entity_relation_mentions(
        entities=[{"entity_type": "organisation"}, {"entity_type": "certification"}],
        relationships=[{"relationship": "holds"}, {"relationship": "requires"}],
    )
    assert errors == []


def test_ontology_lint_rejects_entity_type_outside_closed_set():
    errors = v.lint_entity_relation_mentions(entities=[{"entity_type": "metric"}])
    assert any("entity_type" in err for err in errors)


def test_ontology_lint_rejects_relationship_outside_closed_set():
    errors = v.lint_entity_relation_mentions(relationships=[{"relationship": "owns"}])
    assert any("relationship" in err for err in errors)


def test_ontology_lint_is_a_noop_when_no_mentions_supplied():
    assert v.lint_entity_relation_mentions() == []


def test_ontology_has_exactly_12_entity_types_and_10_relationship_types():
    assert len(v.ALLOWED_ENTITY_TYPES) == 12
    assert len(v.ALLOWED_RELATIONSHIP_TYPES) == 10


def test_concept_with_invalid_entity_mention_fails_the_gate():
    errors = v.check_concept(
        _valid_frontmatter(),
        body=_VALID_BODY,
        entities=[{"entity_type": "not-a-real-entity-type"}],
    )
    assert any("entity_type" in err for err in errors)


# ──────────────────────────────────────────
# S451 rider fold-in 2 — augmentation-guard DETECTION half
# (BI-17/BI-22/DR-016; reference bundle_tools.py:110-155 "augment, not
# replace" guard — validator owns detection, {132.9}/{132.12} own
# enforcement).
# ──────────────────────────────────────────


def test_citation_shrink_detection_fires_when_a_citation_is_dropped():
    kept_uri = ru.build_source_document_uri(uuid.uuid4())
    dropped_uri = ru.build_reference_item_uri(uuid.uuid4())
    previous_body = f"Synthesis.\n\n# Citations\n- {kept_uri}\n- {dropped_uri}\n"
    # New draft keeps only the first citation — a shrink.
    new_body = f"Synthesis (revised).\n\n# Citations\n- {kept_uri}\n"

    missing = v.detect_citation_shrink(previous_body=previous_body, new_body=new_body)
    # Pin the EXACT dropped URI (not merely "some string from previous_body"
    # — a substring-containment check would pass for any dropped entry).
    assert missing == [dropped_uri]


def test_citation_shrink_detection_is_clean_when_citations_are_a_superset():
    ref1 = ru.build_source_document_uri(uuid.uuid4())
    ref2 = ru.build_reference_item_uri(uuid.uuid4())
    previous_body = f"Synthesis.\n\n# Citations\n- {ref1}\n"
    new_body = f"Synthesis (expanded).\n\n# Citations\n- {ref1}\n- {ref2}\n"

    missing = v.detect_citation_shrink(previous_body=previous_body, new_body=new_body)
    assert missing == []


def test_citation_shrink_detection_is_clean_when_unchanged():
    body = _VALID_BODY
    assert v.detect_citation_shrink(previous_body=body, new_body=body) == []


def test_citation_shrink_detection_handles_absent_previous_citations():
    """A first-write concept has no prior state to shrink from."""
    new_body = _VALID_BODY
    assert v.detect_citation_shrink(previous_body="", new_body=new_body) == []


def test_citation_shrink_detection_fires_when_citations_section_is_removed_entirely():
    previous_body = _VALID_BODY
    new_body = "Synthesis with no citations section at all.\n"
    missing = v.detect_citation_shrink(previous_body=previous_body, new_body=new_body)
    assert len(missing) == 1


# ──────────────────────────────────────────
# OKF v0.1 conformance (SPEC §5.1/§8) — the numbered-link citation trailer:
# renderer, cross-format parsing, write-time normalisation, and the CRITICAL
# legacy↔link shrink-guard parity (a prior committed bundle carries the
# bare-path form; a format migration alone must never read as a "shrink").
# ──────────────────────────────────────────


def test_citation_entries_parses_both_legacy_and_numbered_link_forms():
    uri = ru.build_source_document_uri(uuid.uuid4())
    legacy = f"Body.\n\n# Citations\n- {uri}\n- certifications/iso-9001.md\n"
    linked = (
        "Body.\n\n# Citations\n\n"
        f"[1] [{uri}]({uri})\n"
        "[2] [ISO 9001:2015](/certifications/iso-9001.md)\n"
    )
    assert v._citation_entries(legacy) == v._citation_entries(linked) == {
        uri,
        "certifications/iso-9001.md",
    }


def test_citation_shrink_guard_treats_format_migration_as_no_shrink():
    """CRITICAL: the prior committed bundle uses the legacy bare-path form;
    the next run re-emits the same citations as numbered links. Both sides
    normalise to targets — a pure format migration is never a shrink."""
    uri = ru.build_source_document_uri(uuid.uuid4())
    previous_body = f"Body.\n\n# Citations\n- {uri}\n- topics/gdpr.md\n"
    new_body = (
        "Body.\n\n# Citations\n\n"
        f"[1] [{uri}]({uri})\n"
        "[2] [GDPR and Data Protection](/topics/gdpr.md)\n"
    )
    assert v.detect_citation_shrink(previous_body=previous_body, new_body=new_body) == []


def test_citation_shrink_guard_still_fires_across_formats():
    uri = ru.build_source_document_uri(uuid.uuid4())
    dropped = ru.build_reference_item_uri(uuid.uuid4())
    previous_body = f"Body.\n\n# Citations\n- {uri}\n- {dropped}\n"
    new_body = f"Body.\n\n# Citations\n\n[1] [{uri}]({uri})\n"
    assert v.detect_citation_shrink(
        previous_body=previous_body, new_body=new_body
    ) == [dropped]


def test_render_citations_trailer_emits_numbered_markdown_links():
    uri = ru.build_source_document_uri(uuid.uuid4())
    trailer = v.render_citations_trailer(
        [uri, "certifications/iso-9001.md"],
        titles={
            "certifications/iso-9001.md": (
                "ISO 9001:2015 — Quality Management Certification"
            )
        },
    )
    assert trailer == (
        "# Citations\n"
        "\n"
        f"[1] [{uri}]({uri})\n"
        "[2] [ISO 9001:2015 — Quality Management Certification]"
        "(/certifications/iso-9001.md)\n"
    )


def test_render_citations_trailer_falls_back_to_rel_path_label():
    trailer = v.render_citations_trailer(["topics/gdpr.md"])
    assert "[1] [topics/gdpr.md](/topics/gdpr.md)" in trailer


def test_normalise_citations_section_rewrites_legacy_to_numbered_links():
    uri = ru.build_source_document_uri(uuid.uuid4())
    body = f"Prose.\n\n# Citations\n- {uri}\n- topics/gdpr.md\n"
    normalised = v.normalise_citations_section(
        body, titles={"topics/gdpr.md": "GDPR and Data Protection"}
    )
    assert normalised == (
        "Prose.\n\n# Citations\n\n"
        f"[1] [{uri}]({uri})\n"
        "[2] [GDPR and Data Protection](/topics/gdpr.md)\n"
    )


def test_normalise_citations_section_is_idempotent():
    uri = ru.build_source_document_uri(uuid.uuid4())
    body = f"Prose.\n\n# Citations\n- {uri}\n- topics/gdpr.md\n"
    once = v.normalise_citations_section(body)
    assert v.normalise_citations_section(once) == once


def test_normalise_citations_section_preserves_an_existing_link_label():
    """A previously-normalised trailer's human label survives re-normalisation
    when no fresher `titles` mapping resolves the target."""
    body = "Prose.\n\n# Citations\n\n[1] [A Kept Label](/topics/gdpr.md)\n"
    assert "[1] [A Kept Label](/topics/gdpr.md)" in v.normalise_citations_section(body)


def test_normalise_citations_section_no_section_is_unchanged():
    body = "Prose with no trailer.\n"
    assert v.normalise_citations_section(body) == body


def test_link_wrapped_canonical_uri_stays_legal_only_inside_citations():
    """BI-10 under the link form: a `[uri](uri)` canonical anchor inside
    `# Citations` passes the stray-pointer guard; the SAME link anywhere
    else in the body still fails."""
    fm_ok = _valid_frontmatter()
    inside = (
        "Prose.\n\n# Citations\n\n"
        f"[1] [{_RESOURCE}]({_RESOURCE})\n"
    )
    assert v.check_concept(fm_ok, body=inside) == []

    outside = (
        f"Prose citing [{_RESOURCE}]({_RESOURCE}) inline.\n\n"
        "# Citations\n\n"
        f"[1] [{_RESOURCE}]({_RESOURCE})\n"
    )
    errors = v.check_concept(fm_ok, body=outside)
    assert any("BI-10" in err for err in errors)


# ──────────────────────────────────────────
# check_concept accepts a producer.frontmatter.ConceptFrontmatter directly
# ──────────────────────────────────────────


def test_check_concept_accepts_a_concept_frontmatter_instance():
    from scripts.cocoindex_pipeline.producer import frontmatter as fm

    record = fm.build_concept_frontmatter(**_valid_frontmatter())
    errors = v.check_concept(record, body=_VALID_BODY)
    assert errors == []


# ──────────────────────────────────────────
# S443 Amendment / DR-029 — bid-outcome facet-tag re-entry (BI-4 ruling):
# `policy`/`capability` enter as recognised facet TAGS on `topic` concepts;
# the retired `methodology` type aliases onto the existing `playbook` facet
# (no separate tag). The enumerated `type:` set is UNCHANGED — these are
# tags, not types. `tags:` stays an OPEN list (BI-12) — the registry is the
# recognised vocabulary, not a rejection allowlist.
# ──────────────────────────────────────────


def test_recognised_facet_tags_include_the_new_bid_outcome_facets():
    # S443/DR-029 registers `policy` and `capability` as recognised facets.
    assert "policy" in v.RECOGNISED_FACET_TAGS
    assert "capability" in v.RECOGNISED_FACET_TAGS


def test_recognised_facet_tags_carry_the_pre_existing_bi4_facets():
    # The BI-4 tag-carried facets already ratified before S443.
    assert {"metric", "dataset", "playbook"} <= v.RECOGNISED_FACET_TAGS


def test_methodology_is_not_a_recognised_facet_tag_only_an_alias():
    # "document methodology≡playbook; NO separate tag" — methodology folds
    # onto playbook, it is never its own recognised facet tag.
    assert "methodology" not in v.RECOGNISED_FACET_TAGS


def test_recognised_facet_tags_are_disjoint_from_the_concept_type_set():
    # Facets are TAGS, never enumerated types (BI-4).
    assert v.RECOGNISED_FACET_TAGS.isdisjoint(v.ALLOWED_CONCEPT_TYPES)


def test_methodology_tag_canonicalises_to_the_playbook_facet():
    # S443: `methodology` ≡ the existing `playbook` facet.
    assert v.canonical_facet_tag("methodology") == "playbook"


@pytest.mark.parametrize("tag", ["policy", "capability", "playbook", "metric", "dataset"])
def test_recognised_facet_tags_canonicalise_to_themselves(tag):
    assert v.canonical_facet_tag(tag) == tag


def test_non_facet_tags_pass_through_canonicalisation_unchanged():
    # `tags:` is OPEN (BI-12) — an arbitrary domain tag is not rewritten.
    assert v.canonical_facet_tag("encryption") == "encryption"


def test_normalise_facet_tags_folds_methodology_onto_playbook_and_dedupes():
    # methodology→playbook, order-preserving, and the fold collapses onto an
    # existing playbook entry rather than duplicating it.
    assert v.normalise_facet_tags(
        ["methodology", "policy", "playbook", "security"]
    ) == ("playbook", "policy", "security")


def test_normalise_facet_tags_leaves_an_already_canonical_list_untouched():
    assert v.normalise_facet_tags(["policy", "capability"]) == ("policy", "capability")


@pytest.mark.parametrize("facet_name", ["methodology", "policy", "capability"])
def test_bid_outcome_facet_names_are_rejected_as_concept_types(facet_name):
    # No new enumerated type: methodology/policy/capability must NOT pass the
    # BI-4 type-membership gate — they are facet tags, not types.
    errors = v.check_concept(_valid_frontmatter(type=facet_name), body=_VALID_BODY)
    assert any("type" in err.lower() for err in errors)


@pytest.mark.parametrize("facet_tag", ["policy", "capability", "methodology"])
def test_topic_concept_tagged_with_a_bid_outcome_facet_passes_the_gate(facet_tag):
    # A topic concept carrying a bid-outcome facet tag validates cleanly —
    # the enumerated type stays `topic`; the facet rides in `tags:`.
    errors = v.check_concept(
        _valid_frontmatter(type="topic", tags=["security", facet_tag]),
        body=_VALID_BODY,
    )
    assert errors == []


def test_concept_type_set_is_unchanged_by_the_s443_amendment():
    # Regression guard: the S443 facet-tag re-entry adds NO enumerated type.
    assert v.ALLOWED_CONCEPT_TYPES == frozenset(
        {"topic", "product", "company", "certification", "case_study"}
    )


# ──────────────────────────────────────────
# OV-7/OV-8 (ID-132 {132.34} G-OVERLAY-CV, DR-054) — the run's effective
# ontology (base ∪ client-overlay), threaded through the BI-13 gate.
# ──────────────────────────────────────────


def test_effective_ontology_base_only_matches_the_bare_base_frozensets():
    eo = v.EffectiveOntology.base_only()
    assert eo.concept_types == v.ALLOWED_CONCEPT_TYPES
    assert eo.entity_types == v.ALLOWED_ENTITY_TYPES
    assert eo.relationship_types == v.ALLOWED_RELATIONSHIP_TYPES


def test_effective_ontology_compose_of_none_overlay_is_base_only():
    # OV-4: no overlay file present composes to exactly base-only.
    assert v.EffectiveOntology.compose(None) == v.EffectiveOntology.base_only()


def test_effective_ontology_compose_is_a_sorted_deduplicated_union():
    # OV-7: base ∪ overlay, de-duplicated — a new term is added, the base
    # terms are untouched.
    eo = v.EffectiveOntology.compose({"entity_types": ["organisation", "widget"]})
    assert eo.entity_types == frozenset(v.ALLOWED_ENTITY_TYPES | {"widget"})
    assert sorted(eo.entity_types) == sorted(set(v.ALLOWED_ENTITY_TYPES) | {"widget"})


def test_effective_ontology_compose_restating_a_base_term_is_idempotent():
    # OV-3: an overlay term restating a base term is a no-op union — the
    # effective set is identical to composing without that restated term.
    restated = v.EffectiveOntology.compose({"entity_types": ["organisation", "widget"]})
    fresh = v.EffectiveOntology.compose({"entity_types": ["widget"]})
    assert restated.entity_types == fresh.entity_types


def test_effective_ontology_compose_is_deterministic_across_repeated_calls():
    overlay = {"relationship_types": ["partners_with"]}
    first = v.EffectiveOntology.compose(overlay)
    second = v.EffectiveOntology.compose(overlay)
    assert first == second


def test_effective_ontology_compose_ignores_provenance_keys():
    # `overlay` is typically the OV-6 provenance-wrapped mapping
    # (`source`/`sha256` alongside the three dimension keys) —
    # `compose` reads only the dimension keys.
    overlay = {
        "source": "ontology-overlay.json",
        "sha256": "abc123",
        "entity_types": ["widget"],
    }
    eo = v.EffectiveOntology.compose(overlay)
    assert "widget" in eo.entity_types


def test_check_type_membership_rejects_overlay_type_without_effective_ontology():
    # OV-8 core assertion (base-only half): the bare base gate rejects an
    # overlay-shaped type when no effective_ontology is supplied.
    errors = v.check_type_membership("widget_type")
    assert errors


def test_check_type_membership_accepts_overlay_type_with_effective_ontology():
    # OV-8 core assertion (overlay half): the SAME type is accepted once an
    # effective_ontology composed from an overlay naming it is supplied.
    eo = v.EffectiveOntology.compose({"concept_types": ["widget_type"]})
    errors = v.check_type_membership("widget_type", effective_ontology=eo)
    assert errors == []


def test_lint_entity_relation_mentions_rejects_overlay_entity_type_without_effective_ontology():
    errors = v.lint_entity_relation_mentions(entities=[{"entity_type": "widget"}])
    assert errors


def test_lint_entity_relation_mentions_accepts_overlay_entity_type_with_effective_ontology():
    eo = v.EffectiveOntology.compose({"entity_types": ["widget"]})
    errors = v.lint_entity_relation_mentions(
        entities=[{"entity_type": "widget"}], effective_ontology=eo
    )
    assert errors == []


def test_check_concept_threads_effective_ontology_through_to_type_membership():
    # OV-8 — the core testStrategy assertion at the check_concept/
    # validate_concept API surface: an overlay-added concept type is
    # rejected by the base-only gate and accepted only when the run's
    # composed effective_ontology includes it.
    eo = v.EffectiveOntology.compose({"concept_types": ["widget_type"]})

    errors_without = v.check_concept(_valid_frontmatter(type="widget_type"), body=_VALID_BODY)
    errors_with = v.check_concept(
        _valid_frontmatter(type="widget_type"), body=_VALID_BODY, effective_ontology=eo
    )

    assert errors_without  # base-only gate rejects
    assert errors_with == []  # overlay-composed gate accepts


def test_validate_concept_raises_without_overlay_and_passes_with_it():
    eo = v.EffectiveOntology.compose({"concept_types": ["widget_type"]})
    fm = _valid_frontmatter(type="widget_type")

    with pytest.raises(v.ConceptValidationError):
        v.validate_concept(fm, body=_VALID_BODY)

    v.validate_concept(fm, body=_VALID_BODY, effective_ontology=eo)  # does not raise


# ──────────────────────────────────────────
# PC-4 (ID-163 TECH, DR-079) — per-bundle-class BASE concept-type set.
# `base_for_class` scopes the BI-4 concept_types dimension to the run's
# bundle class; entity_types/relationship_types stay the shared base sets
# (TECH id-163 only class-scopes concept_types, not the other two
# dimensions — no per-class entity/relationship registry exists).
# ──────────────────────────────────────────


def test_base_for_class_client_business_matches_the_pre_163_business_set():
    eo = v.EffectiveOntology.base_for_class("client_business")
    assert eo.concept_types == v.ALLOWED_CONCEPT_TYPES


def test_base_for_class_showcase_matches_the_client_business_set():
    # DR-079: showcase shares the existing business type set with
    # client_business (brief: "client_business/showcase -> existing
    # business set").
    business = v.EffectiveOntology.base_for_class("client_business")
    showcase = v.EffectiveOntology.base_for_class("showcase")
    assert showcase.concept_types == business.concept_types


@pytest.mark.parametrize(
    "system_type", ["schema", "tool", "api", "navigation", "playbook"]
)
def test_base_for_class_system_baseline_accepts_the_five_system_types(system_type):
    eo = v.EffectiveOntology.base_for_class("system_baseline")
    errors = v.check_type_membership(system_type, effective_ontology=eo)
    assert errors == []


def test_base_for_class_system_baseline_is_exactly_the_five_system_types():
    eo = v.EffectiveOntology.base_for_class("system_baseline")
    assert eo.concept_types == frozenset(
        {"schema", "tool", "api", "navigation", "playbook"}
    )


def test_base_for_class_system_baseline_rejects_a_business_type():
    eo = v.EffectiveOntology.base_for_class("system_baseline")
    errors = v.check_type_membership("company", effective_ontology=eo)
    assert errors


def test_base_for_class_client_business_rejects_a_system_type():
    eo = v.EffectiveOntology.base_for_class("client_business")
    errors = v.check_type_membership("schema", effective_ontology=eo)
    assert errors


def test_base_for_class_internal_dev_is_deferred():
    # bl-478: internal_dev has no ratified BI-4 type set yet —
    # base_for_class must fail loud, not silently return an empty or
    # permissive set.
    with pytest.raises(ValueError, match="internal_dev"):
        v.EffectiveOntology.base_for_class("internal_dev")


def test_base_only_still_delegates_to_client_business_unchanged():
    # PC-4: base_only()'s existing (pre-163) call sites —
    # check_type_membership and lint_entity_relation_mentions — must
    # observe IDENTICAL behaviour post-change.
    assert v.EffectiveOntology.base_only() == v.EffectiveOntology.base_for_class(
        "client_business"
    )


def test_base_for_class_shares_entity_and_relationship_dimensions_across_classes():
    system = v.EffectiveOntology.base_for_class("system_baseline")
    business = v.EffectiveOntology.base_for_class("client_business")
    assert system.entity_types == business.entity_types == v.ALLOWED_ENTITY_TYPES
    assert (
        system.relationship_types
        == business.relationship_types
        == v.ALLOWED_RELATIONSHIP_TYPES
    )


# ──────────────────────────────────────────
# bl-456 routing hints + bl-477 A19 confidence — shared frontmatter contract
# extension (FRONTMATTER-WAVE.md §"Shared frontmatter contract extension").
# ──────────────────────────────────────────


def test_as_mapping_carries_the_four_new_fields_from_a_concept_frontmatter_instance():
    """Load-bearing: `_as_mapping` must carry purpose/task/audience/confidence
    so downstream checks (BI-10 stray-pointer, A19 membership) see them."""
    from scripts.cocoindex_pipeline.producer import frontmatter as fm_module

    record = fm_module.build_concept_frontmatter(
        **_valid_frontmatter(),
        purpose="Explain X",
        task="answer Y",
        audience="Z",
        confidence="strong",
    )
    mapping = v._as_mapping(record)
    assert mapping["purpose"] == "Explain X"
    assert mapping["task"] == "answer Y"
    assert mapping["audience"] == "Z"
    assert mapping["confidence"] == "strong"


def test_absence_of_all_four_new_fields_is_never_an_error():
    errors = v.check_concept(_valid_frontmatter(), body=_VALID_BODY)
    assert errors == []


@pytest.mark.parametrize("value", ["strong", "partial", "no-content", "needs-SME"])
def test_check_confidence_accepts_every_a19_value(value):
    assert v.check_confidence(value) == []


def test_check_confidence_returns_empty_on_absence():
    assert v.check_confidence(None) == []


def test_check_confidence_rejects_an_invalid_value():
    errors = v.check_confidence("banana")
    assert len(errors) == 1


def test_concept_with_invalid_confidence_fails_the_gate():
    errors = v.check_concept(
        _valid_frontmatter(confidence="banana"), body=_VALID_BODY
    )
    assert any("confidence" in err.lower() for err in errors)


@pytest.mark.parametrize("value", ["strong", "partial", "no-content", "needs-SME"])
def test_concept_with_each_a19_confidence_value_passes_the_gate(value):
    errors = v.check_concept(_valid_frontmatter(confidence=value), body=_VALID_BODY)
    assert errors == []


def test_concept_without_confidence_key_passes_the_gate():
    """Absence — the key not present at all in a raw mapping (as opposed to
    a dataclass-carried explicit `None`) — is also never an error."""
    fm = _valid_frontmatter()
    assert "confidence" not in fm
    errors = v.check_concept(fm, body=_VALID_BODY)
    assert errors == []


def test_routing_hint_embedding_a_canonical_uri_is_a_bi10_violation():
    """Proves `_as_mapping` carries the hint fields — the existing
    `check_no_stray_pointer` BI-10 scan then guards them automatically, with
    no separate positive check needed."""
    errors = v.check_concept(
        _valid_frontmatter(purpose=f"See {_RESOURCE} for details"), body=_VALID_BODY
    )
    assert any("BI-10" in err for err in errors)


@pytest.mark.parametrize("hint_field", ["purpose", "task", "audience"])
def test_any_routing_hint_embedding_a_canonical_uri_is_a_bi10_violation(hint_field):
    errors = v.check_concept(
        _valid_frontmatter(**{hint_field: f"See {_RESOURCE} for details"}),
        body=_VALID_BODY,
    )
    assert any("BI-10" in err for err in errors)


def test_routing_hints_carry_arbitrary_strings_without_a_positive_check():
    """Hints get NO positive shape check — any non-pointer-carrying string is
    fine, absence is fine."""
    errors = v.check_concept(
        _valid_frontmatter(purpose="Anything at all", task="", audience=None),
        body=_VALID_BODY,
    )
    assert errors == []
