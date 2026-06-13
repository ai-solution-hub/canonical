"""Unit tests for the fail-closed entity_aliases generation at lifespan boot.

ID-101 {101.10}: the lifespan hook generates the client entity_aliases snapshot
against the client DB at pipeline deploy. A configured client (PIPELINE_CLIENT_ORG
set and non-empty) with ZERO rows where provenance='client' MUST raise — fail-closed
deploy gate. An unconfigured client (PIPELINE_CLIENT_ORG unset/empty) must NOT raise
(graceful dev/CI path).

Tests use:
  - A minimal fake asyncpg pool (object with .fetch() returning dict-like rows).
  - monkeypatch.setenv/delenv for the env knob.
  - canonicalisation.reset_alias_cache() in setup/teardown to prevent cross-test
    cache bleed.
  - No real DB connections.

The empirical "live ingest yields holder=self" check is {101.9}'s integration territory
and is OUT OF SCOPE for these unit tests. These tests cover the fail-closed contract.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

import scripts.cocoindex_pipeline.canonicalisation as canon
from scripts.cocoindex_pipeline.canonicalisation import (
    canonicalise_for_relationship,
    reset_alias_cache,
)
from scripts.cocoindex_pipeline.flow import (
    _generate_client_alias_snapshot,
)
from scripts.cocoindex_pipeline.holder_rule import CLIENT_ORG_ENV_VAR


# ---------------------------------------------------------------------------
# Fake asyncpg pool helpers
# ---------------------------------------------------------------------------


class _FakePool:
    """Minimal fake asyncpg pool whose .fetch() returns provided rows.

    asyncpg Records support row["key"] access; dicts work for tests.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    async def fetch(self, query: str, *args: object) -> list[dict[str, Any]]:
        return list(self._rows)


def _make_row(alias: str, canonical: str, provenance: str) -> dict[str, Any]:
    return {"alias": alias, "canonical": canonical, "provenance": provenance}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_cache():
    """Reset alias cache before and after every test to avoid cross-test bleed."""
    reset_alias_cache()
    yield
    reset_alias_cache()


# ---------------------------------------------------------------------------
# Test 1: configured client + zero client-provenance rows → raises fail-closed
# ---------------------------------------------------------------------------


def test_configured_client_zero_client_rows_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PIPELINE_CLIENT_ORG set + zero provenance='client' rows → RuntimeError.

    This is the core fail-closed invariant: a configured client whose entity_aliases
    table has no client-provenance rows (empty table or only core/recommended) must
    FAIL the deploy — never silently degrade to baseline-only canonicalisation.
    """
    monkeypatch.setenv(CLIENT_ORG_ENV_VAR, "Acme Holdings Limited")

    # Only core/recommended rows — no client provenance.
    pool = _FakePool(
        [
            _make_row("ISO Certification", "ISO 27001", "core"),
            _make_row("Wordpress", "WordPress", "recommended"),
        ]
    )

    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(_generate_client_alias_snapshot(pool))

    msg = str(exc_info.value).lower()
    assert "fail-closed" in msg or "fail closed" in msg, (
        f"RuntimeError message must mention fail-closed; got: {exc_info.value!r}"
    )
    assert "101.10" in str(exc_info.value) or "101" in str(exc_info.value), (
        f"RuntimeError message should reference the subtask; got: {exc_info.value!r}"
    )


def test_configured_client_empty_table_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PIPELINE_CLIENT_ORG set + completely empty entity_aliases table → RuntimeError."""
    monkeypatch.setenv(CLIENT_ORG_ENV_VAR, "Some Client Org")
    pool = _FakePool([])

    with pytest.raises(RuntimeError):
        asyncio.run(_generate_client_alias_snapshot(pool))


# ---------------------------------------------------------------------------
# Test 2: configured client + ≥1 client-provenance rows → NO raise; cache primed
# ---------------------------------------------------------------------------


def test_configured_client_with_client_rows_no_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PIPELINE_CLIENT_ORG set + ≥1 provenance='client' row → no raise.

    The canonicaliser cache is primed and a known client short→full alias resolves
    via canonicalise_for_relationship (DB wins over baseline).
    """
    monkeypatch.setenv(CLIENT_ORG_ENV_VAR, "Acme Holdings Limited")

    pool = _FakePool(
        [
            _make_row("Acme", "Acme Holdings Limited", "client"),
            _make_row("ISO Certification", "ISO 27001", "core"),
        ]
    )

    # Must not raise.
    asyncio.run(_generate_client_alias_snapshot(pool))

    # Cache was primed: "Acme" should now resolve to "Acme Holdings Limited".
    # canonicalise_for_relationship does: _rel_canonicalise(name) -> _rel_resolve_alias -> .lower()
    # The raw alias key is "Acme"; _rel_canonicalise("Acme") must produce "Acme"
    # (title-case input, no transforms apply) so the lookup hits the DB row.
    resolved = canonicalise_for_relationship("Acme")
    assert resolved == "acme holdings limited", (
        f"DB alias for 'Acme' should resolve to 'acme holdings limited'; got {resolved!r}"
    )


def test_configured_client_db_wins_over_baseline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DB alias wins over baseline when keys collide.

    'ISO Certification' is in _BASELINE_ALIASES → 'ISO 27001'. If the DB has a
    different canonical for the same alias, the DB value wins (merge order:
    baseline first, DB .update() on top).
    """
    monkeypatch.setenv(CLIENT_ORG_ENV_VAR, "Some Client Org")

    # DB overrides the baseline "ISO Certification" → "ISO 27001" entry.
    pool = _FakePool(
        [
            # client row required to satisfy the fail-closed predicate
            _make_row("Some Client", "Some Client Org", "client"),
            # DB override for a baseline alias
            _make_row("ISO Certification", "ISO 9001", "core"),
        ]
    )

    asyncio.run(_generate_client_alias_snapshot(pool))

    # DB value ("ISO 9001") wins over baseline ("ISO 27001") for this alias.
    resolved = canonicalise_for_relationship("ISO Certification")
    assert resolved == "iso 9001", (
        f"DB should win over baseline for 'ISO Certification'; got {resolved!r}"
    )


# ---------------------------------------------------------------------------
# Test 3: PIPELINE_CLIENT_ORG unset/empty + any rows → NO raise (graceful dev path)
# ---------------------------------------------------------------------------


def test_unset_pipeline_client_org_no_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PIPELINE_CLIENT_ORG unset → no raise even with zero client rows.

    Dev/CI path: no client configured means the fail-closed gate must not fire.
    Cache is primed from whatever rows exist (graceful degradation).
    """
    monkeypatch.delenv(CLIENT_ORG_ENV_VAR, raising=False)
    pool = _FakePool(
        [
            _make_row("ISO Certification", "ISO 27001", "core"),
        ]
    )

    # Must not raise.
    asyncio.run(_generate_client_alias_snapshot(pool))

    # Cache was primed from available rows.
    resolved = canonicalise_for_relationship("ISO Certification")
    assert resolved == "iso 27001", (
        f"Baseline+DB rows should prime cache; got {resolved!r}"
    )


def test_empty_pipeline_client_org_no_raise(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PIPELINE_CLIENT_ORG set to empty string → no raise (same as unset)."""
    monkeypatch.setenv(CLIENT_ORG_ENV_VAR, "")
    pool = _FakePool([])

    # Must not raise.
    asyncio.run(_generate_client_alias_snapshot(pool))


# ---------------------------------------------------------------------------
# Test 4: cache merge order — raw alias keying matches existing loader
# ---------------------------------------------------------------------------


def test_cache_merge_order_raw_alias_keying(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DB row is keyed by the RAW alias column, matching entity-aliases.ts:72.

    Verifies: baseline first, DB .update() on top (DB wins on conflict);
    and that the cache key is the raw alias string, not a canonicalised form.
    """
    monkeypatch.setenv(CLIENT_ORG_ENV_VAR, "Test Corp")

    # "Wordpress" is in _BASELINE_ALIASES → "WordPress". The DB should override.
    pool = _FakePool(
        [
            _make_row("Test", "Test Corp", "client"),
            # DB override: same raw alias "Wordpress", different canonical.
            _make_row("Wordpress", "WordPressCMS", "core"),
        ]
    )

    asyncio.run(_generate_client_alias_snapshot(pool))

    # The alias map is keyed by raw "Wordpress" (not lowercased or canonicalised).
    # _rel_canonicalise("Wordpress") → "Wordpress" (title-case, no transforms) →
    # lookup hits "Wordpress" key → "WordPressCMS" (DB wins over "WordPress").
    resolved = canonicalise_for_relationship("Wordpress")
    assert resolved == "wordpresscms", (
        f"DB should win over baseline for 'Wordpress'; got {resolved!r}"
    )


def test_prime_alias_cache_from_db_rows_direct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """prime_alias_cache_from_db_rows() directly primes the cache with DB rows.

    Tests the canonicalisation.py function in isolation — ensures the cache
    is built correctly from a list of record-like dicts.
    """
    from scripts.cocoindex_pipeline.canonicalisation import prime_alias_cache_from_db_rows

    rows = [
        {"alias": "Acme", "canonical": "Acme Holdings Limited", "provenance": "client"},
        {"alias": "ISO Certification", "canonical": "ISO 9001", "provenance": "core"},
    ]

    prime_alias_cache_from_db_rows(rows)

    # "Acme" key resolves to "Acme Holdings Limited"
    resolved_acme = canonicalise_for_relationship("Acme")
    assert resolved_acme == "acme holdings limited", (
        f"Expected 'acme holdings limited'; got {resolved_acme!r}"
    )

    # "ISO Certification" → DB wins "ISO 9001" over baseline "ISO 27001"
    resolved_iso = canonicalise_for_relationship("ISO Certification")
    assert resolved_iso == "iso 9001", (
        f"Expected 'iso 9001'; got {resolved_iso!r}"
    )
