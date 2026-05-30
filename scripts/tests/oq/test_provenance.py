"""Provenance-independence tests (ID-43.10, OQ-INV-31).

Ordering and provenance derive from IN-RECORD fields (``seq`` for ordering,
``emitted_at`` / ``worker_id`` for provenance) — NEVER from filesystem metadata
(mtime, ctime, directory-entry order).  These tests scramble and blank file
mtimes and assert that ``next_seq``, ``oq_restart_classify`` and ``oq_scan_fleet``
ordering all stay anchored to the record's ``seq``.
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
_OQ_CANONICAL = _SCRIPTS_DIR / "oq-canonical.py"
_OQ_CORE_SH = _SCRIPTS_DIR / "oq-core.sh"
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


def _seed_question(oq_root: Path, oq_id: str, seq: int, *, blocking: bool = True,
                   emitted_at: str = "2026-05-30T10:00:00Z", mtime: float | None = None) -> Path:
    path = oq_root / "questions" / f"{oq_id}.json"
    _write_canonical(path, _stamp({
        "oq_id": oq_id, "worker_id": "w", "seq": seq, "emitted_at": emitted_at,
        "question": f"Q {oq_id}?", "urgency": "normal", "blocking": blocking,
        "context_ref": {}, "status": "open", "supersedes": None, "schema_version": 1,
    }))
    if mtime is not None:
        os.utime(path, (mtime, mtime))
    return path


def _seed_state(oq_root: Path, *, lifecycle_state: str, blocked_on: str | None) -> None:
    _write_canonical(oq_root / "oq-state.json", _stamp({
        "worker_id": "w", "lifecycle_state": lifecycle_state, "blocked_on": blocked_on,
        "checkpoint_ref": None, "updated_at": "2026-05-30T10:05:00Z", "schema_version": 1,
    }))


def _next_seq(questions_dir: Path) -> int:
    full = f"source {_OQ_CORE_SH}\nnext_seq {questions_dir}"
    result = subprocess.run(["bash", "-c", full], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return int(result.stdout.strip())


def _classify_order(oq_root: Path) -> list[str]:
    result = subprocess.run(
        ["bash", str(_OQ_WORKER_SH), "oq_restart_classify", str(oq_root)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    return [ln.split()[1] for ln in result.stdout.splitlines() if not ln.startswith("RESUME_") and ln.strip()]


def _scan_open_order(events_base: Path, sid: str) -> list[str]:
    result = subprocess.run(
        ["bash", str(_OQ_PARENT_SH), "oq_scan_fleet", str(events_base)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    return [ln.split()[2] for ln in result.stdout.splitlines()
            if ln.startswith(f"OPEN {sid} ")]


# ──────────────────────────────────────────────────────────────────────────────
# next_seq derives from in-record seq, not mtime
# ──────────────────────────────────────────────────────────────────────────────

def test_next_seq_ignores_mtime_order(tmp_path: Path):
    """next_seq returns max(seq)+1 even when mtimes are in the reverse order of seq."""
    q = tmp_path / "questions"
    # seq 0,1,2 but mtimes are reversed: the highest seq has the OLDEST mtime.
    _seed_question(tmp_path, "oq-seq000000000000", 0, mtime=3000)
    _seed_question(tmp_path, "oq-seq000000000001", 1, mtime=2000)
    _seed_question(tmp_path, "oq-seq000000000002", 2, mtime=1000)
    assert _next_seq(q) == 3


def test_next_seq_ignores_blanked_mtimes(tmp_path: Path):
    """next_seq is correct even when all records share an identical (blanked) mtime."""
    q = tmp_path / "questions"
    for i, oq in enumerate(["oq-a00000000000001", "oq-b00000000000002", "oq-c00000000000003"]):
        _seed_question(tmp_path, oq, i, mtime=1000)  # all identical mtime
    assert _next_seq(q) == 3


# ──────────────────────────────────────────────────────────────────────────────
# oq_restart_classify ordering follows seq, not mtime
# ──────────────────────────────────────────────────────────────────────────────

def test_classify_order_follows_seq_not_mtime(tmp_path: Path):
    """Classification order is seq-ascending even when mtimes are scrambled."""
    # Filenames also sort differently from seq to rule out filename ordering.
    _seed_question(tmp_path, "oq-zzz00000000001", 0, mtime=1000)   # seq 0, newest-name, old mtime
    _seed_question(tmp_path, "oq-mmm00000000002", 1, mtime=5000)   # seq 1, mid, newest mtime
    _seed_question(tmp_path, "oq-aaa00000000003", 2, mtime=3000)   # seq 2, oldest-name, mid mtime
    order = _classify_order(tmp_path)
    assert order == ["oq-zzz00000000001", "oq-mmm00000000002", "oq-aaa00000000003"]


# ──────────────────────────────────────────────────────────────────────────────
# oq_scan_fleet OPEN ordering follows seq, not mtime
# ──────────────────────────────────────────────────────────────────────────────

def test_scan_open_order_follows_seq_not_mtime(tmp_path: Path):
    """The parent scan's OPEN order is seq-ascending regardless of mtime order."""
    events = tmp_path / "cmux-events"
    oq_root = events / "sid-aaa" / "oq"
    (oq_root / "questions").mkdir(parents=True, exist_ok=True)
    (oq_root / "decisions").mkdir(parents=True, exist_ok=True)
    # Three blocking OQs, mtimes reversed relative to seq.
    _seed_question(oq_root, "oq-first0000000001", 0, blocking=True, mtime=9000)
    _seed_question(oq_root, "oq-secnd0000000002", 1, blocking=True, mtime=6000)
    _seed_question(oq_root, "oq-third0000000003", 2, blocking=True, mtime=3000)
    _seed_state(oq_root, lifecycle_state="awaiting-decision", blocked_on="oq-first0000000001")

    order = _scan_open_order(events, "sid-aaa")
    assert order == ["oq-first0000000001", "oq-secnd0000000002", "oq-third0000000003"]


# ──────────────────────────────────────────────────────────────────────────────
# Provenance fields are read from the record, not filesystem metadata
# ──────────────────────────────────────────────────────────────────────────────

def test_provenance_emitted_at_from_record_not_mtime(tmp_path: Path):
    """The record's emitted_at is the provenance source, independent of file mtime."""
    path = _seed_question(tmp_path, "oq-prov00000000001", 0,
                          emitted_at="2099-12-31T23:59:59Z", mtime=1000)
    # The on-disk record carries the in-record emitted_at, decoupled from the
    # (deliberately mismatched) filesystem mtime.
    rec = json.loads(path.read_text())
    assert rec["emitted_at"] == "2099-12-31T23:59:59Z"
    assert os.stat(path).st_mtime == 1000  # mtime is unrelated to provenance
    # And classification still works (provenance derives from the record).
    _seed_state(tmp_path, lifecycle_state="working", blocked_on=None)
    assert _classify_order(tmp_path) == ["oq-prov00000000001"]
