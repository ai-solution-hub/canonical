"""Tests for producer/frontmatter.py — BI-12 concept frontmatter emitter
(ID-132 {132.6} G-PASS1a).

DR-019 amendment (PRODUCT.md §"S436 Amendments" item 1, owner-ratified
2026-07-02): the `timestamp` frontmatter field is ISO-8601 — UK `DD/MM/YYYY`
governs bundle BODY PROSE only, never this field. TECH.md's BI-12 change-map
row summary ("UK English/DD-MM-YYYY") predates this carve-out; this test file
pins the ratified, more specific PRODUCT.md behaviour.
"""

import uuid
from datetime import datetime, timezone

import pytest

from scripts.cocoindex_pipeline.producer import frontmatter as fm
from scripts.cocoindex_pipeline.producer import resource_uri as ru

_RESOURCE = ru.build_source_document_uri(uuid.uuid4())


def _base_kwargs(**overrides):
    kwargs = dict(
        type="topic",
        title="Encryption at rest",
        description="Overview of encryption-at-rest practices.",
        timestamp="2026-07-07T09:30:00Z",
        tags=("security", "encryption"),
        resource=_RESOURCE,
    )
    kwargs.update(overrides)
    return kwargs


# ──────────────────────────────────────────
# BI-12: required keys present
# ──────────────────────────────────────────


def test_build_concept_frontmatter_carries_all_required_keys():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    assert record.type == "topic"
    assert record.title == "Encryption at rest"
    assert record.description == "Overview of encryption-at-rest practices."
    assert record.timestamp == "2026-07-07T09:30:00Z"
    assert record.resource == _RESOURCE
    assert record.tags == ("security", "encryption")


@pytest.mark.parametrize("missing", ["type", "title", "description"])
def test_build_concept_frontmatter_rejects_missing_required_key(missing):
    kwargs = _base_kwargs(**{missing: ""})
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**kwargs)


def test_build_concept_frontmatter_allows_absent_resource():
    """BI-12: resource: is present "where one exists" — optional."""
    record = fm.build_concept_frontmatter(**_base_kwargs(resource=None))
    assert record.resource is None


def test_build_concept_frontmatter_allows_empty_tags():
    record = fm.build_concept_frontmatter(**_base_kwargs(tags=()))
    assert record.tags == ()


def test_build_concept_frontmatter_rejects_empty_tag_entry():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(tags=("security", "")))


# ──────────────────────────────────────────
# DR-019: timestamp is ISO-8601, never DD/MM/YYYY
# ──────────────────────────────────────────


def test_timestamp_accepts_iso8601_string_unchanged():
    record = fm.build_concept_frontmatter(**_base_kwargs(timestamp="2026-07-07T09:30:00Z"))
    assert record.timestamp == "2026-07-07T09:30:00Z"


def test_timestamp_accepts_timezone_aware_datetime_and_renders_iso8601():
    dt = datetime(2026, 7, 7, 9, 30, 0, tzinfo=timezone.utc)
    record = fm.build_concept_frontmatter(**_base_kwargs(timestamp=dt))
    assert record.timestamp == "2026-07-07T09:30:00Z"


def test_timestamp_rejects_naive_datetime():
    dt = datetime(2026, 7, 7, 9, 30, 0)
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(timestamp=dt))


def test_timestamp_rejects_uk_dd_mm_yyyy_form():
    """DR-019: DD/MM/YYYY is body-prose only — the frontmatter timestamp
    field must be ISO-8601 and rejects the UK date form outright."""
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(timestamp="07/07/2026"))


def test_timestamp_rejects_non_iso_garbage():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(timestamp="not-a-date"))


# ──────────────────────────────────────────
# BI-10: only resource: may carry a Canonical uuid/canonical:// uri
# ──────────────────────────────────────────


def test_resource_must_be_a_canonical_uri():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(resource="https://example.com"))


def test_title_embedding_a_canonical_uri_is_rejected():
    poisoned = f"See {_RESOURCE} for details"
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(title=poisoned))


def test_description_embedding_a_bare_uuid_is_rejected():
    poisoned = f"Anchor: {uuid.uuid4()}"
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(description=poisoned))


def test_tag_embedding_a_uuid_is_rejected():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(tags=(str(uuid.uuid4()),)))


def test_clean_title_and_description_are_accepted():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    assert "canonical://" not in record.title
    assert "canonical://" not in record.description


# ──────────────────────────────────────────
# Rendering
# ──────────────────────────────────────────


def test_render_includes_all_required_keys_and_resource_and_tags():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    text = fm.render_concept_frontmatter(record)
    assert text.startswith("---\n")
    assert text.rstrip("\n").endswith("---")
    for key in ("type:", "title:", "description:", "timestamp:", "resource:", "tags:"):
        assert key in text
    assert "- security" in text
    assert "- encryption" in text


def test_render_omits_resource_when_absent():
    record = fm.build_concept_frontmatter(**_base_kwargs(resource=None))
    text = fm.render_concept_frontmatter(record)
    assert "resource:" not in text


def test_render_emits_empty_tags_list_when_no_tags():
    record = fm.build_concept_frontmatter(**_base_kwargs(tags=()))
    text = fm.render_concept_frontmatter(record)
    assert "tags: []" in text


def test_render_quotes_a_title_containing_a_colon():
    record = fm.build_concept_frontmatter(
        **_base_kwargs(title="Security: best practices")
    )
    text = fm.render_concept_frontmatter(record)
    assert 'title: "Security: best practices"' in text


def test_render_timestamp_is_iso8601_not_uk_date_format():
    record = fm.build_concept_frontmatter(**_base_kwargs(timestamp="2026-07-07T09:30:00Z"))
    text = fm.render_concept_frontmatter(record)
    assert "timestamp: 2026-07-07T09:30:00Z" in text
    assert "07/07/2026" not in text


def test_emit_concept_frontmatter_builds_and_renders_in_one_call():
    text = fm.emit_concept_frontmatter(**_base_kwargs())
    assert text.startswith("---\n")
    assert "title: Encryption at rest" in text
