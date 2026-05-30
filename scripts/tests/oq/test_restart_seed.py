"""Multi-worker restart-seeding harness (ID-43.10, OQ-INV-29 / OQ-INV-30).

Seeds several workers' OQ directories with a deliberate mix of open / decided /
cancelled / blocking / non-blocking records, then asserts that a FRESH (zero-
memory) parent and a FRESH worker re-derive exactly the same view as a
never-crashed process would — proving the re-derivation is stateless and
disk-only.  The "never-crashed view" is computed independently in Python from the
seed and compared against the helpers' output.

This is the cross-cutting, multi-worker counterpart to the single-worker checks in
test_restart.py; it lives in the ID-43.10 harness because it spans several workers
and both the worker (oq_restart_classify) and parent (oq_scan_fleet) read surfaces.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_SCRIPTS_DIR = _REPO_ROOT / ".claude" / "skills" / "session-driver-cmux" / "scripts"
_OQ_CANONICAL = _SCRIPTS_DIR / "oq-canonical.py"
_OQ_WORKER_SH = _SCRIPTS_DIR / "oq-worker.sh"
_OQ_PARENT_SH = _SCRIPTS_DIR / "oq-parent.sh"


def _stamp(obj: dict) -> dict:
    result = subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), "stamp"],
        input=json.dumps(obj), capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stamp failed: {result.stderr}"
    return json.loads(result.stdout)


def _write_canonical(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, sort_keys=True, separators=(",", ":")))


def _seed_question(oq_root: Path, oq_id: str, seq: int, *, blocking: bool, status: str = "open",
                   worker_id: str = "w") -> None:
    _write_canonical(oq_root / "questions" / f"{oq_id}.json", _stamp({
        "oq_id": oq_id, "worker_id": worker_id, "seq": seq, "emitted_at": "2026-05-30T10:00:00Z",
        "question": f"Q {oq_id}?", "urgency": "normal", "blocking": blocking,
        "context_ref": {}, "status": status, "supersedes": None, "schema_version": 1,
    }))


def _seed_decision(oq_root: Path, oq_id: str) -> None:
    _write_canonical(oq_root / "decisions" / f"{oq_id}.json", _stamp({
        "oq_id": oq_id, "decided_at": "2026-05-30T10:30:00Z", "decider_id": "parent",
        "outcome": "answered", "answer": "ok", "directive": None, "schema_version": 1,
    }))


def _seed_state(oq_root: Path, *, lifecycle_state: str, blocked_on: str | None,
                worker_id: str = "w") -> None:
    _write_canonical(oq_root / "oq-state.json", _stamp({
        "worker_id": worker_id, "lifecycle_state": lifecycle_state, "blocked_on": blocked_on,
        "checkpoint_ref": None, "updated_at": "2026-05-30T10:05:00Z", "schema_version": 1,
    }))


def _scan_fleet(events_base: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(_OQ_PARENT_SH), "oq_scan_fleet", str(events_base)],
        capture_output=True, text=True,
    )


def _restart_classify(oq_root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(_OQ_WORKER_SH), "oq_restart_classify", str(oq_root)],
        capture_output=True, text=True,
    )


def _make_worker(events: Path, sid: str) -> Path:
    oq_root = events / sid / "oq"
    (oq_root / "questions").mkdir(parents=True, exist_ok=True)
    (oq_root / "decisions").mkdir(parents=True, exist_ok=True)
    return oq_root


def _seed_fleet(events: Path) -> None:
    """Seed three workers with a deterministic open/decided/cancelled/blocking mix."""
    # w1: blocking q0 undecided + non-blocking q1 → awaiting on q0.
    w1 = _make_worker(events, "sid-w1")
    _seed_question(w1, "oq-w1blocking00001", 0, blocking=True, worker_id="w1")
    _seed_question(w1, "oq-w1nonblock00002", 1, blocking=False, worker_id="w1")
    _seed_state(w1, lifecycle_state="awaiting-decision", blocked_on="oq-w1blocking00001", worker_id="w1")

    # w2: blocking q0 DECIDED + blocking q1 undecided → awaiting on q1.
    w2 = _make_worker(events, "sid-w2")
    _seed_question(w2, "oq-w2decided000001", 0, blocking=True, worker_id="w2")
    _seed_decision(w2, "oq-w2decided000001")
    _seed_question(w2, "oq-w2blocking00002", 1, blocking=True, worker_id="w2")
    _seed_state(w2, lifecycle_state="awaiting-decision", blocked_on="oq-w2blocking00002", worker_id="w2")

    # w3: cancelled q0 + non-blocking q1, working (not blocked).
    w3 = _make_worker(events, "sid-w3")
    _seed_question(w3, "oq-w3cancelled0001", 0, blocking=True, status="cancelled", worker_id="w3")
    _seed_question(w3, "oq-w3nonblock00002", 1, blocking=False, worker_id="w3")
    _seed_state(w3, lifecycle_state="working", blocked_on=None, worker_id="w3")


# Never-crashed expectation, computed independently from the seed above.
_EXPECTED_SCAN_LINES = {
    "BLOCKED sid-w1 oq-w1blocking00001",
    "OPEN sid-w1 oq-w1blocking00001",
    "BLOCKED sid-w2 oq-w2blocking00002",
    "OPEN sid-w2 oq-w2blocking00002",
    # w3 is 'working' → no lines.
}


def test_fresh_parent_rederives_seeded_open_awaiting_set(tmp_path: Path):
    """A fresh parent's oq_scan_fleet matches the independently-computed never-crashed view."""
    events = tmp_path / "cmux-events"
    _seed_fleet(events)
    result = _scan_fleet(events)
    assert result.returncode == 0, result.stderr
    lines = {ln for ln in result.stdout.splitlines() if ln.strip()}
    assert lines == _EXPECTED_SCAN_LINES, f"got {lines}"


def test_two_independent_scans_are_byte_identical(tmp_path: Path):
    """Re-deriving twice as independent processes is byte-identical (statelessness, OQ-INV-30)."""
    events = tmp_path / "cmux-events"
    _seed_fleet(events)
    first = _scan_fleet(events)
    second = _scan_fleet(events)
    assert first.returncode == 0 and second.returncode == 0
    assert first.stdout == second.stdout


def test_each_worker_classification_matches_seed(tmp_path: Path):
    """Each fresh worker re-classifies its own OQs to the seeded truth (OQ-INV-29)."""
    events = tmp_path / "cmux-events"
    _seed_fleet(events)

    def classify_map(sid: str) -> dict[str, str]:
        res = _restart_classify(events / sid / "oq")
        assert res.returncode == 0, res.stderr
        out = {}
        for ln in res.stdout.splitlines():
            parts = ln.split()
            if len(parts) == 2 and parts[0] in {"RESOLVED", "DECIDED", "UNRESOLVED"}:
                out[parts[1]] = parts[0]
        return out

    assert classify_map("sid-w1") == {
        "oq-w1blocking00001": "UNRESOLVED",
        "oq-w1nonblock00002": "UNRESOLVED",
    }
    assert classify_map("sid-w2") == {
        "oq-w2decided000001": "DECIDED",
        "oq-w2blocking00002": "UNRESOLVED",
    }
    assert classify_map("sid-w3") == {
        "oq-w3cancelled0001": "RESOLVED",
        "oq-w3nonblock00002": "UNRESOLVED",
    }


def test_worker_classify_is_isolated_from_siblings(tmp_path: Path):
    """A worker's classification never references a sibling worker's oq_ids (OQ-INV-28)."""
    events = tmp_path / "cmux-events"
    _seed_fleet(events)
    res = _restart_classify(events / "sid-w1" / "oq")
    assert res.returncode == 0, res.stderr
    assert "oq-w2" not in res.stdout
    assert "oq-w3" not in res.stdout
