"""Tests for ID-43.9: crash/restart re-derivation + fail-closed (worker + parent).

Covers the {43.9} testStrategy and invariants:
  OQ-INV-20  — parent reads ONLY oq-state.json to decide which workers are blocked.
  OQ-INV-21  — restart-while-blocked re-enters awaiting-decision and resumes WITHOUT
               re-running the OQ-producing work (oq_restart_classify is pure-read).
  OQ-INV-23  — a blocked worker's open-awaiting OQs are listed FIFO (seq order).
  OQ-INV-27  — every read is fail-closed: a corrupt record halts with a channel error,
               never a silent skip.
  OQ-INV-28  — per-worker isolation: oq_restart_classify(A) never sees B's OQs; only the
               parent's sibling-dir oq_scan_fleet sees across workers.
  OQ-INV-29  — worker re-classifies open/decided/cancelled purely from disk, no parent.
  OQ-INV-30  — a fresh (zero-memory) parent re-derives the same open-awaiting set as a
               never-crashed parent (stateless set-difference over disk).
  OQ-INV-32  — worker contract: classify before resuming; never re-run produced work.
  OQ-INV-33  — parent's decide-once guard is disk-derived; decided OQs leave the open set.

These run as plain filesystem unit tests — no live cmux daemon.  Each test uses the
per-test ``tmp_path`` fixture so its oq_root / events-base is fully isolated.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

# ──────────────────────────────────────────────────────────────────────────────
# Resolve paths relative to this test file so tests are CWD-independent.
#   scripts/tests/oq/test_restart.py → parents[3] == <repo root>
# ──────────────────────────────────────────────────────────────────────────────

_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_SCRIPTS_DIR = _REPO_ROOT / ".claude" / "skills" / "session-driver-cmux" / "scripts"
_OQ_CANONICAL = _SCRIPTS_DIR / "oq-canonical.py"
_OQ_WORKER_SH = _SCRIPTS_DIR / "oq-worker.sh"
_OQ_PARENT_SH = _SCRIPTS_DIR / "oq-parent.sh"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _sq(s: str) -> str:
    """Single-quote a string for safe shell embedding."""
    return "'" + s.replace("'", "'\\''") + "'"


def _stamp(obj: dict) -> dict:
    """Return *obj* stamped with its canonical checksum (via oq-canonical.py)."""
    result = subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), "stamp"],
        input=json.dumps(obj),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stamp failed: {result.stderr}"
    return json.loads(result.stdout)


def _write_canonical(path: Path, obj: dict) -> None:
    """Write *obj* as canonical JSON to *path*, creating parents as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, sort_keys=True, separators=(",", ":")))


def _restart_classify(oq_root: Path) -> subprocess.CompletedProcess:
    """Invoke oq_restart_classify via oq-worker.sh CLI dispatch (fresh process)."""
    return subprocess.run(
        ["bash", str(_OQ_WORKER_SH), "oq_restart_classify", str(oq_root)],
        capture_output=True,
        text=True,
    )


def _scan_fleet(events_base: Path) -> subprocess.CompletedProcess:
    """Invoke oq_scan_fleet via oq-parent.sh CLI dispatch (fresh process)."""
    return subprocess.run(
        ["bash", str(_OQ_PARENT_SH), "oq_scan_fleet", str(events_base)],
        capture_output=True,
        text=True,
    )


def _seed_question(
    oq_root: Path,
    oq_id: str,
    seq: int,
    *,
    blocking: bool = True,
    status: str = "open",
    worker_id: str = "worker-test",
    emitted_at: str = "2026-05-30T10:00:00Z",
    urgency: str = "normal",
    supersedes: str | None = None,
) -> None:
    """Seed a stamped OQ question record at oq_root/questions/<oq_id>.json."""
    rec = {
        "oq_id": oq_id,
        "worker_id": worker_id,
        "seq": seq,
        "emitted_at": emitted_at,
        "question": f"Question for {oq_id}?",
        "urgency": urgency,
        "blocking": blocking,
        "context_ref": {"phase": "plan"},
        "status": status,
        "supersedes": supersedes,
        "schema_version": 1,
    }
    _write_canonical(oq_root / "questions" / f"{oq_id}.json", _stamp(rec))


def _seed_decision(
    oq_root: Path,
    oq_id: str,
    *,
    outcome: str = "answered",
    answer: str = "Proceed.",
) -> None:
    """Seed a stamped decision record at oq_root/decisions/<oq_id>.json."""
    rec = {
        "oq_id": oq_id,
        "decided_at": "2026-05-30T10:30:00Z",
        "decider_id": "parent",
        "outcome": outcome,
        "answer": answer,
        "directive": None,
        "schema_version": 1,
    }
    _write_canonical(oq_root / "decisions" / f"{oq_id}.json", _stamp(rec))


def _seed_state(
    oq_root: Path,
    *,
    lifecycle_state: str,
    blocked_on: str | None,
    worker_id: str = "worker-test",
    checkpoint_ref: dict | None = None,
    updated_at: str = "2026-05-30T10:05:00Z",
) -> None:
    """Seed a stamped oq-state record at oq_root/oq-state.json."""
    rec = {
        "worker_id": worker_id,
        "lifecycle_state": lifecycle_state,
        "blocked_on": blocked_on,
        "checkpoint_ref": checkpoint_ref,
        "updated_at": updated_at,
        "schema_version": 1,
    }
    _write_canonical(oq_root / "oq-state.json", _stamp(rec))


def _classify_map(stdout: str) -> dict[str, str]:
    """Parse classification lines (LABEL <oq_id>) into {oq_id: label}, excluding RESUME_*."""
    out: dict[str, str] = {}
    for line in stdout.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] in {"RESOLVED", "DECIDED", "UNRESOLVED"}:
            out[parts[1]] = parts[0]
    return out


def _resume_line(stdout: str) -> str:
    """Return the single RESUME_* directive line from classify output."""
    for line in stdout.splitlines():
        if line.startswith("RESUME_"):
            return line.strip()
    return ""


# ──────────────────────────────────────────────────────────────────────────────
# Sanity
# ──────────────────────────────────────────────────────────────────────────────

def test_scripts_exist():
    assert _OQ_WORKER_SH.is_file()
    assert _OQ_PARENT_SH.is_file()


# ──────────────────────────────────────────────────────────────────────────────
# Worker restart classification (OQ-INV-29, OQ-INV-32)
# ──────────────────────────────────────────────────────────────────────────────

def test_classify_mixed_open_decided_cancelled(tmp_path: Path):
    """A relaunched worker classifies a seeded open/decided/cancelled mix from disk."""
    _seed_question(tmp_path, "oq-open00000000001", seq=0, blocking=True)
    _seed_question(tmp_path, "oq-decided00000002", seq=1, blocking=True)
    _seed_decision(tmp_path, "oq-decided00000002")
    _seed_question(tmp_path, "oq-cancelled000003", seq=2, blocking=False, status="cancelled")

    result = _restart_classify(tmp_path)
    assert result.returncode == 0, f"classify failed: {result.stderr}"
    labels = _classify_map(result.stdout)
    assert labels == {
        "oq-open00000000001": "UNRESOLVED",
        "oq-decided00000002": "DECIDED",
        "oq-cancelled000003": "RESOLVED",
    }


def test_classify_orders_by_seq_fifo(tmp_path: Path):
    """Classification lines appear in in-record seq order (OQ-INV-4), not filename order."""
    # Filenames sort 'a' < 'b' < 'c'; seqs are deliberately the reverse.
    _seed_question(tmp_path, "oq-aaaaaaaaaaaaaaa1", seq=2)
    _seed_question(tmp_path, "oq-bbbbbbbbbbbbbbb2", seq=0)
    _seed_question(tmp_path, "oq-ccccccccccccccc3", seq=1)

    result = _restart_classify(tmp_path)
    assert result.returncode == 0, result.stderr
    ordered = [ln.split()[1] for ln in result.stdout.splitlines() if not ln.startswith("RESUME_")]
    assert ordered == ["oq-bbbbbbbbbbbbbbb2", "oq-ccccccccccccccc3", "oq-aaaaaaaaaaaaaaa1"]


def test_classify_no_parent_involvement_is_pure_read(tmp_path: Path):
    """oq_restart_classify writes nothing — it re-derives purely from disk (OQ-INV-29).

    Proves OQ-INV-21: a restart does not re-run produced work or mutate any record.
    """
    _seed_question(tmp_path, "oq-open00000000001", seq=0, blocking=True)
    _seed_state(tmp_path, lifecycle_state="awaiting-decision", blocked_on="oq-open00000000001")

    before = {p: p.read_bytes() for p in sorted(tmp_path.rglob("*.json"))}
    result = _restart_classify(tmp_path)
    assert result.returncode == 0, result.stderr
    after = {p: p.read_bytes() for p in sorted(tmp_path.rglob("*.json"))}
    assert before == after, "classify must not create, delete, or modify any record"


def test_classify_empty_dir_returns_resume_none(tmp_path: Path):
    """A worker with no OQs at all classifies cleanly with RESUME_NONE."""
    (tmp_path / "questions").mkdir(parents=True)
    (tmp_path / "decisions").mkdir(parents=True)
    result = _restart_classify(tmp_path)
    assert result.returncode == 0, result.stderr
    assert _classify_map(result.stdout) == {}
    assert _resume_line(result.stdout) == "RESUME_NONE"


# ──────────────────────────────────────────────────────────────────────────────
# Resume directive derivation (OQ-INV-21)
# ──────────────────────────────────────────────────────────────────────────────

def test_resume_poll_when_blocked_on_unresolved(tmp_path: Path):
    """awaiting-decision + blocked_on UNRESOLVED ⇒ RESUME_POLL (resume polling)."""
    _seed_question(tmp_path, "oq-blocking00000001", seq=0, blocking=True)
    _seed_state(
        tmp_path,
        lifecycle_state="awaiting-decision",
        blocked_on="oq-blocking00000001",
        checkpoint_ref={"phase": "plan", "note": "resume here"},
    )
    result = _restart_classify(tmp_path)
    assert result.returncode == 0, result.stderr
    assert _resume_line(result.stdout) == "RESUME_POLL oq-blocking00000001"


def test_resume_apply_when_decision_arrived_during_downtime(tmp_path: Path):
    """awaiting-decision + blocked_on DECIDED ⇒ RESUME_APPLY (apply on restart)."""
    _seed_question(tmp_path, "oq-blocking00000001", seq=0, blocking=True)
    _seed_decision(tmp_path, "oq-blocking00000001")
    _seed_state(
        tmp_path,
        lifecycle_state="awaiting-decision",
        blocked_on="oq-blocking00000001",
    )
    result = _restart_classify(tmp_path)
    assert result.returncode == 0, result.stderr
    assert _resume_line(result.stdout) == "RESUME_APPLY oq-blocking00000001"


def test_resume_none_when_working(tmp_path: Path):
    """A working worker (not blocked) ⇒ RESUME_NONE."""
    _seed_question(tmp_path, "oq-nb0000000000001", seq=0, blocking=False)
    _seed_state(tmp_path, lifecycle_state="working", blocked_on=None)
    result = _restart_classify(tmp_path)
    assert result.returncode == 0, result.stderr
    assert _resume_line(result.stdout) == "RESUME_NONE"


def test_resume_none_when_blocked_on_cancelled(tmp_path: Path):
    """awaiting-decision but blocked_on was cancelled (RESOLVED) ⇒ RESUME_NONE."""
    _seed_question(tmp_path, "oq-cancelled000001", seq=0, blocking=True, status="cancelled")
    _seed_state(
        tmp_path,
        lifecycle_state="awaiting-decision",
        blocked_on="oq-cancelled000001",
    )
    result = _restart_classify(tmp_path)
    assert result.returncode == 0, result.stderr
    assert _resume_line(result.stdout) == "RESUME_NONE"


# ──────────────────────────────────────────────────────────────────────────────
# Fail-closed reads (OQ-INV-27)
# ──────────────────────────────────────────────────────────────────────────────

def test_classify_fail_closed_on_corrupt_question(tmp_path: Path):
    """A corrupt question record halts classification with a channel error (no silent skip)."""
    _seed_question(tmp_path, "oq-good00000000001", seq=0)
    # Corrupt a second question: tamper the checksum.
    rec = {
        "oq_id": "oq-bad000000000002",
        "worker_id": "worker-test",
        "seq": 1,
        "emitted_at": "2026-05-30T10:00:00Z",
        "question": "Tampered?",
        "urgency": "normal",
        "blocking": True,
        "context_ref": {},
        "status": "open",
        "supersedes": None,
        "schema_version": 1,
        "checksum": "deadbeef" * 8,
    }
    _write_canonical(tmp_path / "questions" / "oq-bad000000000002.json", rec)

    result = _restart_classify(tmp_path)
    assert result.returncode != 0, "must fail closed on a corrupt question record"
    assert "channel error" in result.stderr


def test_classify_fail_closed_on_corrupt_state(tmp_path: Path):
    """A corrupt oq-state.json halts classification with a channel error."""
    _seed_question(tmp_path, "oq-open00000000001", seq=0, blocking=True)
    # Corrupt state: bad checksum.
    bad_state = {
        "worker_id": "worker-test",
        "lifecycle_state": "awaiting-decision",
        "blocked_on": "oq-open00000000001",
        "checkpoint_ref": None,
        "updated_at": "2026-05-30T10:05:00Z",
        "schema_version": 1,
        "checksum": "0" * 64,
    }
    _write_canonical(tmp_path / "oq-state.json", bad_state)
    result = _restart_classify(tmp_path)
    assert result.returncode != 0, "must fail closed on a corrupt state record"
    assert "channel error" in result.stderr


def test_classify_fail_closed_on_corrupt_decision(tmp_path: Path):
    """A present-but-corrupt decision for a blocking OQ halts classification (fail-closed)."""
    _seed_question(tmp_path, "oq-blocking00000001", seq=0, blocking=True)
    bad_decision = {
        "oq_id": "oq-blocking00000001",
        "decided_at": "2026-05-30T10:30:00Z",
        "decider_id": "parent",
        "outcome": "answered",
        "answer": "Proceed.",
        "directive": None,
        "schema_version": 1,
        "checksum": "f" * 64,
    }
    _write_canonical(tmp_path / "decisions" / "oq-blocking00000001.json", bad_decision)
    result = _restart_classify(tmp_path)
    assert result.returncode != 0, "must fail closed on a corrupt decision record"
    assert "channel error" in result.stderr


def test_classify_fail_closed_on_dangling_blocked_on(tmp_path: Path):
    """awaiting-decision pointing at a blocked_on with no question is corruption ⇒ fail-closed."""
    _seed_state(
        tmp_path,
        lifecycle_state="awaiting-decision",
        blocked_on="oq-missing000000001",
    )
    (tmp_path / "questions").mkdir(parents=True, exist_ok=True)
    result = _restart_classify(tmp_path)
    assert result.returncode != 0
    assert "channel error" in result.stderr


# ──────────────────────────────────────────────────────────────────────────────
# Per-worker isolation (OQ-INV-28)
# ──────────────────────────────────────────────────────────────────────────────

def test_worker_classify_sees_only_own_dir(tmp_path: Path):
    """oq_restart_classify(B) never sees worker A's OQs — directory-boundary isolation."""
    a_root = tmp_path / "sid-a" / "oq"
    b_root = tmp_path / "sid-b" / "oq"
    _seed_question(a_root, "oq-aworker00000001", seq=0, worker_id="worker-a")
    _seed_question(b_root, "oq-bworker00000001", seq=0, worker_id="worker-b")

    result_b = _restart_classify(b_root)
    assert result_b.returncode == 0, result_b.stderr
    labels = _classify_map(result_b.stdout)
    assert "oq-bworker00000001" in labels
    assert "oq-aworker00000001" not in labels, "worker B must not see worker A's OQ"


# ──────────────────────────────────────────────────────────────────────────────
# Parent fleet scan (OQ-INV-20, OQ-INV-23, OQ-INV-28, OQ-INV-30, OQ-INV-33)
# ──────────────────────────────────────────────────────────────────────────────

def _make_worker_dir(events_base: Path, sid: str) -> Path:
    """Return the oq root for <events_base>/<sid>/oq, creating the dirs."""
    oq_root = events_base / sid / "oq"
    (oq_root / "questions").mkdir(parents=True, exist_ok=True)
    (oq_root / "decisions").mkdir(parents=True, exist_ok=True)
    return oq_root


def test_scan_reports_blocked_worker_with_open_fifo(tmp_path: Path):
    """oq_scan_fleet reports BLOCKED + OPEN (FIFO) for a worker awaiting a blocking OQ."""
    events = tmp_path / "cmux-events"
    a = _make_worker_dir(events, "sid-aaa")
    _seed_question(a, "oq-first0000000001", seq=0, blocking=True)
    _seed_state(a, lifecycle_state="awaiting-decision", blocked_on="oq-first0000000001",
                worker_id="worker-a")

    result = _scan_fleet(events)
    assert result.returncode == 0, result.stderr
    assert "BLOCKED sid-aaa oq-first0000000001" in result.stdout
    assert "OPEN sid-aaa oq-first0000000001" in result.stdout


def test_scan_open_list_is_seq_fifo_and_blocking_only(tmp_path: Path):
    """OPEN lines are seq-sorted (FIFO, OQ-INV-23) and exclude non-blocking OQs."""
    events = tmp_path / "cmux-events"
    a = _make_worker_dir(events, "sid-aaa")
    # Two blocking OQs (seq 2 then 0) + one non-blocking — non-blocking must not appear.
    _seed_question(a, "oq-blockhi000000002", seq=2, blocking=True)
    _seed_question(a, "oq-blocklo000000001", seq=0, blocking=True)
    _seed_question(a, "oq-nonblocking00003", seq=1, blocking=False)
    _seed_state(a, lifecycle_state="awaiting-decision", blocked_on="oq-blocklo000000001",
                worker_id="worker-a")

    result = _scan_fleet(events)
    assert result.returncode == 0, result.stderr
    open_ids = [ln.split()[2] for ln in result.stdout.splitlines() if ln.startswith("OPEN ")]
    assert open_ids == ["oq-blocklo000000001", "oq-blockhi000000002"], open_ids
    assert "oq-nonblocking00003" not in open_ids


def test_scan_excludes_working_workers(tmp_path: Path):
    """A worker in 'working' state emits no BLOCKED/OPEN line (OQ-INV-20 marker read)."""
    events = tmp_path / "cmux-events"
    w = _make_worker_dir(events, "sid-working")
    _seed_question(w, "oq-nb0000000000001", seq=0, blocking=False)
    _seed_state(w, lifecycle_state="working", blocked_on=None, worker_id="worker-w")
    result = _scan_fleet(events)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "", f"working worker should emit nothing: {result.stdout!r}"


def test_scan_skips_workers_without_oq_state(tmp_path: Path):
    """A session dir with no oq-state.json is skipped cleanly (absence is not corruption)."""
    events = tmp_path / "cmux-events"
    (events / "sid-no-channel").mkdir(parents=True)
    (events / "sid-no-channel" / "events.jsonl").write_text("{}\n")
    result = _scan_fleet(events)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == ""


def test_scan_decided_oq_leaves_open_set(tmp_path: Path):
    """A decided blocking OQ is removed from the OPEN set (decide-once disk-derived, OQ-INV-33)."""
    events = tmp_path / "cmux-events"
    a = _make_worker_dir(events, "sid-aaa")
    _seed_question(a, "oq-decided00000001", seq=0, blocking=True)
    _seed_decision(a, "oq-decided00000001")
    _seed_state(a, lifecycle_state="awaiting-decision", blocked_on="oq-decided00000001",
                worker_id="worker-a")
    result = _scan_fleet(events)
    assert result.returncode == 0, result.stderr
    # Marker still says awaiting (worker has not self-reset) ⇒ BLOCKED reported,
    # but the decided OQ has left the open set ⇒ no OPEN line.
    assert "BLOCKED sid-aaa oq-decided00000001" in result.stdout
    open_lines = [ln for ln in result.stdout.splitlines() if ln.startswith("OPEN ")]
    assert open_lines == [], f"decided OQ must not appear in the open set: {open_lines}"


def test_scan_cross_worker_sees_all_siblings(tmp_path: Path):
    """The parent sibling-dir scan sees BOTH workers' blocked OQs (cross-worker, OQ-INV-28)."""
    events = tmp_path / "cmux-events"
    a = _make_worker_dir(events, "sid-aaa")
    b = _make_worker_dir(events, "sid-bbb")
    _seed_question(a, "oq-aworker00000001", seq=0, blocking=True)
    _seed_state(a, lifecycle_state="awaiting-decision", blocked_on="oq-aworker00000001",
                worker_id="worker-a")
    _seed_question(b, "oq-bworker00000001", seq=0, blocking=True)
    _seed_state(b, lifecycle_state="awaiting-decision", blocked_on="oq-bworker00000001",
                worker_id="worker-b")

    result = _scan_fleet(events)
    assert result.returncode == 0, result.stderr
    assert "BLOCKED sid-aaa oq-aworker00000001" in result.stdout
    assert "BLOCKED sid-bbb oq-bworker00000001" in result.stdout


def test_scan_fresh_parent_equals_never_crashed(tmp_path: Path):
    """A fresh (zero-memory) parent re-derives the identical open-awaiting set (OQ-INV-30).

    Statelessness is proven by invoking oq_scan_fleet twice as independent processes
    (each a 'fresh parent') and asserting byte-identical output.
    """
    events = tmp_path / "cmux-events"
    a = _make_worker_dir(events, "sid-aaa")
    b = _make_worker_dir(events, "sid-bbb")
    _seed_question(a, "oq-aworker00000001", seq=0, blocking=True)
    _seed_state(a, lifecycle_state="awaiting-decision", blocked_on="oq-aworker00000001",
                worker_id="worker-a")
    _seed_question(b, "oq-bworker00000001", seq=0, blocking=True)
    _seed_question(b, "oq-bworker00000002", seq=1, blocking=True)
    _seed_state(b, lifecycle_state="awaiting-decision", blocked_on="oq-bworker00000001",
                worker_id="worker-b")

    first = _scan_fleet(events)
    second = _scan_fleet(events)
    assert first.returncode == 0 and second.returncode == 0
    assert first.stdout == second.stdout, "stateless re-derivation must be identical"


def test_scan_fail_closed_on_corrupt_state(tmp_path: Path):
    """A corrupt oq-state.json in any sibling dir fails the scan closed (OQ-INV-27)."""
    events = tmp_path / "cmux-events"
    a = _make_worker_dir(events, "sid-aaa")
    bad_state = {
        "worker_id": "worker-a",
        "lifecycle_state": "awaiting-decision",
        "blocked_on": "oq-x000000000000001",
        "checkpoint_ref": None,
        "updated_at": "2026-05-30T10:05:00Z",
        "schema_version": 1,
        "checksum": "0" * 64,
    }
    _write_canonical(a / "oq-state.json", bad_state)
    result = _scan_fleet(events)
    assert result.returncode != 0
    assert "channel error" in result.stderr


def test_scan_absent_events_base_is_empty_not_error(tmp_path: Path):
    """An absent events base is an empty fleet, not an error (OQ-INV-30 statelessness)."""
    result = _scan_fleet(tmp_path / "does-not-exist")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == ""
