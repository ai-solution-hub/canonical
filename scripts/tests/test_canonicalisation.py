"""Tests for canonicalisation.py — the deterministic entity key.

DR-140 reduced `canonicalise_entity_name` to what a stable primary key needs:
strip → NFKD → drop combining marks → lower. It decides nothing about whether
two names are the same thing; `resolve_entities` does.
"""

from scripts.cocoindex_pipeline.canonicalisation import canonicalise_entity_name


def test_lowercases():
    assert canonicalise_entity_name("Acme Corp") == "acme corp"


def test_trims_leading_and_trailing_whitespace():
    assert canonicalise_entity_name("  GDPR  ") == "gdpr"


def test_empty_string_returns_empty():
    assert canonicalise_entity_name("") == ""


def test_ascii_folds_diacritics():
    assert canonicalise_entity_name("Café") == "cafe"


def test_surface_variants_are_not_collapsed():
    """The key preserves surface differences — collapsing them is resolution's
    job, not the key function's (DR-140)."""
    assert canonicalise_entity_name("ISO27001") != canonicalise_entity_name(
        "ISO 27001"
    )
    assert canonicalise_entity_name("ISO 27001:2022") == "iso 27001:2022"
    assert canonicalise_entity_name("ISO/IEC 27001") == "iso/iec 27001"


def test_idempotent():
    for raw in ("ISO27001", "  Café  ", "ISO 27001:2022", "acme corp"):
        once = canonicalise_entity_name(raw)
        assert canonicalise_entity_name(once) == once


def test_deterministic_across_repeated_calls():
    results = [canonicalise_entity_name("ISO/IEC 27001:2022") for _ in range(10)]
    assert len(set(results)) == 1


# ──────────────────────────────────────────────────────────────────────────
# DR-140 clause 3 — one key-space across both lanes.
#
# `entity_mentions.canonical_name` and `entity_relationships.source_entity` /
# `target_entity` were produced by two DIFFERENT functions. Only the
# relationship one stripped a trailing period, and `get_entity_summary` joins
# the two tables by raw string equality — so any name a document ended a
# sentence with was written to the two tables under two different keys and the
# row was silently unjoinable.
# ──────────────────────────────────────────────────────────────────────────


def _mention_key(raw: str) -> str:
    """The key flow.py's `_em_dedup` writes to entity_mentions.canonical_name."""
    return canonicalise_entity_name(raw)


def _endpoint_key(raw: str) -> str:
    """The key flow.py's `_er_dedup` writes to entity_relationships endpoints."""
    return canonicalise_entity_name(raw)


def test_trailing_period_does_not_split_the_key_space():
    """The divergence that made rows unjoinable: the relationship lane stripped
    a trailing period and the mention lane did not."""
    for raw in ("Acme Ltd.", "ISO 27001.", "GDPR.", "Example Datacentre Inc."):
        assert _mention_key(raw) == _endpoint_key(raw), (
            f"{raw!r} must produce ONE key for both tables — get_entity_summary "
            "joins them by raw string equality"
        )
        assert _endpoint_key(raw).endswith("."), (
            "the period is PRESERVED, not stripped on one side only — the two "
            "lanes agree because they are the same function, not because one "
            "lane's rewrite was copied to the other"
        )


def test_both_lanes_agree_on_the_forms_the_two_canonicalisers_split():
    """The relationship canonicaliser rewrote company suffixes, ISO spellings,
    WCAG spacing and abbreviation casing; the mention lane rewrote none of them.
    Every one of those is now a single key."""
    for raw in (
        "Acme Ltd",
        "ISO/IEC 27001",
        "ISO27001",
        "ISO 27001:2022",
        "gdpr",
        "Wcag 2 1 Aa",
        "penetration-testing",
        "Cyber Essentials Plus",
    ):
        assert _mention_key(raw) == _endpoint_key(raw)
