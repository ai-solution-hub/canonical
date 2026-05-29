"""Tests for oq-worker.sh oq_poll_decision + oq_check_decision.

Covers ID-43.8 testStrategy invariants:
  OQ-INV-16  — idempotent apply: re-applying a decision yields the same state.
  OQ-INV-17  — decision records are verified before applying (fail-closed).
  OQ-INV-18  — latency budget: decision present => observed within one poll interval
               (< 10s wall-clock with a short OQ_POLL_INTERVAL).
  OQ-INV-22  — non-blocking emit does NOT flip to awaiting-decision;
               oq_check_decision is one-shot and never alters lifecycle_state.
  OQ-INV-24  — worker round-trip closes via oq_poll_decision (poll loop).
  OQ-INV-27  — fail-closed on corrupt decision: state NOT reset to working.
  closes OQ-INV-8 — worker round-trip: poll loop completes the channel.
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

# ──────────────────────────────────────────────────────────────────────────────
# Resolve paths relative to this test file so tests are CWD-independent.
#
# scripts/tests/oq/test_poll_latency.py
#   └── scripts/tests/oq/         → parents[0]
#       └── scripts/tests/        → parents[1]
#           └── scripts/          → parents[2]
#               └── <repo root>   → parents[3]
# ──────────────────────────────────────────────────────────────────────────────

_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_SCRIPTS_DIR = _REPO_ROOT / ".claude" / "skills" / "session-driver-cmux" / "scripts"
_OQ_CANONICAL = _SCRIPTS_DIR / "oq-canonical.py"
_OQ_CORE_SH = _SCRIPTS_DIR / "oq-core.sh"
_OQ_WORKER_SH = _SCRIPTS_DIR / "oq-worker.sh"
_OQ_PARENT_SH = _SCRIPTS_DIR / "oq-parent.sh"

# Default poll interval for tests — fast enough to keep the suite snappy whilst
# also being representative of the poll-interval-is-the-latency-knob property.
_TEST_POLL_INTERVAL = "0.1"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _sq(s: str) -> str:
    """Single-quote a string for safe shell embedding (escape embedded single quotes)."""
    return "'" + s.replace("'", "'\\''") + "'"


def _stamp(obj: dict) -> dict:
    """Return *obj* stamped with its canonical checksum (via oq-canonical.py stamp)."""
    result = subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), "stamp"],
        input=json.dumps(obj),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stamp failed: {result.stderr}"
    return json.loads(result.stdout)


def _bash_worker(script: str, extra_env: dict | None = None) -> subprocess.CompletedProcess:
    """Run *script* in bash after sourcing oq-worker.sh (which sources oq-core.sh)."""
    full = f"source {_OQ_WORKER_SH}\n{script}"
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    return subprocess.run(["bash", "-c", full], capture_output=True, text=True, env=env)


def _bash_parent(script: str) -> subprocess.CompletedProcess:
    """Run *script* in bash after sourcing oq-parent.sh (which sources oq-core.sh)."""
    full = f"source {_OQ_PARENT_SH}\n{script}"
    return subprocess.run(["bash", "-c", full], capture_output=True, text=True)


def _bash_core(script: str) -> subprocess.CompletedProcess:
    """Run *script* in bash after sourcing oq-core.sh only."""
    full = f"source {_OQ_CORE_SH}\n{script}"
    return subprocess.run(["bash", "-c", full], capture_output=True, text=True)


def _oq_emit(
    oq_root: Path,
    *,
    worker_id: str = "worker-test",
    task_id: str = "43",
    phase: str = "implement",
    question: str = "Should we proceed?",
    urgency: str = "normal",
    blocking: str = "false",
    context_ref: dict | None = None,
    emitted_at: str = "2026-05-30T10:00:00Z",
    checkpoint_ref: str = "null",
) -> subprocess.CompletedProcess:
    """Call oq_emit via oq-worker.sh; oq_root is the oq/ root dir."""
    context_ref_json = json.dumps(context_ref or {})
    script = (
        f"oq_emit "
        f"{_sq(worker_id)} {_sq(task_id)} {_sq(phase)} {_sq(question)} "
        f"{_sq(urgency)} {_sq(blocking)} {_sq(context_ref_json)} "
        f"{_sq(str(oq_root))} {_sq(emitted_at)} {_sq(checkpoint_ref)}"
    )
    return _bash_worker(script)


def _oq_decide(
    oq_root: Path,
    oq_id: str,
    *,
    decided_at: str = "2026-05-30T10:05:00Z",
    decider_id: str = "liam",
    outcome: str = "answered",
    answer: str = "Proceed as planned.",
    directive_json: str = "null",
) -> subprocess.CompletedProcess:
    """Call oq_decide via oq-parent.sh."""
    script = (
        f"oq_decide "
        f"{_sq(str(oq_root))} "
        f"{_sq(oq_id)} "
        f"{_sq(decided_at)} "
        f"{_sq(decider_id)} "
        f"{_sq(outcome)} "
        f"{_sq(answer)} "
        f"{_sq(directive_json)}"
    )
    return _bash_parent(script)


def _oq_poll_decision(
    oq_root: Path,
    blocked_on: str,
    *,
    poll_interval: str = _TEST_POLL_INTERVAL,
    max_wait: str | None = None,
) -> subprocess.CompletedProcess:
    """Call oq_poll_decision via oq-worker.sh with the given env overrides."""
    script = (
        f"oq_poll_decision "
        f"{_sq(str(oq_root))} "
        f"{_sq(blocked_on)}"
    )
    extra: dict[str, str] = {"OQ_POLL_INTERVAL": poll_interval}
    if max_wait is not None:
        extra["OQ_POLL_MAX_WAIT"] = max_wait
    return _bash_worker(script, extra_env=extra)


def _oq_check_decision(
    oq_root: Path,
    oq_id: str,
) -> subprocess.CompletedProcess:
    """Call oq_check_decision via oq-worker.sh."""
    script = (
        f"oq_check_decision "
        f"{_sq(str(oq_root))} "
        f"{_sq(oq_id)}"
    )
    return _bash_worker(script)


def _read_state(oq_root: Path) -> dict:
    """Read and parse oq-state.json from *oq_root*."""
    state_file = oq_root / "oq-state.json"
    return json.loads(state_file.read_text(encoding="utf-8"))


def _write_corrupt_decision(oq_root: Path, oq_id: str) -> None:
    """Write a decision file with a corrupt checksum for *oq_id*."""
    decisions_dir = oq_root / "decisions"
    decisions_dir.mkdir(parents=True, exist_ok=True)
    # Build a valid decision record first, then corrupt its checksum.
    rec = {
        "oq_id": oq_id,
        "decided_at": "2026-05-30T10:05:00Z",
        "decider_id": "liam",
        "outcome": "answered",
        "answer": "Corrupt answer.",
        "directive": None,
        "schema_version": 1,
    }
    stamped = _stamp(rec)
    # Corrupt the checksum field — any other hex string of the same length.
    stamped["checksum"] = "ff" * 32
    (decisions_dir / f"{oq_id}.json").write_text(
        json.dumps(stamped, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Sanity: script files must exist
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_worker_sh_exists():
    assert _OQ_WORKER_SH.is_file(), f"oq-worker.sh not found at {_OQ_WORKER_SH}"


def test_oq_worker_sh_contains_poll_function():
    """oq-worker.sh must define oq_poll_decision."""
    content = _OQ_WORKER_SH.read_text(encoding="utf-8")
    assert "oq_poll_decision()" in content, "oq_poll_decision() not found in oq-worker.sh"


def test_oq_worker_sh_contains_check_function():
    """oq-worker.sh must define oq_check_decision."""
    content = _OQ_WORKER_SH.read_text(encoding="utf-8")
    assert "oq_check_decision()" in content, "oq_check_decision() not found in oq-worker.sh"


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-18: unblock within latency budget
# ──────────────────────────────────────────────────────────────────────────────

def test_poll_unblocks_when_decision_already_present(tmp_path: Path):
    """oq_poll_decision returns 0, state→working, blocked_on=null when decision
    is already present before the poll starts (OQ-INV-18, closes OQ-INV-8).

    Wall-clock must be well under 10s (the latency budget).
    """
    oq_root = tmp_path / "oq"

    # Emit a blocking question so state flips to awaiting-decision.
    emit_result = _oq_emit(
        oq_root,
        question="Is option A safe?",
        blocking="true",
        checkpoint_ref='{"step": "analyse"}',
    )
    assert emit_result.returncode == 0, f"oq_emit failed: {emit_result.stderr}"
    oq_id = emit_result.stdout.strip()

    # Confirm state is awaiting-decision.
    state = _read_state(oq_root)
    assert state["lifecycle_state"] == "awaiting-decision"
    assert state["blocked_on"] == oq_id

    # Write the decision BEFORE calling poll.
    decide_result = _oq_decide(oq_root, oq_id)
    assert decide_result.returncode == 0, f"oq_decide failed: {decide_result.stderr}"

    # Measure wall-clock for the poll.
    t0 = time.monotonic()
    poll_result = _oq_poll_decision(oq_root, oq_id)
    elapsed = time.monotonic() - t0

    assert poll_result.returncode == 0, (
        f"oq_poll_decision failed (rc={poll_result.returncode}): {poll_result.stderr}"
    )

    # State must be reset to working with blocked_on=null.
    state_after = _read_state(oq_root)
    assert state_after["lifecycle_state"] == "working", (
        f"Expected lifecycle_state=working; got {state_after['lifecycle_state']!r}"
    )
    assert state_after["blocked_on"] is None, (
        f"Expected blocked_on=null; got {state_after['blocked_on']!r}"
    )

    # Latency budget: well under 10s (OQ-INV-18).
    assert elapsed < 10.0, (
        f"Poll took {elapsed:.3f}s — exceeds 10s latency budget (OQ-INV-18)"
    )


def test_poll_unblocks_when_decision_arrives_shortly_after(tmp_path: Path):
    """oq_poll_decision detects a decision written ~0.3s after poll starts.

    The background thread writes the decision after a brief delay; the poll loop
    must observe it within one interval and return within the 10s budget
    (OQ-INV-18).
    """
    oq_root = tmp_path / "oq"

    # Emit a blocking question.
    emit_result = _oq_emit(
        oq_root,
        question="Should we continue?",
        blocking="true",
        checkpoint_ref='{"step": "wait"}',
    )
    assert emit_result.returncode == 0, f"oq_emit failed: {emit_result.stderr}"
    oq_id = emit_result.stdout.strip()

    decision_written = threading.Event()

    def _write_decision_after_delay():
        time.sleep(0.3)  # 300 ms after poll starts — within one 100 ms interval.
        _oq_decide(oq_root, oq_id)
        decision_written.set()

    writer = threading.Thread(target=_write_decision_after_delay, daemon=True)

    t0 = time.monotonic()
    writer.start()
    poll_result = _oq_poll_decision(oq_root, oq_id)
    elapsed = time.monotonic() - t0
    writer.join(timeout=2.0)

    assert poll_result.returncode == 0, (
        f"oq_poll_decision failed (rc={poll_result.returncode}): {poll_result.stderr}"
    )
    assert decision_written.is_set(), "Decision writer thread did not complete"

    state_after = _read_state(oq_root)
    assert state_after["lifecycle_state"] == "working"
    assert state_after["blocked_on"] is None

    # Wall-clock must be < 10s (OQ-INV-18).
    assert elapsed < 10.0, (
        f"Poll took {elapsed:.3f}s — exceeds 10s latency budget (OQ-INV-18)"
    )


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-16/17: idempotent apply
# ──────────────────────────────────────────────────────────────────────────────

def test_poll_idempotent_after_successful_unblock(tmp_path: Path):
    """After a successful poll (state=working), invoking oq_poll_decision again
    with state manually reset to awaiting-decision yields the same working state.

    This verifies that applying the same decision twice yields the same result
    (OQ-INV-16/17).
    """
    oq_root = tmp_path / "oq"

    # Emit + decide + poll (first time).
    emit_result = _oq_emit(
        oq_root,
        question="Option B safe?",
        blocking="true",
        checkpoint_ref='{"step": "check"}',
    )
    assert emit_result.returncode == 0, f"oq_emit failed: {emit_result.stderr}"
    oq_id = emit_result.stdout.strip()

    decide_result = _oq_decide(oq_root, oq_id)
    assert decide_result.returncode == 0

    poll1 = _oq_poll_decision(oq_root, oq_id)
    assert poll1.returncode == 0, f"First poll failed: {poll1.stderr}"

    state_after_first = _read_state(oq_root)
    assert state_after_first["lifecycle_state"] == "working"

    # Manually reset oq-state back to awaiting-decision (simulates re-invoke
    # scenario where the state flip is re-applied).  Decision file still present.
    bash_reset = _bash_core(
        f"build_state_record 'worker-test' 'awaiting-decision' {_sq(oq_id)} 'null' "
        f"'2026-05-30T10:10:00Z'"
    )
    assert bash_reset.returncode == 0, f"build_state_record failed: {bash_reset.stderr}"
    state_record = bash_reset.stdout.strip()

    state_file = oq_root / "oq-state.json"
    # Write via atomic_publish equivalent — direct write is fine for test setup.
    state_file.write_text(state_record, encoding="utf-8")

    # Second poll — decision already on disk; must reset to working again.
    poll2 = _oq_poll_decision(oq_root, oq_id)
    assert poll2.returncode == 0, f"Second poll failed: {poll2.stderr}"

    state_after_second = _read_state(oq_root)
    assert state_after_second["lifecycle_state"] == "working", (
        f"Expected working after second poll; got {state_after_second['lifecycle_state']!r}"
    )
    assert state_after_second["blocked_on"] is None, (
        f"Expected blocked_on=null after second poll; got {state_after_second['blocked_on']!r}"
    )


def test_poll_noop_when_already_working(tmp_path: Path):
    """oq_poll_decision is a no-op (returns 0 immediately) when state is already
    working — the loop guard is false (OQ-INV-16/17).
    """
    oq_root = tmp_path / "oq"

    # Emit a non-blocking question — state stays working.
    emit_result = _oq_emit(oq_root, question="Just informing.", blocking="false")
    assert emit_result.returncode == 0
    oq_id = emit_result.stdout.strip()

    # No oq-state.json means state is effectively "working" (not awaiting).
    # Poll must return 0 without modification.
    t0 = time.monotonic()
    poll_result = _oq_poll_decision(oq_root, oq_id)
    elapsed = time.monotonic() - t0

    assert poll_result.returncode == 0, (
        f"oq_poll_decision failed on working-state no-op: {poll_result.stderr}"
    )
    # Should return very quickly (no sleep should occur for a no-op).
    assert elapsed < 2.0, (
        f"No-op poll took {elapsed:.3f}s — should return immediately when not awaiting-decision"
    )


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-22: non-blocking stays working / oq_check_decision one-shot
# ──────────────────────────────────────────────────────────────────────────────

def test_nonblocking_emit_lifecycle_stays_working(tmp_path: Path):
    """A non-blocking emit must NOT flip lifecycle_state to awaiting-decision
    (OQ-INV-22).  oq_check_decision is one-shot and must not touch lifecycle_state.
    """
    oq_root = tmp_path / "oq"

    # Non-blocking emit — state must remain absent (no oq-state.json written).
    emit_result = _oq_emit(oq_root, question="FYI only.", blocking="false")
    assert emit_result.returncode == 0
    oq_id = emit_result.stdout.strip()

    state_file = oq_root / "oq-state.json"
    assert not state_file.exists(), (
        "oq-state.json must not exist after a non-blocking emit"
    )

    # Write a decision for the non-blocking OQ (parent may do this out-of-band).
    decide_result = _oq_decide(oq_root, oq_id)
    assert decide_result.returncode == 0

    # oq_check_decision — one-shot, should report DECISION_AVAILABLE.
    check_result = _oq_check_decision(oq_root, oq_id)
    assert check_result.returncode == 0, f"oq_check_decision failed: {check_result.stderr}"
    assert f"DECISION_AVAILABLE:{oq_id}" in check_result.stdout, (
        f"Expected DECISION_AVAILABLE in stdout; got: {check_result.stdout!r}"
    )

    # oq-state.json still must not exist — check did not flip state.
    assert not state_file.exists(), (
        "oq-state.json must not exist after oq_check_decision (it must not touch state)"
    )


def test_check_decision_no_decision_present(tmp_path: Path):
    """oq_check_decision returns 0 silently when no decision is present."""
    oq_root = tmp_path / "oq"
    oq_id = "oq-zz00000000000001"

    result = _oq_check_decision(oq_root, oq_id)
    assert result.returncode == 0, f"oq_check_decision failed: {result.stderr}"
    assert result.stdout.strip() == "", (
        f"Expected empty stdout when no decision present; got: {result.stdout!r}"
    )


def test_check_decision_does_not_alter_state(tmp_path: Path):
    """oq_check_decision must never alter oq-state.json (blocking or not)."""
    oq_root = tmp_path / "oq"

    # Emit blocking — state becomes awaiting-decision.
    emit_result = _oq_emit(
        oq_root,
        question="Shall we wait?",
        blocking="true",
        checkpoint_ref='{"step": "hold"}',
    )
    assert emit_result.returncode == 0
    oq_id = emit_result.stdout.strip()

    state_before = _read_state(oq_root)
    assert state_before["lifecycle_state"] == "awaiting-decision"

    # Write a decision.
    decide_result = _oq_decide(oq_root, oq_id)
    assert decide_result.returncode == 0

    # Call oq_check_decision.
    check_result = _oq_check_decision(oq_root, oq_id)
    assert check_result.returncode == 0
    assert f"DECISION_AVAILABLE:{oq_id}" in check_result.stdout

    # State must still be awaiting-decision — check must NOT have reset it.
    state_after = _read_state(oq_root)
    assert state_after["lifecycle_state"] == "awaiting-decision", (
        f"oq_check_decision must not alter lifecycle_state; "
        f"got {state_after['lifecycle_state']!r}"
    )
    assert state_after["blocked_on"] == oq_id, (
        f"oq_check_decision must not alter blocked_on; "
        f"got {state_after['blocked_on']!r}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-27: fail-closed on corrupt decision
# ──────────────────────────────────────────────────────────────────────────────

def test_poll_fail_closed_on_corrupt_decision(tmp_path: Path):
    """oq_poll_decision returns non-zero with channel error when the decision
    file has a corrupt checksum; state must NOT be reset to working (OQ-INV-27).
    """
    oq_root = tmp_path / "oq"

    # Emit a blocking question.
    emit_result = _oq_emit(
        oq_root,
        question="Is this data valid?",
        blocking="true",
        checkpoint_ref='{"step": "validate"}',
    )
    assert emit_result.returncode == 0
    oq_id = emit_result.stdout.strip()

    # Confirm awaiting-decision.
    state_before = _read_state(oq_root)
    assert state_before["lifecycle_state"] == "awaiting-decision"

    # Write a CORRUPT decision file.
    _write_corrupt_decision(oq_root, oq_id)

    # Poll must fail (non-zero) without resetting state.
    poll_result = _oq_poll_decision(
        oq_root,
        oq_id,
        max_wait="2",  # Bound the test in case something goes wrong.
    )
    assert poll_result.returncode != 0, (
        "oq_poll_decision must return non-zero on a corrupt decision (OQ-INV-27)"
    )
    assert "channel error" in poll_result.stderr, (
        f"Expected 'channel error' in stderr; got: {poll_result.stderr!r}"
    )

    # State must NOT have been reset to working.
    state_after = _read_state(oq_root)
    assert state_after["lifecycle_state"] == "awaiting-decision", (
        f"State must remain awaiting-decision after corrupt-decision failure; "
        f"got {state_after['lifecycle_state']!r}"
    )


def test_check_decision_fail_closed_on_corrupt_decision(tmp_path: Path):
    """oq_check_decision returns non-zero with channel error on corrupt decision."""
    oq_root = tmp_path / "oq"
    oq_id = "oq-zz00000000000002"

    _write_corrupt_decision(oq_root, oq_id)

    result = _oq_check_decision(oq_root, oq_id)
    assert result.returncode != 0, (
        "oq_check_decision must return non-zero on a corrupt decision file"
    )
    assert "channel error" in result.stderr, (
        f"Expected 'channel error' in stderr; got: {result.stderr!r}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# No premature unblock: OQ_POLL_MAX_WAIT + no decision present
# ──────────────────────────────────────────────────────────────────────────────

def test_poll_no_premature_unblock_on_timeout(tmp_path: Path):
    """When OQ_POLL_MAX_WAIT is set and no decision arrives, oq_poll_decision
    returns exit code 3 (distinct timeout code) without resetting state to working.

    This verifies the 'no premature unblock' property — an unanswered question
    never flips the lifecycle_state back to working on timeout.
    """
    oq_root = tmp_path / "oq"

    # Emit a blocking question — no decision will be written.
    emit_result = _oq_emit(
        oq_root,
        question="Will this ever be answered?",
        blocking="true",
        checkpoint_ref='{"step": "wait-forever"}',
    )
    assert emit_result.returncode == 0
    oq_id = emit_result.stdout.strip()

    state_before = _read_state(oq_root)
    assert state_before["lifecycle_state"] == "awaiting-decision"

    # Poll with a very short max-wait — no decision present; must timeout.
    poll_result = _oq_poll_decision(
        oq_root,
        oq_id,
        poll_interval="0.05",  # Fast poll so the test stays quick.
        max_wait="0.2",         # 200 ms max — expires before any decision arrives.
    )

    # Must return distinct timeout code 3.
    assert poll_result.returncode == 3, (
        f"Expected exit code 3 (timeout) when no decision present; "
        f"got rc={poll_result.returncode}; stderr={poll_result.stderr!r}"
    )

    # State must remain awaiting-decision (no premature unblock).
    state_after = _read_state(oq_root)
    assert state_after["lifecycle_state"] == "awaiting-decision", (
        f"State must remain awaiting-decision on timeout; "
        f"got {state_after['lifecycle_state']!r}"
    )
    assert state_after["blocked_on"] == oq_id, (
        f"blocked_on must remain {oq_id!r} on timeout; "
        f"got {state_after['blocked_on']!r}"
    )


def test_poll_timeout_has_channel_error_message(tmp_path: Path):
    """Timeout exit (code 3) must emit a UK-English 'channel error:' message to stderr."""
    oq_root = tmp_path / "oq"

    emit_result = _oq_emit(
        oq_root,
        question="Timeout test question?",
        blocking="true",
        checkpoint_ref='{"step": "timeout-check"}',
    )
    assert emit_result.returncode == 0
    oq_id = emit_result.stdout.strip()

    poll_result = _oq_poll_decision(
        oq_root,
        oq_id,
        poll_interval="0.05",
        max_wait="0.2",
    )

    assert poll_result.returncode == 3
    assert "channel error" in poll_result.stderr, (
        f"Expected 'channel error' in stderr on timeout; got: {poll_result.stderr!r}"
    )
    # The oq_id must appear in the message so callers can diagnose which OQ timed out.
    assert oq_id in poll_result.stderr, (
        f"Expected oq_id {oq_id!r} in timeout error message"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Worker_id preservation across state reset
# ──────────────────────────────────────────────────────────────────────────────

def test_poll_preserves_worker_id_in_reset_state(tmp_path: Path):
    """After oq_poll_decision resets state to working, the worker_id in
    oq-state.json must be preserved from the awaiting-decision record.
    """
    oq_root = tmp_path / "oq"
    worker_id = "worker-preserve-test"

    emit_result = _oq_emit(
        oq_root,
        worker_id=worker_id,
        question="Does worker_id survive?",
        blocking="true",
        checkpoint_ref='{"step": "preserve"}',
    )
    assert emit_result.returncode == 0
    oq_id = emit_result.stdout.strip()

    state = _read_state(oq_root)
    assert state["worker_id"] == worker_id

    decide_result = _oq_decide(oq_root, oq_id)
    assert decide_result.returncode == 0

    poll_result = _oq_poll_decision(oq_root, oq_id)
    assert poll_result.returncode == 0

    state_after = _read_state(oq_root)
    assert state_after["worker_id"] == worker_id, (
        f"worker_id must be preserved in reset state; "
        f"got {state_after['worker_id']!r}, expected {worker_id!r}"
    )
    assert state_after["lifecycle_state"] == "working"
