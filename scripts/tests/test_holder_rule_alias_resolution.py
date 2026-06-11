"""Regression tests for DB-alias resolution in the relationship canonicaliser
({101.9}, closes the canonicalisation.py:117-123 follow-up).

THE BUG (proven): the Python relationship canonicaliser shipped
``_BASELINE_ALIASES`` ONLY and never loaded the DB ``entity_aliases`` table. A
client's SHORT name in source text (e.g. ``"Acme"``) was therefore NOT resolved
to its full registered canonical (``"Acme Holdings Limited"``), so the holder
self-match ``holds_source == client_org_lower`` at ``holder_rule.py:187``
FAILED — ``client_org_lower`` is the full registered form — and the client's
OWN certification was mis-stamped ``holder='supplier'`` with the client's own
short name as the phantom ``supplier_name`` instead of ``holder='self'``.

THE FIX (Option A): give the Python relationship canonicaliser DB-alias
resolution via a POINT-OF-USE snapshot fixture (gitignored + generated at
deploy per ID-95 PI-15 — NEVER committed; client-provenance rows must not enter
the repo). ``_BASELINE_ALIASES`` is overlaid by the DB snapshot
(DB wins on conflict). The TS oracle keys the DB map by the RAW ``alias`` column
(``entity-aliases.ts:72`` ``cachedAliases[row.alias] = row.canonical``), so a
relationship endpoint resolves only when ``_rel_canonicalise(name)`` equals the
raw alias string — these tests mirror that exact keying.

All client identities here are SYNTHETIC and de-identified — NEVER the real
client name. The synthetic snapshot is injected deterministically by
monkeypatching the loader; these tests do NOT depend on the (gitignored,
point-of-use) ``entity_aliases_snapshot.json`` fixture — they pass on a fresh
checkout where that file is absent and the loader degrades to baseline-only.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

import scripts.cocoindex_pipeline.canonicalisation as canon
from scripts.cocoindex_pipeline.canonicalisation import (
    canonicalise_entity_name,
    canonicalise_for_relationship,
)
from scripts.cocoindex_pipeline.holder_rule import derive_holder_metadata

# Synthetic, de-identified client org and its short-name alias. The alias is the
# SHORT form a document author writes; the canonical is the full registered form
# the client-org env knob (PIPELINE_CLIENT_ORG) is configured with.
_SYNTHETIC_CLIENT_ORG_FULL = "Acme Holdings Limited"
_SYNTHETIC_CLIENT_ORG_SHORT = "Acme"
# DB map is keyed by the RAW alias column (TS parity, entity-aliases.ts:72).
_SYNTHETIC_DB_ALIASES = {_SYNTHETIC_CLIENT_ORG_SHORT: _SYNTHETIC_CLIENT_ORG_FULL}


@dataclass(frozen=True)
class _Mention:
    entity_name: str
    entity_type: str


@dataclass(frozen=True)
class _Rel:
    source: str
    relationship: str
    target: str


def _key(entity_name: str, entity_type: str = "certification") -> tuple[str, str]:
    return (canonicalise_entity_name(entity_name, entity_type), entity_type)


@pytest.fixture()
def _inject_synthetic_aliases(monkeypatch: pytest.MonkeyPatch):
    """Point the module-level DB-alias loader at the synthetic map + reset cache.

    Mirrors how the loader reads the committed snapshot, but injects the
    synthetic rows directly so the test never depends on the real fixture.
    """
    monkeypatch.setattr(
        canon, "_load_db_entity_aliases", lambda: dict(_SYNTHETIC_DB_ALIASES)
    )
    canon.reset_alias_cache()
    yield
    canon.reset_alias_cache()


@pytest.fixture()
def _baseline_only(monkeypatch: pytest.MonkeyPatch):
    """Force baseline-only resolution (empty DB snapshot) + reset cache.

    Proves the existing _BASELINE_ALIASES behaviour is unchanged and the RED
    pre-fix state for the synthetic short-name case.
    """
    monkeypatch.setattr(canon, "_load_db_entity_aliases", lambda: {})
    canon.reset_alias_cache()
    yield
    canon.reset_alias_cache()


# ── The fix: DB alias resolves the short name to the full canonical ──────────


def test_db_alias_resolves_short_client_name(
    _inject_synthetic_aliases: None,
) -> None:
    """With the alias snapshot present, the SHORT form resolves to the full
    canonical — the keystone of the holder self-match fix."""
    assert (
        canonicalise_for_relationship(_SYNTHETIC_CLIENT_ORG_SHORT)
        == "acme holdings limited"
    )
    # The full form is idempotent and stable as the client-org canonical.
    assert (
        canonicalise_for_relationship(_SYNTHETIC_CLIENT_ORG_FULL)
        == "acme holdings limited"
    )


def test_holder_self_with_short_name_alias(
    _inject_synthetic_aliases: None,
) -> None:
    """A cert the document attributes to the client's SHORT name resolves to
    holder='self' once the DB alias snapshot is present (the bug fix)."""
    client_org_lower = canonicalise_for_relationship(_SYNTHETIC_CLIENT_ORG_FULL)
    mentions = [_Mention("ISO 27001", "certification")]
    # Document author wrote the SHORT client name as the holds source.
    rels = [
        _Rel(
            source=_SYNTHETIC_CLIENT_ORG_SHORT,
            relationship="holds",
            target="ISO 27001",
        )
    ]

    result = derive_holder_metadata(mentions, rels, client_org_lower)

    assert result == {_key("ISO 27001"): {"holder": "self"}}


# ── RED guard: baseline-only mis-attributes the client's own cert ────────────


def test_baseline_only_misattributes_short_name(
    _baseline_only: None,
) -> None:
    """Captures the RED (pre-fix) behaviour: with NO DB alias, the short name
    does NOT resolve, so the client's own cert is mis-stamped holder='supplier'.

    This is the exact misattribution {101.9} closes — kept as a regression
    sentinel proving the fix is load-bearing (it FAILS the self-match without
    the DB alias)."""
    client_org_lower = canonicalise_for_relationship(_SYNTHETIC_CLIENT_ORG_FULL)
    # Baseline-only: short name canonicalises to "acme", NOT the full form.
    assert canonicalise_for_relationship(_SYNTHETIC_CLIENT_ORG_SHORT) == "acme"
    assert canonicalise_for_relationship(_SYNTHETIC_CLIENT_ORG_SHORT) != client_org_lower

    mentions = [_Mention("ISO 27001", "certification")]
    rels = [
        _Rel(
            source=_SYNTHETIC_CLIENT_ORG_SHORT,
            relationship="holds",
            target="ISO 27001",
        )
    ]

    result = derive_holder_metadata(mentions, rels, client_org_lower)

    # The phantom-supplier misattribution: holder='supplier', supplier_name='acme'.
    assert result == {
        _key("ISO 27001"): {"holder": "supplier", "supplier_name": "acme"}
    }


# ── Regression guard: baseline-only behaviour is UNCHANGED ───────────────────


def test_baseline_aliases_unchanged_when_no_db_match(
    _inject_synthetic_aliases: None,
) -> None:
    """An existing _BASELINE_ALIASES case still resolves even with a DB snapshot
    loaded — the merge is additive and baseline wins where DB is silent."""
    # "ISO Certification" → _rel_canonicalise → "ISO Certification" → baseline → "ISO 27001"
    assert canonicalise_for_relationship("ISO Certification") == "iso 27001"
    # Another baseline divergence case (Ltd→Limited, no alias) is untouched.
    assert canonicalise_for_relationship("Acme Ltd") == "acme limited"


def test_db_wins_on_conflict_with_baseline() -> None:
    """When a DB alias key collides with a baseline key, the DB value wins
    (loadAliases merge order: baseline first, DB overlaid — entity-aliases.ts:71-73)."""

    def _conflicting() -> dict[str, str]:
        # Override the baseline "ISO Certification" → "ISO 27001" mapping.
        return {"ISO Certification": "ISO 9001"}

    mp = pytest.MonkeyPatch()
    mp.setattr(canon, "_load_db_entity_aliases", _conflicting)
    canon.reset_alias_cache()
    try:
        assert canonicalise_for_relationship("ISO Certification") == "iso 9001"
    finally:
        mp.undo()
        canon.reset_alias_cache()
