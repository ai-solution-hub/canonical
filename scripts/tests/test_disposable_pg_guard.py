"""Unit coverage for the shared disposable-Postgres interlock (ID-427 {427.17}).

These tests take NO database. They pin the guard that decides whether the
producer-SQL integration tests are allowed to run at all, so they must be able
to fail — the S548 audit's whole finding was assertions that could not.

The guard's requirement and its current source: **DR-131** — "a CI suite that
mutates the corpus beyond the rows it seeds runs against a disposable database,
never a shared one", ruled after an unattended run published and embedded 88
mock-tier `q_a_pairs` into shared Platform staging. DR-131 names **loopback**
as the disposability signal; `__tests__/integration/helpers/supabase-client.ts:150`
is the TypeScript expression of the same rule.
"""

from __future__ import annotations

import pytest

from scripts.tests.conftest import _dsn_host, require_disposable_dsn

_LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"


class TestLoopbackIsTheDisposabilitySignal:
    """DR-131's primary interlock — the one that generalises."""

    @pytest.mark.parametrize(
        "dsn",
        [
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
            "postgresql://postgres:postgres@localhost:54322/postgres",
            "postgresql://postgres:postgres@[::1]:54322/postgres",
            "postgresql://postgres:postgres@db.test.localhost:54322/postgres",
        ],
    )
    def test_accepts_every_loopback_form(self, dsn: str) -> None:
        assert require_disposable_dsn(dsn, "suite") == dsn

    @pytest.mark.parametrize(
        "host",
        [
            "db.rbwqewalexrzgxtvcqrh.supabase.co",
            "aws-0-eu-west-2.pooler.supabase.com",
            "10.0.0.5",
            "example.com",
        ],
    )
    def test_refuses_any_non_loopback_host(self, host: str) -> None:
        dsn = f"postgresql://postgres:postgres@{host}:5432/postgres"
        with pytest.raises(RuntimeError, match="NON-DISPOSABLE"):
            require_disposable_dsn(dsn, "suite")

    def test_the_refusal_names_the_offending_host(self) -> None:
        """A guard that refuses without naming the target sends the operator
        hunting through env files. The host is the one fact they need."""
        with pytest.raises(RuntimeError, match="example.com"):
            require_disposable_dsn(
                "postgresql://u:p@example.com:5432/postgres", "suite"
            )

    def test_the_refusal_names_the_offending_suite(self) -> None:
        with pytest.raises(RuntimeError, match="my-suite"):
            require_disposable_dsn(
                "postgresql://u:p@example.com:5432/postgres", "my-suite"
            )


class TestSharedProjectRefInterlock:
    """Defence-in-depth, carried from
    `test_cocoindex_stage_5_crossrun_integration.py:66`. It fires even where
    the loopback check would pass — a shared project reached over a tunnel."""

    def test_refuses_a_dsn_carrying_the_platform_ref_even_on_loopback(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PLATFORM_PROJECT_REF", "rbwqewalexrzgxtvcqrh")
        dsn = "postgresql://postgres:postgres@127.0.0.1:54322/rbwqewalexrzgxtvcqrh"
        with pytest.raises(RuntimeError, match="PLATFORM_PROJECT_REF"):
            require_disposable_dsn(dsn, "suite")

    def test_refuses_a_dsn_carrying_the_client_staging_ref(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("STAGING_PROJECT_REF", "turayklvaunphgbgscat")
        dsn = "postgresql://postgres:postgres@127.0.0.1:54322/turayklvaunphgbgscat"
        with pytest.raises(RuntimeError, match="STAGING_PROJECT_REF"):
            require_disposable_dsn(dsn, "suite")

    def test_an_unset_ref_env_never_blocks_a_legitimate_local_run(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The refs come from the environment, so an empty env must not turn
        the interlock into a no-op *failure* — it degrades to the loopback
        check alone, which is the one that generalises."""
        monkeypatch.delenv("PLATFORM_PROJECT_REF", raising=False)
        monkeypatch.delenv("STAGING_PROJECT_REF", raising=False)
        assert require_disposable_dsn(_LOCAL, "suite") == _LOCAL


class TestRefusesRatherThanGuesses:
    def test_a_missing_dsn_raises_rather_than_defaulting(self) -> None:
        """Reaching the guard means the gate env var was deliberately set, so
        a missing DSN is an operator error and must be loud — NOT a silent
        fallback to a default connection string."""
        with pytest.raises(RuntimeError, match="refusing to guess"):
            require_disposable_dsn(None, "suite")

    def test_an_empty_dsn_raises(self) -> None:
        with pytest.raises(RuntimeError, match="refusing to guess"):
            require_disposable_dsn("", "suite")

    def test_an_unparseable_dsn_is_refused_not_admitted(self) -> None:
        """`urlsplit` raising must not fall through to acceptance — the
        fail-open direction is the dangerous one."""
        with pytest.raises(RuntimeError):
            require_disposable_dsn("postgresql://u:p@[unclosed:5432/db", "suite")


class TestDsnHostHelper:
    @pytest.mark.parametrize(
        ("dsn", "expected"),
        [
            (_LOCAL, "127.0.0.1"),
            ("postgresql://u:p@localhost/db", "localhost"),
            ("postgresql://u:p@[::1]:54322/db", "::1"),
        ],
    )
    def test_extracts_the_host(self, dsn: str, expected: str) -> None:
        assert _dsn_host(dsn) == expected

    def test_returns_none_on_an_unparseable_dsn(self) -> None:
        assert _dsn_host("postgresql://u:p@[unclosed:5432/db") is None
