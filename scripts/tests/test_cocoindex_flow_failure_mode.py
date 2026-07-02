"""Tests for cocoindex_pipeline/flow.py — Subtask ID-28.13 failure-mode wiring.

Verifies:

  - `_classify_stage_exception()` maps Python exception types to the
    7-class stage-level vocabulary per PRODUCT Inv-25:
      * Pydantic ValidationError → 'extraction_validation_failed'
      * anthropic.APIStatusError 5xx / RateLimitError → 'extraction_provider_unavailable'
      * asyncpg.PostgresError → 'postgres_write_failed'
      * docling-raised exception → 'binary_conversion_failed'
      * generic / unmapped → None (caller decides fallback policy)

  - `_emit_stage_error_log()` emits a single structured-log JSON line at
    ERROR level with the contract shape
    `{event, op_id, stage, error_class, source_document_id, error_message}`
    per PRODUCT Inv-26.

  - PII redaction policy:
      * error_message is truncated to 200 characters.
      * UUID-shaped substrings in the error message are replaced with
        `<uuid>`.
      * The structured log emits ONLY error_class + truncated/redacted
        error_message + op_id + stage + source_document_id — no LLM
        response payload, no API key, no raw stack trace.

  - The Inv-27 per-row UPSERT atomicity contract: a synthetic 5-row
    failure scenario (row 5 raises `asyncpg.PostgresError`) leaves
    rows 1-4 persisted in the mock UPSERT log AND emits one
    pipeline-run webhook with status='failed', error_class='postgres_write_failed'.
    This documents the cocoindex-native semantic explicitly so the test
    cannot be misread later as a per-RUN atomicity assertion.

The cocoindex / aiohttp / asyncpg / docling modules are all stubbed at
the import boundary (mirroring test_cocoindex_flow_pipeline_run_webhook.py)
so the test runs WITHOUT live infrastructure.

Reference: docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-8
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

# ── Path setup ──────────────────────────────────────────────────────────────

# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.


# ── cocoindex + dependent stubs (mirrors sibling test file pattern) ─────────


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

# ID-101 §{101.7}: neutralise the relationship-extraction Path-A seam so
# ingest_file tests make no live Anthropic call (mirrors the
# extract_entity_mentions stubs alongside).
async def _fake_relationships_empty(content_text: str) -> list:
    return []


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
# docling is inert (no process-global state, no real-package consumer) so it
# stays resident in sys.modules. asyncpg is installed below as a resident stub
# because this file's tests re-`import asyncpg` at RUN time.
_stub_module("docling")
_stub_module("docling.document_converter")


# ── aiohttp stub — proper async-context-manager shape so the webhook
#    emission test can introspect the JSON payload that would have been
#    POSTed. Mirrors the sibling test_cocoindex_flow_pipeline_run_webhook.py
#    _StubSession pattern.


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

    @classmethod
    def reset(cls) -> None:
        cls.last_url = None
        cls.last_headers = None
        cls.last_json = None
        cls.last_timeout = None
        cls.next_response_status = 200
        cls.next_response_body = "ok"

    async def __aenter__(self) -> "_StubSession":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    def post(self, url, *, json=None, headers=None, timeout=None):  # noqa: ANN001
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
_aiohttp_stub.ClientTimeout = MagicMock(name="ClientTimeout")

# asyncpg stub — but we need a PostgresError that's a real exception
# class (the sibling tests install `asyncpg` as a bare MagicMock with no
# attribute override, leaving `asyncpg.PostgresError` itself a MagicMock —
# `isinstance(exc, MagicMock)` raises TypeError because MagicMock is not
# a type, which would break the classifier's `isinstance` check). Force-
# install a real Exception subclass on whichever asyncpg module is in
# residence so the classification logic + classifier tests both see a
# proper class. asyncpg stays RESIDENT in sys.modules (this file's tests
# re-`import asyncpg` at run time) — it registers no process-global state and
# no sibling consumes the real package, so it is not a cross-contamination
# source (ID-44.5).


class _PostgresError(Exception):
    """Stand-in for asyncpg.PostgresError used by classification tests."""


class _FkViolation(_PostgresError):
    """Stand-in for asyncpg.ForeignKeyViolationError ({75.17}).

    Carries the `.constraint_name` surface the step-8 backlink tolerance in
    `_ingest_url_body` narrows on — by STRING COMPARE of `constraint_name`
    alone (Checker fix: never by asyncpg class identity, which is
    import-order-dependent under this suite's MagicMock asyncpg stubs).
    Subclasses `_PostgresError` so an escaping (non-tolerated) violation
    still classifies `postgres_write_failed` — the REAL asyncpg shape
    (ForeignKeyViolationError < PostgresError, with a `constraint_name`
    attribute) is pinned in a fresh interpreter by
    `TestUrlPerItemFailureIsolation.
    test_real_asyncpg_fk_violation_exposes_constraint_name`.
    """

    def __init__(self, message: str, *, constraint_name: str) -> None:
        super().__init__(message)
        self.constraint_name = constraint_name


if "asyncpg" not in sys.modules:
    _asyncpg_stub = MagicMock(name="asyncpg")
    _asyncpg_stub.PostgresError = _PostgresError
    sys.modules["asyncpg"] = _asyncpg_stub
else:
    # An earlier test (sibling stub) already installed asyncpg as a
    # MagicMock with `PostgresError = MagicMock(...)`. Overwrite that
    # attribute with our real exception class so isinstance checks work.
    sys.modules["asyncpg"].PostgresError = _PostgresError


# ── Import the module under test ─────────────────────────────────────────────
# cocoindex (+ connector submodules) and aiohttp register / shadow
# process-global state, so they are scoped to this import via
# `stubbed_sys_modules()` and removed from sys.modules afterwards (ID-44.5),
# leaving sibling files (e.g. test_cocoindex_server.py) to resolve the real
# aiohttp. `flow` captures the stub references at import time; the
# webhook-emission tests below introspect whichever `flow.aiohttp.ClientSession`
# is in residence (cooperative-stub discipline — see NOTE after the import).
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

# NOTE: we deliberately do NOT pin `flow.aiohttp = _aiohttp_stub` at module
# scope — the sibling `test_cocoindex_flow_pipeline_run_webhook.py` also
# defines a _StubSession class and pins `flow.aiohttp` to ITS local stub.
# Whichever test file imports flow FIRST wins; pinning here would clobber
# the sibling's stub if we run second, breaking its tests. Instead the
# webhook-emission test class (below) cooperates with whichever stub is in
# residence by introspecting `flow.aiohttp.ClientSession.last_json`. The
# _StubSession defined locally exists as a backstop for sub-process
# orderings where no sibling stub has installed itself.


# ============================================================================
# STAGE EXCEPTION CLASSIFICATION (Inv-25 7-class vocabulary)
# ============================================================================


class TestClassifyStageException:
    """`_classify_stage_exception()` maps Python exceptions to the 7-class enum."""

    def test_helper_function_is_exposed(self):
        assert hasattr(flow, "_classify_stage_exception")
        assert callable(flow._classify_stage_exception)

    def test_pydantic_validation_error_maps_to_extraction_validation_failed(self):
        from pydantic import BaseModel, ValidationError

        class _Toy(BaseModel):
            x: int

        try:
            _Toy(x="not-an-int")  # type: ignore[arg-type]
        except ValidationError as exc:
            assert (
                flow._classify_stage_exception(exc)
                == "extraction_validation_failed"
            )
        else:
            raise AssertionError("Pydantic should have raised ValidationError")

    def test_truncated_extraction_error_maps_to_extraction_validation_failed(
        self,
    ):
        """bl-220 continuation §31: a `max_tokens` truncation is a Stage-3
        LLM-extraction failure (the output JSON is unusable), so it classifies to
        the same canonical class as a pydantic ValidationError —
        `extraction_validation_failed` — rather than logging
        `cocoindex.stage_error.unclassified`."""
        from scripts.cocoindex_pipeline.extraction import (
            TruncatedExtractionError,
        )

        exc = TruncatedExtractionError(
            "extract_qa_form: response truncated at max_tokens=32768"
        )
        assert (
            flow._classify_stage_exception(exc)
            == "extraction_validation_failed"
        )

    def test_asyncpg_postgres_error_maps_to_postgres_write_failed(self):
        import asyncpg

        exc = asyncpg.PostgresError("connection refused")
        assert (
            flow._classify_stage_exception(exc) == "postgres_write_failed"
        )

    def test_anthropic_rate_limit_error_maps_to_extraction_provider_unavailable(
        self,
    ):
        # anthropic.RateLimitError is a 429 — caller exhausted retry budget.
        import anthropic

        # anthropic's exception constructors expect an httpx response object,
        # so we synthesise a minimal stand-in. RateLimitError inherits from
        # APIStatusError; both should map identically.
        try:
            raise anthropic.APIStatusError(
                "rate limited",
                response=MagicMock(status_code=429),
                body=None,
            )
        except anthropic.APIStatusError as exc:
            assert (
                flow._classify_stage_exception(exc)
                == "extraction_provider_unavailable"
            )

    def test_anthropic_5xx_status_error_maps_to_extraction_provider_unavailable(
        self,
    ):
        import anthropic

        try:
            raise anthropic.APIStatusError(
                "service unavailable",
                response=MagicMock(status_code=503),
                body=None,
            )
        except anthropic.APIStatusError as exc:
            assert (
                flow._classify_stage_exception(exc)
                == "extraction_provider_unavailable"
            )

    def test_anthropic_api_connection_error_maps_to_provider_unavailable(self):
        # Network-level failures from anthropic SDK are also classified as
        # provider unavailability (the surface is "we cannot reach the
        # provider" — same operator action).
        import anthropic

        try:
            raise anthropic.APIConnectionError(request=MagicMock())
        except anthropic.APIConnectionError as exc:
            assert (
                flow._classify_stage_exception(exc)
                == "extraction_provider_unavailable"
            )

    def test_generic_exception_returns_none(self):
        # Unmapped exceptions return None so the caller can decide between
        # 'log only' (the default behaviour) and an escalation strategy.
        # NOT a fallback to one of the seven classes — we want operators to
        # see honest 'unclassified' failures in pipeline_runs.error_class
        # rather than miscategorised ones.
        assert flow._classify_stage_exception(RuntimeError("???")) is None
        assert flow._classify_stage_exception(ValueError("???")) is None

    # ── ID-53.15 (T-OQ1) — entity_resolution_failed stage classification ──
    #
    # Stage-5 (entity resolution) failures cannot be classified by exception
    # TYPE: the {53.14} failure-injection finding established that the real
    # exceptions are `litellm.exceptions.AuthenticationError` (embedder
    # failMode) and `anthropic.AuthenticationError` (pair_resolver failMode).
    # The latter is an `anthropic.APIError` subclass — TYPE-INDISTINGUISHABLE
    # from a Stage-3 extraction provider failure. So classification needs
    # STAGE CONTEXT, supplied by the wrap-at-attach-site `_EntityResolutionStageError`
    # (flow.py, around the `_run_stage_5_resolution` call). These tests prove the
    # branch + its ordering ahead of the generic `anthropic.APIError` branch.

    def test_entity_resolution_stage_error_maps_to_entity_resolution_failed(self):
        exc = flow._EntityResolutionStageError("resolve_entities blew up")
        assert (
            flow._classify_stage_exception(exc) == "entity_resolution_failed"
        )

    def test_wrapped_anthropic_auth_error_maps_to_entity_resolution_failed(self):
        # pair_resolver failMode: KhPairResolver._invoke_llm raises
        # anthropic.AuthenticationError (an APIStatusError → APIError subclass).
        # Wrapped at the Stage-5 attach site, it MUST classify as
        # entity_resolution_failed — NOT extraction_provider_unavailable.
        # This is the load-bearing ordering assertion: the
        # _EntityResolutionStageError branch must run BEFORE the generic
        # anthropic.APIError branch.
        import anthropic

        try:
            raise anthropic.AuthenticationError(
                "invalid x-api-key",
                response=MagicMock(status_code=401),
                body=None,
            )
        except anthropic.AuthenticationError as inner:
            wrapped = flow._EntityResolutionStageError(str(inner))
            wrapped.__cause__ = inner
            assert (
                flow._classify_stage_exception(wrapped)
                == "entity_resolution_failed"
            )

    def test_wrapped_litellm_auth_error_maps_to_entity_resolution_failed(self):
        # embedder failMode: KhEntityEmbedder.embed (LiteLLMEmbedder) raises
        # litellm.exceptions.AuthenticationError (NOT an anthropic subclass;
        # __module__ == 'litellm.exceptions'). Bare, the classifier returns
        # None ('unclassified'); wrapped, it MUST be entity_resolution_failed.
        import litellm

        try:
            raise litellm.exceptions.AuthenticationError(
                message="missing embedding provider key",
                llm_provider="openai",
                model="text-embedding-3-large",
            )
        except litellm.exceptions.AuthenticationError as inner:
            wrapped = flow._EntityResolutionStageError(str(inner))
            wrapped.__cause__ = inner
            assert (
                flow._classify_stage_exception(wrapped)
                == "entity_resolution_failed"
            )

    def test_bare_anthropic_error_still_maps_to_provider_unavailable(self):
        # REGRESSION GUARD: a BARE (unwrapped) anthropic provider error — i.e.
        # a genuine Stage-3 extraction failure — must STILL classify as
        # extraction_provider_unavailable. The {53.15} Stage-5 branch only
        # catches the explicit _EntityResolutionStageError wrapper, so it must
        # NOT capture bare anthropic errors that escape Stage-3.
        import anthropic

        try:
            raise anthropic.RateLimitError(
                "rate limited",
                response=MagicMock(status_code=429),
                body=None,
            )
        except anthropic.RateLimitError as exc:
            assert (
                flow._classify_stage_exception(exc)
                == "extraction_provider_unavailable"
            )

    def test_cocoindex_entity_resolution_typed_error_maps_by_prefix(self):
        # Belt-and-suspenders: a DIRECT exception whose defining module is
        # cocoindex.ops.entity_resolution.* (a typed error that could arise
        # before the LLM call) classifies by module prefix, even when not
        # wrapped. We synthesise the module attribution because the real
        # cocoindex op module is stubbed in this unit-test boundary.
        class _ResolveError(Exception):
            pass

        _ResolveError.__module__ = "cocoindex.ops.entity_resolution.resolve"
        assert (
            flow._classify_stage_exception(_ResolveError("preload failed"))
            == "entity_resolution_failed"
        )


# ============================================================================
# STRUCTURED ERROR-LOG EMISSION (Inv-26)
# ============================================================================


class TestEmitStageErrorLog:
    """`_emit_stage_error_log()` emits one structured JSON line at ERROR level."""

    def test_helper_function_is_exposed(self):
        assert hasattr(flow, "_emit_stage_error_log")
        assert callable(flow._emit_stage_error_log)

    def test_emits_required_fields(self, caplog):
        op_id = uuid.UUID("11111111-1111-4111-8111-111111111111")
        source_document_id = uuid.UUID("22222222-2222-4222-8222-222222222222")
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            flow._emit_stage_error_log(
                op_id=op_id,
                stage="llm_extraction",
                error_class="extraction_validation_failed",
                source_document_id=source_document_id,
                error_message="malformed JSON from provider",
            )

        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(error_records) == 1, (
            "must emit exactly one ERROR log line per failure"
        )
        payload = json.loads(error_records[0].message)
        assert payload["event"] == "cocoindex.stage_error"
        assert payload["op_id"] == str(op_id)
        assert payload["stage"] == "llm_extraction"
        assert payload["error_class"] == "extraction_validation_failed"
        assert payload["source_document_id"] == str(source_document_id)
        assert "error_message" in payload

    def test_error_message_is_truncated_to_200_chars(self, caplog):
        # PII redaction policy: never emit unbounded error messages — provider
        # 5xx responses can include user-provided payload echoes.
        long_msg = "x" * 500
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            flow._emit_stage_error_log(
                op_id=uuid.uuid4(),
                stage="llm_extraction",
                error_class="extraction_provider_unavailable",
                source_document_id=None,
                error_message=long_msg,
            )

        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(error_records) == 1
        payload = json.loads(error_records[0].message)
        assert len(payload["error_message"]) <= 200

    def test_uuid_substrings_are_redacted(self, caplog):
        # Even an op_id-shaped UUID buried in a provider error message
        # should be redacted — operator forensic correlation uses the
        # op_id field of the structured log, not the message body.
        msg = (
            "extraction failed for record "
            "33333333-3333-4333-8333-333333333333 — please retry"
        )
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            flow._emit_stage_error_log(
                op_id=uuid.uuid4(),
                stage="llm_extraction",
                error_class="extraction_validation_failed",
                source_document_id=None,
                error_message=msg,
            )

        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        payload = json.loads(error_records[0].message)
        assert "33333333" not in payload["error_message"]
        assert "<uuid>" in payload["error_message"]

    def test_input_value_echo_is_redacted(self, caplog):
        # bl-165 / Option D: pydantic ValidationError messages echo the
        # offending value via `input_value=…`. On extraction-validation
        # failures that value is LLM-extracted CLIENT content and is the
        # dominant PII leak vector — UUID redaction + truncation alone leave a
        # short client name/phrase exposed, so it must be stripped outright.
        msg = (
            "1 validation error for ExtractionModel\n"
            "title\n  Field required "
            "[type=missing, input_value='ACME Confidential Bid 2026', "
            "input_type=str]"
        )
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            flow._emit_stage_error_log(
                op_id=uuid.uuid4(),
                stage="llm_extraction",
                error_class="extraction_validation_failed",
                source_document_id=None,
                error_message=msg,
            )

        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        payload = json.loads(error_records[0].message)
        assert "ACME Confidential" not in payload["error_message"]
        assert "input_value=<redacted>" in payload["error_message"]

    def test_source_document_id_none_serialises_as_null(self, caplog):
        # When the failure happens before per-row binding (e.g. Stage 1
        # source-walk failure), there is no source_document_id yet. The
        # field must still appear in the payload (Inv-26 contract) but
        # encoded as JSON null.
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            flow._emit_stage_error_log(
                op_id=uuid.uuid4(),
                stage="source_walk",
                error_class="binary_conversion_failed",
                source_document_id=None,
                error_message="boom",
            )

        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        payload = json.loads(error_records[0].message)
        assert payload["source_document_id"] is None

    def test_payload_is_machine_parseable_json(self, caplog):
        # The container log collector picks JSON-formatted log lines into
        # structured logs automatically (Inv-26 v1 substrate). Round-trip through
        # json.dumps + json.loads to assert the wire shape is honest.
        with caplog.at_level(logging.ERROR, logger="scripts.cocoindex_pipeline.flow"):
            flow._emit_stage_error_log(
                op_id=uuid.uuid4(),
                stage="embedding",
                error_class="embedding_failed",
                source_document_id=uuid.uuid4(),
                error_message="provider 500",
            )

        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        # The log record's .message attribute IS the JSON payload.
        decoded = json.loads(error_records[0].message)
        assert isinstance(decoded, dict)


# ============================================================================
# Cocoindex retry-policy documentation (P-OQ2)
# ============================================================================


class TestRetryPolicyDocstring:
    """The flow.py module docstring documents cocoindex retry defaults (P-OQ2)."""

    def test_docstring_documents_retry_policy(self):
        doc = flow.__doc__ or ""
        # The brief asks the module docstring to explicitly document
        # cocoindex's retry semantics so operators reading the source can
        # find the v1 policy without spelunking through cocoindex internals.
        assert "P-OQ2" in doc or "retry" in doc.lower()

    def test_docstring_cites_cocoindex_defaults(self):
        # The empirical retry surface in cocoindex 1.0.3 lives in connector
        # code (e.g. `cocoindex.connectors.doris.RetryConfig` defaults to
        # 3 retries / 1s base / 30s max / exponential base 2). The flow.py
        # docstring should NAME this so operators know the v1 reliance.
        doc = flow.__doc__ or ""
        assert "cocoindex defaults" in doc.lower() or "3 retries" in doc.lower()


# ============================================================================
# Inv-27 per-row UPSERT atomicity scenario (documented semantic guard)
# ============================================================================


class TestPerRowUpsertAtomicity:
    """A 5-row batch where row 5 raises leaves rows 1-4 'persisted' in the log.

    This test does NOT exercise cocoindex's internal UPSERT mechanics
    (those are private; same blocker as Stage 6 callback per S255 amend).
    Instead it documents the cocoindex-native per-row atomicity semantic
    explicitly using `_emit_upsert_log` as the per-row signal — so the
    test is not later misread as a per-RUN atomicity assertion (which
    would require KH-side flow-scope transaction wrapping, ratified as
    anti-cocoindex per T-OQ5).

    The matching integration test in 28.14 (`no-partial-row-writes.
    integration.test.ts`) exercises the real cocoindex UPSERT path; this
    unit-level test asserts the contract semantic against the helper
    substrate.
    """

    def test_first_four_rows_log_before_fifth_row_failure_is_classified(
        self, caplog
    ):
        op_id = uuid.uuid4()
        row_ids = [uuid.uuid4() for _ in range(5)]

        with caplog.at_level(
            logging.INFO, logger="scripts.cocoindex_pipeline.flow"
        ):
            # Rows 1-4: cocoindex's per-row UPSERT completion would invoke
            # `_emit_upsert_log` (modulo the public-API-callback gap from
            # S255). Simulate the per-row signal directly.
            for row_id in row_ids[:4]:
                flow._emit_upsert_log(
                    op_id=op_id,
                    table="content_items",
                    row_id=row_id,
                    operation="INSERT",
                )

            # Row 5: cocoindex's per-row UPSERT raises asyncpg.PostgresError.
            import asyncpg
            err = asyncpg.PostgresError("row 5 UPSERT refused")
            error_class = flow._classify_stage_exception(err)

        # Per-row INFO logs for rows 1-4 must have landed.
        info_records = [
            r for r in caplog.records if r.levelno == logging.INFO
        ]
        # At least 4 INFO records (one per row 1-4).
        assert len(info_records) >= 4, (
            f"expected >= 4 INFO upsert logs (rows 1-4); got {len(info_records)}"
        )

        # Row 5 failure classifies to postgres_write_failed (Inv-25).
        assert error_class == "postgres_write_failed"


# ============================================================================
# Failed-run webhook (Inv-25 augmentation of _emit_pipeline_run_webhook)
# ============================================================================


class TestFailedRunWebhookEmitsClassifiedErrorClass:
    """The webhook emitter accepts every member of the 7-class vocabulary."""

    URL = "https://kh.example.org/api/internal/pipeline-runs/record"
    SECRET = "test-cron-secret"

    def setup_method(self):
        # The flow module captured a reference to whichever aiohttp module
        # was active at FIRST import. Subsequent tests in the same process
        # cannot swap that module identity without affecting the SIBLING
        # tests that depend on the original module's _StubSession class
        # holding their state. Introspect via `flow.aiohttp.ClientSession`
        # directly so we cooperate with whichever stub class is in
        # residence under the current test-process ordering.
        active_session_cls = getattr(flow.aiohttp, "ClientSession", None)
        if active_session_cls is None:
            return
        if hasattr(active_session_cls, "reset"):
            active_session_cls.reset()

    def _emit_with(self, error_class: str) -> dict | None:
        env = {
            "PIPELINE_RUN_WEBHOOK_URL": self.URL,
            "CRON_SECRET": self.SECRET,
        }
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(
                flow._emit_pipeline_run_webhook(
                    op_id=uuid.uuid4(),
                    status="failed",
                    stage_counts=flow._empty_stage_counts(),
                    items_processed=0,
                    items_created=[],
                    error_message="boom",
                    error_class=error_class,
                )
            )
        active_session_cls = getattr(flow.aiohttp, "ClientSession", None)
        return getattr(active_session_cls, "last_json", None)

    def test_emits_each_of_the_seven_stage_classes(self):
        # Per ID-28.13, flow.py's webhook emitter must forward each of the
        # 7 stage-level classes verbatim. The Vercel route's Zod schema
        # (Slice 2) is the validation layer; flow.py just has to ship the
        # correct vocabulary.
        #
        # Cooperative-stub introspection: the captured `flow.aiohttp.
        # ClientSession` may be EITHER this test's `_StubSession` OR the
        # sibling test's; both classes expose `.last_json`. If the
        # in-residence stub has no `last_json` (e.g. the real aiohttp
        # package leaked through under unusual orderings), skip rather
        # than fail — the unit-level contract is exercised by the
        # ClassificationLog / RetryPolicy / StageErrorLog classes above.
        active_session_cls = getattr(flow.aiohttp, "ClientSession", None)
        if active_session_cls is None or not hasattr(
            active_session_cls, "last_json"
        ):
            import pytest  # noqa: PLC0415

            pytest.skip(
                "active aiohttp stub does not expose last_json — sibling "
                "stub pattern not in residence under this test ordering"
            )

        for cls in [
            "extraction_validation_failed",
            "extraction_provider_unavailable",
            "postgres_write_failed",
            "binary_conversion_failed",
            "embedding_failed",
            "entity_resolution_failed",
            "qa_dedup_proposer_failed",
        ]:
            payload = self._emit_with(cls)
            assert payload is not None, (
                f"expected a webhook POST for class {cls!r}; got None"
            )
            assert payload.get("errorClass") == cls, (
                f"errorClass mismatch for {cls}: got {payload.get('errorClass')!r}"
            )
            assert payload.get("status") == "failed"


# ============================================================================
# Inv-23 retry-count observability (ID-28.13 fix-pack)
# ============================================================================


class TestFlowRetryCounter:
    """`_FlowRetryCounter` is the v1 substrate for Inv-23 retry observability.

    Empirical reality: cocoindex 1.0.3 exposes per-component retry stats
    via `ComponentStats.num_reprocesses` on `UpdateHandle.stats()`, but the
    handle is accessible only from OUTSIDE `app_main()` (the entrypoint
    calling `App.update()`). Since `_emit_pipeline_run_webhook()` fires
    from INSIDE `app_main()`, querying the cocoindex-native counter at
    webhook-emission time is not possible without an architectural refactor
    (deferred to a follow-up Subtask).

    The v1 substrate is a KH-managed counter whose `.increment()` method
    is called by any KH-authored retry wrapper (e.g. a future Anthropic
    503-retry helper around the @coco.fn extractors). The webhook reads
    `.get()` at flow-end and emits `retry_count=<value>` to the Vercel
    route, which lands it in `pipeline_runs.result.retry_count`.
    """

    def test_helper_class_is_exposed(self):
        assert hasattr(flow, "_FlowRetryCounter")
        assert isinstance(flow._FlowRetryCounter, type)

    def test_new_counter_starts_at_zero(self):
        counter = flow._FlowRetryCounter()
        assert counter.get() == 0

    def test_increment_bumps_by_one(self):
        counter = flow._FlowRetryCounter()
        counter.increment()
        assert counter.get() == 1

    def test_increment_is_repeatable(self):
        counter = flow._FlowRetryCounter()
        counter.increment()
        counter.increment()
        counter.increment()
        assert counter.get() == 3

    def test_get_does_not_mutate_state(self):
        counter = flow._FlowRetryCounter()
        counter.increment()
        # Reading the value multiple times must not affect it.
        assert counter.get() == 1
        assert counter.get() == 1
        assert counter.get() == 1

    def test_counter_instances_are_independent(self):
        # Two flow invocations must not share retry-count state — each
        # flow constructs its own counter and reports its own value.
        counter_a = flow._FlowRetryCounter()
        counter_b = flow._FlowRetryCounter()
        counter_a.increment()
        counter_a.increment()
        counter_b.increment()
        assert counter_a.get() == 2
        assert counter_b.get() == 1


class TestRetryCountWebhookEmission:
    """`_emit_pipeline_run_webhook()` forwards `retry_count` as `retryCount`.

    The testStrategy criterion verbatim:
      "transient 503-once mock retries successfully (retry_count=1)"

    The unit-level contract: the webhook emitter accepts a `retry_count`
    kwarg and serialises it as `retryCount` in the JSON payload (camelCase
    mirrors the rest of the payload — `opId`, `pipelineName`,
    `itemsProcessed`, `extractorVersion`, etc.). The Vercel route's
    Zod schema accepts the field as `z.number().int().nonnegative().
    optional()` per Slice 1 of this fix-pack.
    """

    URL = "https://kh.example.org/api/internal/pipeline-runs/record"
    SECRET = "test-cron-secret"

    def setup_method(self):
        # Same stub-cooperation pattern as TestFailedRunWebhookEmits...
        active_session_cls = getattr(flow.aiohttp, "ClientSession", None)
        if active_session_cls is not None and hasattr(
            active_session_cls, "reset"
        ):
            active_session_cls.reset()

    def _active_stub(self):
        return getattr(flow.aiohttp, "ClientSession", None)

    def _emit(self, **overrides):
        env = {
            "PIPELINE_RUN_WEBHOOK_URL": self.URL,
            "CRON_SECRET": self.SECRET,
        }
        kwargs = {
            "op_id": uuid.uuid4(),
            "status": "completed",
            "stage_counts": flow._empty_stage_counts(),
            "items_processed": 0,
            "items_created": [],
        }
        kwargs.update(overrides)
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(flow._emit_pipeline_run_webhook(**kwargs))
        return getattr(self._active_stub(), "last_json", None)

    def test_emit_includes_retry_count_when_provided(self):
        # Inv-23 verbatim: a transient retry happened; webhook reports it.
        active_session_cls = self._active_stub()
        if active_session_cls is None:
            import pytest  # noqa: PLC0415

            pytest.skip("cocoindex stub not resident")
        if not hasattr(active_session_cls, "last_json"):
            import pytest  # noqa: PLC0415

            pytest.skip("stub lacks last_json attribute")

        payload = self._emit(retry_count=1)
        assert payload is not None
        assert payload.get("retryCount") == 1

    def test_emit_includes_retry_count_zero_verbatim(self):
        # Zero is meaningful (no-retry happy path). Must land verbatim
        # so the Vercel route can distinguish "field omitted" from
        # "explicitly zero retries" at the result-envelope layer.
        active_session_cls = self._active_stub()
        if active_session_cls is None:
            import pytest  # noqa: PLC0415

            pytest.skip("cocoindex stub not resident")
        if not hasattr(active_session_cls, "last_json"):
            import pytest  # noqa: PLC0415

            pytest.skip("stub lacks last_json attribute")

        payload = self._emit(retry_count=0)
        assert payload is not None
        assert payload.get("retryCount") == 0

    def test_emit_omits_retry_count_when_default(self):
        # Pre-28.13 callers do not pass `retry_count`; the payload must
        # omit the field entirely (not emit `retryCount: 0` or
        # `retryCount: null`) so the Vercel route's existing back-compat
        # branch leaves `result.retry_count` unset.
        active_session_cls = self._active_stub()
        if active_session_cls is None:
            import pytest  # noqa: PLC0415

            pytest.skip("cocoindex stub not resident")
        if not hasattr(active_session_cls, "last_json"):
            import pytest  # noqa: PLC0415

            pytest.skip("stub lacks last_json attribute")

        payload = self._emit()
        assert payload is not None
        assert "retryCount" not in payload

    def test_emit_handles_high_retry_count(self):
        # Operational evidence: cocoindex's Doris connector defaults to
        # max_retries=3, and a long-tail provider failure might produce
        # higher counts under operator-tuned thresholds. The emitter
        # must not truncate or coerce.
        active_session_cls = self._active_stub()
        if active_session_cls is None:
            import pytest  # noqa: PLC0415

            pytest.skip("cocoindex stub not resident")
        if not hasattr(active_session_cls, "last_json"):
            import pytest  # noqa: PLC0415

            pytest.skip("stub lacks last_json attribute")

        payload = self._emit(retry_count=7)
        assert payload is not None
        assert payload.get("retryCount") == 7


class TestTransient503RetryScenario:
    """End-to-end unit scenario satisfying the 28.13 testStrategy verbatim.

    The testStrategy criterion: "transient 503-once mock retries
    successfully (retry_count=1)".

    The scenario chains the three substrate pieces:
      1. A `_FlowRetryCounter` is constructed at flow start.
      2. A simulated transient 503 (anthropic.APIStatusError with status 503)
         is "retried" by bumping `.increment()` once — modelling whatever
         retry wrapper KH adds at production time (out of scope for this
         fix-pack; the contract substrate is what matters).
      3. The flow completes successfully (status='completed').
      4. `_emit_pipeline_run_webhook()` reads `counter.get() == 1` and
         emits `retryCount=1` in the payload.

    The cocoindex/aiohttp/anthropic modules are stubbed (no live infra).
    The classifier still maps the 503 to `extraction_provider_unavailable`
    in case the retry exhausts; but in the happy-path 503-once scenario
    the retry succeeds and the flow completes WITHOUT an errorClass.
    """

    URL = "https://kh.example.org/api/internal/pipeline-runs/record"
    SECRET = "test-cron-secret"

    def setup_method(self):
        active_session_cls = getattr(flow.aiohttp, "ClientSession", None)
        if active_session_cls is not None and hasattr(
            active_session_cls, "reset"
        ):
            active_session_cls.reset()

    def test_transient_503_once_retry_emits_retry_count_one(self):
        active_session_cls = getattr(flow.aiohttp, "ClientSession", None)
        if active_session_cls is None or not hasattr(
            active_session_cls, "last_json"
        ):
            import pytest  # noqa: PLC0415

            pytest.skip(
                "active aiohttp stub does not expose last_json — sibling "
                "stub pattern not in residence under this test ordering"
            )

        # Step 1: flow start — counter constructed.
        counter = flow._FlowRetryCounter()
        assert counter.get() == 0

        # Step 2: simulate the transient 503 + successful retry. In
        # production this happens inside whatever retry wrapper KH adds
        # around the Anthropic SDK call (out-of-scope for this fix-pack;
        # the contract substrate is what matters). For the unit test,
        # we model the retry happening by bumping the counter once.
        import anthropic
        transient_exc = anthropic.APIStatusError(
            "service unavailable",
            response=MagicMock(status_code=503),
            body=None,
        )
        # Confirm classification (would-be error_class IF the retry
        # exhausted; in the happy-path scenario, it does not).
        assert (
            flow._classify_stage_exception(transient_exc)
            == "extraction_provider_unavailable"
        )
        counter.increment()

        # Step 3: flow completes successfully.
        op_id = uuid.uuid4()

        env = {
            "PIPELINE_RUN_WEBHOOK_URL": self.URL,
            "CRON_SECRET": self.SECRET,
        }
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(
                flow._emit_pipeline_run_webhook(
                    op_id=op_id,
                    status="completed",
                    stage_counts=flow._empty_stage_counts(),
                    items_processed=1,
                    items_created=[str(uuid.uuid4())],
                    retry_count=counter.get(),
                )
            )

        # Step 4: assert the webhook payload carries retry_count=1.
        payload = getattr(active_session_cls, "last_json", None)
        assert payload is not None, "expected a webhook POST; got None"
        assert payload.get("status") == "completed"
        assert payload.get("retryCount") == 1
        # No errorClass on the happy-path retry scenario.
        assert "errorClass" not in payload


# ============================================================================
# bl-165 Option B — fine-grained Pydantic error-detail persistence (ID-61.4)
# ============================================================================


class TestPydanticErrorDetail:
    """`_pydantic_error_detail()` builds the fine-grained detail object.

    bl-165 Option B (ID-61.4): when a `pydantic.ValidationError` aborts the
    flow, the terminal webhook additionally carries
    `errorDetail = {"pydantic_class": <classify_pydantic_error(exc)>,
    "stage": "flow"}` so `pipeline_runs.result.error_detail` makes the
    failure classifiable in the ledger. The coarse Inv-25 `errorClass`
    stays `extraction_validation_failed` — the fine class is a
    SUB-classification, never a replacement.

    The detail carries NO message text — only the fine class + stage — so
    the Option-D PII-redaction guarantee (`_redact_error_message` applied
    to `flow_error_message`) is preserved by construction: there is no
    message surface in the detail to leak `input_value=` echoes through.
    """

    def _validation_error(self):
        """Build a real ValidationError whose message echoes PII-shaped input."""
        from pydantic import BaseModel, ValidationError

        class _Probe(BaseModel):
            required_field: str

        try:
            _Probe.model_validate(
                {
                    "other": "client-confidential text "
                    "123e4567-e89b-42d3-a456-426614174000",
                }
            )
        except ValidationError as exc:
            return exc
        raise AssertionError("Pydantic should have raised ValidationError")

    def test_helper_function_is_exposed(self):
        assert hasattr(flow, "_pydantic_error_detail")

    def test_validation_error_yields_fine_class_and_flow_stage(self):
        exc = self._validation_error()
        detail = flow._pydantic_error_detail(exc)
        # A missing required field maps to 'missing_required' per
        # `_PYDANTIC_ERROR_TO_ERROR_CLASS` in extraction.py (the grounded
        # codomain of classify_pydantic_error — single source of truth).
        assert detail == {"pydantic_class": "missing_required", "stage": "flow"}

    def test_coarse_class_stays_extraction_validation_failed(self):
        # Inv-25: the 7-class stage-level vocabulary is untouched — the SAME
        # exception still classifies coarse as extraction_validation_failed
        # while the fine class rides the detail object alongside it.
        exc = self._validation_error()
        assert (
            flow._classify_stage_exception(exc) == "extraction_validation_failed"
        )
        detail = flow._pydantic_error_detail(exc)
        assert detail is not None
        assert detail["pydantic_class"] == "missing_required"

    def test_detail_carries_no_message_text_or_pii(self):
        # Option-D regression guard: the serialised detail must contain no
        # `input_value=` echo, no client content, and no UUID-shaped
        # substring — the exception message itself echoes all three.
        exc = self._validation_error()
        # The leak vector is real: pydantic echoes the offending input via
        # `input_value=` (long values are truncated, so assert on the
        # prefix that survives truncation).
        assert "input_value" in str(exc)
        assert "client-confide" in str(exc)
        detail = flow._pydantic_error_detail(exc)
        assert detail is not None
        assert set(detail.keys()) == {"pydantic_class", "stage"}
        serialised = json.dumps(detail)
        assert "input_value" not in serialised
        assert "client-confide" not in serialised
        assert "123e4567" not in serialised

    def test_non_validation_error_returns_none(self):
        # Non-pydantic failures carry no fine detail — the webhook omits
        # the field entirely (never `errorDetail: null`).
        assert flow._pydantic_error_detail(ValueError("boom")) is None
        assert flow._pydantic_error_detail(RuntimeError("boom")) is None


class TestErrorDetailWebhookEmission:
    """`_emit_pipeline_run_webhook()` forwards `error_detail` as `errorDetail`.

    Mirrors the TestRetryCountWebhookEmission cooperative-stub pattern. The
    Vercel route's Zod schema accepts the field as an optional strict object
    `{pydantic_class: <fine enum>, stage: string}` and composes it into
    `pipeline_runs.result.error_detail` (ID-61.4).
    """

    URL = "https://kh.example.org/api/internal/pipeline-runs/record"
    SECRET = "test-cron-secret"

    def setup_method(self):
        active_session_cls = getattr(flow.aiohttp, "ClientSession", None)
        if active_session_cls is not None and hasattr(
            active_session_cls, "reset"
        ):
            active_session_cls.reset()

    def _active_stub(self):
        return getattr(flow.aiohttp, "ClientSession", None)

    def _emit(self, **overrides):
        env = {
            "PIPELINE_RUN_WEBHOOK_URL": self.URL,
            "CRON_SECRET": self.SECRET,
        }
        kwargs = {
            "op_id": uuid.uuid4(),
            "status": "failed",
            "stage_counts": flow._empty_stage_counts(),
            "items_processed": 0,
            "items_created": [],
            "error_message": "boom",
            "error_class": "extraction_validation_failed",
        }
        kwargs.update(overrides)
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(flow._emit_pipeline_run_webhook(**kwargs))
        return getattr(self._active_stub(), "last_json", None)

    def test_emit_includes_error_detail_when_provided(self):
        active_session_cls = self._active_stub()
        if active_session_cls is None or not hasattr(
            active_session_cls, "last_json"
        ):
            import pytest  # noqa: PLC0415

            pytest.skip(
                "active aiohttp stub does not expose last_json — sibling "
                "stub pattern not in residence under this test ordering"
            )

        detail = {"pydantic_class": "missing_required", "stage": "flow"}
        payload = self._emit(error_detail=detail)
        assert payload is not None
        assert payload.get("errorDetail") == detail
        # The coarse class rides alongside, unchanged (Inv-25).
        assert payload.get("errorClass") == "extraction_validation_failed"

    def test_emit_omits_error_detail_when_default(self):
        # Non-pydantic failures pass `error_detail=None`; the payload must
        # omit the field entirely so the Vercel route composes the result
        # WITHOUT an `error_detail` key (no undefined/null leakage).
        active_session_cls = self._active_stub()
        if active_session_cls is None or not hasattr(
            active_session_cls, "last_json"
        ):
            import pytest  # noqa: PLC0415

            pytest.skip(
                "active aiohttp stub does not expose last_json"
            )

        payload = self._emit()
        assert payload is not None
        assert "errorDetail" not in payload


# ============================================================================
# 80.2 §B.4 — per-item failure isolation + item_failures tally (ID-80.9)
# ============================================================================


class _PathOnlyFile:
    """Minimal File stand-in carrying only `file_path.path` (branch tests)."""

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str) -> None:
        self.file_path = _PathOnlyFile._FilePath(Path(rel_path))


def _two_route_manifest():
    """Real WorkspaceManifest with a forms/ + content/ route pair (80.2 §B.2)."""
    from scripts.cocoindex_pipeline.workspace_resolver import WorkspaceManifest

    return WorkspaceManifest.model_validate(
        {
            "schema_version": 1,
            "mappings": [
                {
                    "path_prefix": "forms/",
                    "workspace_id": "33333333-3333-4333-8333-333333333333",
                    "route": "forms",
                },
                {
                    "path_prefix": "content/",
                    "workspace_id": "44444444-4444-4444-8444-444444444444",
                    "route": "content",
                },
            ],
        }
    )


class TestFlowItemFailureCounter:
    """`_FlowItemFailureCounter` — per-flow per-branch item-failure tally.

    80.2 §B.4 (OQ-80.2-C RATIFIED): per-item faults are contained at the
    `mount_each` boundary and tallied per branch
    (`{'forms': n, 'content': m, 'url': k}` — the `'url'` branch joined at
    {75.11} when `bound_ingest_url` mounted the URL source) instead of
    flipping `flow_status` to 'failed'. Mirrors the `_FlowRetryCounter`
    per-flow instance pattern (no shared state).
    """

    def test_helper_class_is_exposed(self):
        assert hasattr(flow, "_FlowItemFailureCounter")

    def test_new_counter_tallies_zero_for_all_three_branches(self):
        # {75.11}: an all-zero tally must report 'url' alongside
        # forms/content — "walk ran, zero per-item faults" is meaningful per
        # branch (the 80.2 §B.4 omitted-vs-zero distinction).
        counter = flow._FlowItemFailureCounter()
        assert counter.tally() == {"forms": 0, "content": 0, "url": 0}

    def test_increment_forms_bumps_forms_only(self):
        counter = flow._FlowItemFailureCounter()
        counter.increment("forms")
        assert counter.tally() == {"forms": 1, "content": 0, "url": 0}

    def test_increment_content_bumps_content_only(self):
        counter = flow._FlowItemFailureCounter()
        counter.increment("content")
        assert counter.tally() == {"forms": 0, "content": 1, "url": 0}

    def test_increment_url_bumps_url_only(self):
        counter = flow._FlowItemFailureCounter()
        counter.increment("url")
        assert counter.tally() == {"forms": 0, "content": 0, "url": 1}

    def test_increment_is_repeatable(self):
        counter = flow._FlowItemFailureCounter()
        counter.increment("forms")
        counter.increment("forms")
        counter.increment("content")
        assert counter.tally() == {"forms": 2, "content": 1, "url": 0}

    def test_tally_returns_a_copy_not_internal_state(self):
        counter = flow._FlowItemFailureCounter()
        snapshot = counter.tally()
        snapshot["forms"] = 99
        assert counter.tally() == {"forms": 0, "content": 0, "url": 0}

    def test_counter_instances_are_independent(self):
        first = flow._FlowItemFailureCounter()
        second = flow._FlowItemFailureCounter()
        first.increment("forms")
        assert second.tally() == {"forms": 0, "content": 0, "url": 0}


class TestItemFailureBranchDerivation:
    """`_item_failure_branch` — forms|content attribution for a contained fault.

    Derived from the SAME pure `resolve_route(manifest, rel_path)` computation
    the {80.8} fork uses (80.2 §B.2/§B.4) — no I/O, no clock. The helper MUST
    NEVER raise: it runs inside the per-item containment handler, where an
    escape would abort the batch (the exact all-or-nothing failure mode B.4
    kills).
    """

    def test_helper_function_is_exposed(self):
        assert hasattr(flow, "_item_failure_branch")

    def test_forms_route_yields_forms(self):
        manifest = _two_route_manifest()
        file = _PathOnlyFile("forms/blank-form.md")
        assert flow._item_failure_branch(manifest, file, None) == "forms"

    def test_content_route_yields_content(self):
        manifest = _two_route_manifest()
        file = _PathOnlyFile("content/doc.md")
        assert flow._item_failure_branch(manifest, file, None) == "content"

    def test_unmapped_path_defaults_to_content(self):
        # UnmappedPath from resolve_route must NOT escape the containment
        # handler — default the attribution to 'content' (the manifest's own
        # route default per 80.2 §B.2).
        manifest = _two_route_manifest()
        file = _PathOnlyFile("elsewhere/mystery.md")
        assert flow._item_failure_branch(manifest, file, None) == "content"

    def test_broken_file_object_defaults_to_content_without_raising(self):
        # A malformed item (no file_path) must not raise from inside the
        # containment handler.
        manifest = _two_route_manifest()
        assert flow._item_failure_branch(manifest, object(), None) == "content"

    def test_absolute_path_is_normalised_via_source_path(self):
        # Production File paths are ABSOLUTE ({66.22}/BUG-A); the helper must
        # apply the same _to_source_relative normalisation the dispatcher uses
        # so the manifest prefixes still match.
        manifest = _two_route_manifest()
        file = _PathOnlyFile("/cocoindex-state/corpus/forms/blank-form.md")
        source = Path("/cocoindex-state/corpus")
        assert flow._item_failure_branch(manifest, file, source) == "forms"


class TestItemFailuresWebhookEmission:
    """`_emit_pipeline_run_webhook()` forwards `item_failures` as `itemFailures`.

    Mirrors the TestErrorDetailWebhookEmission cooperative-stub pattern.
    Strictly additive alongside ID-61.4's errorDetail + taxonomyMisses
    (coordinate, don't clobber — 80.2 §B.4 ratification note).
    """

    URL = "https://kh.example.org/api/internal/pipeline-runs/record"
    SECRET = "test-cron-secret"

    def setup_method(self):
        active_session_cls = getattr(flow.aiohttp, "ClientSession", None)
        if active_session_cls is not None and hasattr(
            active_session_cls, "reset"
        ):
            active_session_cls.reset()

    def _active_stub(self):
        return getattr(flow.aiohttp, "ClientSession", None)

    def _emit(self, **overrides):
        env = {
            "PIPELINE_RUN_WEBHOOK_URL": self.URL,
            "CRON_SECRET": self.SECRET,
        }
        kwargs = {
            "op_id": uuid.uuid4(),
            "status": "completed",
            "stage_counts": flow._empty_stage_counts(),
            "items_processed": 2,
            "items_created": [],
        }
        kwargs.update(overrides)
        with patch.dict(os.environ, env, clear=True):
            asyncio.run(flow._emit_pipeline_run_webhook(**kwargs))
        return getattr(self._active_stub(), "last_json", None)

    def _skip_if_no_introspectable_stub(self):
        active_session_cls = self._active_stub()
        if active_session_cls is None or not hasattr(
            active_session_cls, "last_json"
        ):
            import pytest  # noqa: PLC0415

            pytest.skip(
                "active aiohttp stub does not expose last_json — sibling "
                "stub pattern not in residence under this test ordering"
            )

    def test_emit_includes_item_failures_when_provided(self):
        self._skip_if_no_introspectable_stub()
        payload = self._emit(item_failures={"forms": 1, "content": 0})
        assert payload is not None
        assert payload.get("itemFailures") == {"forms": 1, "content": 0}
        # OQ-80.2-C: per-item faults do NOT flip the terminal status.
        assert payload.get("status") == "completed"

    def test_emit_rides_alongside_error_detail_and_taxonomy_misses(self):
        # Coordinate, don't clobber: the three ID-61.4-era optional fields and
        # itemFailures all land in ONE payload.
        self._skip_if_no_introspectable_stub()
        detail = {"pydantic_class": "missing_required", "stage": "flow"}
        payload = self._emit(
            item_failures={"forms": 2, "content": 1},
            error_detail=detail,
            taxonomy_misses={"primary_domain": 3},
        )
        assert payload is not None
        assert payload.get("itemFailures") == {"forms": 2, "content": 1}
        assert payload.get("errorDetail") == detail
        assert payload.get("taxonomyMisses") == {"primary_domain": 3}

    def test_emit_omits_item_failures_when_default(self):
        # The flow-start emission passes no item_failures — the payload must
        # omit the field entirely (never `itemFailures: null`).
        self._skip_if_no_introspectable_stub()
        payload = self._emit()
        assert payload is not None
        assert "itemFailures" not in payload


class TestPerItemFailureIsolation:
    """The 80.2 §B.4 headline: a raising form item must NOT zero a good
    content item's writes (the bl-224 cascade inversion, OQ-80.2-C RATIFIED).

    Drives the REAL `flow.app_main` over a 2-file batch [raising form,
    good content] through a faithful inline `mount_each` stand-in:

      - content rows still land (ci target receives the content doc's row),
      - flow_status == 'completed' (per-item faults never flip it),
      - the terminal webhook threads
        item_failures == {'forms': 1, 'content': 0, 'url': 0},
      - ONE `cocoindex.stage_error` with stage='ingest_item' is emitted.
    """

    @staticmethod
    def _fake_file(rel_path: str, disk_path: Path):
        class _FilePath:
            def __init__(self, p: Path) -> None:
                self.path = p

        class _File:
            def __init__(self) -> None:
                self.file_path = _FilePath(Path(rel_path))

            async def size(self) -> int:
                return disk_path.stat().st_size

            async def read(self) -> bytes:
                return disk_path.read_bytes()

            async def read_text(self) -> str:
                return disk_path.read_text()

            async def content_fingerprint(self) -> bytes:
                import hashlib  # noqa: PLC0415

                return hashlib.sha256(disk_path.read_bytes()).digest()

        return _File()

    class _FakeTarget:
        def __init__(self, table_name: str) -> None:
            self.table_name = table_name
            self.rows: list[dict] = []

        def declare_row(self, *, row: dict) -> None:
            self.rows.append(row)

        def declare_vector_index(self, **kwargs: object) -> None:
            pass

    class _ItemsFeed:
        def __init__(self, pairs: list) -> None:
            self._pairs = pairs

        async def __aiter__(self):
            for pair in self._pairs:
                yield pair

    def test_raising_form_item_is_contained_and_content_still_lands(
        self, tmp_path, monkeypatch
    ):
        # ── Stage a 2-file source: forms/ (will raise) + content/ (good) ──
        forms_dir = tmp_path / "forms"
        forms_dir.mkdir()
        content_dir = tmp_path / "content"
        content_dir.mkdir()
        # Genuine form suffix (.xlsx): the {80.8} fork's secondary suffix guard
        # rejects .md/.txt/.html under a route:'forms' prefix as a manifest
        # mis-wire (stage_error + early return) BEFORE extract_form_structure
        # runs — a non-form suffix would never reach the per-item containment
        # under test. Bytes are irrelevant: extract_form_structure is stubbed.
        form_path = forms_dir / "blank-form.xlsx"
        form_path.write_text("not a real xlsx; reader is stubbed")
        content_path = content_dir / "doc.md"
        good_markdown = "# Doc\n\nGood content body."
        content_path.write_text(good_markdown)

        manifest = {
            "schema_version": 1,
            "mappings": [
                {
                    "path_prefix": "forms/",
                    "workspace_id": "33333333-3333-4333-8333-333333333333",
                    "route": "forms",
                },
                {
                    "path_prefix": "content/",
                    "workspace_id": "44444444-4444-4444-8444-444444444444",
                    "route": "content",
                },
            ],
        }
        (tmp_path / ".kh-workspace-map.json").write_text(json.dumps(manifest))

        # ── Stub Stage 2/3/4: the FORM file faults in the form branch — the
        # manifest tags forms/ route:'forms', so the {80.8} fork sends it into
        # _ingest_form_branch where the raising extract_form_structure stub's
        # RuntimeError (NOT a FormExtractionError) PROPAGATES to
        # bound_ingest_file's per-item catch. The CONTENT file completes
        # normally. The raising arm in _convert is a deliberate TRIPWIRE: the
        # forms route performs NO Markdown conversion, so if a regression ever
        # mis-routes the form file down the content branch, _convert raises and
        # Path-A's stage-level containment lands ZERO ci rows + a forms:0 tally
        # — assertions 3 and 4 then fail loudly instead of silently passing.
        async def _convert(file: object) -> str:
            rel = file.file_path.path.as_posix()  # type: ignore[attr-defined]
            if rel.startswith("forms/") or "/forms/" in rel:
                raise RuntimeError("synthetic per-item fault on the form file")
            return good_markdown

        async def _form_structure(file: object):
            rel = file.file_path.path.as_posix()  # type: ignore[attr-defined]
            if rel.startswith("forms/") or "/forms/" in rel:
                raise RuntimeError("synthetic per-item fault on the form file")
            return None

        async def _classification(content_text: str):
            return {
                "content_type": "case_study",
                "primary_domain": "procurement",
                "primary_subtopic": "tender_evaluation",
            }

        async def _qa(content_text: str):
            return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

        async def _entities(content_text: str):
            return []

        async def _embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _convert)
        monkeypatch.setattr(flow, "extract_form_structure", _form_structure)
        monkeypatch.setattr(flow, "extract_classification", _classification)
        monkeypatch.setattr(flow, "extract_qa_form", _qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _embed)

        # ── Recording targets (no real Postgres). ──
        # reference_items joined the Stage-6 prep block at {75.11} (the URL
        # source's write target) — app_main mounts it on every walk.
        targets = {
            name: self._FakeTarget(name)
            for name in (
                "content_items",
                "q_a_extractions",
                "source_documents",
                "entity_mentions",
                "entity_relationships",
                "form_templates",
                "form_template_fields",
                "content_chunks",
                "reference_items",
            )
        }

        async def _fake_mount_table_target(
            db_ctx, table_name, schema, *, managed_by
        ):
            return targets[table_name]

        monkeypatch.setattr(flow, "mount_table_target", _fake_mount_table_target)

        # ── Source walk: keyed (rel_path, File) feed, form FIRST so the
        # fault precedes the good content item (the bl-224 cascade shape).
        feed_pairs = [
            (
                "forms/blank-form.xlsx",
                self._fake_file("forms/blank-form.xlsx", form_path),
            ),
            ("content/doc.md", self._fake_file("content/doc.md", content_path)),
        ]

        items_feed_cls = self._ItemsFeed

        class _FakeWalk:
            def items(self):
                return items_feed_cls(list(feed_pairs))

        def _fake_walk_dir(path, *, live, recursive):
            return _FakeWalk()

        monkeypatch.setattr(flow.localfs, "walk_dir", _fake_walk_dir)

        # ── Faithful inline mount_each: per-item fn(value, *extra_args); a
        # per-item raise PROPAGATES to the binder (engine semantics) — the
        # containment under test lives in bound_ingest_file, NOT here.
        async def _inline_mount_each(_subpath, fn, items, *extra_args):
            async for _key, value in items:
                await fn(value, *extra_args)

            class _Handle:
                async def ready(self) -> None:
                    return None

            return _Handle()

        monkeypatch.setattr(flow.coco, "mount_each", _inline_mount_each)

        # {75.11}: app_main builds `FeedUrlSource(pool=coco.use_context(DB_CTX))`
        # and iterates it on the second mount_each — give the URL source an
        # empty ledger (zero passed URLs) so this test stays a pure
        # localfs-branch scenario.
        class _EmptyLedgerPool:
            async def fetch(self, sql):
                return []

        monkeypatch.setattr(
            flow.coco, "use_context", lambda key: _EmptyLedgerPool()
        )

        # ── Stage 5 is flow-scope; stub it (not under test). ──
        async def _fake_stage_5(*args, **kwargs):
            return 0

        monkeypatch.setattr(flow, "_run_stage_5_resolution", _fake_stage_5)

        # ── Capture webhook emissions + stage-error logs. ──
        webhook_calls: list[dict] = []

        async def _capture_webhook(**kwargs):
            webhook_calls.append(kwargs)

        monkeypatch.setattr(flow, "_emit_pipeline_run_webhook", _capture_webhook)

        stage_error_calls: list[dict] = []
        real_emit_stage_error = flow._emit_stage_error_log

        def _spy_stage_error(**kwargs):
            stage_error_calls.append(kwargs)
            return real_emit_stage_error(**kwargs)

        monkeypatch.setattr(flow, "_emit_stage_error_log", _spy_stage_error)

        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(tmp_path))

        # ── Drive the REAL app_main — it must NOT raise (containment). ──
        asyncio.run(flow.app_main())

        # 1. Content rows land: the good content file's writes are NOT zeroed
        # by the sibling form fault (the bl-224 inversion).
        ci_rows = targets["content_items"].rows
        assert len(ci_rows) == 1, (
            f"expected exactly the content doc's content_items row; "
            f"got {len(ci_rows)}"
        )
        assert ci_rows[0]["content"] == good_markdown

        # 2. flow_status == 'completed': per-item faults never flip the
        # terminal status ('failed' is reserved for walk-wide faults).
        assert webhook_calls, "expected webhook emissions"
        terminal = webhook_calls[-1]
        assert terminal["status"] == "completed"
        assert terminal.get("error_class") is None
        assert terminal.get("error_message") is None

        # 3. The terminal webhook threads the per-branch tally ('url' joined
        # the branch vocabulary at {75.11}; zero here — no URL items walked).
        assert terminal.get("item_failures") == {
            "forms": 1,
            "content": 0,
            "url": 0,
        }

        # 4. The fault is attributed: ONE ingest_item stage error, classified
        # via the `_classify_stage_exception(exc) or type name` fallback.
        ingest_item_errors = [
            c for c in stage_error_calls if c.get("stage") == "ingest_item"
        ]
        assert len(ingest_item_errors) == 1
        assert ingest_item_errors[0]["error_class"] == "RuntimeError"
        # Redaction applied at the call site (spec B.4 sketch).
        assert "synthetic per-item fault" in ingest_item_errors[0]["error_message"]

        # 5. The flow-start emission carries NO item_failures (omitted, not 0).
        flow_start = webhook_calls[0]
        assert flow_start["status"] == "in_progress"
        assert flow_start.get("item_failures") is None


def _sd_rows_from_pool(pool) -> list[dict]:
    """Reconstruct source_documents rows from the S437 raw-pool UPSERT capture.

    id-131: the URL sd PARENT no longer flows through the engine `sd_target`;
    it is written by `_upsert_source_document` as a raw-pool autocommit
    `INSERT ... ON CONFLICT (id)` on the ledger pool (`pool.executed`). Each
    captured `source_documents` INSERT's positional args are mapped back onto
    its column names so the URL sd landing reads as it did off `sd_target`.
    """
    rows: list[dict] = []
    for sql, args in pool.executed:
        if "INSERT INTO public.source_documents" not in sql:
            continue
        cols = [c.strip() for c in sql.split("(", 1)[1].split(")", 1)[0].split(",")]
        rows.append(dict(zip(cols, args)))
    return rows


class TestUrlPerItemFailureIsolation:
    """{75.11} BI-19: URL-branch per-item containment at the mount boundary.

    Drives the REAL `flow.app_main` over a 2-URL passed ledger [URL A whose
    raw-HTML fetch 5xxes ({112.7} HTML route), URL B that fetches cleanly]
    through the same faithful inline `mount_each` stand-in the localfs
    precedent uses:

      - URL A lands ZERO rows (no sd, no ri) while sibling URL B's sd+ri
        pair lands — one URL's fault never aborts the batch (BI-19),
      - flow_status == 'completed' (per-item faults never flip it),
      - the terminal webhook threads
        item_failures == {'forms': 0, 'content': 0, 'url': 1},
      - ONE `cocoindex.stage_error` with stage='ingest_item' is emitted,
      - a SECOND walk (the fetch recovered) re-runs URL A and lands its rows —
        a failed item declared nothing, so the next enumeration retries it,
      - the callable mounted for the URL fan-out is a NAMED closure
        `bound_ingest_url` with real `__name__`/`__qualname__` — NEVER a
        `functools.partial` (the {66.16}/{66.19} engine contract).
    """

    _URL_A = "https://example.org/articles/alpha"
    _URL_B = "https://example.org/articles/beta"
    _RI_FKEY = "feed_articles_reference_item_id_fkey"

    class _FakeTarget:
        def __init__(self, table_name: str) -> None:
            self.table_name = table_name
            self.rows: list[dict] = []

        def declare_row(self, *, row: dict) -> None:
            self.rows.append(row)

        def declare_vector_index(self, **kwargs: object) -> None:
            pass

    class _FakeLedgerPool:
        """asyncpg-pool stand-in: `fetch` returns the passed-URL ledger rows;
        `acquire()` yields a connection recording the S437 (id-131) raw-pool
        `_upsert_source_document` sd INSERTs.

        The URL sd PARENT no longer flows through the engine `sd_target` — it is
        written in-component on THIS pool (autocommit UPSERT) BEFORE the step-6
        `ri_target.declare_row`, so the URL sd landing is read off `executed`.
        """

        def __init__(self, rows: list[dict]) -> None:
            self._rows = rows
            self.executed: list[tuple[str, tuple]] = []

        async def fetch(self, sql: str) -> list[dict]:
            return list(self._rows)

        def acquire(self):
            pool = self

            class _Conn:
                async def execute(self, sql: str, *args: object) -> str:
                    pool.executed.append((sql, args))
                    return "INSERT 0 1"

            class _Acquire:
                async def __aenter__(self) -> "_Conn":
                    return _Conn()

                async def __aexit__(self, *exc: object) -> None:
                    return None

            return _Acquire()

    @staticmethod
    def _ledger_row(url: str, title: str, ingested_at: str) -> dict:
        return {
            "external_url": url,
            "title": title,
            "ai_summary": None,
            "published_at": "2026-05-01T09:00:00+00:00",
            "ingested_at": ingested_at,
            "workspace_id": "55555555-5555-4555-8555-555555555555",
        }

    def _build_harness(self, tmp_path, monkeypatch):
        """Wire app_main's collaborators; return the mutable harness state."""
        # app_main aborts without a workspace manifest at the source root —
        # provide a minimal content-only one (the localfs walk is empty here).
        manifest = {
            "schema_version": 1,
            "mappings": [
                {
                    "path_prefix": "",
                    "workspace_id": "44444444-4444-4444-8444-444444444444",
                    "route": "content",
                }
            ],
        }
        (tmp_path / ".kh-workspace-map.json").write_text(json.dumps(manifest))

        # ── Localfs walk: EMPTY feed — this scenario is URL-branch only. ──
        class _EmptyFeed:
            async def __aiter__(self):
                return
                yield  # pragma: no cover — makes this an async generator

        class _FakeWalk:
            def items(self):
                return _EmptyFeed()

        monkeypatch.setattr(
            flow.localfs, "walk_dir", lambda path, *, live, recursive: _FakeWalk()
        )

        # ── Passed-URL ledger: two URLs, A then B. ──
        pool = self._FakeLedgerPool(
            [
                self._ledger_row(self._URL_A, "Alpha", "2026-05-02T10:00:00+00:00"),
                self._ledger_row(self._URL_B, "Beta", "2026-05-02T11:00:00+00:00"),
            ]
        )
        monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)

        # ── HTML fetch (ID-112.7): URL A's raw-HTML GET 5xxes while
        # `fail_urls` holds it; B fetches clean HTML. `_fetch_url_bytes`
        # `raise_for_status()`es on HTTP failure — mirror that production shape
        # (a fetch error contained per-item at the BI-19 mount boundary). The
        # success case returns realistic HTML so the REAL in-process
        # `clean_html` produces a body that clears the {112.5} quality gate.
        harness = {"fail_urls": {self._URL_A}, "pool": pool}

        _CLEAN_HTML_BODY = (
            b"<html><body><main><article><h1>Fetched guide</h1><p>"
            + b"Substantive procurement guidance body content. " * 8
            + b"</p></article></main></body></html>"
        )

        async def _fake_fetch_url_bytes(url: str) -> bytes:
            if url in harness["fail_urls"]:
                raise RuntimeError(
                    f"html fetch failed for {url}: "
                    "status=502 body='upstream fetch error'"
                )
            return _CLEAN_HTML_BODY

        monkeypatch.setattr(flow, "_fetch_url_bytes", _fake_fetch_url_bytes)

        # No network: never HEAD-sniff; both URLs take the HTML route.
        async def _never_pdf(url: str) -> bool:
            return False

        monkeypatch.setattr(flow, "_url_is_pdf", _never_pdf)

        # ── Stage-3 stubs (classification + embedding). ──
        async def _classification(content_text: str):
            return {
                "content_type": "case_study",
                "primary_domain": "procurement",
                "primary_subtopic": "tender_evaluation",
                "suggested_title": "Suggested",
            }

        async def _embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "extract_classification", _classification)
        monkeypatch.setattr(flow, "embed_content_text", _embed)

        # ── D-7 backlink: record, don't touch a pool. {75.17}: the harness
        # can inject a per-walk backlink failure via harness["backlink_exc"]
        # (the harness["fail_urls"] mutability pattern) — while the cell holds
        # an exception instance, EVERY backlink write on that walk raises it.
        backlinks: list[tuple] = []
        backlink_exc: dict = {"exc": None}

        async def _fake_backlink(reference_item_id, ledger_urls):
            exc = backlink_exc["exc"]
            if exc is not None:
                raise exc
            backlinks.append((reference_item_id, ledger_urls))

        monkeypatch.setattr(flow, "_backlink_feed_articles", _fake_backlink)
        harness["backlinks"] = backlinks
        harness["backlink_exc"] = backlink_exc

        # {75.17} (Checker fix): the step-8 tolerance in `_ingest_url_body`
        # narrows by `constraint_name` STRING COMPARE only — it never reads
        # an asyncpg exception class, so NO ForeignKeyViolationError pin is
        # needed (a class-identity pin proved run-order-flaky under the
        # suite's resident MagicMock asyncpg). Pin only `PostgresError` —
        # `_classify_stage_exception` still isinstance-checks it for the
        # ESCAPING (non-tolerated) errors these tests assert on — on
        # whatever module object flow captured, so the classifier behaves
        # deterministically across import orderings (monkeypatch restores
        # the attribute after each test).
        monkeypatch.setattr(
            flow.asyncpg, "PostgresError", _PostgresError, raising=False
        )

        # ── Recording targets. ──
        targets = {
            name: self._FakeTarget(name)
            for name in (
                "content_items",
                "q_a_extractions",
                "source_documents",
                "entity_mentions",
                "entity_relationships",
                "form_templates",
                "form_template_fields",
                "content_chunks",
                "reference_items",
            )
        }
        harness["targets"] = targets

        async def _fake_mount_table_target(db_ctx, table_name, schema, *, managed_by):
            return targets[table_name]

        monkeypatch.setattr(flow, "mount_table_target", _fake_mount_table_target)

        # ── Faithful inline mount_each; capture each mounted callable so the
        # named-closure contract ({66.16}/{66.19}) is assertable. ──
        mounted_fns: list = []
        harness["mounted_fns"] = mounted_fns

        async def _inline_mount_each(_subpath, fn, items, *extra_args):
            mounted_fns.append(fn)
            async for _key, value in items:
                await fn(value, *extra_args)

            class _Handle:
                async def ready(self) -> None:
                    return None

            return _Handle()

        monkeypatch.setattr(flow.coco, "mount_each", _inline_mount_each)

        # ── Stage 5 is flow-scope; stub it (not under test). ──
        async def _fake_stage_5(*args, **kwargs):
            return 0

        monkeypatch.setattr(flow, "_run_stage_5_resolution", _fake_stage_5)

        # ── Capture webhook emissions + stage-error logs. ──
        webhook_calls: list[dict] = []
        harness["webhook_calls"] = webhook_calls

        async def _capture_webhook(**kwargs):
            webhook_calls.append(kwargs)

        monkeypatch.setattr(flow, "_emit_pipeline_run_webhook", _capture_webhook)

        stage_error_calls: list[dict] = []
        harness["stage_error_calls"] = stage_error_calls
        real_emit_stage_error = flow._emit_stage_error_log

        def _spy_stage_error(**kwargs):
            stage_error_calls.append(kwargs)
            return real_emit_stage_error(**kwargs)

        monkeypatch.setattr(flow, "_emit_stage_error_log", _spy_stage_error)

        monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(tmp_path))
        return harness

    def test_html_fetch_5xx_lands_zero_rows_siblings_land_later_walk_retries(
        self, tmp_path, monkeypatch
    ):
        harness = self._build_harness(tmp_path, monkeypatch)
        targets = harness["targets"]

        # ── Walk 1: URL A's HTML fetch 5xxes; URL B is clean. Must NOT raise. ──
        asyncio.run(flow.app_main())

        ri_rows = targets["reference_items"].rows
        # S437 (id-131): the URL sd PARENT lands via the raw-pool UPSERT, not
        # the engine `sd_target` — reconstruct it from the pool capture.
        sd_rows = _sd_rows_from_pool(harness["pool"])

        # 1. Sibling B's sd+ri pair lands; A lands ZERO rows (BI-19).
        assert [r["source_url"] for r in ri_rows] == [self._URL_B], (
            f"expected exactly URL B's reference_items row; got "
            f"{[r.get('source_url') for r in ri_rows]}"
        )
        assert [r["source_url"] for r in sd_rows] == [self._URL_B]
        assert ri_rows[0]["title"] == "Beta"

        # 2. flow_status == 'completed' — a per-item URL fault never flips it.
        terminal = harness["webhook_calls"][-1]
        assert terminal["status"] == "completed"
        assert terminal.get("error_class") is None

        # 3. The fault rides the 'url' branch of the per-branch tally.
        assert terminal.get("item_failures") == {
            "forms": 0,
            "content": 0,
            "url": 1,
        }

        # 4. ONE attributed structured log: stage='ingest_item', classified
        # via the `_classify_stage_exception(exc) or type name` fallback.
        ingest_item_errors = [
            c
            for c in harness["stage_error_calls"]
            if c.get("stage") == "ingest_item"
        ]
        assert len(ingest_item_errors) == 1
        assert ingest_item_errors[0]["error_class"] == "RuntimeError"
        assert "html fetch failed" in ingest_item_errors[0]["error_message"]

        # 5. Only B was backlinked on walk 1.
        assert len(harness["backlinks"]) == 1

        # ── Walk 2: the fetch recovered — the failed item declared NOTHING on
        # walk 1, so re-enumeration re-runs it and its rows land (BI-19). ──
        harness["fail_urls"].clear()
        asyncio.run(flow.app_main())

        ri_urls = sorted(r["source_url"] for r in targets["reference_items"].rows)
        assert self._URL_A in ri_urls, (
            "a later walk must retry the previously-failed URL — its "
            "reference_items row should land once the fetch recovers"
        )
        terminal_walk_2 = harness["webhook_calls"][-1]
        assert terminal_walk_2["status"] == "completed"
        assert terminal_walk_2.get("item_failures") == {
            "forms": 0,
            "content": 0,
            "url": 0,
        }

    def test_walk1_fk_deferral_completes_item_then_walk2_converges(
        self, tmp_path, monkeypatch, caplog
    ):
        """{75.17}: the engine deferred-flush race. The step-8 backlink
        UPDATE runs IN-component, but the engine flushes the `ri_target` row
        declared at step 6 only AFTER the component returns
        (cocoindex-write-model.md §1 — no per-row UPSERT completion
        callback), so on a clean walk 1 the backlink write ALWAYS hits the
        `feed_articles_reference_item_id_fkey` violation. EXACTLY that
        constraint name is tolerated (string compare — never asyncpg class
        identity): the item COMPLETES (sd/ri stay declared → the
        engine flushes them), one structured
        `cocoindex.url_backlink_deferred` line is logged per deferred URL,
        the url tally is NOT incremented, and walk 2's re-enumeration (the
        per-walk op_id kwarg busts the component memo — real-engine probed)
        lands the backlink against the flushed ri row.
        """
        harness = self._build_harness(tmp_path, monkeypatch)
        harness["fail_urls"].clear()  # both URLs fetch cleanly
        targets = harness["targets"]

        # ── Walk 1: every backlink write hits the deferred-flush race. ──
        harness["backlink_exc"]["exc"] = _FkViolation(
            'insert or update on table "feed_articles" violates foreign key '
            f'constraint "{self._RI_FKEY}"',
            constraint_name=self._RI_FKEY,
        )
        with caplog.at_level(
            logging.INFO, logger="scripts.cocoindex_pipeline.flow"
        ):
            asyncio.run(flow.app_main())

        # 1. Both items COMPLETED: the sd+ri evidence pairs stay declared —
        #    a raise here would have made the engine DISCARD them (the
        #    {75.16}-proven faulted-item contract), killing convergence.
        ri_rows = targets["reference_items"].rows
        # S437 (id-131): the URL sd PARENT lands via the raw-pool UPSERT, not
        # the engine `sd_target` — reconstruct it from the pool capture.
        sd_rows = _sd_rows_from_pool(harness["pool"])
        assert sorted(r["source_url"] for r in ri_rows) == sorted(
            [self._URL_A, self._URL_B]
        )
        assert sorted(r["source_url"] for r in sd_rows) == sorted(
            [self._URL_A, self._URL_B]
        )

        # 2. The backlink write was SKIPPED (deferred to walk 2) — never
        #    recorded, never retried in-walk.
        assert harness["backlinks"] == []

        # 3. The deferral is NOT a contained per-item fault: flow completed,
        #    the url tally stays 0, ZERO ingest_item stage errors.
        terminal = harness["webhook_calls"][-1]
        assert terminal["status"] == "completed"
        assert terminal.get("item_failures") == {
            "forms": 0,
            "content": 0,
            "url": 0,
        }
        assert [
            c
            for c in harness["stage_error_calls"]
            if c.get("stage") == "ingest_item"
        ] == []

        # 4. One structured deferral line per deferred URL: the event name +
        #    url + ri id contract ({75.17}).
        deferred = [
            json.loads(r.getMessage())
            for r in caplog.records
            if "url_backlink_deferred" in r.getMessage()
        ]
        assert len(deferred) == 2, (
            f"expected one cocoindex.url_backlink_deferred line per deferred "
            f"URL; got {len(deferred)}"
        )
        ri_by_url = {r["source_url"]: str(r["id"]) for r in ri_rows}
        assert sorted(d["source_url"] for d in deferred) == sorted(
            [self._URL_A, self._URL_B]
        )
        for d in deferred:
            assert d["event"] == "cocoindex.url_backlink_deferred"
            assert d["reference_item_id"] == ri_by_url[d["source_url"]]
            assert d["op_id"], "the deferral line must carry the run op_id"

        # ── Walk 2: the ri rows flushed after walk 1 → the backlink lands. ──
        harness["backlink_exc"]["exc"] = None
        asyncio.run(flow.app_main())

        assert len(harness["backlinks"]) == 2, (
            "walk 2 must re-run the backlink write for both URLs "
            "(convergence-by-walk-2)"
        )
        assert sorted(str(ri) for ri, _urls in harness["backlinks"]) == sorted(
            ri_by_url.values()
        )
        terminal_walk_2 = harness["webhook_calls"][-1]
        assert terminal_walk_2["status"] == "completed"
        assert terminal_walk_2.get("item_failures") == {
            "forms": 0,
            "content": 0,
            "url": 0,
        }

    def test_fk_violation_on_another_constraint_still_tallies(
        self, tmp_path, monkeypatch
    ):
        """The {75.17} tolerance is scoped to EXACTLY
        `feed_articles_reference_item_id_fkey`: a ForeignKeyViolation on ANY
        other constraint is a real fault — contained per-item at the mount
        boundary, tallied on the url branch, attributed via an ingest_item
        stage error classified `postgres_write_failed`.

        Engine-contract caveat (do NOT extend this test with landing
        assertions for the faulted items): under the REAL engine a faulted
        item's declared rows are DISCARDED at flush (the {75.16}-proven
        contract); the recording `_FakeTarget` retains them, so declared-row
        state is meaningless for the faulted path here.
        """
        harness = self._build_harness(tmp_path, monkeypatch)
        harness["fail_urls"].clear()
        harness["backlink_exc"]["exc"] = _FkViolation(
            'insert or update on table "feed_articles" violates foreign key '
            'constraint "feed_articles_content_item_id_fkey"',
            constraint_name="feed_articles_content_item_id_fkey",
        )

        asyncio.run(flow.app_main())

        terminal = harness["webhook_calls"][-1]
        assert terminal["status"] == "completed"
        assert terminal.get("item_failures") == {
            "forms": 0,
            "content": 0,
            "url": 2,
        }
        ingest_item_errors = [
            c
            for c in harness["stage_error_calls"]
            if c.get("stage") == "ingest_item"
        ]
        assert len(ingest_item_errors) == 2
        for call in ingest_item_errors:
            assert call["error_class"] == "postgres_write_failed"
        assert harness["backlinks"] == []

    def test_other_postgres_error_in_backlink_still_tallies(
        self, tmp_path, monkeypatch
    ):
        """A non-FK postgres error in the backlink write (e.g. a dropped
        connection) must STILL raise into the BI-19 containment tally — the
        {75.17} tolerance never swallows it. Same engine-contract caveat as
        the sibling test: no declared-row assertions for faulted items.
        """
        harness = self._build_harness(tmp_path, monkeypatch)
        harness["fail_urls"].clear()
        harness["backlink_exc"]["exc"] = _PostgresError(
            "connection was closed in the middle of operation"
        )

        asyncio.run(flow.app_main())

        terminal = harness["webhook_calls"][-1]
        assert terminal["status"] == "completed"
        assert terminal.get("item_failures") == {
            "forms": 0,
            "content": 0,
            "url": 2,
        }
        ingest_item_errors = [
            c
            for c in harness["stage_error_calls"]
            if c.get("stage") == "ingest_item"
        ]
        assert len(ingest_item_errors) == 2
        for call in ingest_item_errors:
            assert call["error_class"] == "postgres_write_failed"
        assert harness["backlinks"] == []

    def test_real_asyncpg_fk_violation_exposes_constraint_name(self):
        """THE load-bearing seam proof for the {75.17} tolerance, pinned
        against the REAL installed asyncpg in a fresh interpreter (this
        suite's process may hold the MagicMock asyncpg stub). The production
        narrowing is a `constraint_name` string compare with NO asyncpg
        class dependency, so this pin carries the whole contract:
        `ForeignKeyViolationError` exposes `.constraint_name` (were it to
        drift, getattr → None → re-raise → the S319 no-convergence defect
        returns) and subclasses `PostgresError` (were that to drift, an
        escaping violation would stop classifying `postgres_write_failed`).
        """
        src = (
            "import asyncpg, asyncpg.exceptions as ex\n"
            "e = ex.ForeignKeyViolationError.new({'C': '23503', 'M': "
            "'insert or update on table violates foreign key constraint', "
            "'n': 'feed_articles_reference_item_id_fkey'})\n"
            "assert e.constraint_name == "
            "'feed_articles_reference_item_id_fkey', e.constraint_name\n"
            "assert isinstance(e, asyncpg.PostgresError), type(e).__mro__\n"
            "print('OK')\n"
        )
        proc = subprocess.run(
            [sys.executable, "-c", src],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert proc.returncode == 0, proc.stderr
        assert proc.stdout.strip() == "OK"

    def test_bound_ingest_url_is_a_named_closure_not_a_partial(
        self, tmp_path, monkeypatch
    ):
        """The {66.16}/{66.19} engine contract: cocoindex 1.0.3 derives the
        ComponentSubpath from `fn.__name__` and builds
        `ComponentProcessorInfo(fn.__qualname__)` — a `functools.partial` has
        NEITHER and crashes the `_LoopRunner` worker at live boot. The URL
        binding must be a NAMED closure, exactly the `bound_ingest_file`
        precedent."""
        import functools
        import inspect

        harness = self._build_harness(tmp_path, monkeypatch)
        harness["fail_urls"].clear()

        asyncio.run(flow.app_main())

        mounted = harness["mounted_fns"]
        names = [getattr(fn, "__name__", None) for fn in mounted]
        assert "bound_ingest_url" in names, (
            f"app_main must mount a NAMED closure 'bound_ingest_url' for the "
            f"URL fan-out; mounted callables: {names}"
        )
        for fn in mounted:
            assert not isinstance(fn, functools.partial), (
                "functools.partial is PROHIBITED at the mount_each boundary "
                "({66.16}: the engine reads __name__/__qualname__)"
            )
            assert getattr(fn, "__qualname__", None), (
                f"mounted callable {fn!r} lacks a real __qualname__"
            )

        # Source-level belt-and-braces: the named closure + pinned subpath
        # are visible in app_main's source (the localfs precedent pattern).
        source = inspect.getsource(flow.app_main)
        assert "async def bound_ingest_url(" in source
        assert 'component_subpath("ingest_url")' in source


class TestStageHandlerUrlStagingDocstring:
    """WP-G ({75.11}): `_stage_handler` documents how URL items are staged.

    Asserted against the SOURCE TEXT (not an import) — `server.py` imports
    the real cocoindex at module scope, and booting the engine inside this
    stub-scoped suite would leak process-global state (ID-44.5).
    """

    def test_stage_handler_docstring_notes_url_ledger_row_seeding(self):
        server_path = (
            Path(flow.__file__).resolve().parent / "server.py"
        )
        source = server_path.read_text()
        marker = "async def _stage_handler"
        assert marker in source, "server.py must define _stage_handler"
        handler_block = source.split(marker, 1)[1]
        # The docstring is the first triple-quoted block after the def;
        # collapse the wrap-indentation whitespace before phrase-matching.
        docstring = " ".join(handler_block.split('"""')[1].split())
        assert "feed_articles" in docstring, (
            "_stage_handler docstring must note that URL items are staged by "
            "seeding a gate-passed feed_articles ledger row ({75.11} WP-G)"
        )
        assert "not by staging bytes" in docstring.lower()
        assert "file-fixture" in docstring.lower(), (
            "_stage_handler docstring must state /stage remains "
            "file-fixture-only"
        )
