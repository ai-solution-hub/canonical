"""Unit tests for `deploy/onprem/verify/verify_driver.py` (ID-62 / {62.10}).

The URL-mode verify driver is the URL parameterisation of the ID-62
verify-driver primitive (Inv-21): fixture step = ONE gate-passed
`feed_articles` row seeded via service-role PostgREST insert (NOT `/stage`
byte-staging); trigger step = `POST {worker}/walk` (bearer-gated bl-221
route); assertion surfaced via exit code = the landed `source_documents`
row poll (Inv-23). Row-shape assertions are NOT the driver's job — they
live in `__tests__/integration/cocoindex/url-landing-set.integration.test.ts`
(Inv-22 single assertion surface).

Tests drive the contract with MOCKED HTTP callables (no live Supabase, no
live worker — the {62.7}/{62.9} test precedent):

  - the seed step's PostgREST request shapes (gate-passed row: passed=true,
    title NOT NULL, published_at set, external_url normalised);
  - walk-trigger semantics: 202 accepted; 409 retried (walk in flight —
    the hourly Coolify fallback can collide); 401/400/503 fail fast;
  - the landing poll: the deterministic uuid5 sd row is observed, else the
    deadline returns a non-ok verdict;
  - the second-walk idempotency leg: re-POST `/walk` in the same
    invocation + `pipeline_runs` terminal-row wait;
  - `run()` exit-code semantics end-to-end over injected deps.

Test philosophy: every test asserts real behaviour — the injected HTTP
callables exercise the same branching a live run drives, minus the network
(docs/reference/test-philosophy.md).
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import Mock

from deploy.onprem.verify import verify_driver as vd

# ──────────────────────────────────────────────────────────────────────────
# Fixtures / helpers
# ──────────────────────────────────────────────────────────────────────────

PROOF_URL = "https://example.com/"
WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
FEED_SOURCE_ID = "22222222-2222-4222-8222-222222222222"
ARTICLE_ID = "33333333-3333-4333-8333-333333333333"

# uuid5(fbfaf1ff-1ee4-583c-9757-1674465b2ec1, "sd:https://example.com/") —
# pinned literal so namespace/seed drift breaks loudly (mirrors flow.py's
# `_KH_PIPELINE_DOC_NS` pin).
SD_ID_FOR_PROOF_URL = "bd2e928c-86ab-5777-862b-7107e7dbc21d"


def _response(
    status: int,
    body: Any = None,
    headers: dict[str, str] | None = None,
) -> Mock:
    """Stand-in for `requests.Response` with the attrs the driver reads."""
    resp = Mock(name=f"response-{status}")
    resp.status_code = status
    if isinstance(body, (list, dict)):
        resp.text = json.dumps(body)
        resp.json = Mock(return_value=body)
    else:
        resp.text = body if body is not None else ""
        resp.json = Mock(side_effect=ValueError("not json"))
    resp.headers = headers or {}
    return resp


class FakeHttp:
    """Routes (method, url) → canned responses; records every call.

    Handlers are matched by substring on the URL, first match wins. A
    handler may be a Mock response or a callable `(url, kwargs) -> response`
    for stateful sequences (e.g. 409-then-202).
    """

    def __init__(self) -> None:
        self.routes: list[tuple[str, str, Any]] = []
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def route(self, method: str, url_fragment: str, handler: Any) -> None:
        self.routes.append((method.upper(), url_fragment, handler))

    def _dispatch(self, method: str, url: str, **kwargs: Any) -> Any:
        self.calls.append((method, url, kwargs))
        for m, fragment, handler in self.routes:
            if m == method and fragment in url:
                if callable(handler) and not isinstance(handler, Mock):
                    return handler(url, kwargs)
                return handler
        raise AssertionError(f"unrouted {method} {url}")

    def get(self, url: str, **kwargs: Any) -> Any:
        return self._dispatch("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> Any:
        return self._dispatch("POST", url, **kwargs)

    def patch(self, url: str, **kwargs: Any) -> Any:
        return self._dispatch("PATCH", url, **kwargs)

    def calls_to(self, method: str, fragment: str) -> list[dict[str, Any]]:
        return [
            kwargs
            for m, url, kwargs in self.calls
            if m == method and fragment in url
        ]


def _config(**overrides: Any) -> "vd.DriverConfig":
    """A DriverConfig with no-wait timings so tests never sleep for real."""
    base: dict[str, Any] = dict(
        proof_url=PROOF_URL,
        supabase_url="https://staging.supabase.test",
        service_role_key="service-role-test-key",
        worker_url="https://worker.test",
        cron_secret="cron-secret-test",
        timeout=5.0,
        sd_poll_deadline=2.0,
        sd_poll_interval=0.0,
        walk_retry_deadline=2.0,
        walk_retry_interval=0.0,
        walk2_run_deadline=2.0,
        walk2_run_interval=0.0,
    )
    base.update(overrides)
    return vd.DriverConfig(**base)


def _deps(http: FakeHttp) -> "vd.Deps":
    """Deps over the fake http with an instant clock (no real sleeping)."""
    clock = {"t": 0.0}

    def fake_monotonic() -> float:
        clock["t"] += 0.05
        return clock["t"]

    return vd.Deps(
        http_get=http.get,
        http_post=http.post,
        http_patch=http.patch,
        sleep=lambda _s: None,
        monotonic=fake_monotonic,
    )


def _route_happy_seed(http: FakeHttp) -> None:
    """Route the three PostgREST seed lookups to the from-scratch branch."""
    http.route("GET", "/rest/v1/workspaces", _response(200, [{"id": WORKSPACE_ID}]))
    http.route("GET", "/rest/v1/feed_sources", _response(200, []))
    http.route(
        "POST", "/rest/v1/feed_sources", _response(201, [{"id": FEED_SOURCE_ID}])
    )
    http.route("GET", "/rest/v1/feed_articles", _response(200, []))
    http.route(
        "POST", "/rest/v1/feed_articles", _response(201, [{"id": ARTICLE_ID}])
    )


# ──────────────────────────────────────────────────────────────────────────
# §1 — deterministic sd-id derivation (the uuid5 seed contract)
# ──────────────────────────────────────────────────────────────────────────


class TestSourceDocumentId:
    def test_sd_id_is_uuid5_of_namespace_and_sd_prefixed_url(self) -> None:
        assert str(vd.sd_document_id(PROOF_URL)) == SD_ID_FOR_PROOF_URL

    def test_sd_id_applies_normalisation_first(self) -> None:
        # A bare host normalises to the root-slash form — same id.
        assert vd.sd_document_id("https://example.com") == uuid.UUID(
            SD_ID_FOR_PROOF_URL
        )


# ──────────────────────────────────────────────────────────────────────────
# §2 — seed step (service-role PostgREST fixture row)
# ──────────────────────────────────────────────────────────────────────────


class TestSeedLedgerRow:
    def test_inserts_gate_passed_row_when_absent(self) -> None:
        http = FakeHttp()
        _route_happy_seed(http)
        outcome = vd.seed_ledger_row(_config(), _deps(http))
        assert outcome.ok

        # feed_sources insert: inactive (the TS poller must never poll it),
        # bound to the looked-up workspace.
        [source_post] = http.calls_to("POST", "/rest/v1/feed_sources")
        source_row = source_post["json"]
        assert source_row["workspace_id"] == WORKSPACE_ID
        assert source_row["is_active"] is False

        # feed_articles insert: the gate-passed ledger row per TECH §5 step 1.
        [article_post] = http.calls_to("POST", "/rest/v1/feed_articles")
        row = article_post["json"]
        assert row["passed"] is True
        assert row["external_url"] == PROOF_URL  # already-normalised form
        assert row["title"]  # NOT NULL
        assert row["published_at"]  # set
        assert row["workspace_id"] == WORKSPACE_ID
        assert row["feed_source_id"] == FEED_SOURCE_ID

    def test_patches_existing_row_and_bumps_ingested_at(self) -> None:
        http = FakeHttp()
        http.route(
            "GET", "/rest/v1/workspaces", _response(200, [{"id": WORKSPACE_ID}])
        )
        http.route(
            "GET", "/rest/v1/feed_sources", _response(200, [{"id": FEED_SOURCE_ID}])
        )
        http.route(
            "GET", "/rest/v1/feed_articles", _response(200, [{"id": ARTICLE_ID}])
        )
        http.route("PATCH", "/rest/v1/feed_articles", _response(204, []))
        outcome = vd.seed_ledger_row(_config(), _deps(http))
        assert outcome.ok

        # Re-run path: no duplicate insert; PATCH re-asserts the gate and
        # bumps ingested_at (the D-4 content-epoch token) for a fresh fetch.
        assert http.calls_to("POST", "/rest/v1/feed_articles") == []
        [article_patch] = http.calls_to("PATCH", "/rest/v1/feed_articles")
        patch = article_patch["json"]
        assert patch["passed"] is True
        assert patch["ingested_at"]

    def test_fails_loud_when_no_workspace_exists(self) -> None:
        http = FakeHttp()
        http.route("GET", "/rest/v1/workspaces", _response(200, []))
        outcome = vd.seed_ledger_row(_config(), _deps(http))
        assert not outcome.ok
        assert "workspace" in outcome.detail

    def test_service_role_headers_on_every_rest_call(self) -> None:
        http = FakeHttp()
        _route_happy_seed(http)
        vd.seed_ledger_row(_config(), _deps(http))
        rest_calls = [
            kwargs for _m, url, kwargs in http.calls if "/rest/v1/" in url
        ]
        assert rest_calls
        for kwargs in rest_calls:
            headers = kwargs["headers"]
            assert headers["apikey"] == "service-role-test-key"
            assert headers["Authorization"] == "Bearer service-role-test-key"


# ──────────────────────────────────────────────────────────────────────────
# §3 — walk trigger (bearer-gated bl-221 route; 409 retried)
# ──────────────────────────────────────────────────────────────────────────


class TestWalkTrigger:
    def test_202_accepted_first_try(self) -> None:
        http = FakeHttp()
        http.route("POST", "/walk", _response(202, {"requestId": "r1"}))
        ok, detail = vd.walk_until_accepted(_config(), _deps(http))
        assert ok
        [walk_post] = http.calls_to("POST", "/walk")
        assert (
            walk_post["headers"]["Authorization"] == "Bearer cron-secret-test"
        )

    def test_409_in_flight_is_retried_until_202(self) -> None:
        http = FakeHttp()
        statuses = iter([409, 409, 202])

        def walk_handler(_url: str, _kwargs: dict[str, Any]) -> Mock:
            return _response(next(statuses), {"requestId": "r2"})

        http.route("POST", "/walk", walk_handler)
        ok, _detail = vd.walk_until_accepted(_config(), _deps(http))
        assert ok
        assert len(http.calls_to("POST", "/walk")) == 3

    def test_401_fails_fast_without_retry(self) -> None:
        http = FakeHttp()
        http.route("POST", "/walk", _response(401, {"error": "bad bearer"}))
        ok, detail = vd.walk_until_accepted(_config(), _deps(http))
        assert not ok
        assert "401" in detail
        assert len(http.calls_to("POST", "/walk")) == 1

    def test_409_forever_times_out_non_ok(self) -> None:
        http = FakeHttp()
        http.route("POST", "/walk", _response(409, {"error": "in progress"}))
        ok, detail = vd.walk_until_accepted(
            _config(walk_retry_deadline=0.2), _deps(http)
        )
        assert not ok
        assert "409" in detail


# ──────────────────────────────────────────────────────────────────────────
# §4 — landed-row poll (sd-row existence; NOT a row-shape assertion)
# ──────────────────────────────────────────────────────────────────────────


class TestPollLandedSdRow:
    def test_returns_true_when_row_lands(self) -> None:
        http = FakeHttp()
        http.route(
            "GET",
            "/rest/v1/source_documents",
            _response(200, [{"id": SD_ID_FOR_PROOF_URL}]),
        )
        assert vd.poll_landed_sd_row(_config(), _deps(http)) is True
        # The poll filters on the deterministic uuid5 sd id.
        [sd_get] = http.calls_to("GET", "/rest/v1/source_documents")
        assert sd_get["params"]["id"] == f"eq.{SD_ID_FOR_PROOF_URL}"

    def test_returns_false_when_row_never_lands(self) -> None:
        http = FakeHttp()
        http.route("GET", "/rest/v1/source_documents", _response(200, []))
        assert (
            vd.poll_landed_sd_row(_config(sd_poll_deadline=0.2), _deps(http))
            is False
        )


# ──────────────────────────────────────────────────────────────────────────
# §5 — second-walk idempotency leg (pipeline_runs terminal wait)
# ──────────────────────────────────────────────────────────────────────────


class TestSecondWalkLeg:
    def test_completed_terminal_row_ok(self) -> None:
        http = FakeHttp()
        http.route(
            "GET",
            "/rest/v1/pipeline_runs",
            _response(200, [{"id": "p1", "status": "completed"}]),
        )
        ok, _detail = vd.wait_for_terminal_pipeline_run(
            _config(), _deps(http), since_iso="2026-06-06T10:00:00+00:00"
        )
        assert ok
        [runs_get] = http.calls_to("GET", "/rest/v1/pipeline_runs")
        params = runs_get["params"]
        assert params["pipeline_name"] == "eq.kh_canonical_pipeline"
        assert params["created_at"] == "gte.2026-06-06T10:00:00+00:00"

    def test_failed_terminal_row_non_ok(self) -> None:
        http = FakeHttp()
        http.route(
            "GET",
            "/rest/v1/pipeline_runs",
            _response(200, [{"id": "p1", "status": "failed"}]),
        )
        ok, detail = vd.wait_for_terminal_pipeline_run(
            _config(), _deps(http), since_iso="2026-06-06T10:00:00+00:00"
        )
        assert not ok
        assert "failed" in detail

    def test_no_terminal_row_times_out_non_ok(self) -> None:
        http = FakeHttp()
        http.route(
            "GET",
            "/rest/v1/pipeline_runs",
            _response(200, [{"id": "p1", "status": "running"}]),
        )
        ok, detail = vd.wait_for_terminal_pipeline_run(
            _config(walk2_run_deadline=0.2),
            _deps(http),
            since_iso="2026-06-06T10:00:00+00:00",
        )
        assert not ok
        assert "PIPELINE_RUN_WEBHOOK_URL" in detail


# ──────────────────────────────────────────────────────────────────────────
# §7 — run() exit-code semantics over fully-injected deps (Inv-23)
# ──────────────────────────────────────────────────────────────────────────


class TestRunExitCodes:
    def _happy_http(self) -> FakeHttp:
        http = FakeHttp()
        _route_happy_seed(http)
        http.route("POST", "/walk", _response(202, {"requestId": "r1"}))
        http.route(
            "GET",
            "/rest/v1/source_documents",
            _response(200, [{"id": SD_ID_FOR_PROOF_URL}]),
        )
        http.route(
            "GET",
            "/rest/v1/pipeline_runs",
            _response(200, [{"id": "p1", "status": "completed"}]),
        )
        return http

    def test_happy_path_exit_0_and_two_walks_posted(self) -> None:
        http = self._happy_http()
        exit_code = vd.run_with(_config(), _deps(http))
        assert exit_code == 0
        # Walk 1 (trigger) + walk 2 (idempotency leg) in the SAME invocation.
        assert len(http.calls_to("POST", "/walk")) == 2

    def test_landing_poll_failure_exits_non_zero(self) -> None:
        http = self._happy_http()
        # Re-route the sd landing poll to an empty result (routes are
        # first-match, so rebuild with the failing handler first).
        failing = FakeHttp()
        failing.route(
            "GET",
            "/rest/v1/source_documents",
            _response(200, []),
        )
        failing.routes.extend(http.routes)
        exit_code = vd.run_with(_config(sd_poll_deadline=0.2), _deps(failing))
        assert exit_code == 1
        # The second walk never fires — the landing gate failed first.
        assert len(failing.calls_to("POST", "/walk")) == 1

    def test_second_walk_failed_run_exits_non_zero(self) -> None:
        http = self._happy_http()
        failing = FakeHttp()
        failing.route(
            "GET",
            "/rest/v1/pipeline_runs",
            _response(200, [{"id": "p1", "status": "failed"}]),
        )
        failing.routes.extend(http.routes)
        exit_code = vd.run_with(_config(), _deps(failing))
        assert exit_code == 1

    def test_skip_second_walk_posts_once(self) -> None:
        http = self._happy_http()
        exit_code = vd.run_with(
            _config(second_walk=False), _deps(http)
        )
        assert exit_code == 0
        assert len(http.calls_to("POST", "/walk")) == 1

    def test_missing_env_exits_2(self, monkeypatch: Any) -> None:
        # Only the genuinely required vars are removed — COCOINDEX_URL_VERIFY_URL
        # defaults (PROOF_URL_DEFAULT) and must NOT be needed for the exit-2
        # required-env diagnostic.
        for var in (
            "NEXT_PUBLIC_SUPABASE_URL",
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "COCOINDEX_WORKER_URL",
            "PIPELINE_TRIGGER_SECRET",
        ):
            monkeypatch.delenv(var, raising=False)
        assert vd.run([]) == 2
