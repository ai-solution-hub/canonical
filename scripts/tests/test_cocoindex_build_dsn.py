"""Regression guard for `scripts/cocoindex_pipeline/flow.py:_build_dsn()` — ID-49.8.

Root cause (S268, see docs/audits/cocoindex-state-db-connection-crash-2026-05-26.md):
the previous `_build_dsn()` fabricated the Supabase pooler host as
`{project_ref}.pooler.supabase.com`, which does NOT exist in DNS (NXDOMAIN ->
asyncpg `socket.gaierror [-2]`), crashing the cocoindex worker at boot on both
envs. Supabase pooler hosts are region-qualified
(`aws-<n>-<region>.pooler.supabase.com`); the project-ref belongs ONLY in the
username. The secondary defect used `SUPABASE_SERVICE_ROLE_KEY` (a PostgREST JWT)
as the Postgres password.

The fix (audit §7.1 "preferred"): read an explicit pooler DSN from the
`COCOINDEX_DB_DSN` env var directly — it carries host + user + password + port,
so there is NO host reconstruction. No silent fallback: an unset/empty
`COCOINDEX_DB_DSN` raises a clear `RuntimeError` (KH no-silent-failure ethos).

These tests assert the new contract WITHOUT a real DB (monkeypatch only):
  - `_build_dsn()` returns the `COCOINDEX_DB_DSN` value verbatim when set.
  - `_build_dsn()` RAISES `RuntimeError` when `COCOINDEX_DB_DSN` is unset/empty.
  - the host-shape validator rejects the old `{ref}.pooler.supabase.com` shape
    and accepts a region-qualified `aws-<n>-<region>.pooler.supabase.com` host.

Stub-isolation: flow.py registers process-global cocoindex App / ContextKey /
lifespan at import. We import it behind `stubbed_sys_modules()` (mirrors
`test_cocoindex_flow_write_path.py::_flow_module`) so importing flow here does
NOT contaminate the global registry and break the idle-mode re-import contract.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest


_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from conftest import fresh_flow_module  # noqa: E402


# ── cocoindex stub install — centralised in conftest (ID-55.1) ────────────────


def _flow_module():
    """Import flow under the standard stubbed cocoindex (ID-55.1 primitive).

    Delegates to ``conftest.fresh_flow_module()`` so this file no longer carries
    its own copy of the ``_StubContextKey`` / ``_make_coco_stub`` / pop / import
    dance (formerly a near-verbatim copy of the sibling flow tests).
    """
    return fresh_flow_module()


# A concrete, region-qualified pooler DSN — the SHAPE the container will mount.
# (The real value is minted out-of-band by Liam; this is a representative
# stand-in for the contract test — NO real credentials.)
_VALID_DSN = (
    "postgresql://postgres.abcdefghijklmnop:s3cr3t-pw"
    "@aws-1-eu-west-2.pooler.supabase.com:5432/postgres"
)


# ── §1 — explicit DSN env var ─────────────────────────────────────────────────


class TestBuildDsnReadsExplicitEnvVar:
    """_build_dsn() reads COCOINDEX_DB_DSN directly — no host reconstruction."""

    def test_returns_explicit_dsn_verbatim(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        monkeypatch.setenv("COCOINDEX_DB_DSN", _VALID_DSN)
        assert flow._build_dsn() == _VALID_DSN

    def test_does_not_reconstruct_from_supabase_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Even with SUPABASE_URL present, the broken `{ref}.pooler.supabase.com`
        host must NEVER appear — the explicit DSN is the sole source of truth."""
        flow = _flow_module()
        monkeypatch.setenv("SUPABASE_URL", "https://abcdefghijklmnop.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "jwt.fake.token")
        monkeypatch.setenv("COCOINDEX_DB_DSN", _VALID_DSN)
        dsn = flow._build_dsn()
        assert dsn == _VALID_DSN
        assert "abcdefghijklmnop.pooler.supabase.com" not in dsn
        # The JWT service-role key must NOT be the password material.
        assert "jwt.fake.token" not in dsn


# ── §2 — no silent fallback ───────────────────────────────────────────────────


class TestBuildDsnFailsFast:
    """Unset / empty COCOINDEX_DB_DSN raises RuntimeError — no silent fallback."""

    def test_unset_raises_runtime_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        monkeypatch.delenv("COCOINDEX_DB_DSN", raising=False)
        with pytest.raises(RuntimeError, match="COCOINDEX_DB_DSN"):
            flow._build_dsn()

    def test_empty_raises_runtime_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        monkeypatch.setenv("COCOINDEX_DB_DSN", "")
        with pytest.raises(RuntimeError, match="COCOINDEX_DB_DSN"):
            flow._build_dsn()

    def test_does_not_fall_back_to_broken_derivation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With SUPABASE_URL set but COCOINDEX_DB_DSN unset, the old code would
        have derived `{ref}.pooler.supabase.com`. The fix must raise instead of
        silently falling back to that NXDOMAIN host."""
        flow = _flow_module()
        monkeypatch.setenv("SUPABASE_URL", "https://abcdefghijklmnop.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "jwt.fake.token")
        monkeypatch.delenv("COCOINDEX_DB_DSN", raising=False)
        with pytest.raises(RuntimeError):
            flow._build_dsn()


# ── §3 — host-shape validator ─────────────────────────────────────────────────


class TestPoolerHostShape:
    """flow.py exposes a region-qualified-host regex guarding the DSN contract.

    Rejects the old `{ref}.pooler.supabase.com` shape (the NXDOMAIN host that
    crashed the worker); accepts `aws-<n>-<region>.pooler.supabase.com`.
    """

    def test_regex_exposed(self) -> None:
        flow = _flow_module()
        assert hasattr(flow, "POOLER_HOST_RE"), (
            "flow.py must expose POOLER_HOST_RE for the host-shape regression guard"
        )

    def test_rejects_old_ref_derived_host(self) -> None:
        flow = _flow_module()
        # The exact NXDOMAIN host the previous code fabricated.
        assert not re.match(flow.POOLER_HOST_RE, "abcdefghijklmnop.pooler.supabase.com")

    def test_accepts_region_qualified_host(self) -> None:
        flow = _flow_module()
        assert re.match(flow.POOLER_HOST_RE, "aws-1-eu-west-2.pooler.supabase.com")
        assert re.match(flow.POOLER_HOST_RE, "aws-0-eu-west-2.pooler.supabase.com")

    def test_valid_dsn_host_matches_regex(self) -> None:
        """The host embedded in a well-formed pooler DSN matches the regex —
        ties the validator to the testStrategy's acceptance pattern."""
        flow = _flow_module()
        host_match = re.search(r"@([^/:]+)(?::\d+)?/", _VALID_DSN)
        assert host_match is not None
        assert re.match(flow.POOLER_HOST_RE, host_match.group(1))
