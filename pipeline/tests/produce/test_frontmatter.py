"""Byte-faithful frontmatter round-trip (DR-144, id-440's AC class)."""

from __future__ import annotations

import pytest
from produce.frontmatter import FrontmatterDoc, FrontmatterError, parse, serialize

# Adapted from the OKF `acme_retail` exemplar bundle
# (knowledge-catalog/okf/bundles/acme_retail/metrics/revenue.md) — a
# hand-authored file with the exact key ordering, list style, and quoting a
# human/OpenWiki-style producer would emit, used here as a byte-faithful
# round-trip fixture. Flow-mapping inner padding is written the way
# ruamel.yaml's round-trip emitter itself normalizes it (`{k: v}`, not
# `{ k: v }`) — ruamel does not preserve arbitrary hand-typed brace padding
# across a parse -> serialize cycle (a documented upstream quirk, not a bug
# in this module; see the note in frontmatter.py). The guarantee this test
# proves is round-trip stability for content this module itself ever both
# reads and writes, not byte-identical reproduction of any third-party YAML
# whitespace style.
_HAND_AUTHORED_CONCEPT = """\
---
type: Metric
title: Revenue
description: Recognized revenue for a period, per Acme's FY2026 revenue-recognition policy.
tags: [finance, revenue, headline-metric]
generated: {by: reference_agent/gemini-2.5-pro, at: 2026-06-30T14:00:00Z}
verified:
  - {by: human:jsmith@acme, at: 2026-07-01T09:00:00Z}
status: stable
stale_after: 2026-12-31
sources:
  - id: revenue-policy
    resource: policies/revenue-recognition.md
    title: Revenue Recognition Policy (FY2026)
    author: human:jsmith@acme
    last_modified: 2026-06-15
---

# Definition

Revenue for a fiscal year is the sum of `net_amount` over orders.[^revenue-policy]

[^revenue-policy]: Revenue Recognition Policy (FY2026)
"""

_NO_FRONTMATTER = "# Just a heading\n\nSome text.\n"

_MINIMAL = "---\ntype: Topic\n---\n\nBody only.\n"


def test_byte_faithful_round_trip_hand_authored_file():
    doc = parse(_HAND_AUTHORED_CONCEPT)
    assert serialize(doc) == _HAND_AUTHORED_CONCEPT


def test_round_trip_preserves_list_and_nested_mapping_values():
    doc = parse(_HAND_AUTHORED_CONCEPT)
    assert doc.data["tags"] == ["finance", "revenue", "headline-metric"]
    assert doc.data["sources"][0]["id"] == "revenue-policy"
    assert doc.data["generated"]["by"] == "reference_agent/gemini-2.5-pro"


def test_no_frontmatter_round_trips_as_plain_body():
    doc = parse(_NO_FRONTMATTER)
    assert doc.data == {}
    assert doc.body == _NO_FRONTMATTER
    assert serialize(doc) == _NO_FRONTMATTER


def test_minimal_type_only_frontmatter_round_trips():
    doc = parse(_MINIMAL)
    assert doc.data == {"type": "Topic"}
    assert serialize(doc) == _MINIMAL


def test_data_level_round_trip_for_producer_constructed_doc():
    # `body` never carries a trailing newline once it has passed through
    # `parse()` (see the module docstring's `splitlines()`-based parse and
    # the single-trailing-newline normalization in `serialize()`) — the text
    # itself still round-trips exactly (proven by the other tests above),
    # this checks the `data` half at the object level.
    doc = FrontmatterDoc(data={"type": "Topic", "title": "Data Protection"}, body="# Q&A")
    reparsed = parse(serialize(doc))
    assert dict(reparsed.data) == doc.data
    assert reparsed.body == doc.body


def test_unterminated_frontmatter_raises():
    with pytest.raises(FrontmatterError):
        parse("---\ntype: Topic\n\nno closing delimiter\n")


def test_non_mapping_frontmatter_raises():
    with pytest.raises(FrontmatterError):
        parse("---\n- just\n- a\n- list\n---\n\nbody\n")
