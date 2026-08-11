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


# Cross-lane joinability (DR-140 clause 3) is proven at the REAL write sites:
# test_cocoindex_flow_write_path.py::TestUnjoinableTrailingPeriodRowClosed.
# The contract tests below pin the reduced function's outputs only.


def test_trailing_period_is_preserved():
    for raw in ("Acme Ltd.", "ISO 27001.", "GDPR.", "Example Datacentre Inc."):
        assert canonicalise_entity_name(raw).endswith(".")


def test_forms_the_deleted_relationship_canonicaliser_rewrote_are_untouched():
    cases = {
        "Acme Ltd": "acme ltd",
        "ISO/IEC 27001": "iso/iec 27001",
        "ISO27001": "iso27001",
        "ISO 27001:2022": "iso 27001:2022",
        "Wcag 2 1 Aa": "wcag 2 1 aa",
        "penetration-testing": "penetration-testing",
        "Cyber Essentials Plus": "cyber essentials plus",
    }
    for raw, expected in cases.items():
        assert canonicalise_entity_name(raw) == expected
