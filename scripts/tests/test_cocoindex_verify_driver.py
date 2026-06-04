"""Unit tests for `scripts/cocoindex_pipeline/verify_driver.py` (ID-62 / {62.7}).

The verify driver is a STAGE-ONLY loopback POSTer: it reads
`(fixture_path, dest_path, title_prefix)` tuples and POSTs each as
`multipart/form-data` to the sidecar's `POST /stage` route, returning exit 0
iff every POST is 2xx. Tests drive that contract with a MOCKED HTTP client (no
live sidecar) and assert the two load-bearing guarantees:

  - exit-code semantics: all-2xx → 0; any 4xx/5xx/transport failure → non-zero
    with the failing fixture surfaced; and
  - the module imports NO Supabase / SQL symbol (the stage-only boundary
    enforced, not merely intended).

Test philosophy: every test asserts real behaviour. The HTTP client is injected
(`http_post=`) so the driver's branching on real `requests.Response` /
`requests.RequestException` shapes is exercised without binding a socket — the
same code path a live run drives, minus the network.
"""

from __future__ import annotations

import ast
from pathlib import Path
from unittest.mock import Mock

import pytest
import requests

from scripts.cocoindex_pipeline import verify_driver as vd


# ──────────────────────────────────────────────────────────────────────────
# Fixtures / helpers
# ──────────────────────────────────────────────────────────────────────────


def _fake_response(status: int, body: str = "{}") -> Mock:
    """A stand-in for `requests.Response` with the attrs the driver reads."""
    resp = Mock(name=f"response-{status}")
    resp.status_code = status
    resp.text = body
    return resp


@pytest.fixture
def repo_root_with_fixtures(tmp_path: Path) -> Path:
    """A fake repo root whose every FIXTURE_SETS['templates'] source exists.

    The driver reads each fixture's bytes off disk before POSTing; the unit
    tests do not exercise the real `docs/testing/test-data/**` corpus, so we
    materialise small byte stubs at the exact relative paths the default set
    references. This keeps the test hermetic and fast.
    """
    for fixture in vd.FIXTURE_SETS["templates"]:
        source = tmp_path / fixture.fixture_path
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(b"fake-fixture-bytes-" + fixture.title_prefix.encode())
    return tmp_path


# ──────────────────────────────────────────────────────────────────────────
# §1 — exit-code semantics (all-2xx → 0)
# ──────────────────────────────────────────────────────────────────────────


class TestStageFixtureSetAll2xx:
    """All-2xx → every outcome ok; no failures."""

    def test_all_2xx_outcomes_ok(self, repo_root_with_fixtures: Path) -> None:
        post = Mock(return_value=_fake_response(200))
        outcomes = vd.stage_fixture_set(
            vd.FIXTURE_SETS["templates"],
            stage_url="http://localhost:8080/stage",
            repo_root=repo_root_with_fixtures,
            timeout=5.0,
            http_post=post,
        )
        assert all(o.ok for o in outcomes)
        assert all(o.status == 200 for o in outcomes)
        # One POST per fixture in the set — the driver stages every tuple.
        assert post.call_count == len(vd.FIXTURE_SETS["templates"])

    def test_201_counts_as_2xx_success(self, repo_root_with_fixtures: Path) -> None:
        post = Mock(return_value=_fake_response(201))
        outcomes = vd.stage_fixture_set(
            vd.FIXTURE_SETS["templates"],
            stage_url="http://localhost:8080/stage",
            repo_root=repo_root_with_fixtures,
            timeout=5.0,
            http_post=post,
        )
        assert all(o.ok for o in outcomes)

    def test_multipart_wire_contract(self, repo_root_with_fixtures: Path) -> None:
        """The POST carries a `file` part (bytes) + `destPath`/`titlePrefix`
        text parts — the {62.8}/{62.5} /stage wire contract."""
        post = Mock(return_value=_fake_response(200))
        fixture = vd.FIXTURE_SETS["templates"][0]
        vd.stage_one(
            fixture,
            stage_url="http://localhost:8080/stage",
            repo_root=repo_root_with_fixtures,
            timeout=5.0,
            http_post=post,
        )
        _, kwargs = post.call_args
        assert "file" in kwargs["files"]
        filename, file_bytes, _ctype = kwargs["files"]["file"]
        assert isinstance(file_bytes, bytes) and len(file_bytes) > 0
        assert kwargs["data"]["destPath"] == fixture.dest_path
        assert kwargs["data"]["titlePrefix"] == fixture.title_prefix


class TestRunExitZero:
    """`run()` returns 0 when every /stage POST is 2xx."""

    def test_run_returns_0_on_all_2xx(
        self, monkeypatch: pytest.MonkeyPatch, repo_root_with_fixtures: Path
    ) -> None:
        monkeypatch.setattr(vd, "_repo_root", lambda: repo_root_with_fixtures)
        post = Mock(return_value=_fake_response(200))
        rc = vd.run(["--fixtures", "templates", "--port", "8080"], http_post=post)
        assert rc == 0


# ──────────────────────────────────────────────────────────────────────────
# §2 — exit-code semantics (any failure → non-zero, failing fixture surfaced)
# ──────────────────────────────────────────────────────────────────────────


class TestStageFailureSurfaced:
    """A 4xx/5xx response → that outcome is non-ok and carries the status+body."""

    def test_4xx_is_non_ok(self, repo_root_with_fixtures: Path) -> None:
        fixture = vd.FIXTURE_SETS["templates"][0]
        post = Mock(return_value=_fake_response(400, body='{"error": "bad destPath"}'))
        outcome = vd.stage_one(
            fixture,
            stage_url="http://localhost:8080/stage",
            repo_root=repo_root_with_fixtures,
            timeout=5.0,
            http_post=post,
        )
        assert outcome.ok is False
        assert outcome.status == 400
        # The response body is surfaced so the operator can diagnose.
        assert "bad destPath" in outcome.detail

    def test_5xx_is_non_ok(self, repo_root_with_fixtures: Path) -> None:
        fixture = vd.FIXTURE_SETS["templates"][0]
        post = Mock(return_value=_fake_response(500, body="mount failure"))
        outcome = vd.stage_one(
            fixture,
            stage_url="http://localhost:8080/stage",
            repo_root=repo_root_with_fixtures,
            timeout=5.0,
            http_post=post,
        )
        assert outcome.ok is False
        assert outcome.status == 500

    def test_timeout_is_non_ok_no_status(
        self, repo_root_with_fixtures: Path
    ) -> None:
        """A transport-level timeout → non-ok with status=None, the error text
        surfaced (operator can diagnose connection-refused / timeout)."""
        fixture = vd.FIXTURE_SETS["templates"][0]
        post = Mock(side_effect=requests.Timeout("read timed out"))
        outcome = vd.stage_one(
            fixture,
            stage_url="http://localhost:8080/stage",
            repo_root=repo_root_with_fixtures,
            timeout=5.0,
            http_post=post,
        )
        assert outcome.ok is False
        assert outcome.status is None
        assert "timed out" in outcome.detail

    def test_connection_refused_is_non_ok(
        self, repo_root_with_fixtures: Path
    ) -> None:
        fixture = vd.FIXTURE_SETS["templates"][0]
        post = Mock(side_effect=requests.ConnectionError("connection refused"))
        outcome = vd.stage_one(
            fixture,
            stage_url="http://localhost:8080/stage",
            repo_root=repo_root_with_fixtures,
            timeout=5.0,
            http_post=post,
        )
        assert outcome.ok is False
        assert outcome.status is None
        assert "connection refused" in outcome.detail


class TestRunExitNonZero:
    """`run()` returns non-zero when ANY /stage POST fails, and surfaces the
    failing fixture."""

    def test_run_returns_nonzero_on_any_4xx(
        self,
        monkeypatch: pytest.MonkeyPatch,
        repo_root_with_fixtures: Path,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        monkeypatch.setattr(vd, "_repo_root", lambda: repo_root_with_fixtures)

        # First POST 200, second POST 400 → overall non-zero.
        responses = [_fake_response(200), _fake_response(400, body="bad"), _fake_response(200)]
        post = Mock(side_effect=responses)
        rc = vd.run(["--fixtures", "templates", "--port", "8080"], http_post=post)
        assert rc != 0
        # The failing fixture's dest path is printed for diagnosis.
        err = capsys.readouterr().err
        failing = vd.FIXTURE_SETS["templates"][1]
        assert failing.dest_path in err
        assert "FAIL" in err

    def test_run_returns_nonzero_on_transport_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
        repo_root_with_fixtures: Path,
    ) -> None:
        monkeypatch.setattr(vd, "_repo_root", lambda: repo_root_with_fixtures)
        post = Mock(side_effect=requests.ConnectionError("refused"))
        rc = vd.run(["--fixtures", "templates", "--port", "8080"], http_post=post)
        assert rc != 0

    def test_run_stages_all_before_failing(
        self,
        monkeypatch: pytest.MonkeyPatch,
        repo_root_with_fixtures: Path,
    ) -> None:
        """A failure in the middle does NOT short-circuit — every fixture is
        attempted so the operator sees the full picture in one run."""
        monkeypatch.setattr(vd, "_repo_root", lambda: repo_root_with_fixtures)
        post = Mock(
            side_effect=[_fake_response(400), _fake_response(200), _fake_response(200)]
        )
        vd.run(["--fixtures", "templates", "--port", "8080"], http_post=post)
        assert post.call_count == len(vd.FIXTURE_SETS["templates"])


# ──────────────────────────────────────────────────────────────────────────
# §3 — URL / port resolution (loopback default)
# ──────────────────────────────────────────────────────────────────────────


class TestResolveStageUrl:
    """Loopback is the load-bearing default; explicit --url / env / --port
    override in documented precedence."""

    def test_default_is_loopback_8080(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("COCOINDEX_STAGING_URL", raising=False)
        monkeypatch.delenv("PORT", raising=False)
        assert vd.resolve_stage_url() == "http://localhost:8080/stage"

    def test_port_arg_overrides_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("COCOINDEX_STAGING_URL", raising=False)
        assert vd.resolve_stage_url(port_arg=9090) == "http://localhost:9090/stage"

    def test_env_port_honoured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The driver resolves the port from $PORT — the same convention
        server.py uses — so co-located runs need no flag."""
        monkeypatch.delenv("COCOINDEX_STAGING_URL", raising=False)
        monkeypatch.setenv("PORT", "7777")
        assert vd.resolve_stage_url() == "http://localhost:7777/stage"

    def test_staging_url_env_overrides_port(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COCOINDEX_STAGING_URL", "http://host:1234/stage")
        monkeypatch.setenv("PORT", "7777")
        assert vd.resolve_stage_url() == "http://host:1234/stage"

    def test_url_arg_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("COCOINDEX_STAGING_URL", "http://env:1/stage")
        assert (
            vd.resolve_stage_url(url_arg="http://explicit:2/stage")
            == "http://explicit:2/stage"
        )


# ──────────────────────────────────────────────────────────────────────────
# §4 — STAGE-ONLY boundary: NO Supabase / SQL symbol imported (Inv-8)
# ──────────────────────────────────────────────────────────────────────────


class TestNoSupabaseImport:
    """The driver stages bytes and reads HTTP status codes ONLY. It must import
    no Supabase / SQL / DB-client symbol — the stage-only boundary (ID-62
    Inv-8) enforced statically so it cannot silently rot.

    Asserted by parsing the module source AST: no `import`/`from … import` may
    reference a forbidden DB/SQL package. A runtime `sys.modules` check would be
    fooled by a sibling test loading supabase first, so the static AST check is
    the load-bearing guarantee.
    """

    _FORBIDDEN = (
        "supabase",
        "postgrest",
        "asyncpg",
        "psycopg",
        "psycopg2",
        "sqlalchemy",
        "sqlite3",
    )

    def _imported_module_roots(self) -> set[str]:
        source = Path(vd.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        roots: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    roots.add(alias.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    roots.add(node.module.split(".")[0])
        return roots

    def test_no_forbidden_db_import(self) -> None:
        roots = self._imported_module_roots()
        offending = sorted(r for r in roots if r in self._FORBIDDEN)
        assert not offending, (
            f"verify_driver must stage-only — no DB/SQL import allowed, found: "
            f"{offending}"
        )

    def test_no_flow_or_supabase_client_import(self) -> None:
        """No import of the pipeline flow module nor the bid-worker supabase
        client — the driver never touches the write/read DB path."""
        roots = self._imported_module_roots()
        # The driver imports only stdlib + requests; it must NOT pull in the
        # cocoindex flow (which registers DB ContextKeys) or any supabase client.
        assert "cocoindex" not in roots
        source = Path(vd.__file__).read_text(encoding="utf-8")
        assert "from scripts.cocoindex_pipeline.flow" not in source
        assert "import supabase" not in source
