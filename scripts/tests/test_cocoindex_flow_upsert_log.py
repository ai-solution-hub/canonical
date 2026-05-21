"""Tests for cocoindex_pipeline/flow.py — Inv-13 v1 structured-log substrate.

Verifies the `_emit_upsert_log()` helper emits a single JSON-formatted log
line at INFO level with the contract shape {event, op_id, table, row_id,
operation} on Postgres UPSERT completion (Stage 6 bind_target hook).

Per Inv-13 PRODUCT contract (T8 PLAN), the v1 audit-observability path
is structured logs via Cloud Run's log ingest surface — NOT an
`audit_log` table (DEFERRED-v1.1 per P-OQ1).

Per S254 TECH amendments (commit 61e163d8), cocoindex 1.0.3 does NOT
expose `coco.logger`; v1 substrate uses stdlib
`logging.getLogger(__name__).info(json.dumps(...))` so Cloud Run's
JSON-payload parser picks the line into `jsonPayload`.

Cocoindex is stubbed at the import boundary (mirroring
test_cocoindex_adapters.py pattern) so the test does NOT require LMDB
startup nor dangerouslyDisableSandbox: true.

Reference: docs/specs/cocoindex-flow-scaffolding/TECH.md §P-5
Test strategy: ID-28.10 — JSON shape contract + INFO level + stdlib logger
"""

from __future__ import annotations

import json
import logging
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

# ── Path setup ──────────────────────────────────────────────────────────────

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))


# ── cocoindex + dependent stubs ─────────────────────────────────────────────
# Stub the cocoindex module + its submodules + asyncpg + docling so that
# importing cocoindex_pipeline.flow does NOT trigger the Rust LMDB engine,
# does NOT require an installed cocoindex, and does NOT require asyncpg /
# docling at test time.


def _make_coco_stub() -> MagicMock:
    """Return a minimal cocoindex module stub for import-boundary patching."""
    stub = MagicMock(name="cocoindex")
    # ContextKey is used at module level for the DB context — accept any args.
    stub.ContextKey = MagicMock(name="ContextKey")
    # App / AppConfig used at module level for KH_PIPELINE_APP assembly.
    stub.AppConfig = MagicMock(name="AppConfig")
    stub.App = MagicMock(name="App")
    # use_context is an async context manager — return a MagicMock that the
    # test does not exercise (app_main is not called from this test).
    stub.use_context = MagicMock(name="use_context")
    stub.start = MagicMock(name="start")
    return stub


def _stub_module(name: str) -> MagicMock:
    """Register `name` as a stub module if not already installed."""
    if name not in sys.modules:
        sys.modules[name] = MagicMock(name=name)
    return sys.modules[name]


# Stub cocoindex + connector submodules BEFORE any import of flow.py
_coco_stub = _make_coco_stub()
sys.modules.setdefault("cocoindex", _coco_stub)

# cocoindex.connectors.localfs
_localfs_stub = MagicMock(name="cocoindex.connectors.localfs")
sys.modules.setdefault("cocoindex.connectors", MagicMock(name="cocoindex.connectors"))
sys.modules.setdefault("cocoindex.connectors.localfs", _localfs_stub)

# cocoindex.connectors.postgres — TableSchema, ColumnDef, mount_table_target
_pg_stub = MagicMock(name="cocoindex.connectors.postgres")
_pg_stub.ColumnDef = MagicMock(name="ColumnDef")
_pg_stub.TableSchema = MagicMock(name="TableSchema")
_pg_stub.mount_table_target = MagicMock(name="mount_table_target")
sys.modules.setdefault("cocoindex.connectors.postgres", _pg_stub)

# cocoindex.connectorkits.target.ManagedBy
_connectorkits_stub = MagicMock(name="cocoindex.connectorkits")
_target_stub = MagicMock(name="cocoindex.connectorkits.target")
_target_stub.ManagedBy = MagicMock(name="ManagedBy")
sys.modules.setdefault("cocoindex.connectorkits", _connectorkits_stub)
sys.modules.setdefault("cocoindex.connectorkits.target", _target_stub)

# asyncpg + docling-adjacent stubs (adapters import chain)
_stub_module("asyncpg")
_stub_module("docling")
_stub_module("docling.document_converter")


# ── Import the module under test ─────────────────────────────────────────────
from cocoindex_pipeline import flow  # noqa: E402  (must come after stub injection)


# ============================================================================
# UPSERT LOG EMISSION CONTRACT
# Inv-13 v1 substrate — structured-log shape per TECH.md §P-5.
# ============================================================================


class TestEmitUpsertLog:
    """Verify _emit_upsert_log() satisfies the Inv-13 v1 structured-log contract."""

    def test_helper_function_is_exposed(self):
        """flow module exposes _emit_upsert_log helper (28.10 contract surface)."""
        assert hasattr(flow, "_emit_upsert_log"), (
            "flow.py must expose _emit_upsert_log helper for Inv-13 v1 substrate "
            "(see TECH.md §P-5)"
        )
        assert callable(flow._emit_upsert_log), (
            "_emit_upsert_log must be callable"
        )

    def test_log_line_is_json_formatted(self, caplog):
        """Emitted log line is valid JSON parseable by Cloud Run's jsonPayload ingest."""
        op_id = uuid.UUID("11111111-1111-4111-8111-111111111111")
        row_id = uuid.UUID("22222222-2222-4222-8222-222222222222")
        with caplog.at_level(logging.INFO, logger="cocoindex_pipeline.flow"):
            flow._emit_upsert_log(
                op_id=op_id,
                table="content_items",
                row_id=row_id,
                operation="INSERT",
            )
        assert len(caplog.records) == 1, (
            f"Expected exactly one log record; got {len(caplog.records)}"
        )
        record = caplog.records[0]
        # Parse the message as JSON — Cloud Run requires valid JSON for
        # jsonPayload extraction.
        parsed = json.loads(record.message)
        assert isinstance(parsed, dict), "Log message must parse to a JSON object"

    def test_log_payload_has_required_fields(self, caplog):
        """JSON payload carries {event, op_id, table, row_id, operation}."""
        op_id = uuid.UUID("11111111-1111-4111-8111-111111111111")
        row_id = uuid.UUID("22222222-2222-4222-8222-222222222222")
        with caplog.at_level(logging.INFO, logger="cocoindex_pipeline.flow"):
            flow._emit_upsert_log(
                op_id=op_id,
                table="content_items",
                row_id=row_id,
                operation="UPDATE",
            )
        record = caplog.records[0]
        parsed = json.loads(record.message)
        # Per TECH.md §P-5 + S254 amendment: contract shape is exactly these
        # five keys (and only these — extra keys flag spec drift for the
        # Checker to triage).
        assert parsed["event"] == "cocoindex.upsert", (
            f"event must be 'cocoindex.upsert'; got {parsed.get('event')!r}"
        )
        assert parsed["op_id"] == str(op_id), (
            "op_id must serialise the UUID via str()"
        )
        assert parsed["table"] == "content_items", (
            "table must round-trip the input"
        )
        assert parsed["row_id"] == str(row_id), (
            "row_id must serialise the UUID via str()"
        )
        assert parsed["operation"] == "UPDATE", (
            "operation must round-trip the input"
        )

    def test_log_emitted_at_info_level(self, caplog):
        """Emission goes through INFO (not DEBUG / WARN / ERROR)."""
        with caplog.at_level(logging.INFO, logger="cocoindex_pipeline.flow"):
            flow._emit_upsert_log(
                op_id=uuid.uuid4(),
                table="q_a_extractions",
                row_id=uuid.uuid4(),
                operation="INSERT",
            )
        assert len(caplog.records) == 1
        assert caplog.records[0].levelno == logging.INFO, (
            "Log must emit at INFO level — Cloud Run filters DEBUG by default"
        )

    def test_logger_is_module_scoped(self, caplog):
        """Emission goes through cocoindex_pipeline.flow logger (stdlib)."""
        with caplog.at_level(logging.INFO, logger="cocoindex_pipeline.flow"):
            flow._emit_upsert_log(
                op_id=uuid.uuid4(),
                table="source_documents",
                row_id=uuid.uuid4(),
                operation="INSERT",
            )
        assert len(caplog.records) == 1
        # Per S254 amendment: must use stdlib `logging.getLogger(__name__)`,
        # NOT a (non-existent) `coco.logger`. The flow module's logger name
        # is the canonical hand-off into the Cloud Run JSON-payload parser.
        assert caplog.records[0].name == "cocoindex_pipeline.flow", (
            f"Logger must be 'cocoindex_pipeline.flow' (stdlib module-scoped); "
            f"got {caplog.records[0].name!r}"
        )

    def test_operation_insert_round_trips(self, caplog):
        """operation='INSERT' round-trips intact."""
        with caplog.at_level(logging.INFO, logger="cocoindex_pipeline.flow"):
            flow._emit_upsert_log(
                op_id=uuid.uuid4(),
                table="content_items",
                row_id=uuid.uuid4(),
                operation="INSERT",
            )
        parsed = json.loads(caplog.records[0].message)
        assert parsed["operation"] == "INSERT"

    def test_operation_update_round_trips(self, caplog):
        """operation='UPDATE' round-trips intact."""
        with caplog.at_level(logging.INFO, logger="cocoindex_pipeline.flow"):
            flow._emit_upsert_log(
                op_id=uuid.uuid4(),
                table="content_items",
                row_id=uuid.uuid4(),
                operation="UPDATE",
            )
        parsed = json.loads(caplog.records[0].message)
        assert parsed["operation"] == "UPDATE"

    def test_uuid_strings_also_accepted(self, caplog):
        """Helper accepts str inputs for op_id / row_id (callers may pass either)."""
        # cocoindex's per-flow op_id symbol — when wired (28.12) — may surface
        # as either uuid.UUID or str depending on the cocoindex API. The
        # helper must be tolerant; str() is a no-op when input is already str.
        op_id_str = "33333333-3333-4333-8333-333333333333"
        row_id_str = "44444444-4444-4444-8444-444444444444"
        with caplog.at_level(logging.INFO, logger="cocoindex_pipeline.flow"):
            flow._emit_upsert_log(
                op_id=op_id_str,
                table="content_items",
                row_id=row_id_str,
                operation="INSERT",
            )
        parsed = json.loads(caplog.records[0].message)
        assert parsed["op_id"] == op_id_str
        assert parsed["row_id"] == row_id_str
