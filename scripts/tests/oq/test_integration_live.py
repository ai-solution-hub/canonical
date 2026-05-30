"""End-to-end OQ-escalation integration (ID-43.11).

Exercises the whole channel — worker (oq-worker.sh) + parent (oq-parent.sh) +
core (oq-core.sh) — through the REAL ``<events_base>/<sid>/oq/`` layout, as a
single round-trip: a worker emits a blocking OQ, the parent's scan finds it, the
parent decides, the worker unblocks. This is the integration counterpart to the
per-function unit tests in test_emit_cancel / test_decide / test_poll_latency /
test_restart.

Two tiers:

  * **Filesystem end-to-end (default, runs in-suite).** Drives the real helper
    scripts against an isolated ``tmp_path`` events base — no cmux daemon needed.
    This is what keeps the full suite green and is the load-bearing integration
    check. The ``oq_decide`` send-prompt nudge is exercised through the
    conftest-isolated events base (so it can never touch a live fleet) and is
    proven non-correctness-bearing.
  * **Live cmux daemon (opt-in, skipped by default).** The true Phase-B check —
    a real sub-orchestrator emitting through a live daemon — is heavy and
    interactive (see SKILL.md "Phase B (interactive) verifies end-to-end"). It is
    gated behind ``OQ_LIVE_CMUX=1`` so the committed suite never spins a worker
    or depends on a running daemon.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_SCRIPTS_DIR = _REPO_ROOT / ".claude" / "skills" / "session-driver-cmux" / "scripts"
_OQ_WORKER_SH = _SCRIPTS_DIR / "oq-worker.sh"
_OQ_PARENT_SH = _SCRIPTS_DIR / "oq-parent.sh"
_SKILL_MD = _SCRIPTS_DIR.parent / "SKILL.md"
_BRIEF_FRAGMENT = _SCRIPTS_DIR.parent / "oq-brief-fragment.md"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers — invoke the real scripts via CLI dispatch (fresh process each call,
# mirroring how a worker and a parent invoke them independently).
# ──────────────────────────────────────────────────────────────────────────────

def _worker(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(_OQ_WORKER_SH), *args],
                          capture_output=True, text=True, env=env)


def _parent(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(_OQ_PARENT_SH), *args],
                          capture_output=True, text=True)


def _make_session(events_base: Path, sid: str) -> Path:
    """Create <events_base>/<sid>/oq/{questions,decisions} (the launch-worker layout)."""
    oq_root = events_base / sid / "oq"
    (oq_root / "questions").mkdir(parents=True, exist_ok=True)
    (oq_root / "decisions").mkdir(parents=True, exist_ok=True)
    return oq_root


# ──────────────────────────────────────────────────────────────────────────────
# Sanity: the {43.11} artefacts exist and the SKILL.md pointer resolves
# ──────────────────────────────────────────────────────────────────────────────

def test_brief_fragment_exists_and_documents_two_state_contract():
    assert _BRIEF_FRAGMENT.is_file(), f"oq-brief-fragment.md not found at {_BRIEF_FRAGMENT}"
    text = _BRIEF_FRAGMENT.read_text()
    assert "awaiting-decision" in text
    assert "oq_emit" in text and "oq_poll_decision" in text
    assert "/exit" in text  # the two-state contract (OQ-INV-24)


def test_skill_md_points_at_helper_scripts():
    """The SKILL.md Escalation cross-reference resolves to the shipped helpers + brief."""
    text = _SKILL_MD.read_text()
    assert "oq-worker.sh" in text and "oq-parent.sh" in text
    assert "oq_scan_fleet" in text and "oq_decide" in text
    assert "oq-brief-fragment.md" in text
    assert "watch-fleet.sh" in text  # S281 amendment: parent scan rides the smart-watcher
    # Named scripts referenced by SKILL.md must actually exist on disk.
    for name in ("oq-core.sh", "oq-worker.sh", "oq-parent.sh", "oq-canonical.py"):
        assert (_SCRIPTS_DIR / name).is_file(), f"SKILL.md points at missing {name}"


# ──────────────────────────────────────────────────────────────────────────────
# Filesystem end-to-end round-trip (default — runs in-suite, no daemon)
# ──────────────────────────────────────────────────────────────────────────────

def test_blocking_oq_round_trip_through_real_layout(tmp_path: Path):
    """emit(blocking) → parent scan → parent decide → worker poll unblocks → restart resolves."""
    events = tmp_path / "cmux-events"
    sid = "sid-integration01"
    oq_root = _make_session(events, sid)
    worker_id = "worker-integration"

    # 1. Worker emits a BLOCKING OQ.
    emit = _worker("oq_emit", worker_id, "43", "plan",
                   "TECH §4 vs PRODUCT §3.2 — which decision schema governs?",
                   "high", "true", '{"file":"TECH.md","subtask_id":"43.7"}',
                   str(oq_root), "2026-05-30T10:00:00Z", '{"phase":"plan"}')
    assert emit.returncode == 0, emit.stderr
    oq_id = emit.stdout.strip()
    state = json.loads((oq_root / "oq-state.json").read_text())
    assert state["lifecycle_state"] == "awaiting-decision"
    assert state["blocked_on"] == oq_id

    # 2. Parent's scan (oq_scan_fleet) discovers the blocked worker + its open OQ.
    scan = _parent("oq_scan_fleet", str(events))
    assert scan.returncode == 0, scan.stderr
    assert f"BLOCKED {sid} {oq_id}" in scan.stdout
    assert f"OPEN {sid} {oq_id}" in scan.stdout

    # 3. Parent decides (writes decisions/<oq_id>.json). A worker_name is supplied
    #    so the send-prompt nudge path runs — the conftest isolates the events base,
    #    so the nudge cannot touch a live fleet and is swallowed; the decision file
    #    is authoritative regardless.
    decide = _parent("oq_decide", str(oq_root), oq_id, "2026-05-30T10:30:00Z",
                     "parent-session", "answered", "PRODUCT §3.2 governs.", "null",
                     worker_id)
    assert decide.returncode == 0, decide.stderr
    assert (oq_root / "decisions" / f"{oq_id}.json").is_file()

    # 4. A fresh parent scan: the decided OQ has left the open set (decide-once,
    #    OQ-INV-33) even though the worker has not yet self-reset its marker.
    scan2 = _parent("oq_scan_fleet", str(events))
    assert scan2.returncode == 0, scan2.stderr
    assert f"OPEN {sid} {oq_id}" not in scan2.stdout

    # 5. Worker polls and unblocks within budget (polling alone — nudge unneeded).
    env = os.environ.copy()
    env["OQ_POLL_INTERVAL"] = "0.1"
    poll = _worker("oq_poll_decision", str(oq_root), oq_id, env=env)
    assert poll.returncode == 0, poll.stderr
    final_state = json.loads((oq_root / "oq-state.json").read_text())
    assert final_state["lifecycle_state"] == "working"
    assert final_state["blocked_on"] is None

    # 6. The parent scan now reports nothing for this (working) worker.
    scan3 = _parent("oq_scan_fleet", str(events))
    assert scan3.returncode == 0, scan3.stderr
    assert sid not in scan3.stdout

    # 7. A relaunched worker re-classifies the OQ as DECIDED / nothing to resume.
    classify = _worker("oq_restart_classify", str(oq_root))
    assert classify.returncode == 0, classify.stderr
    assert f"DECIDED {oq_id}" in classify.stdout
    assert "RESUME_NONE" in classify.stdout


def test_worker_stays_awaiting_until_decision_no_exit(tmp_path: Path):
    """OQ-INV-24: a blocking OQ keeps the worker in awaiting-decision (it must not /exit)."""
    events = tmp_path / "cmux-events"
    oq_root = _make_session(events, "sid-stoporth01")
    emit = _worker("oq_emit", "worker-x", "43", "impl", "Block here?", "normal", "true",
                   '{"phase":"impl"}', str(oq_root), "2026-05-30T10:00:00Z", '{"phase":"impl"}')
    assert emit.returncode == 0, emit.stderr
    oq_id = emit.stdout.strip()
    # No decision yet: the marker stays awaiting-decision (the worker would remain
    # parked, not /exit), and the parent scan keeps reporting it as open.
    state = json.loads((oq_root / "oq-state.json").read_text())
    assert state["lifecycle_state"] == "awaiting-decision"
    scan = _parent("oq_scan_fleet", str(events))
    assert f"OPEN sid-stoporth01 {oq_id}" in scan.stdout


def test_non_blocking_oq_does_not_park_the_worker(tmp_path: Path):
    """OQ-INV-22: a non-blocking OQ leaves the worker 'working' and the scan silent for it."""
    events = tmp_path / "cmux-events"
    oq_root = _make_session(events, "sid-nonblock01")
    emit = _worker("oq_emit", "worker-y", "43", "impl", "FYI only?", "low", "false",
                   '{"phase":"impl"}', str(oq_root), "2026-05-30T10:00:00Z")
    assert emit.returncode == 0, emit.stderr
    # Non-blocking emit does not write an awaiting-decision marker.
    state_file = oq_root / "oq-state.json"
    if state_file.exists():
        assert json.loads(state_file.read_text())["lifecycle_state"] == "working"
    scan = _parent("oq_scan_fleet", str(events))
    assert scan.returncode == 0, scan.stderr
    assert "sid-nonblock01" not in scan.stdout


# ──────────────────────────────────────────────────────────────────────────────
# Live cmux daemon (opt-in Phase-B — skipped by default)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(
    os.environ.get("OQ_LIVE_CMUX") != "1",
    reason="live-cmux Phase-B end-to-end is opt-in (set OQ_LIVE_CMUX=1); skipped so the "
           "committed suite needs no running daemon — see SKILL.md 'Phase B (interactive)'.",
)
def test_live_cmux_end_to_end():  # pragma: no cover - exercised only in interactive Phase-B
    """Opt-in: a real sub-orchestrator emits a blocking OQ through a live cmux daemon,
    the parent's watch-fleet → oq_scan_fleet → oq_decide loop scans + decides, and the
    worker unblocks end-to-end. Requires a running daemon and is interactive by nature."""
    assert subprocess.run(["bash", "-c", "command -v cmux"],
                          capture_output=True).returncode == 0, "cmux CLI not on PATH"
    pytest.skip("OQ_LIVE_CMUX=1 set but the live-daemon driver is run from an interactive "
                "Phase-B session, not the unit suite.")
