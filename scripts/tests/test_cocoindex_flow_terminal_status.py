"""Tests for flow.py's id-414 AC-1/AC-2 terminal-status substrate.

Source-level cover (the S516 lesson: a backstop must not be the only cover)
for the two helpers the fail-loud change introduced:

  - `_resolve_terminal_status` (AC-1): a 'completed' walk whose per-item
    failure tally is non-zero resolves to 'completed_with_errors'; a
    walk-wide 'failed' is never rewritten in either direction. The
    containment substrate itself (`_FlowItemFailureCounter`, bl-224
    inversion) is unchanged and stays covered by
    test_cocoindex_flow_failure_mode.py's end-to-end app_main drives —
    whose terminal assertions now pin the resolved label.
  - `_emit_run_terminal_log` (AC-2): ONE machine-parseable
    `cocoindex.run_terminal` line per run carrying the per-branch tally and
    its total — INFO on a clean 'completed' run, WARNING otherwise — the
    docker-logs-legible drop count and the nightly baseline-walk gate's
    parse target (AC-3).

Flow import goes through `conftest.fresh_flow_module()` (the ID-55.1
canonical primitive) so this file adds no collection-order sensitivity and
preserves any cooperative `flow.aiohttp` pin a sibling installed.
"""

from __future__ import annotations

import json
import logging
import uuid

import pytest

from conftest import fresh_flow_module  # noqa: E402


@pytest.fixture(scope="module")
def flow():
    """A fresh stubbed `scripts.cocoindex_pipeline.flow` (ID-55.1 primitive)."""
    return fresh_flow_module()


# ============================================================================
# AC-1 — _resolve_terminal_status
# ============================================================================


class TestResolveTerminalStatus:
    """`_resolve_terminal_status` — the id-414 AC-1 fail-loud rule at its
    source: non-zero per-item tally flips 'completed' (and ONLY 'completed')
    to 'completed_with_errors'."""

    def test_helper_function_is_exposed(self, flow):
        assert hasattr(flow, "_resolve_terminal_status")

    def test_clean_completed_stays_completed(self, flow):
        assert (
            flow._resolve_terminal_status(
                "completed", {"content": 0, "url": 0}
            )
            == "completed"
        )

    def test_content_branch_failure_resolves_completed_with_errors(self, flow):
        assert (
            flow._resolve_terminal_status(
                "completed", {"content": 1, "url": 0}
            )
            == "completed_with_errors"
        )

    def test_url_branch_failure_resolves_completed_with_errors(self, flow):
        assert (
            flow._resolve_terminal_status(
                "completed", {"content": 0, "url": 3}
            )
            == "completed_with_errors"
        )

    def test_walk_wide_failed_is_never_downgraded(self, flow):
        # A walk-wide fault stays 'failed' even when per-item faults were
        # also tallied before the walk-wide abort — 'failed' outranks the
        # contained class.
        assert (
            flow._resolve_terminal_status("failed", {"content": 2, "url": 1})
            == "failed"
        )

    def test_failed_with_zero_tally_stays_failed(self, flow):
        assert (
            flow._resolve_terminal_status("failed", {"content": 0, "url": 0})
            == "failed"
        )

    def test_only_completed_is_upgraded(self, flow):
        # Defensive: any non-'completed' input passes through untouched —
        # the resolver rewrites exactly one label in exactly one direction.
        assert (
            flow._resolve_terminal_status(
                "in_progress", {"content": 1, "url": 0}
            )
            == "in_progress"
        )

    def test_empty_tally_stays_completed(self, flow):
        # An empty dict (no branches recorded at all) sums to zero.
        assert flow._resolve_terminal_status("completed", {}) == "completed"


# ============================================================================
# AC-2 — _emit_run_terminal_log
# ============================================================================


_OP_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")


def _terminal_records(caplog: pytest.LogCaptureFixture) -> list[dict]:
    return [
        json.loads(r.getMessage())
        for r in caplog.records
        if "cocoindex.run_terminal" in r.getMessage()
    ]


class TestEmitRunTerminalLog:
    """`_emit_run_terminal_log` — ONE parseable per-run rollup line with the
    drop count (the AC-3 gate's parse target)."""

    def test_helper_function_is_exposed(self, flow):
        assert hasattr(flow, "_emit_run_terminal_log")

    def test_emits_required_fields(self, flow, caplog):
        with caplog.at_level(logging.INFO):
            flow._emit_run_terminal_log(
                op_id=_OP_ID,
                status="completed",
                item_failures={"content": 0, "url": 0},
                items_processed=14,
            )
        records = _terminal_records(caplog)
        assert len(records) == 1
        payload = records[0]
        assert payload["event"] == "cocoindex.run_terminal"
        assert payload["op_id"] == str(_OP_ID)
        assert payload["status"] == "completed"
        assert payload["item_failures"] == {"content": 0, "url": 0}
        assert payload["item_failure_total"] == 0
        assert payload["items_processed"] == 14

    def test_total_is_the_sum_across_branches(self, flow, caplog):
        with caplog.at_level(logging.INFO):
            flow._emit_run_terminal_log(
                op_id=_OP_ID,
                status="completed_with_errors",
                item_failures={"content": 2, "url": 3},
                items_processed=9,
            )
        payload = _terminal_records(caplog)[0]
        assert payload["item_failure_total"] == 5
        assert payload["item_failures"] == {"content": 2, "url": 3}

    def test_line_is_machine_parseable_json(self, flow, caplog):
        # The nightly gate slices from the first '{' and json.loads — the
        # emitted message must BE one JSON object, not prose around one.
        with caplog.at_level(logging.INFO):
            flow._emit_run_terminal_log(
                op_id=_OP_ID,
                status="completed",
                item_failures={"content": 0, "url": 0},
                items_processed=0,
            )
        [record] = [
            r
            for r in caplog.records
            if "cocoindex.run_terminal" in r.getMessage()
        ]
        parsed = json.loads(record.getMessage())
        assert parsed["event"] == "cocoindex.run_terminal"

    def test_clean_completed_logs_at_info(self, flow, caplog):
        with caplog.at_level(logging.INFO):
            flow._emit_run_terminal_log(
                op_id=_OP_ID,
                status="completed",
                item_failures={"content": 0, "url": 0},
                items_processed=1,
            )
        [record] = [
            r
            for r in caplog.records
            if "cocoindex.run_terminal" in r.getMessage()
        ]
        assert record.levelno == logging.INFO

    def test_completed_with_errors_logs_at_warning(self, flow, caplog):
        with caplog.at_level(logging.INFO):
            flow._emit_run_terminal_log(
                op_id=_OP_ID,
                status="completed_with_errors",
                item_failures={"content": 1, "url": 0},
                items_processed=2,
            )
        [record] = [
            r
            for r in caplog.records
            if "cocoindex.run_terminal" in r.getMessage()
        ]
        assert record.levelno == logging.WARNING

    def test_failed_logs_at_warning(self, flow, caplog):
        with caplog.at_level(logging.INFO):
            flow._emit_run_terminal_log(
                op_id=_OP_ID,
                status="failed",
                item_failures={"content": 0, "url": 0},
                items_processed=0,
            )
        [record] = [
            r
            for r in caplog.records
            if "cocoindex.run_terminal" in r.getMessage()
        ]
        assert record.levelno == logging.WARNING
