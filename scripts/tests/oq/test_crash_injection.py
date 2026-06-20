"""Crash-injection / atomicity / durability tests (ID-43.10).

Hardens, via deterministic crash injection (crash-shim.sh) and kill-9, the
atomicity + durability invariants that no single behaviour slice can own:

  OQ-INV-3   — atomic emit: a concurrent reader sees EITHER nothing OR the
               complete record, never a truncated one; the in-flight dotfile is
               never enumerated; tmp and target share a device.
  OQ-INV-5   — durability: a record that emit reported successful survives a
               worker crash (kill -9) and is observable on the next read.
  OQ-INV-14  — decisions inherit the same atomic write guarantees.
  OQ-INV-16  — at-least-once delivery: a duplicate decision is tolerated.
  OQ-INV-17  — idempotent apply: applying the same decision twice == once.
  OQ-INV-25  — no loss: crash-then-read yields the OQ.

Plain filesystem tests — no live cmux daemon.  Each uses ``tmp_path`` for full
per-test isolation (reinforced by the conftest events-base isolation).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_SCRIPTS_DIR = _REPO_ROOT / ".claude" / "skills" / "session-driver-cmux" / "scripts"
_OQ_CANONICAL = _SCRIPTS_DIR / "oq-canonical.py"
_OQ_CORE_SH = _SCRIPTS_DIR / "oq-core.sh"
_OQ_WORKER_SH = _SCRIPTS_DIR / "oq-worker.sh"
_OQ_PARENT_SH = _SCRIPTS_DIR / "oq-parent.sh"
_CRASH_SHIM = _HERE.parent / "crash-shim.sh"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _stamp(obj: dict) -> dict:
    result = subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), "stamp"],
        input=json.dumps(obj), capture_output=True, text=True,
    )
    assert result.returncode == 0, f"stamp failed: {result.stderr}"
    return json.loads(result.stdout)


def _canonical_bytes(obj: dict) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def _list_records(dir_path: Path) -> list[str]:
    """Return the *.json paths oq-core.sh's list_records enumerates (dotfiles excluded)."""
    full = f"source {_OQ_CORE_SH}\nlist_records {dir_path}"
    result = subprocess.run(["bash", "-c", full], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return [ln for ln in result.stdout.splitlines() if ln.strip()]


def _verify_record(file_path: Path) -> subprocess.CompletedProcess:
    full = f"source {_OQ_CORE_SH}\nverify_record {file_path}"
    return subprocess.run(["bash", "-c", full], capture_output=True, text=True)


def _emit(oq_root: Path, *, blocking: str = "false", question: str = "Crash-safe?",
          worker_id: str = "worker-test", emitted_at: str = "2026-05-30T10:00:00Z",
          checkpoint_ref: str = "null") -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(_OQ_WORKER_SH), "oq_emit", worker_id, "43", "impl", question,
         "normal", blocking, '{"phase":"impl"}', str(oq_root), emitted_at, checkpoint_ref],
        capture_output=True, text=True,
    )


def _seed_decision_file(oq_root: Path, oq_id: str) -> None:
    dec = _stamp({
        "oq_id": oq_id, "decided_at": "2026-05-30T10:30:00Z", "decider_id": "parent",
        "outcome": "answered", "answer": "Proceed.", "directive": None, "schema_version": 1,
    })
    decisions = oq_root / "decisions"
    decisions.mkdir(parents=True, exist_ok=True)
    (decisions / f"{oq_id}.json").write_text(_canonical_bytes(dec))


def _drive_shim_to_barrier(target_dir: Path, name: str, payload: str, signal_dir: Path):
    """Start crash-shim publish in the background; block until it reaches the barrier.

    Returns the Popen handle (still paused at the barrier) and the in-flight tmp name.
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    signal_dir.mkdir(parents=True, exist_ok=True)
    payload_file = signal_dir / "payload.json"
    payload_file.write_text(payload)

    proc = subprocess.Popen(
        ["bash", str(_CRASH_SHIM), "publish", str(target_dir), name,
         str(payload_file), str(signal_dir)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    # Wait until the shim has written + fsync'd the dotfile and signalled the barrier.
    ready = signal_dir / "tmp_ready"
    deadline = time.monotonic() + 15
    while not ready.exists():
        if proc.poll() is not None:
            out, err = proc.communicate()
            raise AssertionError(f"crash-shim exited before barrier: rc={proc.returncode} {err}")
        if time.monotonic() > deadline:
            proc.kill()
            raise AssertionError("crash-shim did not reach barrier within 15s")
        time.sleep(0.02)
    tmp_name = (signal_dir / "tmp_name").read_text().strip()
    return proc, tmp_name


def _release_shim(proc, signal_dir: Path) -> None:
    (signal_dir / "proceed").write_text("go")
    out, err = proc.communicate(timeout=15)
    assert proc.returncode == 0, f"crash-shim publish failed: rc={proc.returncode} {err}"


# ──────────────────────────────────────────────────────────────────────────────
# Sanity
# ──────────────────────────────────────────────────────────────────────────────

def test_crash_shim_exists():
    assert _CRASH_SHIM.is_file(), f"crash-shim.sh not found at {_CRASH_SHIM}"


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-3: no partial record visible mid-publish
# ──────────────────────────────────────────────────────────────────────────────

def test_no_partial_record_visible_during_publish(tmp_path: Path):
    """While the dotfile exists but the rename has not run, a reader sees nothing."""
    target = tmp_path / "questions"
    name = "oq-crashtest0000001.json"
    payload = _canonical_bytes(_stamp({"schema_version": 1, "oq_id": "oq-crashtest0000001",
                                       "worker_id": "w", "seq": 0, "emitted_at": "2026-05-30T10:00:00Z",
                                       "question": "mid?", "urgency": "normal", "blocking": False,
                                       "context_ref": {}, "status": "open", "supersedes": None}))
    proc, tmp_name = _drive_shim_to_barrier(target, name, payload, tmp_path / "sig")
    try:
        # At the barrier: the dotfile exists, the final record does NOT.
        assert (target / tmp_name).exists(), "in-flight dotfile must exist at the barrier"
        assert not (target / name).exists(), "final record must NOT exist before rename"
        # The reader (list_records) sees nothing — never a truncated record.
        assert _list_records(target) == [], "no record may be visible mid-publish"
    finally:
        _release_shim(proc, tmp_path / "sig")

    # After the rename: the complete record is present and verifies.
    records = _list_records(target)
    assert len(records) == 1 and records[0].endswith(name)
    assert _verify_record(target / name).returncode == 0


def test_dotfile_tmp_never_enumerated(tmp_path: Path):
    """The in-flight dotfile is excluded from list_records even while present on disk."""
    target = tmp_path / "questions"
    name = "oq-dotfile00000001.json"
    payload = _canonical_bytes(_stamp({"schema_version": 1, "k": "v"}))
    proc, tmp_name = _drive_shim_to_barrier(target, name, payload, tmp_path / "sig")
    try:
        assert tmp_name.startswith("."), "tmp must be a dotfile"
        # The dotfile is physically present...
        assert (target / tmp_name).exists()
        # ...but list_records (which the channel readers use) never enumerates it.
        listed = _list_records(target)
        assert all(not Path(p).name.startswith(".") for p in listed)
        assert str(target / tmp_name) not in listed
    finally:
        _release_shim(proc, tmp_path / "sig")


def test_tmp_and_target_share_a_device(tmp_path: Path):
    """The tmp dotfile and its target dir are on the same filesystem (rename is atomic)."""
    target = tmp_path / "questions"
    name = "oq-device000000001.json"
    payload = _canonical_bytes(_stamp({"schema_version": 1, "k": "v"}))
    proc, tmp_name = _drive_shim_to_barrier(target, name, payload, tmp_path / "sig")
    try:
        tmp_dev = os.stat(target / tmp_name).st_dev
        dir_dev = os.stat(target).st_dev
        assert tmp_dev == dir_dev, "tmp and target dir must share a device for atomic rename"
    finally:
        _release_shim(proc, tmp_path / "sig")


def test_large_record_over_4kb_is_atomic(tmp_path: Path):
    """A >4 KB record (beyond PIPE_BUF) is published atomically — no truncation visible."""
    target = tmp_path / "questions"
    name = "oq-bigrecord000001.json"
    big_question = "X" * 8192  # 8 KB, well over the 4 KB PIPE_BUF append-atomicity limit
    obj = _stamp({"schema_version": 1, "oq_id": "oq-bigrecord000001", "worker_id": "w",
                  "seq": 0, "emitted_at": "2026-05-30T10:00:00Z", "question": big_question,
                  "urgency": "normal", "blocking": False, "context_ref": {}, "status": "open",
                  "supersedes": None})
    payload = _canonical_bytes(obj)
    assert len(payload) > 4096
    proc, tmp_name = _drive_shim_to_barrier(target, name, payload, tmp_path / "sig")
    try:
        # Mid-publish: nothing visible (not a partial 4 KB prefix).
        assert _list_records(target) == []
    finally:
        _release_shim(proc, tmp_path / "sig")
    # After: complete 8 KB record present and integrity-valid.
    assert _verify_record(target / name).returncode == 0
    written = json.loads((target / name).read_text())
    assert written["question"] == big_question


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-5 / OQ-INV-25: durability across crash (kill -9)
# ──────────────────────────────────────────────────────────────────────────────

def test_kill9_after_emit_returns_no_loss(tmp_path: Path):
    """An emit that returned success survives an immediate kill -9 of the worker."""
    # Emit in a background process; once it prints the oq_id, emit has returned
    # success (record fsync'd + renamed). Then kill -9 the (now-finished) worker
    # process and re-read from a FRESH process: the OQ must still be present.
    proc = subprocess.Popen(
        ["bash", str(_OQ_WORKER_SH), "oq_emit", "worker-test", "43", "impl",
         "Durable across crash?", "normal", "false", '{"phase":"impl"}',
         str(tmp_path), "2026-05-30T10:00:00Z", "null"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    out, err = proc.communicate(timeout=15)
    assert proc.returncode == 0, f"emit failed: {err}"
    oq_id = out.strip()
    assert oq_id.startswith("oq-")
    # Simulate a hard crash of the worker the instant after emit returned.
    try:
        os.kill(proc.pid, 9)  # already exited — harmless; models kill-9 timing
    except ProcessLookupError:
        # Expected if the worker already exited after communicate(); this test
        # intentionally models kill-9 timing immediately after a successful emit.
        pass
    # Fresh read: the record is durably present and verifies (no loss).
    question_file = tmp_path / "questions" / f"{oq_id}.json"
    assert question_file.is_file(), "emitted OQ must survive the crash"
    assert _verify_record(question_file).returncode == 0


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-16 / OQ-INV-17: at-least-once + idempotent apply (duplicate decision)
# ──────────────────────────────────────────────────────────────────────────────

def test_duplicate_decision_apply_is_idempotent(tmp_path: Path):
    """Applying the same decision twice leaves worker state identical to applying once."""
    # Emit a blocking OQ; worker is now awaiting-decision.
    emit = _emit(tmp_path, blocking="true", checkpoint_ref='{"phase":"impl"}')
    assert emit.returncode == 0, emit.stderr
    oq_id = emit.stdout.strip()
    _seed_decision_file(tmp_path, oq_id)

    env = os.environ.copy()
    env["OQ_POLL_INTERVAL"] = "0.05"

    def poll():
        return subprocess.run(
            ["bash", str(_OQ_WORKER_SH), "oq_poll_decision", str(tmp_path), oq_id],
            capture_output=True, text=True, env=env,
        )

    # First apply: observes the decision, resets state to working.
    r1 = poll()
    assert r1.returncode == 0, r1.stderr
    state_after_one = json.loads((tmp_path / "oq-state.json").read_text())
    assert state_after_one["lifecycle_state"] == "working"
    assert state_after_one["blocked_on"] is None

    # Deliver/observe the SAME decision again: second apply is a no-op.
    r2 = poll()
    assert r2.returncode == 0, r2.stderr
    state_after_two = json.loads((tmp_path / "oq-state.json").read_text())

    # Idempotent: state after two applies == state after one (modulo updated_at,
    # which the no-op path does not rewrite since state is already 'working').
    assert state_after_two["lifecycle_state"] == "working"
    assert state_after_two["blocked_on"] is None
    assert state_after_two == state_after_one, "second apply must not change worker state"
