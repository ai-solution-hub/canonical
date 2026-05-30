"""Tests for canonicalisation.py — per-document deterministic canonicalisation.

Covers PRODUCT.md Inv-4 (per-doc default canonical_name written BEFORE Stage-5
runs). The pure function under test is deterministic, idempotent, and entity-
type aware per TECH §P-2 of docs/specs/id-53-stage-5-entity-resolution/TECH.md.
"""

from scripts.cocoindex_pipeline.canonicalisation import canonicalise_entity_name


# ──────────────────────────────────────────
# Certification: ISO 27001 family collapse
# ──────────────────────────────────────────


def test_iso_tight_collapses_to_canonical():
    assert canonicalise_entity_name("ISO27001", "certification") == "iso 27001"


def test_iso_with_version_suffix_strips_version():
    assert canonicalise_entity_name("ISO 27001:2022", "certification") == "iso 27001"


def test_iso_slash_iec_normalises():
    assert canonicalise_entity_name("ISO/IEC 27001", "certification") == "iso 27001"


def test_already_canonical_is_passthrough():
    assert canonicalise_entity_name("iso 27001", "certification") == "iso 27001"


def test_all_iso_inputs_collapse_to_same_canonical():
    """testStrategy acceptance: the three canonical forms collapse to "iso 27001"."""
    assert (
        canonicalise_entity_name("ISO27001", "certification")
        == canonicalise_entity_name("ISO 27001:2022", "certification")
        == canonicalise_entity_name("ISO/IEC 27001", "certification")
        == "iso 27001"
    )


# ──────────────────────────────────────────
# Idempotency
# ──────────────────────────────────────────


def test_idempotent_iso_tight():
    once = canonicalise_entity_name("ISO27001", "certification")
    twice = canonicalise_entity_name(once, "certification")
    assert once == twice


def test_idempotent_iso_version_suffix():
    once = canonicalise_entity_name("ISO 27001:2022", "certification")
    twice = canonicalise_entity_name(once, "certification")
    assert once == twice


def test_idempotent_iso_slash_iec():
    once = canonicalise_entity_name("ISO/IEC 27001", "certification")
    twice = canonicalise_entity_name(once, "certification")
    assert once == twice


def test_idempotent_already_canonical():
    once = canonicalise_entity_name("iso 27001", "certification")
    twice = canonicalise_entity_name(once, "certification")
    assert once == twice


# ──────────────────────────────────────────
# Empty / whitespace inputs
# ──────────────────────────────────────────


def test_empty_string_returns_empty():
    assert canonicalise_entity_name("", "certification") == ""


def test_leading_trailing_whitespace_trimmed():
    assert canonicalise_entity_name("  ISO 27001  ", "certification") == "iso 27001"


# ──────────────────────────────────────────
# Pass-through entity types (no entity-type-aware rules)
# ──────────────────────────────────────────


def test_organisation_lowercase_passthrough():
    assert canonicalise_entity_name("Acme Corp", "organisation") == "acme corp"


def test_regulation_passthrough_with_trim():
    assert canonicalise_entity_name("  GDPR  ", "regulation") == "gdpr"


def test_passthrough_type_does_not_apply_iso_rules():
    """ISO rules are gated on entity_type == "certification" — other types skip them."""
    # For a non-certification type, ISO27001 should NOT get an injected space.
    assert canonicalise_entity_name("ISO27001", "organisation") == "iso27001"


def test_ascii_fold_diacritics():
    """Step 2: NFKD + combining-char strip removes diacritics."""
    # "café" → "cafe"
    assert canonicalise_entity_name("Café", "organisation") == "cafe"


# ──────────────────────────────────────────
# Determinism (same input → same output)
# ──────────────────────────────────────────


def test_deterministic_across_repeated_calls():
    results = [
        canonicalise_entity_name("ISO/IEC 27001:2022", "certification")
        for _ in range(10)
    ]
    assert len(set(results)) == 1
    assert results[0] == "iso 27001"
