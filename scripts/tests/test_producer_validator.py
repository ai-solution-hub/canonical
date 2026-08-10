"""Tests for producer/validator.py — the BI-13 concept-frontmatter validator
gate (ID-132 {132.7} G-VALIDATE), upgraded to the OKF v0.2 emission contract
(id-426, S546 F1-A/F2-B).

Covers: the v0.2 required-key check (`generated` replaces `timestamp`),
the ID-427 {427.5} `type` SHAPE rule (DR-141 — a label, never a
membership), the F2-B top-level-resource inversion (never
canonical://), the §5.1 `sources` shape gate (`check_sources`), the BI-10
"no uuid outside sources[].resource" assertion, the closed
12-entity/10-relation ontology semantic lint, and the S451 rider fold-in 2
citation-shrink DETECTION API (BI-17/BI-22/DR-016) — now harvesting BOTH
the legacy v0.1 `# Citations` trailer and the v0.2 `sources:` frontmatter,
so the format migration is never a false shrink.

No concept is written/published unless it passes this gate (PRODUCT.md BI-13)
— `validate_concept` is what `{132.10}` wires onto the `declare_file` call
site.
"""

import uuid

import pytest

from scripts.cocoindex_pipeline.producer import frontmatter as fm_module
from scripts.cocoindex_pipeline.producer import resource_uri as ru
from scripts.cocoindex_pipeline.producer import validator as v

_RESOURCE = ru.build_source_document_uri(uuid.uuid4())
_GENERATED = {"by": "kh-concept-producer/test-model-1", "at": "2026-07-07T09:30:00Z"}


def _valid_sources(resource=_RESOURCE):
    return [{"id": fm_module.derive_source_id(resource), "resource": resource, "title": None}]


def _valid_frontmatter(**overrides):
    fm = dict(
        type="topic",
        title="Encryption at rest",
        description="Overview of encryption-at-rest practices.",
        generated=dict(_GENERATED),
        tags=["security", "encryption"],
        sources=_valid_sources(),
    )
    fm.update(overrides)
    return fm


_VALID_BODY = (
    "A distilled synthesis of encryption-at-rest practice.\n\n"
    f"[^{fm_module.derive_source_id(_RESOURCE)}]: {fm_module.derive_source_id(_RESOURCE)}\n"
)

# A LEGACY v0.1 body (trailer-carrying) — the gate still tolerates the
# `# Citations` ingress for prior committed bundles.
_LEGACY_BODY = (
    "A distilled synthesis of encryption-at-rest practice.\n\n"
    "# Citations\n"
    f"- {_RESOURCE}\n"
)


# ──────────────────────────────────────────
# BI-12 (v0.2): required keys
# ──────────────────────────────────────────


def test_valid_concept_passes():
    errors = v.check_concept(_valid_frontmatter(), body=_VALID_BODY)
    assert errors == []


@pytest.mark.parametrize("missing_key", ["type", "title", "description", "generated", "tags"])
def test_concept_missing_a_required_key_is_rejected(missing_key):
    fm = _valid_frontmatter()
    del fm[missing_key]
    errors = v.check_concept(fm, body=_VALID_BODY)
    assert any(missing_key in err for err in errors)


def test_timestamp_is_no_longer_a_required_key():
    """S546: `timestamp` is removed, not shadowed — a v0.2 concept with no
    such key passes, and the required set names `generated` instead."""
    fm = _valid_frontmatter()
    assert "timestamp" not in fm
    assert v.check_concept(fm, body=_VALID_BODY) == []
    assert "timestamp" not in v._REQUIRED_KEYS
    assert "generated" in v._REQUIRED_KEYS


@pytest.mark.parametrize(
    "bad_generated",
    [
        "2026-07-07T09:30:00Z",  # a bare string is the retired timestamp shape
        {"by": "", "at": "2026-07-07T09:30:00Z"},
        {"by": "kh-concept-producer/m", "at": ""},
        {"by": "kh-concept-producer/m"},
        {"at": "2026-07-07T09:30:00Z"},
        None,
    ],
)
def test_malformed_generated_is_rejected(bad_generated):
    errors = v.check_concept(
        _valid_frontmatter(generated=bad_generated), body=_VALID_BODY
    )
    assert any("generated" in err for err in errors)


def test_concept_missing_a_required_key_raises_via_validate_concept():
    fm = _valid_frontmatter()
    del fm["title"]
    with pytest.raises(v.ConceptValidationError) as excinfo:
        v.validate_concept(fm, body=_VALID_BODY)
    assert any("title" in err for err in excinfo.value.errors)


def test_resource_and_sources_are_not_required_keys():
    """v0.2: a DB-backed concept omits `resource:` entirely (F2-B), and the
    `sources` SHAPE gate does not require presence (citation non-emptiness
    is BI-17's draft-time contract in enrich.py)."""
    fm = _valid_frontmatter()
    del fm["sources"]
    assert "resource" not in fm
    errors = v.check_concept(fm, body="A distilled synthesis.\n")
    assert errors == []


# ──────────────────────────────────────────
# ID-427 {427.5} / DR-141: `type` is a shape-validated LABEL.
#
# The gate asserts a label is WELL-FORMED. It asserts nothing about which
# labels exist, because a producer that enumerates its permitted types is
# the inversion DR-141 withdrew ("consumers MUST tolerate unknown types";
# OKF §1 lists a fixed concept-type taxonomy under Non-goals).
# ──────────────────────────────────────────


@pytest.mark.parametrize(
    "concept_type",
    [
        # Every label the platform emits today — the shape rule ratifies
        # existing output rather than forcing a migration.
        "topic",
        "product",
        "company",
        "certification",
        "case_study",
        "schema",
        "tool",
        "api",
        "navigation",
        "playbook",
    ],
)
def test_every_type_the_platform_emits_today_still_validates(concept_type):
    errors = v.check_concept(_valid_frontmatter(type=concept_type), body=_VALID_BODY)
    assert errors == []


@pytest.mark.parametrize(
    "novel_type",
    [
        # THE assertion of this subtask. Not one of these was ever a member
        # of any register the producer held — `ALLOWED_CONCEPT_TYPES`, the
        # per-class sets, the Source-side `CONCEPT_TYPES`, or the TS legend.
        # Each is emitted-and-valid now with no register edited.
        "procurement_policy",
        "document",
        "questionnaire_response",
        "answer_set",
        "reference",
        "framework",
    ],
)
def test_a_type_no_register_ever_held_validates(novel_type):
    errors = v.check_concept(_valid_frontmatter(type=novel_type), body=_VALID_BODY)
    assert errors == []


@pytest.mark.parametrize(
    ("bad_type", "expected_fault"),
    [
        # Each rejection names WHAT IS WRONG WITH THE LABEL.
        ("Q A Pair!", "snake_case"),
        ("x", "characters long"),
        ("a_very_long_five_word_type_label", "words"),
        ("", "empty"),
    ],
)
def test_a_malformed_type_is_rejected_with_a_shape_fault(bad_type, expected_fault):
    errors = v.check_concept(_valid_frontmatter(type=bad_type), body=_VALID_BODY)
    type_errors = [e for e in errors if "type" in e.lower()]
    assert type_errors, f"{bad_type!r} should have produced a type error"
    assert any(expected_fault in e for e in type_errors), type_errors


@pytest.mark.parametrize(
    "bad_type", ["Q A Pair!", "x", "a_very_long_five_word_type_label", "", "q_a_pair"]
)
def test_a_shape_error_never_enumerates_a_permitted_vocabulary(bad_type):
    # The regression this subtask most needs to hold: a shape error that
    # lists the types it WOULD have accepted has reintroduced the closed
    # taxonomy in prose. Assert on the message, because prose is where a
    # deleted gate comes back.
    errors = v.check_type_shape(bad_type)
    assert errors
    message = " ".join(errors)
    for withdrawn_term in (
        "topic",
        "product",
        "company",
        "certification",
        "case_study",
        "schema",
        "navigation",
        "playbook",
    ):
        assert withdrawn_term not in message, message
    for enumerating_word in ("one of", "outside", "allowed", "permitted set"):
        assert enumerating_word not in message.lower(), message


def test_q_a_pair_is_refused_unconditionally_at_the_write_gate():
    # BI-3 survives the register's deletion — it is a RESERVED NAME, not a
    # permitted-value set, and it is the one thing `type` may never be.
    errors = v.check_concept(_valid_frontmatter(type="q_a_pair"), body=_VALID_BODY)
    assert any("BI-3" in e for e in errors), errors


def test_a_non_string_type_is_rejected():
    assert v.check_type_shape(None)
    assert v.check_type_shape(42)


# ──────────────────────────────────────────
# S546 F2-B: top-level resource is never canonical://
# ──────────────────────────────────────────


def test_absent_resource_is_valid():
    errors = v.check_concept(_valid_frontmatter(), body=_VALID_BODY)
    assert errors == []


def test_web_url_resource_is_valid():
    """The Pass-2 reference-concept shape: the real fetched URL."""
    errors = v.check_concept(
        _valid_frontmatter(resource="https://client.example/certifications/iso-9001"),
        body=_VALID_BODY,
    )
    assert errors == []


@pytest.mark.parametrize(
    "bad_resource",
    [
        _RESOURCE,
        "canonical://reference_items/" + str(uuid.uuid4()),
        "canonical://q_a_pairs?scope_tag=pricing",
    ],
)
def test_canonical_pointer_as_top_level_resource_is_rejected(bad_resource):
    errors = v.check_concept(_valid_frontmatter(resource=bad_resource), body=_VALID_BODY)
    assert any("F2-B" in err for err in errors)


def test_empty_resource_is_rejected():
    errors = v.check_resource_scheme("")
    assert errors


def test_none_resource_passes_check_resource_scheme():
    assert v.check_resource_scheme(None) == []


# ──────────────────────────────────────────
# §5.1: the sources shape gate
# ──────────────────────────────────────────


@pytest.mark.parametrize(
    "resource",
    [
        _RESOURCE,
        "canonical://reference_items/" + str(uuid.uuid4()),
        "canonical://q_a_pairs?scope_tag=pricing",
        "https://client.example/page",
        "/case-studies/acme.md",
        "case-studies/acme.md",
    ],
)
def test_sources_accept_every_v02_resource_form(resource):
    fm = _valid_frontmatter(
        sources=[{"id": fm_module.derive_source_id(resource), "resource": resource}]
    )
    assert v.check_concept(fm, body="A synthesis.\n") == []


def test_sources_reject_the_retired_domain_subtopic_query_form():
    """S531: the retired ?domain=&subtopic= form must not validate as a
    sources[].resource either."""
    fm = _valid_frontmatter(
        sources=[
            {
                "id": "qa-legacy",
                "resource": "canonical://q_a_pairs?domain=security&subtopic=encryption",
            }
        ]
    )
    errors = v.check_concept(fm, body="A synthesis.\n")
    assert any("sources[].resource" in err for err in errors)


@pytest.mark.parametrize(
    "bad_resource",
    [
        "canonical://q_a_pairs/" + str(uuid.uuid4()),  # BI-7: q_a_pairs master never per-row
        "canonical://not_a_real_table/" + str(uuid.uuid4()),
        "canonical://source_documents/not-a-uuid",
        "ftp://client.example/a",
        "",
        None,
    ],
)
def test_bad_sources_resource_is_rejected(bad_resource):
    fm = _valid_frontmatter(sources=[{"id": "bad", "resource": bad_resource}])
    errors = v.check_concept(fm, body="A synthesis.\n")
    assert any("sources[].resource" in err for err in errors)


def test_sources_reject_a_missing_or_empty_id():
    errors = v.check_sources([{"resource": _RESOURCE}])
    assert any("sources[].id" in err for err in errors)
    errors = v.check_sources([{"id": "", "resource": _RESOURCE}])
    assert any("sources[].id" in err for err in errors)


def test_sources_reject_a_duplicated_id():
    errors = v.check_sources(
        [
            {"id": "dup", "resource": "https://client.example/a"},
            {"id": "dup", "resource": "https://client.example/b"},
        ]
    )
    assert any("duplicated" in err for err in errors)


def test_sources_reject_a_pointer_bearing_title():
    errors = v.check_sources(
        [{"id": "ok", "resource": _RESOURCE, "title": f"See {_RESOURCE}"}]
    )
    assert any("sources[].title" in err for err in errors)


def test_sources_tolerate_the_spec_credibility_signals():
    """§5.1's optional `author`/`usage_count`/`last_modified` keys (and any
    unknown key) are tolerated — the spec's unknown-key posture."""
    errors = v.check_sources(
        [
            {
                "id": "ga4-schema",
                "resource": "https://developers.google.com/analytics/schema",
                "title": "GA4 export schema",
                "author": "team:ga4-docs",
                "usage_count": 5000,
                "last_modified": "2026-05-30",
            }
        ]
    )
    assert errors == []


def test_sources_absence_and_none_are_not_errors():
    assert v.check_sources(None) == []


def test_non_list_sources_is_rejected():
    errors = v.check_sources("not-a-list")
    assert errors


# ──────────────────────────────────────────
# BI-10: no uuid outside sources[].resource (legacy `# Citations` bodies
# stay tolerated for prior committed bundles)
# ──────────────────────────────────────────


def test_uuid_in_description_fails():
    poisoned = _valid_frontmatter(description=f"Anchor: {uuid.uuid4()}")
    errors = v.check_concept(poisoned, body=_VALID_BODY)
    assert any("BI-10" in err for err in errors)


def test_uuid_in_tag_fails():
    poisoned = _valid_frontmatter(tags=["security", str(uuid.uuid4())])
    errors = v.check_concept(poisoned, body=_VALID_BODY)
    assert any("BI-10" in err for err in errors)


def test_uuid_in_body_outside_citations_fails():
    body = f"See {_RESOURCE} in the prose body.\n"
    errors = v.check_concept(_valid_frontmatter(), body=body)
    assert any("BI-10" in err for err in errors)


def test_uuid_inside_a_legacy_citations_section_is_fine():
    errors = v.check_concept(_valid_frontmatter(), body=_LEGACY_BODY)
    assert errors == []


def test_uuid_in_sources_resource_is_fine():
    """`sources[].resource` is the sanctioned ingress — BI-10 does not
    apply to it."""
    errors = v.check_concept(_valid_frontmatter(), body="No provenance here.\n")
    assert errors == []


def test_v02_footnote_definitions_never_carry_a_pointer():
    """The v0.2 body surface: footnote definitions keyed by sources[].id —
    no canonical:// anchor ever appears in the body."""
    assert "canonical://" not in _VALID_BODY
    assert v.check_concept(_valid_frontmatter(), body=_VALID_BODY) == []


def test_link_wrapped_canonical_uri_stays_legal_only_inside_citations():
    """BI-10 under the legacy link form: a `[uri](uri)` canonical anchor
    inside a legacy `# Citations` passes the stray-pointer guard; the SAME
    link anywhere else in the body still fails."""
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
# (BI-17/BI-22/DR-016), v0.2-aware (id-426): `detect_citation_shrink`
# harvests BOTH the legacy trailer and the v0.2 `sources:` frontmatter.
# ──────────────────────────────────────────


def _v02_document(*resources):
    """A minimal v0.2 document whose provenance rides the frontmatter
    `sources:` list (no body trailer)."""
    lines = [
        "---",
        "type: topic",
        "title: T",
        "description: D",
        'generated: { by: kh-concept-producer/test-model-1, at: "2026-07-07T09:30:00Z" }',
        "tags: []",
        "sources:",
    ]
    for resource in resources:
        lines.append(f"  - id: {fm_module.derive_source_id(resource)}")
        lines.append(f"    resource: {resource}")
    lines += ["---", "", "Body prose.", ""]
    return "\n".join(lines)


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
    body = _LEGACY_BODY
    assert v.detect_citation_shrink(previous_body=body, new_body=body) == []


def test_citation_shrink_detection_handles_absent_previous_citations():
    """A first-write concept has no prior state to shrink from."""
    assert v.detect_citation_shrink(previous_body="", new_body=_LEGACY_BODY) == []


def test_citation_shrink_detection_fires_when_provenance_is_removed_entirely():
    previous_body = _LEGACY_BODY
    new_body = "Synthesis with no provenance at all.\n"
    missing = v.detect_citation_shrink(previous_body=previous_body, new_body=new_body)
    assert len(missing) == 1


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


def test_frontmatter_source_targets_harvests_the_v02_sources_block():
    uri = ru.build_source_document_uri(uuid.uuid4())
    document = _v02_document(uri, "https://client.example/about", "/case-studies/acme.md")
    assert v._frontmatter_source_targets(document) == {
        uri,
        "https://client.example/about",
        "case-studies/acme.md",
    }


def test_frontmatter_source_targets_is_empty_for_a_bare_body_or_legacy_doc():
    assert v._frontmatter_source_targets("No frontmatter here.\n") == set()
    assert v._frontmatter_source_targets(_LEGACY_BODY) == set()


def test_frontmatter_source_targets_ignores_a_top_level_resource_key():
    """Only the `sources:` block is provenance — a reference concept's
    top-level `resource:` URL is not harvested as a citation target."""
    document = (
        "---\n"
        "type: topic\n"
        "title: T\n"
        "description: D\n"
        "resource: https://client.example/fetched-page\n"
        "sources:\n"
        "  - id: ref-1\n"
        "    resource: https://client.example/cited\n"
        "---\n\nBody.\n"
    )
    assert v._frontmatter_source_targets(document) == {"https://client.example/cited"}


def test_citation_shrink_guard_treats_v01_to_v02_migration_as_no_shrink():
    """CRITICAL (id-426): the prior committed doc carries a v0.1 trailer;
    the new draft carries the SAME targets in its v0.2 `sources:`
    frontmatter and no trailer. A pure format migration is never a
    shrink — otherwise the first v0.2 producer run would refuse every
    previously-committed concept."""
    uri = ru.build_source_document_uri(uuid.uuid4())
    previous_doc = f"Body.\n\n# Citations\n- {uri}\n- topics/gdpr.md\n"
    new_doc = _v02_document(uri, "/topics/gdpr.md")
    assert v.detect_citation_shrink(previous_body=previous_doc, new_body=new_doc) == []


def test_citation_shrink_guard_still_fires_across_the_format_migration():
    uri = ru.build_source_document_uri(uuid.uuid4())
    dropped = ru.build_reference_item_uri(uuid.uuid4())
    previous_doc = f"Body.\n\n# Citations\n- {uri}\n- {dropped}\n"
    new_doc = _v02_document(uri)
    assert v.detect_citation_shrink(
        previous_body=previous_doc, new_body=new_doc
    ) == [dropped]


def test_citation_shrink_guard_compares_two_v02_documents():
    uri = ru.build_source_document_uri(uuid.uuid4())
    dropped = ru.build_reference_item_uri(uuid.uuid4())
    previous_doc = _v02_document(uri, dropped)
    superset_doc = _v02_document(uri, dropped, "https://client.example/new")
    shrunk_doc = _v02_document(uri)
    assert v.detect_citation_shrink(previous_body=previous_doc, new_body=superset_doc) == []
    assert v.detect_citation_shrink(previous_body=previous_doc, new_body=shrunk_doc) == [dropped]


def test_the_trailer_renderers_are_retired():
    """S546 F1-A: dropped in this change — no one-release carry."""
    assert not hasattr(v, "render_citations_trailer")
    assert not hasattr(v, "normalise_citations_section")


# ──────────────────────────────────────────
# check_concept accepts a producer.frontmatter.ConceptFrontmatter directly
# ──────────────────────────────────────────


def _dataclass_frontmatter(**overrides):
    kwargs = dict(
        type="topic",
        title="Encryption at rest",
        description="Overview of encryption-at-rest practices.",
        generated_by=_GENERATED["by"],
        generated_at=_GENERATED["at"],
        tags=("security", "encryption"),
        sources=fm_module.sources_from_citations([_RESOURCE]),
    )
    kwargs.update(overrides)
    return fm_module.build_concept_frontmatter(**kwargs)


def test_check_concept_accepts_a_concept_frontmatter_instance():
    record = _dataclass_frontmatter()
    errors = v.check_concept(record, body=_VALID_BODY)
    assert errors == []


def test_as_mapping_carries_generated_and_sources_from_a_dataclass():
    record = _dataclass_frontmatter()
    mapping = v._as_mapping(record)
    assert mapping["generated"] == {"by": _GENERATED["by"], "at": _GENERATED["at"]}
    assert mapping["sources"][0]["resource"] == _RESOURCE
    assert "timestamp" not in mapping


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


def test_a_facet_name_is_now_also_a_well_formed_type_label():
    # REPLACES `test_recognised_facet_tags_are_disjoint_from_the_concept_
    # type_set`, whose subject (`ALLOWED_CONCEPT_TYPES`) is deleted. That
    # test asserted facets could never be types — the very constraint that
    # forced `reference`/`policy`/`capability` to be invented as facets
    # because the closed set would not admit them (DR-141's headline
    # evidence). Under DR-141 the constraint is withdrawn: a facet name is
    # an ordinary label, and {427.6} resolves the three bends AS types.
    for facet in sorted(v.RECOGNISED_FACET_TAGS):
        assert v.check_type_shape(facet) == [], facet


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
def test_bid_outcome_facet_names_are_accepted_as_concept_types(facet_name):
    # INVERTED from `test_bid_outcome_facet_names_are_rejected_as_concept_
    # types` (S443/DR-029), and the inversion is the point. Those three
    # names became "facets" precisely BECAUSE the closed type set refused a
    # sixth type — `validator.py`'s own comments recorded the bend. With
    # the set gone, they are simply well-formed labels; nothing emits them
    # yet (RESEARCH M2 measured no emitter for policy/capability), and
    # nothing has to for the gate to stop refusing them.
    errors = v.check_concept(_valid_frontmatter(type=facet_name), body=_VALID_BODY)
    assert errors == []


@pytest.mark.parametrize("facet_tag", ["policy", "capability", "methodology"])
def test_topic_concept_tagged_with_a_bid_outcome_facet_passes_the_gate(facet_tag):
    # A topic concept carrying a bid-outcome facet tag validates cleanly —
    # the enumerated type stays `topic`; the facet rides in `tags:`.
    errors = v.check_concept(
        _valid_frontmatter(type="topic", tags=["security", facet_tag]),
        body=_VALID_BODY,
    )
    assert errors == []


def test_the_producer_holds_no_concept_type_register_at_all():
    # REPLACES `test_concept_type_set_is_unchanged_by_the_s443_amendment`,
    # a regression guard PINNING the five-member set. Pinning it is exactly
    # what {427.5} withdraws, so the guard inverts: assert the module
    # exports no concept-type register for anything to pin.
    assert not hasattr(v, "ALLOWED_CONCEPT_TYPES")
    assert not hasattr(v, "_CLASS_CONCEPT_TYPES")
    assert not hasattr(v.EffectiveOntology, "base_for_class")
    assert not hasattr(v.EffectiveOntology.base_only(), "concept_types")


# ──────────────────────────────────────────
# OV-7/OV-8 (ID-132 {132.34} G-OVERLAY-CV, DR-054) — the run's effective
# ontology (base ∪ client-overlay), threaded through the BI-13 gate.
# ──────────────────────────────────────────


def test_effective_ontology_base_only_matches_the_bare_base_frozensets():
    eo = v.EffectiveOntology.base_only()
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


def test_a_client_type_needs_no_overlay_to_be_accepted():
    # REPLACES the OV-8 concept-type pair (`check_type_membership` rejects
    # `widget_type` without an overlay / accepts it with one). Both halves
    # asserted that a client's own concept type required PERMISSION from an
    # `ontology-overlay.json`. DR-141 withdraws the permission model for
    # this dimension, so the behavioural claim inverts: the same label is
    # accepted either way, and an overlay changes nothing about it.
    without = v.check_concept(_valid_frontmatter(type="widget_type"), body=_VALID_BODY)
    eo = v.EffectiveOntology.compose({"concept_types": ["widget_type"]})
    with_overlay = v.check_concept(
        _valid_frontmatter(type="widget_type"), body=_VALID_BODY, effective_ontology=eo
    )
    assert without == []
    assert with_overlay == []


def test_an_overlay_declaring_concept_types_stays_schema_valid_and_composes_nothing():
    # {427.11} owns the artefact half. Here: an overlay may still DECLARE
    # `concept_types` (the key stays in the closed overlay schema, and a
    # shipped client bundle carrying one must not start failing), but the
    # composed ontology has no such dimension to widen.
    eo = v.EffectiveOntology.compose({"concept_types": ["widget_type"]})
    assert not hasattr(eo, "concept_types")
    assert eo == v.EffectiveOntology.base_only()


def test_lint_entity_relation_mentions_rejects_overlay_entity_type_without_effective_ontology():
    errors = v.lint_entity_relation_mentions(entities=[{"entity_type": "widget"}])
    assert errors


def test_lint_entity_relation_mentions_accepts_overlay_entity_type_with_effective_ontology():
    eo = v.EffectiveOntology.compose({"entity_types": ["widget"]})
    errors = v.lint_entity_relation_mentions(
        entities=[{"entity_type": "widget"}], effective_ontology=eo
    )
    assert errors == []


def test_check_concept_still_threads_effective_ontology_to_the_entity_lint():
    # OV-8 survives for the dimensions that are GENUINELY closed. Rewritten
    # from `test_check_concept_threads_effective_ontology_through_to_type_
    # membership` onto `entity_types` — same threading behaviour asserted
    # at the same API surface, on the dimension that still gates.
    eo = v.EffectiveOntology.compose({"entity_types": ["widget"]})
    mentions = [{"entity_type": "widget"}]

    errors_without = v.check_concept(
        _valid_frontmatter(), body=_VALID_BODY, entities=mentions
    )
    errors_with = v.check_concept(
        _valid_frontmatter(), body=_VALID_BODY, entities=mentions, effective_ontology=eo
    )

    assert errors_without  # base-only lint rejects
    assert errors_with == []  # overlay-composed lint accepts


def test_validate_concept_raises_without_overlay_and_passes_with_it():
    # Same rewrite as above, one level up at the raising boundary.
    eo = v.EffectiveOntology.compose({"entity_types": ["widget"]})
    fm = _valid_frontmatter()
    mentions = [{"entity_type": "widget"}]

    with pytest.raises(v.ConceptValidationError):
        v.validate_concept(fm, body=_VALID_BODY, entities=mentions)

    v.validate_concept(
        fm, body=_VALID_BODY, entities=mentions, effective_ontology=eo
    )  # does not raise


def test_validate_concept_never_raises_for_an_unheard_of_type():
    # The write gate itself, not just the check helper: no register, no
    # overlay, a type string this codebase has never contained — published.
    v.validate_concept(_valid_frontmatter(type="procurement_policy"), body=_VALID_BODY)


# ──────────────────────────────────────────
# PI-7 (ID-427 {427.5}, owner ruling S546) — bundle classes are UNIFORM.
#
# This block REPLACES the eight PC-4/`base_for_class` tests, which asserted
# the opposite: a per-class concept-type set, `client_business`/`showcase`
# sharing the business five, `system_baseline` owning its own five, the two
# being mutually rejecting, and `internal_dev` failing loud for want of a
# ratified set. Every one of those assertions encoded the class-scoped
# taxonomy DR-141 and the owner's S546 uniformity ruling withdraw —
# *"we should be conformant and uniform across bundle classes. Our current
# setup missed the very purpose of OKF (organic knowledge base growth)"*.
# What survives from the old block is its LOAD-BEARING half: the shared
# entity/relationship dimensions, asserted below.
# ──────────────────────────────────────────


@pytest.mark.parametrize(
    "concept_type", ["company", "schema", "document", "procurement_policy"]
)
def test_no_type_is_scoped_to_a_bundle_class(concept_type):
    # The old block's `system_baseline rejects a business type` /
    # `client_business rejects a system type` pair, inverted. A business
    # label, a system label and two labels belonging to neither all pass
    # the same single gate, because there is only one gate now.
    assert v.check_type_shape(concept_type) == []


def test_the_effective_ontology_is_identical_for_every_bundle_class():
    # There is no longer any per-class entry point to compare, which IS the
    # assertion — one base ontology, whatever the run's class.
    base = v.EffectiveOntology.base_only()
    assert base.entity_types == v.ALLOWED_ENTITY_TYPES
    assert base.relationship_types == v.ALLOWED_RELATIONSHIP_TYPES
    assert v.EffectiveOntology.compose(None) == base


def test_internal_dev_no_longer_has_a_deferred_type_set_to_fail_on():
    # REPLACES `test_base_for_class_internal_dev_is_deferred`. bl-478's
    # fail-loud existed because internal_dev had "no ratified BI-4 type set
    # YET". Under DR-141 no class has one or needs one, so the deferral has
    # no subject and the entry point it lived on is gone. The behavioural
    # consequence at the write gate is asserted in
    # test_producer_bundle_writer.py.
    assert not hasattr(v.EffectiveOntology, "base_for_class")


# ──────────────────────────────────────────
# bl-456 routing hints + bl-477 A19 confidence — shared frontmatter contract
# extension (FRONTMATTER-WAVE.md), carried UNCHANGED through v0.2.
# ──────────────────────────────────────────


def test_as_mapping_carries_the_four_new_fields_from_a_concept_frontmatter_instance():
    """Load-bearing: `_as_mapping` must carry purpose/task/audience/confidence
    so downstream checks (BI-10 stray-pointer, A19 membership) see them."""
    record = _dataclass_frontmatter(
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
