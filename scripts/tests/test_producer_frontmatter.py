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
    # {132.7} S451 rider fold-in 1: timestamp is now ALWAYS double-quoted
    # (fix option (a)) so a YAML-1.1 loader never re-parses it as a
    # datetime — see the quoting-ambiguity tests below.
    assert 'timestamp: "2026-07-07T09:30:00Z"' in text
    assert "07/07/2026" not in text


def test_emit_concept_frontmatter_builds_and_renders_in_one_call():
    text = fm.emit_concept_frontmatter(**_base_kwargs())
    assert text.startswith("---\n")
    assert "title: Encryption at rest" in text


# ──────────────────────────────────────────
# bl-456 routing hints + bl-477 A19 confidence — shared frontmatter contract
# extension (FRONTMATTER-WAVE.md §"Shared frontmatter contract extension").
# ──────────────────────────────────────────


def test_build_concept_frontmatter_defaults_new_fields_to_none():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    assert record.purpose is None
    assert record.task is None
    assert record.audience is None
    assert record.confidence is None


def test_build_concept_frontmatter_carries_routing_hints_and_confidence():
    record = fm.build_concept_frontmatter(
        **_base_kwargs(
            purpose="Explain encryption-at-rest options",
            task="answer a procurement question",
            audience="SME buyer",
            confidence="strong",
        )
    )
    assert record.purpose == "Explain encryption-at-rest options"
    assert record.task == "answer a procurement question"
    assert record.audience == "SME buyer"
    assert record.confidence == "strong"


@pytest.mark.parametrize("hint_field", ["purpose", "task", "audience"])
def test_routing_hint_embedding_a_canonical_uri_is_rejected(hint_field):
    """BI-10: routing hints get the same contains_record_pointer guard the
    existing string fields get."""
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(**{hint_field: f"See {_RESOURCE}"}))


@pytest.mark.parametrize("hint_field", ["purpose", "task", "audience"])
def test_routing_hint_embedding_a_bare_uuid_is_rejected(hint_field):
    poisoned = f"Anchor: {uuid.uuid4()}"
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(**{hint_field: poisoned}))


@pytest.mark.parametrize("value", ["strong", "partial", "no-content", "needs-SME"])
def test_build_concept_frontmatter_accepts_every_a19_confidence_value(value):
    record = fm.build_concept_frontmatter(**_base_kwargs(confidence=value))
    assert record.confidence == value


def test_build_concept_frontmatter_rejects_invalid_confidence_value():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(confidence="banana"))


def test_render_omits_routing_hints_and_confidence_when_none():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    text = fm.render_concept_frontmatter(record)
    assert "purpose:" not in text
    assert "task:" not in text
    assert "audience:" not in text
    assert "confidence:" not in text


def test_render_emits_routing_hints_and_confidence_only_when_set():
    record = fm.build_concept_frontmatter(
        **_base_kwargs(purpose="Explain X", task="answer Y", audience="Z", confidence="partial")
    )
    text = fm.render_concept_frontmatter(record)
    assert "purpose: Explain X" in text
    assert "task: answer Y" in text
    assert "audience: Z" in text
    assert "confidence: partial" in text


def test_render_new_fields_appear_in_fixed_order_after_description_before_resource():
    record = fm.build_concept_frontmatter(
        **_base_kwargs(purpose="Explain X", task="answer Y", audience="Z", confidence="partial")
    )
    text = fm.render_concept_frontmatter(record)
    order = [
        text.index("description:"),
        text.index("purpose:"),
        text.index("task:"),
        text.index("audience:"),
        text.index("confidence:"),
        text.index("resource:"),
    ]
    assert order == sorted(order)


@pytest.mark.parametrize("value", ["no-content", "needs-SME"])
def test_render_hyphenated_confidence_values_are_unquoted(value):
    """The hyphenated A19 values must not match any _YAML_* ambiguity
    pattern (both are anchored on `$`, neither is bool/null/number/
    timestamp-shaped) — they render as plain, unquoted scalars."""
    record = fm.build_concept_frontmatter(**_base_kwargs(confidence=value))
    text = fm.render_concept_frontmatter(record)
    assert f"confidence: {value}\n" in text
    assert f'confidence: "{value}"' not in text


def test_emit_concept_frontmatter_threads_routing_hints_and_confidence():
    text = fm.emit_concept_frontmatter(
        **_base_kwargs(purpose="Explain X", task="answer Y", audience="Z", confidence="strong")
    )
    assert "purpose: Explain X" in text
    assert "confidence: strong" in text


# ──────────────────────────────────────────
# A19 (bl-477) — derive_concept_confidence: the deterministic, never
# model-authored confidence-setting rule (FRONTMATTER-WAVE.md §"Design — A19
# producer-drafted confidence-setting rule").
# ──────────────────────────────────────────


def test_derive_concept_confidence_is_strong_for_per_row_anchor_plus_two_record_citations():
    resource = ru.build_source_document_uri(uuid.uuid4())
    citations = [ru.build_source_document_uri(uuid.uuid4()), ru.build_reference_item_uri(uuid.uuid4())]
    assert fm.derive_concept_confidence(resource=resource, citations=citations) == "strong"


def test_derive_concept_confidence_is_partial_for_per_row_anchor_with_one_record_citation():
    resource = ru.build_source_document_uri(uuid.uuid4())
    citations = [ru.build_reference_item_uri(uuid.uuid4())]
    assert fm.derive_concept_confidence(resource=resource, citations=citations) == "partial"


def test_derive_concept_confidence_is_partial_for_qa_pairs_query_anchor():
    """A q_a_pairs query-form resource is not a PER-ROW anchor."""
    resource = ru.build_q_a_pairs_query_uri(scope_tag="pricing")
    citations = [ru.build_source_document_uri(uuid.uuid4()), ru.build_reference_item_uri(uuid.uuid4())]
    assert fm.derive_concept_confidence(resource=resource, citations=citations) == "partial"


def test_derive_concept_confidence_is_partial_when_resource_is_none():
    citations = [ru.build_source_document_uri(uuid.uuid4()), ru.build_reference_item_uri(uuid.uuid4())]
    assert fm.derive_concept_confidence(resource=None, citations=citations) == "partial"


def test_derive_concept_confidence_cross_link_only_second_citation_does_not_lift_to_strong():
    """Only distinct RECORD anchors corroborate — a concept cross-link path
    is not fresh record grounding."""
    resource = ru.build_source_document_uri(uuid.uuid4())
    citations = [ru.build_source_document_uri(uuid.uuid4()), "topics/gdpr.md"]
    assert fm.derive_concept_confidence(resource=resource, citations=citations) == "partial"


def test_derive_concept_confidence_is_partial_for_reference_concept_web_anchor():
    """A Pass-2 reference concept whose `resource` is a gated web
    `reference_items` anchor is honest "grounded but thin" — partial, even
    with a corroborating citation, unless it independently clears the
    per-row + >=2 bar."""
    resource = ru.build_reference_item_uri(uuid.uuid4())
    citations = [resource]
    assert fm.derive_concept_confidence(resource=resource, citations=citations) == "partial"


# ──────────────────────────────────────────
# {132.7} S451 rider fold-in 1 — YAML-1.1 type-ambiguity quoting.
#
# The reference agent serialises via `yaml.safe_dump`, which quotes any
# plain scalar that would re-parse as a non-string (bool/null/number/
# timestamp) on reload. The hand-rolled emitter here previously only quoted
# on leading special chars / ": " / trailing ":" / " #" — under-quoting a
# title of "NO" or "99.9", and never quoting `timestamp:` at all. This
# under-quoting is a silent round-trip type-drift hazard for any strict
# YAML-1.1 consumer (e.g. PyYAML, which the addendum's reference/any lifted
# viewer would use). Proof of fidelity: a YAML double-quoted scalar is
# ALWAYS type `str`, universally, regardless of content (YAML 1.1 + 1.2
# spec) — so asserting the emitter wraps every ambiguous value in `"..."`
# is sufficient proof of round-trip type fidelity without needing a
# `pyyaml` test dependency (not pinned in requirements.txt; {132.7} brief
# prefers a dependency-free check).
# ──────────────────────────────────────────


@pytest.mark.parametrize(
    "value",
    [
        "NO", "no", "No", "yes", "YES", "true", "True", "FALSE", "on", "Off",
    ],
)
def test_needs_quoting_flags_yaml_bool_ambiguous_scalars(value):
    assert fm._needs_quoting(value) is True


@pytest.mark.parametrize("value", ["null", "Null", "NULL", "~"])
def test_needs_quoting_flags_yaml_null_ambiguous_scalars(value):
    assert fm._needs_quoting(value) is True


@pytest.mark.parametrize("value", ["99.9", "42", "-3.14e10", "0x1A", "1_000"])
def test_needs_quoting_flags_yaml_number_ambiguous_scalars(value):
    assert fm._needs_quoting(value) is True


@pytest.mark.parametrize(
    "value",
    ["2026-07-07T09:30:00Z", "2026-07-07", "2026-07-07 09:30:00"],
)
def test_needs_quoting_flags_yaml_timestamp_ambiguous_scalars(value):
    assert fm._needs_quoting(value) is True


@pytest.mark.parametrize(
    "value", ["Encryption at rest", "security", "case_study", "topic-42x"]
)
def test_needs_quoting_leaves_ordinary_strings_unquoted(value):
    assert fm._needs_quoting(value) is False


@pytest.mark.parametrize("value", ["NO", "99.9", "null", "2026-07-07T09:30:00Z"])
def test_yaml_scalar_wraps_ambiguous_values_in_double_quotes(value):
    # A double-quoted YAML scalar is ALWAYS str-typed on reload — this is
    # the round-trip type-fidelity guarantee the {132.7} rider requires.
    assert fm._yaml_scalar(value) == f'"{value}"'


def test_render_quotes_a_title_that_is_yaml_bool_ambiguous():
    record = fm.build_concept_frontmatter(**_base_kwargs(title="NO"))
    text = fm.render_concept_frontmatter(record)
    assert 'title: "NO"' in text


def test_render_quotes_a_title_that_is_yaml_number_ambiguous():
    record = fm.build_concept_frontmatter(**_base_kwargs(title="99.9"))
    text = fm.render_concept_frontmatter(record)
    assert 'title: "99.9"' in text


def test_render_always_quotes_timestamp_regardless_of_content():
    """Fix option (a) — ALWAYS quote timestamp, not just when ambiguous."""
    record = fm.build_concept_frontmatter(**_base_kwargs(timestamp="2026-07-07T09:30:00Z"))
    text = fm.render_concept_frontmatter(record)
    assert 'timestamp: "2026-07-07T09:30:00Z"' in text
