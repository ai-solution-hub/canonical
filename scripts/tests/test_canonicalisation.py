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
