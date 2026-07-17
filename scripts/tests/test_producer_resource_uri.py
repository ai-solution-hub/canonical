"""Tests for producer/resource_uri.py — BI-6/7/8/9/10 canonical:// contract
grid (ID-132 {132.6} G-PASS1a).

Oracle uuid5 values below are computed independently against the pinned
`_KH_PIPELINE_DOC_NS` literal (`fbfaf1ff-1ee4-583c-9757-1674465b2ec1`,
`flow.py:1708`) to prove `derive_source_document_id`/`derive_reference_item_id`
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


# ──────────────────────────────────────────
# OKF v0.1 conformance (SPEC §5.1/§8) — citation-entry target extraction:
# the single normalisation every citation consumer keys comparisons on.
# ──────────────────────────────────────────


def test_citation_target_passes_a_bare_legacy_entry_through():
    uri = ru.build_source_document_uri(uuid.uuid4())
    assert ru.citation_target(uri) == uri
    assert ru.citation_target("certifications/iso-9001.md") == "certifications/iso-9001.md"


def test_citation_target_unwraps_a_numbered_markdown_link():
    uri = ru.build_source_document_uri(uuid.uuid4())
    assert ru.citation_target(f"[1] [{uri}]({uri})") == uri
    assert (
        ru.citation_target("[2] [ISO 9001:2015](/certifications/iso-9001.md)")
        == "certifications/iso-9001.md"
    )


def test_citation_target_unwraps_a_bare_markdown_link_without_ordinal():
    assert (
        ru.citation_target("[GDPR and Data Protection](/topics/gdpr.md)")
        == "topics/gdpr.md"
    )


def test_citation_target_strips_a_leading_slash_from_a_bare_path():
    assert ru.citation_target("/topics/gdpr.md") == "topics/gdpr.md"


def test_parse_citation_entry_returns_label_and_target():
    label, target = ru.parse_citation_entry(
        "[2] [ISO 9001:2015 — Quality Management Certification](/certifications/iso-9001.md)"
    )
    assert label == "ISO 9001:2015 — Quality Management Certification"
    assert target == "certifications/iso-9001.md"


def test_parse_citation_entry_bare_form_has_no_label():
    label, target = ru.parse_citation_entry("topics/gdpr.md")
    assert label is None
    assert target == "topics/gdpr.md"


# ──────────────────────────────────────────
# PC-5 (ID-163 TECH, DR-086): the git-blob/doc-page citation scheme —
# the system_baseline bundle's additive anchor form alongside canonical://.
# ──────────────────────────────────────────


def test_public_canonical_blob_base_is_the_dr086_ratified_public_repo():
    assert ru.PUBLIC_CANONICAL_BLOB_BASE == "https://github.com/ai-solution-hub/canonical/blob"


def test_build_git_blob_citation_whole_file_form_has_no_line_range():
    anchor = ru.build_git_blob_citation("deadbeef", "docs/navigation/getting-started.md")
    assert anchor == f"{ru.PUBLIC_CANONICAL_BLOB_BASE}/deadbeef/docs/navigation/getting-started.md"
    assert "#L" not in anchor


def test_build_git_blob_citation_line_range_form_appends_the_l_fragment():
    anchor = ru.build_git_blob_citation(
        "deadbeef", "lib/mcp/tools/content.ts", line_start=4, line_end=9
    )
    assert (
        anchor
        == f"{ru.PUBLIC_CANONICAL_BLOB_BASE}/deadbeef/lib/mcp/tools/content.ts#L4-L9"
    )


def test_build_git_blob_citation_rejects_empty_sha():
    with pytest.raises(ValueError, match="git_blob_sha"):
        ru.build_git_blob_citation("", "x.md")


def test_build_git_blob_citation_rejects_empty_path():
    with pytest.raises(ValueError, match="path"):
        ru.build_git_blob_citation("deadbeef", "")


def test_build_git_blob_citation_rejects_a_partial_line_range():
    with pytest.raises(ValueError, match="line_start"):
        ru.build_git_blob_citation("deadbeef", "x.ts", line_start=4, line_end=None)
    with pytest.raises(ValueError, match="line_end"):
        ru.build_git_blob_citation("deadbeef", "x.ts", line_start=None, line_end=9)


def test_is_git_blob_citation_true_for_a_public_canonical_blob_url():
    anchor = ru.build_git_blob_citation("deadbeef", "docs/navigation/x.md")
    assert ru.is_git_blob_citation(anchor)


def test_is_git_blob_citation_false_for_a_canonical_scheme_uri():
    uri = ru.build_source_document_uri(uuid.uuid4())
    assert not ru.is_git_blob_citation(uri)


def test_is_git_blob_citation_false_for_a_private_docs_site_url():
    """S3/DR-086 hard rule: the private docs-site is never a mint source —
    proven here by construction, not an explicit denylist: a private-host
    URL simply does not match the public blob-base prefix."""
    assert not ru.is_git_blob_citation(
        "https://knowledge-hub-docs-site.example.test/specs/id-163/TECH.md"
    )


def test_is_git_blob_citation_false_for_a_bare_concept_cross_link_path():
    assert not ru.is_git_blob_citation("topics/gdpr.md")


def test_is_git_blob_citation_false_for_non_string():
    assert not ru.is_git_blob_citation(None)  # type: ignore[arg-type]
