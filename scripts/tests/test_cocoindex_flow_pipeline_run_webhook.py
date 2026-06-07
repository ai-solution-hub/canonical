"""Tests for cocoindex_pipeline/flow.py — Inv-16 / Inv-17 / Inv-18 rollup substrate.

Verifies the `_emit_pipeline_run_webhook()` helper:

  - skips emission when PIPELINE_RUN_WEBHOOK_URL or CRON_SECRET is unset
    (best-effort discipline; pipeline must keep running);
  - posts to PIPELINE_RUN_WEBHOOK_URL with the Authorization Bearer header;
  - serialises op_id via str() (UUID v4 → string);
  - flattens stage_counts into the payload as the `stageCounts` key (the
    receiving Vercel Zod schema requires exactly this casing);
  - includes errorMessage / errorClass / extractorVersion only when supplied;
  - logs (not raises) on HTTP 4xx/5xx so the pipeline keeps running;
  - logs (not raises) on aiohttp transport exceptions.

Subtask ID-28.11 — TECH.md §P-7 Option α (sidecar webhook callback).

aiohttp is stubbed at the import boundary (mirroring
test_cocoindex_flow_upsert_log.py + test_cocoindex_adapters.py pattern) so
the test runs WITHOUT a live HTTP server or aiohttp dependency at test time.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ── Path setup ──────────────────────────────────────────────────────────────

# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.


# ── cocoindex + dependent stubs (mirrors test_cocoindex_flow_upsert_log.py) ──


def _make_coco_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex")
    stub.ContextKey = MagicMock(name="ContextKey")
    stub.AppConfig = MagicMock(name="AppConfig")
    stub.App = MagicMock(name="App")
    stub.use_context = MagicMock(name="use_context")
    stub.start = MagicMock(name="start")
    return stub


def _stub_module(name: str) -> MagicMock:
    if name not in sys.modules:
        sys.modules[name] = MagicMock(name=name)
    return sys.modules[name]


from conftest import passthrough_coco_fn, stubbed_sys_modules  # noqa: E402

_coco_stub = _make_coco_stub()
# Guarantee a working `@coco.fn` so flow.py's `extraction` import keeps
# `extract_classification` awaitable regardless of import order (ID-44.5).
_coco_stub.fn = passthrough_coco_fn
_localfs_stub = MagicMock(name="cocoindex.connectors.localfs")
_pg_stub = MagicMock(name="cocoindex.connectors.postgres")
_pg_stub.ColumnDef = MagicMock(name="ColumnDef")
_pg_stub.TableSchema = MagicMock(name="TableSchema")
_pg_stub.mount_table_target = MagicMock(name="mount_table_target")
_connectorkits_stub = MagicMock(name="cocoindex.connectorkits")
_target_stub = MagicMock(name="cocoindex.connectorkits.target")
_target_stub.ManagedBy = MagicMock(name="ManagedBy")
# asyncpg + docling are inert (no process-global state, no real-package
# consumer) so they stay resident in sys.modules.
_stub_module("asyncpg")
_stub_module("docling")
_stub_module("docling.document_converter")


# ── aiohttp stub — must be installed BEFORE flow.py import so the `import
#    aiohttp` at module level resolves to the stub (real package not required
#    for unit tests). ─────────────────────────────────────────────────────────


class _StubResponse:
    """In-memory stand-in for aiohttp.ClientResponse."""

    def __init__(self, status: int = 200, body: str = "ok"):
        self.status = status
        self._body = body

    async def text(self) -> str:
        return self._body

    async def __aenter__(self) -> "_StubResponse":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None


class _StubSession:
    """In-memory stand-in for aiohttp.ClientSession."""

    last_url: str | None = None
    last_headers: dict[str, str] | None = None
    last_json: dict[str, object] | None = None
    last_timeout: object = None
    next_response_status: int = 200
    next_response_body: str = "ok"
    raise_on_post: BaseException | None = None

    @classmethod
    def reset(cls) -> None:
        cls.last_url = None
        cls.last_headers = None
        cls.last_json = None
        cls.last_timeout = None
        cls.next_response_status = 200
        cls.next_response_body = "ok"
        cls.raise_on_post = None

    async def __aenter__(self) -> "_StubSession":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    def post(self, url: str, *, json=None, headers=None, timeout=None):  # noqa: ANN001 — mirror aiohttp API
        if _StubSession.raise_on_post is not None:
            raise _StubSession.raise_on_post
        _StubSession.last_url = url
        _StubSession.last_headers = headers
        _StubSession.last_json = json
        _StubSession.last_timeout = timeout
        return _StubResponse(
            status=_StubSession.next_response_status,
            body=_StubSession.next_response_body,
        )


_aiohttp_stub = MagicMock(name="aiohttp")
_aiohttp_stub.ClientSession = _StubSession


# ── Import the module under test ─────────────────────────────────────────────
# cocoindex (+ connector submodules) and aiohttp register / shadow
# process-global state, so they are scoped to this import via
# `stubbed_sys_modules()` and removed from sys.modules afterwards (ID-44.5).
# `flow` captures the stub references at import time; the `flow.aiohttp` pin
# below re-asserts the aiohttp stub on the flow module attribute (independent
# of sys.modules), so the webhook-payload introspection tests keep working and
# sibling files (e.g. test_cocoindex_server.py) resolve the real aiohttp.
with stubbed_sys_modules(
    {
        "cocoindex": _coco_stub,
        "cocoindex.connectors": MagicMock(name="cocoindex.connectors"),
        "cocoindex.connectors.localfs": _localfs_stub,
        "cocoindex.connectors.postgres": _pg_stub,
        "cocoindex.connectorkits": _connectorkits_stub,
        "cocoindex.connectorkits.target": _target_stub,
        "aiohttp": _aiohttp_stub,
    }
):
    from scripts.cocoindex_pipeline import flow  # noqa: E402  (stub-scoped import)


# Pin the aiohttp symbol on the imported module to the stub — without this
# pin, the `import aiohttp` resolution inside flow.py may have already
# cached the MagicMock proxy under a different identity. Forcing the stub
# AFTER import guarantees the helper sees `_StubSession` end-to-end.
flow.aiohttp = _aiohttp_stub


@pytest.fixture(autouse=True)
def _pin_webhook_session() -> None:
    """Re-assert this file's aiohttp stub on the shared canonical `flow` module
    before each test (ID-67.2): post namespace canonicalisation `flow` is a
    single `scripts.cocoindex_pipeline.flow` sys.modules identity shared with
    test_cocoindex_app_main_retry_wiring.py, whose own per-test pin would
    otherwise leave its stub (not this file's `_StubSession`) resident on
    `flow.aiohttp` and swallow this file's webhook POSTs."""
    flow.aiohttp = _aiohttp_stub


# ============================================================================
# PIPELINE RUN WEBHOOK EMISSION CONTRACT
# Inv-16 / Inv-17 / Inv-18 substrate per TECH.md §P-7.
# ============================================================================


class TestEmptyStageCounts:
    """The canonical six-stage counter map exposes all six keys at zero."""

    def test_helper_function_is_exposed(self):
        assert hasattr(flow, "_empty_stage_counts")
        assert callable(flow._empty_stage_counts)

    def test_returns_seven_canonical_keys(self):
        counts = flow._empty_stage_counts()
        assert set(counts.keys()) == {
            "source_walk",
            "binary_conversion",
            "llm_extraction",
            "embedding",
            "entity_resolution",
            "chunking",
            "postgres_upsert",
        }

    def test_all_keys_initialise_to_zero(self):
        counts = flow._empty_stage_counts()
        for key, value in counts.items():
            assert value == 0, f"{key} must initialise to 0; got {value}"


class TestEmitPipelineRunWebhookConfiguration:
    """Configuration-gated behaviour: skip silently if env vars are missing."""

    def setup_method(self):
        _StubSession.reset()

    def test_helper_function_is_exposed(self):
        assert hasattr(flow, "_emit_pipeline_run_webhook")
        assert inspect.iscoroutinefunction(flow._emit_pipeline_run_webhook)

    def test_skips_when_url_missing(self, caplog):
        """No WEBHOOK_URL → log warning, do not POST."""
        with patch.dict(os.environ, {"CRON_SECRET": "secret"}, clear=True):
            with caplog.at_level(
                logging.WARNING, logger="scripts.cocoindex_pipeline.flow"
            ):
                asyncio.run(
                    flow._emit_pipeline_run_webhook(
                        op_id=uuid.uuid4(),
                        status="completed",
                        stage_counts=flow._empty_stage_counts(),
                        items_processed=0,
                        items_created=[],
                    )
                )
        assert _StubSession.last_url is None, "must NOT POST when URL missing"
        warning_records = [
            r for r in caplog.records if r.levelno == logging.WARNING
        ]
        assert len(warning_records) >= 1, (
            "must log a WARNING when URL is missing"
        )

    def test_skips_when_secret_missing(self, caplog):
        """No CRON_SECRET → log warning, do not POST."""
        with patch.dict(
            os.environ,
            {"PIPELINE_RUN_WEBHOOK_URL": "https://example.com/webhook"},
            clear=True,
        ):
            with caplog.at_level(
                logging.WARNING, logger="scripts.cocoindex_pipeline.flow"
            ):
                asyncio.run(
                    flow._emit_pipeline_run_webhook(
                        op_id=uuid.uuid4(),
                        status="completed",
                        stage_counts=flow._empty_stage_counts(),
                        items_processed=0,
                        items_created=[],
                    )
                )
        assert _StubSession.last_url is None
        warning_records = [
            r for r in caplog.records if r.levelno == logging.WARNING
        ]
        assert len(warning_records) >= 1


class TestEmitPipelineRunWebhookPayload:
    """Payload contract: URL, headers, JSON body match TECH.md §P-7."""

    URL = "https://kh.example.org/api/internal/pipeline-runs/record"
    SECRET = "test-cron-secret"

    def setup_method(self):
        _StubSession.reset()

    def _emit(self, **kwargs):
        env = {
            "PIPELINE_RUN_WEBHOOK_URL": self.URL,
            "CRON_SECRET": self.SECRET,
        }
        defaults = {
            "op_id": uuid.UUID("11111111-1111-4111-8111-111111111111"),
            "status": "completed",
            "stage_counts": {
                "source_walk": 3,
                "binary_conversion": 3,
                "llm_extraction": 3,
                "embedding": 3,
                "entity_resolution": 3,
                "chunking": 3,
                "postgres_upsert": 3,
            },
            "items_processed": 3,
            "items_created": ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        }
        defaults.update(kwargs)
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(flow._emit_pipeline_run_webhook(**defaults))

    def test_posts_to_pipeline_run_webhook_url(self):
        self._emit()
        assert _StubSession.last_url == self.URL

    def test_sets_authorization_bearer_header(self):
        self._emit()
        headers = _StubSession.last_headers or {}
        assert headers.get("Authorization") == f"Bearer {self.SECRET}"

    def test_sets_json_content_type_header(self):
        self._emit()
        headers = _StubSession.last_headers or {}
        assert headers.get("Content-Type") == "application/json"

    def test_payload_op_id_serialised_via_str(self):
        op_id = uuid.UUID("12345678-1234-4abc-8def-1234567890ab")
        self._emit(op_id=op_id)
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["opId"] == str(op_id)

    def test_payload_pipeline_name_defaults_to_canonical(self):
        self._emit()
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["pipelineName"] == "kh_canonical_pipeline"

    def test_payload_pipeline_name_override(self):
        self._emit(pipeline_name="custom_pipeline")
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["pipelineName"] == "custom_pipeline"

    def test_payload_status_round_trips(self):
        self._emit(status="in_progress")
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["status"] == "in_progress"

    def test_payload_stage_counts_uses_camelCase_key(self):
        """Vercel Zod schema requires `stageCounts` (camelCase) — Inv-17."""
        stage_counts = {
            "source_walk": 1,
            "binary_conversion": 2,
            "llm_extraction": 3,
            "embedding": 4,
            "entity_resolution": 5,
            "chunking": 6,
            "postgres_upsert": 7,
        }
        self._emit(stage_counts=stage_counts)
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["stageCounts"] == stage_counts

    def test_payload_omits_optional_fields_when_unset(self):
        self._emit()
        assert _StubSession.last_json is not None
        assert "errorMessage" not in _StubSession.last_json
        assert "errorClass" not in _StubSession.last_json
        assert "extractorVersion" not in _StubSession.last_json

    def test_payload_includes_error_message_when_set(self):
        self._emit(status="failed", error_message="pipeline halted")
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["errorMessage"] == "pipeline halted"

    def test_payload_includes_error_class_when_set(self):
        self._emit(
            status="failed",
            error_message="malformed extraction",
            error_class="extraction_validation_failed",
        )
        assert _StubSession.last_json is not None
        assert (
            _StubSession.last_json["errorClass"]
            == "extraction_validation_failed"
        )

    def test_payload_includes_extractor_version_when_set(self):
        sha = "abc1234567890def1234567890abcdef12345678"
        self._emit(extractor_version=sha)
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["extractorVersion"] == sha

    def test_payload_items_created_round_trips(self):
        items = [
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ]
        self._emit(items_created=items, items_processed=2)
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["itemsCreated"] == items
        assert _StubSession.last_json["itemsProcessed"] == 2

    def test_payload_is_serialisable_json(self):
        """The payload must be json.dumps-safe (Vercel route does .json())."""
        op_id = uuid.UUID("99999999-9999-4999-8999-999999999999")
        self._emit(op_id=op_id)
        # The stub stored the dict the caller passed; round-trip through json
        # to assert serialisation viability (UUIDs would otherwise blow up).
        encoded = json.dumps(_StubSession.last_json)
        decoded = json.loads(encoded)
        assert decoded["opId"] == str(op_id)


class TestEmitPipelineRunWebhookErrorHandling:
    """4xx/5xx responses + transport exceptions must NOT raise."""

    URL = "https://kh.example.org/api/internal/pipeline-runs/record"
    SECRET = "test-cron-secret"

    def setup_method(self):
        _StubSession.reset()

    def _emit_with_env(self):
        env = {
            "PIPELINE_RUN_WEBHOOK_URL": self.URL,
            "CRON_SECRET": self.SECRET,
        }
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(
                flow._emit_pipeline_run_webhook(
                    op_id=uuid.uuid4(),
                    status="completed",
                    stage_counts=flow._empty_stage_counts(),
                    items_processed=0,
                    items_created=[],
                )
            )

    def test_http_4xx_logs_error_does_not_raise(self, caplog):
        _StubSession.next_response_status = 401
        _StubSession.next_response_body = '{"error":"Unauthorised"}'
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            # Must not raise — best-effort discipline.
            self._emit_with_env()
        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(error_records) >= 1, (
            "HTTP 4xx must log an ERROR for forensic tracing"
        )

    def test_http_5xx_logs_error_does_not_raise(self, caplog):
        _StubSession.next_response_status = 500
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            self._emit_with_env()
        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(error_records) >= 1

    def test_transport_exception_logs_error_does_not_raise(self, caplog):
        """Connection refused / DNS failure must NOT crash the pipeline."""
        _StubSession.raise_on_post = ConnectionError("connection refused")
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            # Must not raise — pipeline keeps running per best-effort contract.
            self._emit_with_env()
        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(error_records) >= 1

    def test_http_200_does_not_log_error(self, caplog):
        """Success path is silent (no error log)."""
        _StubSession.next_response_status = 200
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            self._emit_with_env()
        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(error_records) == 0


class TestEmitPipelineRunWebhookItemFailures:
    """`item_failures` payload contract (ID-80.9, 80.2 §B.4 OQ-80.2-C).

    The per-branch item-failure tally (`{'forms': n, 'content': m}`) rides
    the terminal emission as camelCase `itemFailures`, omit-when-None —
    mirroring the errorDetail (ID-61.4) pattern. Strictly additive alongside
    errorDetail / taxonomyMisses (coordinate, don't clobber).
    """

    URL = "https://kh.example.org/api/internal/pipeline-runs/record"
    SECRET = "test-cron-secret"

    def setup_method(self):
        _StubSession.reset()

    def _emit(self, **kwargs):
        env = {
            "PIPELINE_RUN_WEBHOOK_URL": self.URL,
            "CRON_SECRET": self.SECRET,
        }
        defaults = {
            "op_id": uuid.UUID("11111111-1111-4111-8111-111111111111"),
            "status": "completed",
            "stage_counts": flow._empty_stage_counts(),
            "items_processed": 2,
            "items_created": [],
        }
        defaults.update(kwargs)
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(flow._emit_pipeline_run_webhook(**defaults))

    def test_payload_includes_item_failures_when_set(self):
        self._emit(item_failures={"forms": 1, "content": 0})
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["itemFailures"] == {
            "forms": 1,
            "content": 0,
        }

    def test_payload_includes_zero_tally_verbatim(self):
        # A clean walk still threads {'forms': 0, 'content': 0} at flow end —
        # meaningful ("walk ran, zero per-item faults") and distinguishable
        # from the field being omitted (flow-start emission).
        self._emit(item_failures={"forms": 0, "content": 0})
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["itemFailures"] == {
            "forms": 0,
            "content": 0,
        }

    def test_payload_omits_item_failures_when_unset(self):
        self._emit()
        assert _StubSession.last_json is not None
        assert "itemFailures" not in _StubSession.last_json

    def test_payload_status_stays_completed_with_item_failures(self):
        # OQ-80.2-C: per-item faults are reported on a 'completed' run;
        # 'failed' is reserved for walk-wide faults.
        self._emit(status="completed", item_failures={"forms": 3, "content": 1})
        assert _StubSession.last_json is not None
        assert _StubSession.last_json["status"] == "completed"
        assert _StubSession.last_json["itemFailures"] == {
            "forms": 3,
            "content": 1,
        }
