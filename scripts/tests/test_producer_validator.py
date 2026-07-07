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
    previous_body = (
        "Synthesis.\n\n# Citations\n"
        f"- {ru.build_source_document_uri(uuid.uuid4())}\n"
        f"- {ru.build_reference_item_uri(uuid.uuid4())}\n"
    )
    # New draft keeps only the first citation — a shrink.
    first_line = previous_body.splitlines()[3]
    new_body = "Synthesis (revised).\n\n# Citations\n" + first_line + "\n"

    missing = v.detect_citation_shrink(previous_body=previous_body, new_body=new_body)
    assert len(missing) == 1
    assert missing[0] in previous_body


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
# check_concept accepts a producer.frontmatter.ConceptFrontmatter directly
# ──────────────────────────────────────────


def test_check_concept_accepts_a_concept_frontmatter_instance():
    from scripts.cocoindex_pipeline.producer import frontmatter as fm

    record = fm.build_concept_frontmatter(**_valid_frontmatter())
    errors = v.check_concept(record, body=_VALID_BODY)
    assert errors == []
