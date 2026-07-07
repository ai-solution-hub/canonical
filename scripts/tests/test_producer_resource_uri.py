"""Tests for producer/resource_uri.py — BI-6/7/8/9/10 canonical:// contract
grid (ID-132 {132.6} G-PASS1a).

Oracle uuid5 values below are computed independently against the pinned
`_KH_PIPELINE_DOC_NS` literal (`fbfaf1ff-1ee4-583c-9757-1674465b2ec1`,
`flow.py:1665`) to prove `derive_source_document_id`/`derive_reference_item_id`
reproduce flow.py's exact `sd:`/`ri:` formula (flow.py:1994, flow.py:3869-3870)
— the "Hard-coded uuid5 oracles over _KH_PIPELINE_DOC_NS" pattern used
elsewhere in this suite (e.g. test_cocoindex_chunking.py).
"""

import uuid

import pytest

from scripts.cocoindex_pipeline.producer import resource_uri as ru

_NS = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


# ──────────────────────────────────────────
# BI-7: deterministic seed-contract derivation
# ──────────────────────────────────────────


def test_derive_source_document_id_matches_flow_py_formula():
    rel_path = "products/lms.md"
    expected = uuid.uuid5(_NS, f"sd:{rel_path}")
    assert ru.derive_source_document_id(rel_path) == expected
    # Hard-coded oracle, independently computed — pins the formula byte-for-byte.
    assert str(expected) == "475e02e0-47ac-5e9d-90e9-2a2988875b57"


def test_derive_reference_item_id_matches_flow_py_formula():
    source_url = "https://example.com/docs/lms-overview"
    expected = uuid.uuid5(_NS, f"ri:{source_url}")
    assert ru.derive_reference_item_id(source_url) == expected
    assert str(expected) == "bf216d36-80ec-5101-ab0d-167c96a5de1a"


def test_derive_source_document_id_is_deterministic():
    a = ru.derive_source_document_id("security/policy.md")
    b = ru.derive_source_document_id("security/policy.md")
    assert a == b


def test_derive_source_document_id_differs_by_rel_path():
    a = ru.derive_source_document_id("a.md")
    b = ru.derive_source_document_id("b.md")
    assert a != b


def test_derive_source_document_id_rejects_empty_rel_path():
    with pytest.raises(ValueError):
        ru.derive_source_document_id("")


def test_derive_reference_item_id_rejects_empty_source_url():
    with pytest.raises(ValueError):
        ru.derive_reference_item_id("")


# ──────────────────────────────────────────
# BI-6: per-row anchors — ONLY source_documents/reference_items
# ──────────────────────────────────────────


def test_build_source_document_uri_shape():
    record_id = uuid.uuid5(_NS, "sd:products/lms.md")
    assert (
        ru.build_source_document_uri(record_id)
        == f"canonical://source_documents/{record_id}"
    )


def test_build_reference_item_uri_shape():
    record_id = uuid.uuid5(_NS, "ri:https://example.com/x")
    assert (
        ru.build_reference_item_uri(record_id)
        == f"canonical://reference_items/{record_id}"
    )


def test_build_per_row_uri_accepts_string_uuid():
    record_id = "475e02e0-47ac-5e9d-90e9-2a2988875b57"
    assert (
        ru.build_per_row_uri("source_documents", record_id)
        == f"canonical://source_documents/{record_id}"
    )


def test_build_per_row_uri_rejects_q_a_pairs_table():
    """BI-7: the gen_random_uuid() q_a_pairs master is NEVER emitted in the
    per-row anchor form — the table itself is rejected, not just the id."""
    with pytest.raises(ValueError, match="q_a_pairs"):
        ru.build_per_row_uri("q_a_pairs", uuid.uuid4())


def test_build_per_row_uri_rejects_arbitrary_table():
    with pytest.raises(ValueError):
        ru.build_per_row_uri("concepts", uuid.uuid4())


def test_build_per_row_uri_rejects_invalid_uuid():
    with pytest.raises(ValueError):
        ru.build_per_row_uri("source_documents", "not-a-uuid")


def test_source_document_uri_from_rel_path_composes_derive_and_build():
    rel_path = "products/lms.md"
    expected_id = ru.derive_source_document_id(rel_path)
    assert (
        ru.source_document_uri_from_rel_path(rel_path)
        == f"canonical://source_documents/{expected_id}"
    )


def test_reference_item_uri_from_source_url_composes_derive_and_build():
    source_url = "https://example.com/docs/lms-overview"
    expected_id = ru.derive_reference_item_id(source_url)
    assert (
        ru.reference_item_uri_from_source_url(source_url)
        == f"canonical://reference_items/{expected_id}"
    )


# ──────────────────────────────────────────
# BI-8: q_a_pairs table/query form — NEVER a row uuid
# ──────────────────────────────────────────


def test_build_q_a_pairs_query_uri_scope_tag_form():
    assert (
        ru.build_q_a_pairs_query_uri(scope_tag="security-basics")
        == "canonical://q_a_pairs?scope_tag=security-basics"
    )


def test_build_q_a_pairs_query_uri_domain_subtopic_form():
    assert (
        ru.build_q_a_pairs_query_uri(domain="security", subtopic="encryption")
        == "canonical://q_a_pairs?domain=security&subtopic=encryption"
    )


def test_build_q_a_pairs_query_uri_rejects_mixed_forms():
    with pytest.raises(ValueError):
        ru.build_q_a_pairs_query_uri(scope_tag="x", domain="y")


def test_build_q_a_pairs_query_uri_rejects_no_args():
    with pytest.raises(ValueError):
        ru.build_q_a_pairs_query_uri()


def test_build_q_a_pairs_query_uri_rejects_partial_domain_subtopic():
    with pytest.raises(ValueError):
        ru.build_q_a_pairs_query_uri(domain="security")


def test_q_a_pairs_query_uri_has_no_path_segment_after_table():
    """The gen_random_uuid() master is never emitted: the q_a_pairs uri is
    ALWAYS the `?query` form, never a `canonical://q_a_pairs/<uuid>` path."""
    uri = ru.build_q_a_pairs_query_uri(scope_tag="anything")
    assert "/" not in uri.removeprefix("canonical://")


def test_build_q_a_pairs_query_uri_signature_has_no_uuid_parameter():
    """Structural guarantee (BI-7): no keyword on this builder can carry a
    q_a_pairs row id — a caller cannot even attempt to pass one."""
    import inspect

    params = inspect.signature(ru.build_q_a_pairs_query_uri).parameters
    assert set(params) == {"scope_tag", "domain", "subtopic"}


# ──────────────────────────────────────────
# BI-9: concept→concept cross-refs cite the PATH, never a uuid
# ──────────────────────────────────────────


def test_concept_citation_path_returns_the_rel_path_unchanged():
    assert ru.concept_citation_path("products/lms.md") == "products/lms.md"


def test_concept_citation_path_rejects_canonical_uri():
    with pytest.raises(ValueError):
        ru.concept_citation_path("canonical://source_documents/" + str(uuid.uuid4()))


def test_concept_citation_path_rejects_bare_uuid():
    with pytest.raises(ValueError):
        ru.concept_citation_path(str(uuid.uuid4()))


def test_concept_citation_path_rejects_empty():
    with pytest.raises(ValueError):
        ru.concept_citation_path("")


# ──────────────────────────────────────────
# BI-10: shared uuid/canonical-uri detector
# ──────────────────────────────────────────


def test_contains_record_pointer_detects_canonical_scheme():
    assert ru.contains_record_pointer(
        "see canonical://source_documents/" + str(uuid.uuid4())
    )


def test_contains_record_pointer_detects_bare_embedded_uuid():
    assert ru.contains_record_pointer(f"anchor id {uuid.uuid4()} embedded")


def test_contains_record_pointer_false_for_clean_prose():
    assert not ru.contains_record_pointer("Encryption best practices overview")


def test_contains_record_pointer_false_for_empty():
    assert not ru.contains_record_pointer("")


def test_is_canonical_resource_uri():
    assert ru.is_canonical_resource_uri("canonical://source_documents/x")
    assert not ru.is_canonical_resource_uri("https://example.com")
    assert not ru.is_canonical_resource_uri("")
