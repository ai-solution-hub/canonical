"""Unit coverage for the Stage-5 crossrun `_require_disposable_dsn` guard.

The guard lives in `test_cocoindex_stage_5_crossrun_integration.py`, but the
four real cross-run tests that exercise it are gated behind
`KH_RUN_STAGE5_INTEGRATION` (module-level `pytestmark`) and never run in the
default `python3 -m pytest scripts/tests/` sweep. The guard itself is a pure
string check — no DB, no `KH_RUN_STAGE5_INTEGRATION` — so it is unit-tested
here, UNGATED, to prove the rejection path runs on every default sweep
(ID-127.23: post-cutover the shared DB is Platform staging, reachable by DSN
but previously unchecked).
"""

from __future__ import annotations

import pytest

from scripts.tests.test_cocoindex_stage_5_crossrun_integration import (
    _require_disposable_dsn,
)


def test_guard_rejects_client_staging_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    """Existing behaviour (regression guard): a DSN containing STAGING_PROJECT_REF
    (the client-staging ref) is refused."""
    monkeypatch.setenv("STAGING_PROJECT_REF", "clientstagingref")
    monkeypatch.delenv("PLATFORM_PROJECT_REF", raising=False)
    monkeypatch.setenv(
        "KH_STAGE5_INTEGRATION_DSN",
        "postgresql://user:pw@db.clientstagingref.supabase.co:5432/postgres",
    )
    with pytest.raises(RuntimeError, match="SHARED STAGING"):
        _require_disposable_dsn()


def test_guard_rejects_platform_staging_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    """ID-127.23: a DSN containing PLATFORM_PROJECT_REF (Platform staging,
    rbwqewalexrzgxtvcqrh post-cutover) is refused — previously unchecked."""
    monkeypatch.delenv("STAGING_PROJECT_REF", raising=False)
    monkeypatch.setenv("PLATFORM_PROJECT_REF", "rbwqewalexrzgxtvcqrh")
    monkeypatch.setenv(
        "KH_STAGE5_INTEGRATION_DSN",
        "postgresql://user:pw@db.rbwqewalexrzgxtvcqrh.supabase.co:5432/postgres",
    )
    with pytest.raises(RuntimeError, match="PLATFORM STAGING"):
        _require_disposable_dsn()


def test_guard_allows_legitimate_disposable_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A DSN pointing at neither shared-staging ref is allowed through unchanged."""
    monkeypatch.setenv("STAGING_PROJECT_REF", "clientstagingref")
    monkeypatch.setenv("PLATFORM_PROJECT_REF", "rbwqewalexrzgxtvcqrh")
    disposable_dsn = (
        "postgresql://user:pw@db.disposableephemeralref.supabase.co:5432/postgres"
    )
    monkeypatch.setenv("KH_STAGE5_INTEGRATION_DSN", disposable_dsn)
    assert _require_disposable_dsn() == disposable_dsn


def test_guard_requires_dsn_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    """Existing behaviour (regression guard): an unset DSN is refused outright."""
    monkeypatch.delenv("KH_STAGE5_INTEGRATION_DSN", raising=False)
    with pytest.raises(RuntimeError, match="KH_STAGE5_INTEGRATION_DSN is unset"):
        _require_disposable_dsn()
