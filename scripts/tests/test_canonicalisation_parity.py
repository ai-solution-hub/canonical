"""Cross-language parity test for canonicalise_for_relationship ({101.5}).

The R1 HARD GATE before the ID-45 re-ingest: the Python relationship
canonicaliser MUST agree byte-for-byte with the TypeScript writer chain
``resolveAlias(canonicalise(name)).toLowerCase()`` (lib/ai/classify.ts:1788).

This Python pytest and the TS Vitest at
``__tests__/lib/entities/canonicalisation-parity.test.ts`` read the SAME
shared fixture ``scripts/tests/fixtures/canonicalisation_parity.json``. The
fixture's ``expected`` values are derived from the TS oracle — both languages
must reproduce them.

Covers PRODUCT §PC-3 (cross-language canonicaliser agreement) and §PC-6
lane 1 (golden parity fixture).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.cocoindex_pipeline.canonicalisation import (
    canonicalise_entity_name,
    canonicalise_for_relationship,
)

_FIXTURE_PATH = (
    Path(__file__).parent / "fixtures" / "canonicalisation_parity.json"
)


def _load_pairs() -> list[dict[str, str]]:
    with _FIXTURE_PATH.open(encoding="utf-8") as fh:
        pairs = json.load(fh)
    assert isinstance(pairs, list) and pairs, "fixture must be a non-empty list"
    for pair in pairs:
        assert set(pair) == {"raw", "expected"}, (
            f"each fixture entry must be {{raw, expected}}, got {sorted(pair)}"
        )
    return pairs


_PAIRS = _load_pairs()


@pytest.mark.parametrize(
    "raw,expected",
    [(p["raw"], p["expected"]) for p in _PAIRS],
    ids=[p["raw"] for p in _PAIRS],
)
def test_relationship_canonicaliser_matches_oracle(raw: str, expected: str) -> None:
    """Every shared-fixture pair must canonicalise to its oracle expected value."""
    assert canonicalise_for_relationship(raw) == expected


def test_fixture_covers_divergence_cases() -> None:
    """The fixture must include the documented R1 divergence cases.

    These are the inputs where the relationship chain DIVERGES from the
    per-mention ``canonicalise_entity_name`` ISO-only canonicaliser:
      - ``Acme Ltd`` → ``acme limited`` (Ltd→Limited; mention path leaves it)
      - WCAG version normalisation
      - abbreviation-map upcasing then lowercasing
    """
    raws = {p["raw"] for p in _PAIRS}
    assert "Acme Ltd" in raws, "Ltd→Limited divergence case missing"
    assert "Wcag 2 1 Aa" in raws, "WCAG divergence case missing"
    assert "gdpr" in raws, "abbreviation-map divergence case missing"

    by_raw = {p["raw"]: p["expected"] for p in _PAIRS}
    assert by_raw["Acme Ltd"] == "acme limited"
    assert by_raw["Wcag 2 1 Aa"] == "wcag 2.1 aa"
    assert by_raw["gdpr"] == "gdpr"


def test_relationship_canonicaliser_is_deterministic() -> None:
    """Same input → same output across repeated calls (no hidden state)."""
    for raw in (p["raw"] for p in _PAIRS):
        first = canonicalise_for_relationship(raw)
        assert all(canonicalise_for_relationship(raw) == first for _ in range(3))


def test_does_not_perturb_per_mention_canonicaliser() -> None:
    """The two canonicalisers are distinct — the per-mention one is unchanged.

    ``Acme Ltd`` exercises the divergence: the relationship path applies
    Ltd→Limited; the ISO-only per-mention path does not (it only lowercases
    + ASCII-folds for non-certification types).
    """
    assert canonicalise_for_relationship("Acme Ltd") == "acme limited"
    assert canonicalise_entity_name("Acme Ltd", "organisation") == "acme ltd"
