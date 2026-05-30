"""Latency-budget tests (ID-43.10, OQ-INV-18).

The blocking-OQ latency budget is 10 s wall-clock: once the parent writes a
decision, the worker's poll loop must observe it and unblock within the budget.
The poll cadence (2 s in production) is an implementation knob; tests drive a
short interval so the assertion is fast, but the asserted property is the budget.

These tests also prove the ``send-prompt`` nudge is NON-correctness-bearing:
  * dropping the nudge entirely (no worker_name) still meets the budget via
    polling alone — the file is authoritative;
  * supplying a nudge whose target is unreachable (the conftest isolates the
    events base to an empty fleet) NEVER lengthens the observed latency — the
    nudge failure is swallowed and the decision file unblocks the poll anyway.

The live-daemon "nudge SHORTENS the latency" half is exercised in
test_integration_live.py (ID-43.11), which has a real cmux daemon; here, without
a daemon, we assert the budget is met regardless of the nudge.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_SCRIPTS_DIR = _REPO_ROOT / ".claude" / "skills" / "session-driver-cmux" / "scripts"
_OQ_CANONICAL = _SCRIPTS_DIR / "oq-canonical.py"
_OQ_WORKER_SH = _SCRIPTS_DIR / "oq-worker.sh"
_OQ_PARENT_SH = _SCRIPTS_DIR / "oq-parent.sh"

_LATENCY_BUDGET_SECONDS = 10.0  # OQ-INV-18


def _stamp(obj: dict) -> dict:
    result = subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), "stamp"],
        input=json.dumps(obj), capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stamp failed: {result.stderr}"
    return json.loads(result.stdout)


def _emit_blocking(oq_root: Path, *, question: str = "Block on me?") -> str:
    result = subprocess.run(
        ["bash", str(_OQ_WORKER_SH), "oq_emit", "worker-test", "43", "impl", question,
         "high", "true", '{"phase":"impl"}', str(oq_root), "2026-05-30T10:00:00Z",
         '{"phase":"impl"}'],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def _write_decision(oq_root: Path, oq_id: str) -> None:
    dec = _stamp({
        "oq_id": oq_id, "decided_at": "2026-05-30T10:30:00Z", "decider_id": "parent",
        "outcome": "answered", "answer": "Proceed.", "directive": None, "schema_version": 1,
    })
    decisions = oq_root / "decisions"
    decisions.mkdir(parents=True, exist_ok=True)
    (decisions / f"{oq_id}.json").write_text(json.dumps(dec, sort_keys=True, separators=(",", ":")))


def _decide_via_parent(oq_root: Path, oq_id: str, worker_name: str | None) -> subprocess.CompletedProcess:
    args = ["bash", str(_OQ_PARENT_SH), "oq_decide", str(oq_root), oq_id,
            "2026-05-30T10:30:00Z", "parent", "answered", "Proceed.", "null"]
    if worker_name is not None:
        args.append(worker_name)
    return subprocess.run(args, capture_output=True, text=True)


def _poll(oq_root: Path, oq_id: str, *, interval: str = "0.1") -> tuple[subprocess.CompletedProcess, float]:
    """Run oq_poll_decision and return (result, wall_clock_seconds)."""
    env = os.environ.copy()
    env["OQ_POLL_INTERVAL"] = interval
    start = time.monotonic()
    result = subprocess.run(
        ["bash", str(_OQ_WORKER_SH), "oq_poll_decision", str(oq_root), oq_id],
        capture_output=True, text=True, env=env,
    )
    return result, time.monotonic() - start


# ──────────────────────────────────────────────────────────────────────────────
# Budget met when the decision is already present
# ──────────────────────────────────────────────────────────────────────────────

def test_unblock_immediately_when_decision_present(tmp_path: Path):
    """A decision already on disk unblocks on the first poll iteration, well within budget."""
    oq_id = _emit_blocking(tmp_path)
    _write_decision(tmp_path, oq_id)
    result, elapsed = _poll(tmp_path, oq_id)
    assert result.returncode == 0, result.stderr
    assert elapsed < _LATENCY_BUDGET_SECONDS, f"unblock took {elapsed:.2f}s (> {_LATENCY_BUDGET_SECONDS}s)"
    state = json.loads((tmp_path / "oq-state.json").read_text())
    assert state["lifecycle_state"] == "working"


# ──────────────────────────────────────────────────────────────────────────────
# Budget met by POLLING ALONE when the decision arrives during the poll (nudge dropped)
# ──────────────────────────────────────────────────────────────────────────────

def test_unblock_within_budget_by_polling_alone(tmp_path: Path):
    """Decision arrives ~0.4 s after the poll starts; polling alone unblocks within budget.

    No nudge is fired (no worker_name), proving the file is authoritative and the
    budget (OQ-INV-18) is met without any send-prompt assistance.
    """
    oq_id = _emit_blocking(tmp_path)

    def _delayed_writer():
        time.sleep(0.4)
        _write_decision(tmp_path, oq_id)

    writer = threading.Thread(target=_delayed_writer)
    writer.start()
    try:
        result, elapsed = _poll(tmp_path, oq_id, interval="0.1")
    finally:
        writer.join()

    assert result.returncode == 0, result.stderr
    assert elapsed < _LATENCY_BUDGET_SECONDS, f"polling-alone unblock took {elapsed:.2f}s"
    state = json.loads((tmp_path / "oq-state.json").read_text())
    assert state["lifecycle_state"] == "working" and state["blocked_on"] is None


# ──────────────────────────────────────────────────────────────────────────────
# Nudge never LENGTHENS the latency (unreachable nudge is swallowed)
# ──────────────────────────────────────────────────────────────────────────────

def test_unreachable_nudge_does_not_lengthen_unblock(tmp_path: Path):
    """oq_decide with a worker_name whose nudge cannot be delivered still commits the
    decision and the worker unblocks within budget — the nudge never lengthens latency."""
    oq_id = _emit_blocking(tmp_path)
    # The conftest isolates KH_CMUX_EVENTS_DIR to an empty fleet, so the nudge's
    # worker scan finds nothing and the nudge fails fast (swallowed by oq_decide).
    decide = _decide_via_parent(tmp_path, oq_id, worker_name="unreachable-worker")
    assert decide.returncode == 0, f"oq_decide must succeed despite an unreachable nudge: {decide.stderr}"
    assert (tmp_path / "decisions" / f"{oq_id}.json").is_file()

    result, elapsed = _poll(tmp_path, oq_id)
    assert result.returncode == 0, result.stderr
    assert elapsed < _LATENCY_BUDGET_SECONDS, f"unblock took {elapsed:.2f}s with a failed nudge"


def test_dropping_nudge_still_meets_budget(tmp_path: Path):
    """oq_decide with NO worker_name (nudge dropped entirely) still meets the budget."""
    oq_id = _emit_blocking(tmp_path)
    decide = _decide_via_parent(tmp_path, oq_id, worker_name=None)
    assert decide.returncode == 0, decide.stderr
    result, elapsed = _poll(tmp_path, oq_id)
    assert result.returncode == 0, result.stderr
    assert elapsed < _LATENCY_BUDGET_SECONDS, f"unblock took {elapsed:.2f}s with no nudge"
    state = json.loads((tmp_path / "oq-state.json").read_text())
    assert state["lifecycle_state"] == "working"
