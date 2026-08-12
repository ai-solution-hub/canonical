"""Tests for producer/frontmatter.py — BI-12 concept frontmatter emitter
(ID-132 {132.6} G-PASS1a), upgraded to the OKF v0.2 emission contract
(id-426, S546 rulings F1-A/F2-B).

v0.2 surface pinned here:
- `generated: { by, at }` (§5.2) replaces the retired v0.1 `timestamp` —
  removed, not shadowed. `generated.at` keeps the DR-019 ISO-8601 rule
  (UK `DD/MM/YYYY` governs bundle BODY PROSE only, never this field) and
  the S451-rider ALWAYS-double-quote rule; `generated.by` is a §7 actor.
- `sources:` (§5.1) is the provenance list — `{ id, resource, title? }`
  entries with deterministic, reorder-stable ids (`derive_source_id`).
- Top-level `resource:` must NOT be a canonical:// pointer (F2-B).
- The `# Citations` trailer is retired (F1-A): `render_source_footnotes`
  emits `[^id]:` footnote definitions instead.
"""

import re
import uuid
from datetime import datetime, timezone

import pytest
from ruamel.yaml import YAML

from scripts.cocoindex_pipeline.producer import frontmatter as fm
from scripts.cocoindex_pipeline.producer import resource_uri as ru

_ANCHOR = ru.build_source_document_uri(uuid.uuid4())
_GENERATED_BY = "kh-concept-producer/test-model-1"
_GENERATED_AT = "2026-07-07T09:30:00Z"


def _base_kwargs(**overrides):
    kwargs = dict(
        type="topic",
        title="Encryption at rest",
        description="Overview of encryption-at-rest practices.",
        generated_by=_GENERATED_BY,
        generated_at=_GENERATED_AT,
        tags=("security", "encryption"),
        sources=fm.sources_from_citations([_ANCHOR]),
    )
    kwargs.update(overrides)
    return kwargs


# ──────────────────────────────────────────
# BI-12 (v0.2): required keys present
# ──────────────────────────────────────────


def test_build_concept_frontmatter_carries_all_required_keys():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    assert record.type == "topic"
    assert record.title == "Encryption at rest"
    assert record.description == "Overview of encryption-at-rest practices."
    assert record.generated_by == _GENERATED_BY
    assert record.generated_at == _GENERATED_AT
    assert record.tags == ("security", "encryption")
    assert record.resource is None
    assert [s.resource for s in record.sources] == [_ANCHOR]


@pytest.mark.parametrize("missing", ["type", "title", "description"])
def test_build_concept_frontmatter_rejects_missing_required_key(missing):
    kwargs = _base_kwargs(**{missing: ""})
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**kwargs)


def test_build_concept_frontmatter_rejects_empty_generated_by():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(generated_by=""))


def test_build_concept_frontmatter_has_no_timestamp_field():
    """S546: `timestamp` is removed, not shadowed — the dataclass carries
    no such field and the builder accepts no such kwarg."""
    record = fm.build_concept_frontmatter(**_base_kwargs())
    assert not hasattr(record, "timestamp")
    with pytest.raises(TypeError):
        fm.build_concept_frontmatter(
            **_base_kwargs(), timestamp="2026-07-07T09:30:00Z"
        )


def test_build_concept_frontmatter_allows_absent_resource_and_sources():
    record = fm.build_concept_frontmatter(**_base_kwargs(sources=()))
    assert record.resource is None
    assert record.sources == ()


def test_build_concept_frontmatter_allows_empty_tags():
    record = fm.build_concept_frontmatter(**_base_kwargs(tags=()))
    assert record.tags == ()


def test_build_concept_frontmatter_rejects_empty_tag_entry():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(tags=("security", "")))


# ──────────────────────────────────────────
# §7: generated.by actor convention
# ──────────────────────────────────────────


@pytest.mark.parametrize(
    "actor",
    [
        "kh-concept-producer/glm-5.2",
        "reference_agent/gemini-2.5-pro",
        "human:liam",
        "process:finance-nightly",
    ],
)
def test_generated_by_accepts_every_section7_actor_form(actor):
    record = fm.build_concept_frontmatter(**_base_kwargs(generated_by=actor))
    assert record.generated_by == actor


@pytest.mark.parametrize("actor", ["glm-5.2", "human:", "/glm-5.2", "producer/"])
def test_generated_by_rejects_non_actor_forms(actor):
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(generated_by=actor))


# ──────────────────────────────────────────
# DR-019 (carried to §5.2): generated.at is ISO-8601, never DD/MM/YYYY
# ──────────────────────────────────────────


def test_generated_at_accepts_iso8601_string_unchanged():
    record = fm.build_concept_frontmatter(**_base_kwargs(generated_at="2026-07-07T09:30:00Z"))
    assert record.generated_at == "2026-07-07T09:30:00Z"


def test_generated_at_accepts_timezone_aware_datetime_and_renders_iso8601():
    dt = datetime(2026, 7, 7, 9, 30, 0, tzinfo=timezone.utc)
    record = fm.build_concept_frontmatter(**_base_kwargs(generated_at=dt))
    assert record.generated_at == "2026-07-07T09:30:00Z"


def test_generated_at_rejects_naive_datetime():
    dt = datetime(2026, 7, 7, 9, 30, 0)
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(generated_at=dt))


def test_generated_at_rejects_uk_dd_mm_yyyy_form():
    """DR-019: DD/MM/YYYY is body-prose only — generated.at must be
    ISO-8601 and rejects the UK date form outright."""
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(generated_at="07/07/2026"))


def test_generated_at_rejects_non_iso_garbage():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(generated_at="not-a-date"))


# ──────────────────────────────────────────
# S546 F2-B: top-level resource is never canonical://
# ──────────────────────────────────────────


def test_resource_rejects_a_canonical_pointer():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(resource=_ANCHOR))


def test_resource_rejects_the_qa_pairs_query_form():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(
            **_base_kwargs(resource=ru.build_q_a_pairs_query_uri(scope_tag="pricing"))
        )


def test_resource_accepts_a_real_web_url():
    """The Pass-2 reference-concept shape: resource is the real fetched
    URL (followable, §4.1-conformant)."""
    record = fm.build_concept_frontmatter(
        **_base_kwargs(resource="https://client.example/certifications/iso-9001")
    )
    assert record.resource == "https://client.example/certifications/iso-9001"


# ──────────────────────────────────────────
# BI-10: only sources[].resource may carry a Canonical uuid/canonical:// uri
# ──────────────────────────────────────────


def test_title_embedding_a_canonical_uri_is_rejected():
    poisoned = f"See {_ANCHOR} for details"
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(title=poisoned))


def test_description_embedding_a_bare_uuid_is_rejected():
    poisoned = f"Anchor: {uuid.uuid4()}"
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(description=poisoned))


def test_tag_embedding_a_uuid_is_rejected():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(tags=(str(uuid.uuid4()),)))


def test_generated_by_embedding_a_canonical_uri_is_rejected():
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(generated_by=f"agent/{_ANCHOR}"))


def test_clean_title_and_description_are_accepted():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    assert "canonical://" not in record.title
    assert "canonical://" not in record.description


# ──────────────────────────────────────────
# §5.1 sources — entry validation
# ──────────────────────────────────────────


def test_sources_accept_canonical_anchor_web_url_and_bundle_path():
    entries = fm.sources_from_citations(
        [_ANCHOR, "https://client.example/about", "case-studies/acme.md"]
    )
    record = fm.build_concept_frontmatter(**_base_kwargs(sources=entries))
    assert [s.resource for s in record.sources] == [
        _ANCHOR,
        "https://client.example/about",
        "/case-studies/acme.md",
    ]


def test_sources_reject_duplicate_ids():
    entry = fm.ConceptSource(id="dup", resource="https://client.example/a")
    other = fm.ConceptSource(id="dup", resource="https://client.example/b")
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(sources=(entry, other)))


def test_sources_reject_an_empty_id():
    entry = fm.ConceptSource(id="", resource="https://client.example/a")
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(sources=(entry,)))


def test_sources_reject_an_invalid_resource():
    entry = fm.ConceptSource(id="bad", resource="ftp://client.example/a")
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(sources=(entry,)))


def test_sources_reject_a_pointer_bearing_title():
    entry = fm.ConceptSource(id="ok", resource=_ANCHOR, title=f"See {_ANCHOR}")
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(sources=(entry,)))


@pytest.mark.parametrize(
    "resource",
    [
        "canonical://source_documents/00000000-0000-4000-8000-000000000001",
        "canonical://reference_items/00000000-0000-4000-8000-000000000002",
        "canonical://q_a_pairs?scope_tag=pricing",
        "https://client.example/page",
        "http://client.example/page",
        "/case-studies/acme.md",
        "case-studies/acme.md",
    ],
)
def test_is_valid_source_resource_accepts_the_v02_grammar(resource):
    assert fm.is_valid_source_resource(resource) is True


@pytest.mark.parametrize(
    "resource",
    [
        "",
        None,
        "canonical://q_a_pairs/00000000-0000-4000-8000-000000000001",
        "ftp://client.example/a",
        "case-studies/acme",
        "just some prose",
    ],
)
def test_is_valid_source_resource_rejects_everything_else(resource):
    assert fm.is_valid_source_resource(resource) is False


# ──────────────────────────────────────────
# §5.1 sources[].id — deterministic, human-short, reorder-stable
# ──────────────────────────────────────────


def test_derive_source_id_for_source_document_anchor():
    anchor = "canonical://source_documents/1a2b3c4d-0000-4000-8000-000000000001"
    assert fm.derive_source_id(anchor) == "sd-1a2b3c4d"


def test_derive_source_id_for_reference_item_anchor():
    anchor = "canonical://reference_items/AABBCCDD-0000-4000-8000-000000000002"
    assert fm.derive_source_id(anchor) == "ref-aabbccdd"


def test_derive_source_id_for_qa_pairs_query():
    anchor = "canonical://q_a_pairs?scope_tag=Pricing_2026"
    assert fm.derive_source_id(anchor) == "qa-pricing-2026"


def test_derive_source_id_for_bundle_path_slugs_the_path():
    assert fm.derive_source_id("/case-studies/acme.md") == "case-studies-acme"
    assert fm.derive_source_id("case-studies/acme.md") == "case-studies-acme"


def test_derive_source_id_for_web_url_is_slug_plus_short_hash():
    url = "https://client.example/certifications/iso-9001.html"
    derived = fm.derive_source_id(url)
    assert derived.startswith("web-iso-9001-")
    # deterministic: same input, same id — and the hash suffix keeps two
    # distinct URLs with the same slug from colliding.
    assert derived == fm.derive_source_id(url)
    sibling = fm.derive_source_id("https://other.example/docs/iso-9001.html")
    assert sibling != derived


def test_derive_source_id_is_stable_across_runs_and_reordering():
    """§5.1's whole point: the id is a pure function of the resource URI,
    so reordering the list never changes any entry's id."""
    citations = [
        "canonical://source_documents/1a2b3c4d-0000-4000-8000-000000000001",
        "https://client.example/about",
        "case-studies/acme.md",
    ]
    forward = fm.sources_from_citations(citations)
    reversed_ = fm.sources_from_citations(list(reversed(citations)))
    assert {s.resource: s.id for s in forward} == {
        s.resource: s.id for s in reversed_
    }


def test_sources_from_citations_leads_with_the_primary_anchor_and_dedupes():
    primary = _ANCHOR
    citations = ["case-studies/acme.md", primary, "case-studies/acme.md"]
    entries = fm.sources_from_citations(citations, primary_anchor=primary)
    assert [s.resource for s in entries] == [primary, "/case-studies/acme.md"]


def test_source_citation_targets_round_trips_the_stored_forms():
    citations = [_ANCHOR, "https://client.example/about", "case-studies/acme.md"]
    entries = fm.sources_from_citations(citations)
    assert list(fm.source_citation_targets(entries)) == citations


# ──────────────────────────────────────────
# F1-A: footnote definitions replace the trailer
# ──────────────────────────────────────────


def test_render_source_footnotes_emits_one_definition_per_entry():
    entries = fm.sources_from_citations(
        [_ANCHOR, "https://client.example/about", "case-studies/acme.md"]
    )
    text = fm.render_source_footnotes(entries)
    lines = text.strip().split("\n")
    assert len(lines) == 3
    for entry, line in zip(entries, lines):
        assert line.startswith(f"[^{entry.id}]: ")


def test_render_source_footnotes_never_leaks_a_canonical_anchor_into_the_body():
    """BI-10 under v0.2: a record pointer's footnote text falls back to the
    entry id, never the anchor itself."""
    entries = fm.sources_from_citations([_ANCHOR])
    text = fm.render_source_footnotes(entries)
    assert "canonical://" not in text
    assert f"[^{entries[0].id}]: {entries[0].id}" in text


def test_render_source_footnotes_prefers_the_title_when_present():
    entry = fm.ConceptSource(id="pol", resource="https://client.example/p", title="Policy page")
    assert fm.render_source_footnotes([entry]) == "[^pol]: Policy page\n"


def test_render_source_footnotes_empty_sources_is_empty_string():
    assert fm.render_source_footnotes([]) == ""


def test_no_citations_trailer_renderer_survives():
    """S546 F1-A: the trailer is dropped in this change — no one-release
    carry. The renderers are gone outright."""
    from scripts.cocoindex_pipeline.producer import validator

    assert not hasattr(validator, "render_citations_trailer")
    assert not hasattr(validator, "normalise_citations_section")


# ──────────────────────────────────────────
# Rendering — the golden v0.2 frontmatter shape
# ──────────────────────────────────────────


def test_render_golden_full_v02_shape_with_fixed_field_order():
    """The id-426 golden shape: generated + sources, fixed field order,
    byte-deterministic."""
    anchor = "canonical://source_documents/1a2b3c4d-0000-4000-8000-000000000001"
    record = fm.build_concept_frontmatter(
        type="topic",
        title="Encryption at rest",
        description="Overview of encryption-at-rest practices.",
        generated_by="kh-concept-producer/test-model-1",
        generated_at="2026-07-07T09:30:00Z",
        tags=("security",),
        purpose="Explain X",
        task="answer Y",
        audience="Z",
        sources=fm.sources_from_citations(
            ["https://client.example/about", "case-studies/acme.md"],
            primary_anchor=anchor,
        ),
    )
    web_id = fm.derive_source_id("https://client.example/about")
    assert fm.render_concept_frontmatter(record) == (
        "---\n"
        "type: topic\n"
        "title: Encryption at rest\n"
        "description: Overview of encryption-at-rest practices.\n"
        'generated: { by: kh-concept-producer/test-model-1, at: "2026-07-07T09:30:00Z" }\n'
        "purpose: Explain X\n"
        "task: answer Y\n"
        "audience: Z\n"
        "tags:\n"
        "  - security\n"
        "sources:\n"
        "  - id: sd-1a2b3c4d\n"
        f"    resource: {anchor}\n"
        f"  - id: {web_id}\n"
        "    resource: https://client.example/about\n"
        "  - id: case-studies-acme\n"
        "    resource: /case-studies/acme.md\n"
        "---\n"
    )


def test_render_includes_generated_and_sources_and_tags():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    text = fm.render_concept_frontmatter(record)
    assert text.startswith("---\n")
    assert text.rstrip("\n").endswith("---")
    for key in ("type:", "title:", "description:", "generated:", "tags:", "sources:"):
        assert key in text
    assert "timestamp:" not in text
    assert "- security" in text
    assert "- encryption" in text


def test_render_omits_resource_when_absent():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    text = fm.render_concept_frontmatter(record)
    assert "resource:" not in text.replace("    resource:", "")


def test_render_omits_sources_when_empty():
    record = fm.build_concept_frontmatter(**_base_kwargs(sources=()))
    text = fm.render_concept_frontmatter(record)
    assert "sources:" not in text


def test_render_emits_source_title_only_when_set():
    entry = fm.ConceptSource(id="pol", resource="https://client.example/p", title="Policy page")
    record = fm.build_concept_frontmatter(**_base_kwargs(sources=(entry,)))
    text = fm.render_concept_frontmatter(record)
    assert "    title: Policy page\n" in text


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


def test_render_generated_at_is_iso8601_not_uk_date_format():
    record = fm.build_concept_frontmatter(**_base_kwargs(generated_at="2026-07-07T09:30:00Z"))
    text = fm.render_concept_frontmatter(record)
    # The S451-rider ALWAYS-double-quote rule carries from `timestamp` to
    # its successor `generated.at`.
    assert 'at: "2026-07-07T09:30:00Z"' in text
    assert "07/07/2026" not in text


def test_emit_concept_frontmatter_builds_and_renders_in_one_call():
    text = fm.emit_concept_frontmatter(**_base_kwargs())
    assert text.startswith("---\n")
    assert "title: Encryption at rest" in text
    assert "generated: { by: kh-concept-producer/test-model-1" in text


# ──────────────────────────────────────────
# bl-456 routing hints — carried UNCHANGED through the v0.2 wave
# (id-318/S546). The bl-477 A19 `confidence` field that used to share this
# section is RETIRED — see the id-428 section below.
# ──────────────────────────────────────────


def test_build_concept_frontmatter_defaults_new_fields_to_none():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    assert record.purpose is None
    assert record.task is None
    assert record.audience is None


def test_build_concept_frontmatter_carries_routing_hints():
    record = fm.build_concept_frontmatter(
        **_base_kwargs(
            purpose="Explain encryption-at-rest options",
            task="answer a procurement question",
            audience="SME buyer",
        )
    )
    assert record.purpose == "Explain encryption-at-rest options"
    assert record.task == "answer a procurement question"
    assert record.audience == "SME buyer"


@pytest.mark.parametrize("hint_field", ["purpose", "task", "audience"])
def test_routing_hint_embedding_a_canonical_uri_is_rejected(hint_field):
    """BI-10: routing hints get the same contains_record_pointer guard the
    existing string fields get."""
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(**{hint_field: f"See {_ANCHOR}"}))


@pytest.mark.parametrize("hint_field", ["purpose", "task", "audience"])
def test_routing_hint_embedding_a_bare_uuid_is_rejected(hint_field):
    poisoned = f"Anchor: {uuid.uuid4()}"
    with pytest.raises(ValueError):
        fm.build_concept_frontmatter(**_base_kwargs(**{hint_field: poisoned}))


def test_render_omits_routing_hints_when_none():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    text = fm.render_concept_frontmatter(record)
    assert "purpose:" not in text
    assert "task:" not in text
    assert "audience:" not in text


def test_render_emits_routing_hints_only_when_set():
    record = fm.build_concept_frontmatter(
        **_base_kwargs(purpose="Explain X", task="answer Y", audience="Z")
    )
    text = fm.render_concept_frontmatter(record)
    assert "purpose: Explain X" in text
    assert "task: answer Y" in text
    assert "audience: Z" in text


def test_render_new_fields_appear_in_fixed_order_after_generated_before_tags():
    record = fm.build_concept_frontmatter(
        **_base_kwargs(purpose="Explain X", task="answer Y", audience="Z")
    )
    text = fm.render_concept_frontmatter(record)
    order = [
        text.index("description:"),
        text.index("generated:"),
        text.index("purpose:"),
        text.index("task:"),
        text.index("audience:"),
        text.index("tags:"),
        text.index("sources:"),
    ]
    assert order == sorted(order)


def test_emit_concept_frontmatter_threads_routing_hints():
    text = fm.emit_concept_frontmatter(
        **_base_kwargs(purpose="Explain X", task="answer Y", audience="Z")
    )
    assert "purpose: Explain X" in text


# ──────────────────────────────────────────
# id-428 (owner rulings S546 F3-A + S553) — `confidence` is RETIRED from
# the emission contract entirely.
#
# The retirement ground is SPEC §5.1, not the private-vocabulary framing:
# OKF records objective per-source signals and "does not store a
# credibility score: a score is subjective, unportable across consumers,
# and goes stale. Credibility is INFERRED from the signals, the same way
# trust tiers are (§5.3), not stored." A `strong`/`partial` verdict IS a
# stored credibility score, so no rename or re-vocabulary saves it — the
# field goes, and nothing takes its slot here. (Emitting `verified` events
# and §5.4 `status` is id-420's half, NOT this one's; the consumer derives
# the §5.3 tier.)
#
# `derive_concept_confidence` — the A19 rule — is retired with it. It was
# the producer's only credibility-scoring code path.
# ──────────────────────────────────────────


def test_the_confidence_derivation_rule_is_retired():
    """DR-081a ratified the `strong|partial` emission; S553 retired it.
    No code reference may survive — a live derivation is what would let
    the field creep back in."""
    assert not hasattr(fm, "derive_concept_confidence")
    assert not hasattr(fm, "_CONFIDENCE_VALUES")


def test_build_concept_frontmatter_no_longer_accepts_a_confidence_argument():
    with pytest.raises(TypeError):
        fm.build_concept_frontmatter(**_base_kwargs(confidence="strong"))


def test_emit_concept_frontmatter_no_longer_accepts_a_confidence_argument():
    with pytest.raises(TypeError):
        fm.emit_concept_frontmatter(**_base_kwargs(confidence="strong"))


def test_the_frontmatter_record_carries_no_confidence_field():
    record = fm.build_concept_frontmatter(**_base_kwargs())
    assert not hasattr(record, "confidence")


def test_the_best_grounded_concept_shape_still_emits_no_confidence():
    """The shape that used to derive `strong` — a per-row record anchor
    plus two distinct record-anchor citations — emits nothing at all now.
    Asserted on the strongest input precisely because that is the one a
    credibility score would be most tempting to keep."""
    anchor = ru.build_source_document_uri(uuid.uuid4())
    citations = [
        ru.build_source_document_uri(uuid.uuid4()),
        ru.build_reference_item_uri(uuid.uuid4()),
    ]
    text = fm.emit_concept_frontmatter(
        **_base_kwargs(
            sources=fm.sources_from_citations(citations, primary_anchor=anchor)
        )
    )
    assert "confidence" not in text
    assert "confidence" not in _load_emitted_block(text)


# ──────────────────────────────────────────
# {132.7} S451 rider fold-in 1 — YAML-1.1 type-ambiguity quoting.
#
# The reference agent serialises via `yaml.safe_dump`, which quotes any
# plain scalar that would re-parse as a non-string (bool/null/number/
# timestamp) on reload. Proof of fidelity: a YAML double-quoted scalar is
# ALWAYS type `str`, universally, regardless of content (YAML 1.1 + 1.2
# spec) — so asserting the emitter wraps every ambiguous value in `"..."`
# is sufficient proof of round-trip type fidelity without needing a
# `pyyaml` test dependency.
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
def test_render_wraps_ambiguous_values_in_double_quotes(value):
    # A double-quoted YAML scalar is ALWAYS str-typed on reload — this is
    # the round-trip type-fidelity guarantee the {132.7} rider requires.
    # Asserted on the RENDERED block rather than on a scalar helper: under
    # DR-144 the quoting mechanics belong to ruamel, and `_needs_quoting`
    # only decides which scalars are forced to the double-quoted style.
    record = fm.build_concept_frontmatter(**_base_kwargs(title=value))
    assert f'title: "{value}"' in fm.render_concept_frontmatter(record)


def test_render_quotes_a_title_that_is_yaml_bool_ambiguous():
    record = fm.build_concept_frontmatter(**_base_kwargs(title="NO"))
    text = fm.render_concept_frontmatter(record)
    assert 'title: "NO"' in text


def test_render_quotes_a_title_that_is_yaml_number_ambiguous():
    record = fm.build_concept_frontmatter(**_base_kwargs(title="99.9"))
    text = fm.render_concept_frontmatter(record)
    assert 'title: "99.9"' in text


def test_render_always_quotes_generated_at_regardless_of_content():
    """The S451-rider ALWAYS-quote rule, carried from `timestamp` to
    `generated.at`."""
    record = fm.build_concept_frontmatter(**_base_kwargs(generated_at="2026-07-07T09:30:00Z"))
    text = fm.render_concept_frontmatter(record)
    assert 'at: "2026-07-07T09:30:00Z"' in text


def test_render_quotes_a_generated_by_containing_flow_indicators():
    """A model id containing a comma would corrupt the `generated` flow
    mapping if emitted plain. ruamel's flow-context analysis quotes it
    (DR-144) — asserted by reloading, not by pinning a quote character:
    single- and double-quoted YAML scalars are both always `str`, and
    which one ruamel picks is its business, not this contract's."""
    tricky = fm.build_concept_frontmatter(**_base_kwargs(generated_by="producer/a,b"))
    text = fm.render_concept_frontmatter(tricky)
    assert dict(_load_emitted_block(text)["generated"])["by"] == "producer/a,b"
    # Still ONE line — a flow mapping, never split into block form (§5.2).
    assert len([ln for ln in text.split("\n") if ln.startswith("generated:")]) == 1

    plain = fm.build_concept_frontmatter(
        **_base_kwargs(generated_by="kh-concept-producer/glm-5.2")
    )
    assert "generated: { by: kh-concept-producer/glm-5.2," in fm.render_concept_frontmatter(
        plain
    )


# ──────────────────────────────────────────
# DR-144 (S548 owner ruling) — emission runs through `ruamel.yaml`
# round-trip mode rather than a hand-rolled writer.
#
# These are LOADER-BACKED: the emitted block is parsed by a real YAML
# parser and every value compared against what was handed to the emitter.
# That is a strictly stronger proof than asserting on the emitted text,
# and it is what the hand-rolled `_yaml_escape` could not satisfy — it
# escaped `\` and `"` but NOT newlines, so agent-authored prose carrying a
# raw newline emitted a broken multi-line plain scalar (id-428/S548).
# ──────────────────────────────────────────

_MULTILINE_PROSE = "First line\nSecond line"


def _load_emitted_block(text: str):
    """Parse an emitted `---`-fenced block back with a real YAML parser."""
    assert text.startswith("---\n"), text
    assert text.endswith("---\n"), text
    return YAML(typ="rt").load(text[len("---\n") : -len("---\n")])


def test_render_round_trips_a_title_carrying_a_raw_newline():
    """The concrete bug DR-144 retires: a raw newline in a title emitted an
    unparseable block (`title: First line` then a bare `Second line`)."""
    record = fm.build_concept_frontmatter(**_base_kwargs(title=_MULTILINE_PROSE))
    loaded = _load_emitted_block(fm.render_concept_frontmatter(record))
    assert loaded["title"] == _MULTILINE_PROSE


def test_render_round_trips_a_description_carrying_a_raw_newline():
    record = fm.build_concept_frontmatter(**_base_kwargs(description=_MULTILINE_PROSE))
    loaded = _load_emitted_block(fm.render_concept_frontmatter(record))
    assert loaded["description"] == _MULTILINE_PROSE


def test_render_round_trips_prose_carrying_quotes_and_backslashes():
    """The two classes the hand-rolled escaper DID cover stay covered."""
    tricky = 'A "quoted" phrase with a C:\\path and a trailing backslash \\'
    record = fm.build_concept_frontmatter(**_base_kwargs(title=tricky))
    loaded = _load_emitted_block(fm.render_concept_frontmatter(record))
    assert loaded["title"] == tricky


def test_render_round_trips_every_emitted_field_through_a_real_parser():
    """Whole-shape fidelity, not one field at a time — the emitted block
    reloads to exactly the values `build_concept_frontmatter` holds."""
    anchor = "canonical://source_documents/1a2b3c4d-0000-4000-8000-000000000001"
    record = fm.build_concept_frontmatter(
        type="topic",
        title=_MULTILINE_PROSE,
        description='He said "no" — 99.9% of the time',
        generated_by="kh-concept-producer/test-model-1",
        generated_at="2026-07-07T09:30:00Z",
        tags=("security", "NO", "99.9"),
        purpose="Explain X",
        task="answer Y",
        audience="Z",
        sources=fm.sources_from_citations(
            ["https://client.example/about"], primary_anchor=anchor
        ),
    )
    loaded = _load_emitted_block(fm.render_concept_frontmatter(record))
    assert loaded["type"] == "topic"
    assert loaded["title"] == _MULTILINE_PROSE
    assert loaded["description"] == 'He said "no" — 99.9% of the time'
    assert dict(loaded["generated"]) == {
        "by": "kh-concept-producer/test-model-1",
        "at": "2026-07-07T09:30:00Z",
    }
    # The S451 rider's whole point: every ambiguous tag reloads as `str`.
    assert list(loaded["tags"]) == ["security", "NO", "99.9"]
    assert all(isinstance(tag, str) for tag in loaded["tags"])
    assert loaded["purpose"] == "Explain X"
    assert [entry["resource"] for entry in loaded["sources"]] == [
        anchor,
        "https://client.example/about",
    ]


@pytest.mark.parametrize(
    "prose", [_MULTILINE_PROSE, "trailing newline\n", "  leading space", "#hash"]
)
def test_every_emitted_frontmatter_line_is_a_key_line_or_an_indented_continuation(prose):
    """The shape contract `producer/git_sync.py`'s field-level override
    model depends on (id-440 AC-2): between the fences, every line either
    opens a `key:` or is an indented continuation of the preceding one. A
    raw newline in prose broke exactly this — the orphaned second line made
    `capture_overrides` refuse the producer's OWN output."""
    record = fm.build_concept_frontmatter(**_base_kwargs(title=prose, description=prose))
    block = fm.render_concept_frontmatter(record).split("\n")[1:-2]
    for line in block:
        assert line.startswith((" ", "\t")) or re.match(
            r"^[A-Za-z_][A-Za-z0-9_-]*:", line
        ), f"line {line!r} is neither a `key:` line nor an indented continuation"
