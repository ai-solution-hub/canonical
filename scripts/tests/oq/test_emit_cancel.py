"""Tests for oq-worker.sh oq_emit and oq_cancel functions.

Covers ID-43.6 testStrategy invariants:
  OQ-INV-2   — immutability: second status:open write to existing oq_id is rejected.
  OQ-INV-6   — no-retract: cancel overwrites with status:cancelled; never deletes.
  OQ-INV-7   — emitted_at is caller-supplied (pinnable for tests).
  OQ-INV-8   — OQ record carries all required fields.
  OQ-INV-9   — worker_id is stamped into the record.
  OQ-INV-12  — idempotency short-circuit: re-emit of same logical question is safe.
  OQ-INV-13  — cancel resets oq-state when it was blocking-awaiting.
  OQ-INV-21  — blocking emit writes state AFTER question file (load-bearing ordering).
  OQ-INV-22  — seq is disk-derived (next_seq).
  OQ-INV-26  — oq_id derived from content, not mtime/position.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

# ──────────────────────────────────────────────────────────────────────────────
# Resolve paths relative to this test file so tests are CWD-independent.
#
# scripts/tests/oq/test_emit_cancel.py
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


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _sq(s: str) -> str:
    """Single-quote a string for safe shell embedding (escape embedded single quotes)."""
    return "'" + s.replace("'", "'\\''") + "'"


def _run_canonical(subcommand: str, obj: dict) -> subprocess.CompletedProcess:
    """Run oq-canonical.py <subcommand> with *obj* on stdin."""
    return subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), subcommand],
        input=json.dumps(obj),
        capture_output=True,
        text=True,
    )


def _stamp(obj: dict) -> dict:
    """Return *obj* stamped with its canonical checksum."""
    result = _run_canonical("stamp", obj)
    assert result.returncode == 0, f"stamp failed: {result.stderr}"
    return json.loads(result.stdout)


def _bash_source(script: str) -> subprocess.CompletedProcess:
    """Run *script* in bash after sourcing oq-core.sh."""
    full = f"source {_OQ_CORE_SH}\n{script}"
    return subprocess.run(["bash", "-c", full], capture_output=True, text=True)


def _bash_worker(script: str) -> subprocess.CompletedProcess:
    """Run *script* in bash after sourcing oq-worker.sh (which sources oq-core.sh)."""
    full = f"source {_OQ_WORKER_SH}\n{script}"
    return subprocess.run(["bash", "-c", full], capture_output=True, text=True)


def _verify_record(file_path: Path) -> subprocess.CompletedProcess:
    """Source oq-core.sh and call verify_record on a file."""
    script = f"verify_record {_sq(str(file_path))}"
    return _bash_source(script)


def _derive_oq_id(task_id: str, phase: str, question: str, context_ref: dict) -> str:
    """Call derive_oq_id via oq-core.sh and return the oq_id string."""
    context_ref_json = json.dumps(context_ref)
    script = (
        f"derive_oq_id {_sq(task_id)} {_sq(phase)} "
        f"{_sq(question)} {_sq(context_ref_json)}"
    )
    result = _bash_source(script)
    assert result.returncode == 0, f"derive_oq_id failed: {result.stderr}"
    return result.stdout.strip()


def _oq_emit(
    tmp_path: Path,
    *,
    worker_id: str = "worker-test",
    task_id: str = "43",
    phase: str = "implement",
    question: str = "Is this safe?",
    urgency: str = "normal",
    blocking: str = "false",
    context_ref: dict | None = None,
    emitted_at: str = "2026-05-29T10:00:00Z",
    checkpoint_ref: str = "null",
) -> subprocess.CompletedProcess:
    """Call oq_emit via oq-worker.sh; oq_root_dir is tmp_path."""
    context_ref_json = json.dumps(context_ref or {})
    script = (
        f"oq_emit "
        f"{_sq(worker_id)} {_sq(task_id)} {_sq(phase)} {_sq(question)} "
        f"{_sq(urgency)} {_sq(blocking)} {_sq(context_ref_json)} "
        f"{_sq(str(tmp_path))} {_sq(emitted_at)} {_sq(checkpoint_ref)}"
    )
    return _bash_worker(script)


def _oq_cancel(
    tmp_path: Path,
    oq_id: str,
    *,
    updated_at: str = "2026-05-29T11:00:00Z",
) -> subprocess.CompletedProcess:
    """Call oq_cancel via oq-worker.sh; oq_root_dir is tmp_path."""
    script = (
        f"oq_cancel "
        f"{_sq(oq_id)} {_sq(str(tmp_path))} {_sq(updated_at)}"
    )
    return _bash_worker(script)


def _seed_decision(tmp_path: Path, oq_id: str) -> None:
    """Write a minimal stamped decision record to tmp_path/decisions/<oq_id>.json."""
    decisions_dir = tmp_path / "decisions"
    decisions_dir.mkdir(parents=True, exist_ok=True)
    dec = {
        "oq_id": oq_id,
        "decided_at": "2026-05-29T10:30:00Z",
        "decider_id": "liam",
        "outcome": "answered",
        "answer": "Proceed with option B.",
        "directive": None,
        "schema_version": 1,
    }
    stamped = _stamp(dec)
    (decisions_dir / f"{oq_id}.json").write_text(
        json.dumps(stamped, sort_keys=True, separators=(",", ":"))
    )


# ──────────────────────────────────────────────────────────────────────────────
# Sanity: script files must exist
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_worker_sh_exists():
    assert _OQ_WORKER_SH.is_file(), f"oq-worker.sh not found at {_OQ_WORKER_SH}"


def test_oq_worker_sh_sources_without_side_effects():
    """Sourcing oq-worker.sh must not execute any commands (no side effects)."""
    result = subprocess.run(
        ["bash", "-c", f"source {_OQ_WORKER_SH}; echo 'sourced ok'"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"Source failed: {result.stderr}"
    assert "sourced ok" in result.stdout


# ──────────────────────────────────────────────────────────────────────────────
# Emit → read-back round-trip (OQ-INV-7,8,9,22,26)
# ──────────────────────────────────────────────────────────────────────────────

def test_emit_creates_question_file(tmp_path: Path):
    """oq_emit creates questions/<oq_id>.json with correct content."""
    result = _oq_emit(tmp_path, question="Is this safe?", context_ref={"ref": "TECH.md"})
    assert result.returncode == 0, f"oq_emit failed (rc={result.returncode}): {result.stderr}"

    oq_id = result.stdout.strip()
    assert oq_id.startswith("oq-"), f"Expected oq-* prefix, got: {oq_id!r}"
    assert len(oq_id) == len("oq-") + 16, f"Unexpected oq_id length: {oq_id!r}"

    question_file = tmp_path / "questions" / f"{oq_id}.json"
    assert question_file.is_file(), f"Question file not found: {question_file}"

    record = json.loads(question_file.read_text())
    assert record["oq_id"] == oq_id, "oq_id in record must match derive_oq_id output"
    assert record["status"] == "open"
    assert record["question"] == "Is this safe?"
    assert record["worker_id"] == "worker-test"
    assert record["urgency"] == "normal"
    assert record["blocking"] is False
    assert record["seq"] == 0
    assert record["emitted_at"] == "2026-05-29T10:00:00Z"
    assert record["schema_version"] == 1
    assert "checksum" in record


def test_emit_oq_id_matches_derive_oq_id(tmp_path: Path):
    """oq_id returned by oq_emit must equal derive_oq_id with the same inputs."""
    task_id, phase, question, context_ref = "43", "implement", "Is this safe?", {"ref": "TECH.md"}

    expected_oq_id = _derive_oq_id(task_id, phase, question, context_ref)
    result = _oq_emit(
        tmp_path,
        task_id=task_id,
        phase=phase,
        question=question,
        context_ref=context_ref,
    )
    assert result.returncode == 0
    assert result.stdout.strip() == expected_oq_id


def test_emit_question_file_passes_verify_record(tmp_path: Path):
    """questions/<oq_id>.json written by oq_emit must pass verify_record (OQ-INV-3,27)."""
    result = _oq_emit(tmp_path)
    assert result.returncode == 0
    oq_id = result.stdout.strip()

    question_file = tmp_path / "questions" / f"{oq_id}.json"
    verify = _verify_record(question_file)
    assert verify.returncode == 0, f"verify_record failed: {verify.stderr}"


def test_emit_seq_starts_at_zero_for_empty_dir(tmp_path: Path):
    """First emit into an empty questions dir gets seq=0 (OQ-INV-4,22)."""
    result = _oq_emit(tmp_path)
    assert result.returncode == 0
    oq_id = result.stdout.strip()

    record = json.loads((tmp_path / "questions" / f"{oq_id}.json").read_text())
    assert record["seq"] == 0


def test_emit_seq_increments_for_second_distinct_question(tmp_path: Path):
    """Second distinct OQ emit gets seq=1 (OQ-INV-4,22 — disk-derived)."""
    _oq_emit(tmp_path, question="First question?")
    result2 = _oq_emit(tmp_path, question="Second question?")
    assert result2.returncode == 0
    oq_id2 = result2.stdout.strip()

    record2 = json.loads((tmp_path / "questions" / f"{oq_id2}.json").read_text())
    assert record2["seq"] == 1


# ──────────────────────────────────────────────────────────────────────────────
# Immutability rejection (OQ-INV-2,12)
# ──────────────────────────────────────────────────────────────────────────────

def test_re_emit_same_inputs_is_idempotent(tmp_path: Path):
    """Re-emitting the same (task_id,phase,question,context_ref) is a no-op (OQ-INV-2,12).

    The short-circuit: exactly one questions file exists; content unchanged.
    """
    kwargs = dict(question="Is this safe?", context_ref={"ref": "TECH.md"})

    result1 = _oq_emit(tmp_path, **kwargs)
    assert result1.returncode == 0

    # Read the on-disk content after the first emit.
    oq_id = result1.stdout.strip()
    question_file = tmp_path / "questions" / f"{oq_id}.json"
    content_after_first = question_file.read_text()

    # Second emit: must succeed (rc=0) but must NOT overwrite the file.
    result2 = _oq_emit(tmp_path, **kwargs, emitted_at="2026-05-29T12:00:00Z")
    assert result2.returncode == 0, f"Second emit failed: {result2.stderr}"
    assert result2.stdout.strip() == oq_id, "Second emit must return the same oq_id"

    # Exactly one file in questions/.
    question_files = list((tmp_path / "questions").glob("*.json"))
    assert len(question_files) == 1, f"Expected 1 question file, found {len(question_files)}"

    # Content must be unchanged (no overwrite).
    content_after_second = question_file.read_text()
    assert content_after_first == content_after_second, (
        "Second emit must not overwrite the existing question file (OQ-INV-2)"
    )


def test_re_emit_n_times_produces_one_file(tmp_path: Path):
    """Emitting the same question 3× produces exactly one questions/<oq_id>.json."""
    kwargs = dict(question="Repeated question?", context_ref={})

    ids = []
    for _ in range(3):
        r = _oq_emit(tmp_path, **kwargs)
        assert r.returncode == 0
        ids.append(r.stdout.strip())

    # All three runs must return the same oq_id.
    assert len(set(ids)) == 1, f"Expected a single oq_id across 3 emits, got: {ids}"

    question_files = list((tmp_path / "questions").glob("*.json"))
    assert len(question_files) == 1, f"Expected 1 file, found {len(question_files)}"


# ──────────────────────────────────────────────────────────────────────────────
# Already-resolved signal (OQ-INV-12 + exit-code 2 contract)
# ──────────────────────────────────────────────────────────────────────────────

def test_emit_already_resolved_signals_apply_decision(tmp_path: Path):
    """When question+decision both exist, oq_emit exits 2 with OQ_ALREADY_RESOLVED:<oq_id>."""
    kwargs = dict(question="Is this safe?", context_ref={})

    # First emit: creates the question file.
    result1 = _oq_emit(tmp_path, **kwargs)
    assert result1.returncode == 0
    oq_id = result1.stdout.strip()

    # Seed a decision record (as oq-parent.sh would write — ID-43.7 territory).
    _seed_decision(tmp_path, oq_id)

    # Second emit: question+decision both exist → signal already-resolved.
    result2 = _oq_emit(tmp_path, **kwargs)
    assert result2.returncode == 2, (
        f"Expected rc=2 (OQ_ALREADY_RESOLVED) when decision exists, got rc={result2.returncode}"
    )
    assert result2.stdout.strip() == f"OQ_ALREADY_RESOLVED:{oq_id}", (
        f"Expected OQ_ALREADY_RESOLVED:<oq_id> on stdout, got: {result2.stdout.strip()!r}"
    )


def test_emit_already_resolved_does_not_overwrite_question(tmp_path: Path):
    """When already resolved, oq_emit must NOT overwrite questions/<oq_id>.json."""
    kwargs = dict(question="Safe to proceed?", context_ref={"doc": "plan.md"})

    result1 = _oq_emit(tmp_path, **kwargs)
    assert result1.returncode == 0
    oq_id = result1.stdout.strip()
    content_before = (tmp_path / "questions" / f"{oq_id}.json").read_text()

    _seed_decision(tmp_path, oq_id)

    result2 = _oq_emit(tmp_path, **kwargs, emitted_at="2026-05-29T13:00:00Z")
    assert result2.returncode == 2

    content_after = (tmp_path / "questions" / f"{oq_id}.json").read_text()
    assert content_before == content_after, "Question file must not be modified after resolved"


# ──────────────────────────────────────────────────────────────────────────────
# Blocking: state flip ordering (OQ-INV-21, load-bearing)
# ──────────────────────────────────────────────────────────────────────────────

def test_blocking_emit_writes_state_awaiting_decision(tmp_path: Path):
    """Blocking emit writes oq-state.json with lifecycle_state=awaiting-decision."""
    checkpoint = json.dumps({"step": "after-analysis", "file": "lib/foo.ts"})
    result = _oq_emit(
        tmp_path,
        question="Must I stop?",
        blocking="true",
        checkpoint_ref=checkpoint,
        emitted_at="2026-05-29T10:00:00Z",
    )
    assert result.returncode == 0, f"Blocking emit failed: {result.stderr}"
    oq_id = result.stdout.strip()

    state_file = tmp_path / "oq-state.json"
    assert state_file.is_file(), "oq-state.json must exist after blocking emit"

    state = json.loads(state_file.read_text())
    assert state["lifecycle_state"] == "awaiting-decision", (
        f"Expected awaiting-decision, got: {state['lifecycle_state']!r}"
    )
    assert state["blocked_on"] == oq_id, (
        f"Expected blocked_on={oq_id!r}, got: {state['blocked_on']!r}"
    )
    expected_checkpoint = json.loads(checkpoint)
    assert state["checkpoint_ref"] == expected_checkpoint, (
        f"checkpoint_ref mismatch: {state['checkpoint_ref']!r}"
    )


def test_blocking_emit_question_file_exists_before_state_flip(tmp_path: Path):
    """After a blocking emit, the question file must exist (committed before state flip)."""
    result = _oq_emit(
        tmp_path,
        question="Must I stop?",
        blocking="true",
        checkpoint_ref='{"step":"checkpoint-1"}',
    )
    assert result.returncode == 0
    oq_id = result.stdout.strip()

    question_file = tmp_path / "questions" / f"{oq_id}.json"
    assert question_file.is_file(), (
        "Question file must exist — it must be committed before the state flip"
    )


def test_blocking_emit_state_passes_verify(tmp_path: Path):
    """oq-state.json written by blocking emit must pass verify_record."""
    result = _oq_emit(
        tmp_path,
        question="Must I wait?",
        blocking="true",
        checkpoint_ref="null",
    )
    assert result.returncode == 0

    state_file = tmp_path / "oq-state.json"
    verify = _verify_record(state_file)
    assert verify.returncode == 0, f"verify_record on oq-state.json failed: {verify.stderr}"


def test_non_blocking_emit_does_not_flip_state(tmp_path: Path):
    """Non-blocking emit must NOT create or modify oq-state.json to awaiting-decision."""
    state_file = tmp_path / "oq-state.json"

    result = _oq_emit(tmp_path, question="Can I continue?", blocking="false")
    assert result.returncode == 0

    # oq-state.json must not exist (non-blocking does not create it).
    assert not state_file.is_file(), (
        "Non-blocking emit must not create oq-state.json"
    )


def test_non_blocking_emit_leaves_existing_working_state_unchanged(tmp_path: Path):
    """Non-blocking emit leaves a pre-existing working oq-state.json untouched."""
    # Manually seed a working state.
    state_record = {
        "worker_id": "worker-test",
        "lifecycle_state": "working",
        "blocked_on": None,
        "checkpoint_ref": None,
        "updated_at": "2026-05-29T09:00:00Z",
        "schema_version": 1,
    }
    stamped = _stamp(state_record)
    state_file = tmp_path / "oq-state.json"
    state_file.write_text(json.dumps(stamped, sort_keys=True, separators=(",", ":")))

    content_before = state_file.read_text()

    result = _oq_emit(tmp_path, question="Can I continue?", blocking="false")
    assert result.returncode == 0

    content_after = state_file.read_text()
    assert content_before == content_after, (
        "Non-blocking emit must not modify an existing working oq-state.json"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Cancel (OQ-INV-6, OQ-INV-13)
# ──────────────────────────────────────────────────────────────────────────────

def test_cancel_flips_status_to_cancelled(tmp_path: Path):
    """oq_cancel overwrites the slot with status:cancelled (OQ-INV-6)."""
    result = _oq_emit(tmp_path, question="Should I stop?")
    assert result.returncode == 0
    oq_id = result.stdout.strip()

    cancel_result = _oq_cancel(tmp_path, oq_id)
    assert cancel_result.returncode == 0, f"oq_cancel failed: {cancel_result.stderr}"

    question_file = tmp_path / "questions" / f"{oq_id}.json"
    assert question_file.is_file(), "File must still exist after cancel (no-retract, OQ-INV-6)"

    record = json.loads(question_file.read_text())
    assert record["status"] == "cancelled", f"Expected cancelled, got: {record['status']!r}"
    assert record["supersedes"] == oq_id, (
        f"supersedes must equal cancelled oq_id, got: {record['supersedes']!r}"
    )


def test_cancel_preserves_original_question_and_emitted_at(tmp_path: Path):
    """oq_cancel preserves the original question text and emitted_at (OQ-INV-6)."""
    original_question = "Is the scope well-defined?"
    original_emitted_at = "2026-05-29T08:00:00Z"

    result = _oq_emit(
        tmp_path,
        question=original_question,
        emitted_at=original_emitted_at,
    )
    assert result.returncode == 0
    oq_id = result.stdout.strip()

    _oq_cancel(tmp_path, oq_id)

    record = json.loads((tmp_path / "questions" / f"{oq_id}.json").read_text())
    assert record["question"] == original_question, (
        f"Original question must be preserved after cancel, got: {record['question']!r}"
    )
    assert record["emitted_at"] == original_emitted_at, (
        f"Original emitted_at must be preserved after cancel, got: {record['emitted_at']!r}"
    )


def test_cancel_preserves_seq(tmp_path: Path):
    """oq_cancel preserves the original seq value."""
    # Seed one record first so the cancelled one gets seq=1.
    _oq_emit(tmp_path, question="First question")
    result2 = _oq_emit(tmp_path, question="Second question to cancel")
    assert result2.returncode == 0
    oq_id = result2.stdout.strip()

    original_record = json.loads((tmp_path / "questions" / f"{oq_id}.json").read_text())
    original_seq = original_record["seq"]

    _oq_cancel(tmp_path, oq_id)

    cancelled_record = json.loads((tmp_path / "questions" / f"{oq_id}.json").read_text())
    assert cancelled_record["seq"] == original_seq, (
        f"seq must be preserved after cancel: expected {original_seq}, got {cancelled_record['seq']}"
    )


def test_cancel_file_passes_verify_record(tmp_path: Path):
    """Cancelled question file must pass verify_record (checksum intact after overwrite)."""
    result = _oq_emit(tmp_path, question="Will I be cancelled?")
    assert result.returncode == 0
    oq_id = result.stdout.strip()

    _oq_cancel(tmp_path, oq_id)

    verify = _verify_record(tmp_path / "questions" / f"{oq_id}.json")
    assert verify.returncode == 0, f"verify_record on cancelled file failed: {verify.stderr}"


def test_cancel_does_not_delete_file(tmp_path: Path):
    """oq_cancel must not delete the question file (no-retract, OQ-INV-6)."""
    result = _oq_emit(tmp_path, question="Keep me even if cancelled")
    assert result.returncode == 0
    oq_id = result.stdout.strip()

    _oq_cancel(tmp_path, oq_id)

    assert (tmp_path / "questions" / f"{oq_id}.json").is_file(), (
        "Question file must remain after cancel — no-retract invariant (OQ-INV-6)"
    )


def test_cancel_blocking_resets_oq_state_to_working(tmp_path: Path):
    """Cancelling a blocking OQ resets oq-state from awaiting-decision to working (OQ-INV-13)."""
    result = _oq_emit(
        tmp_path,
        question="Must I stop?",
        blocking="true",
        checkpoint_ref='{"step": "analysis"}',
    )
    assert result.returncode == 0
    oq_id = result.stdout.strip()

    state = json.loads((tmp_path / "oq-state.json").read_text())
    assert state["lifecycle_state"] == "awaiting-decision"

    cancel_result = _oq_cancel(tmp_path, oq_id, updated_at="2026-05-29T11:00:00Z")
    assert cancel_result.returncode == 0, f"oq_cancel failed: {cancel_result.stderr}"

    state_after = json.loads((tmp_path / "oq-state.json").read_text())
    assert state_after["lifecycle_state"] == "working", (
        f"oq-state must be reset to working after cancel, got: {state_after['lifecycle_state']!r}"
    )
    assert state_after["blocked_on"] is None, (
        f"blocked_on must be null after cancel, got: {state_after['blocked_on']!r}"
    )


def test_cancel_non_blocking_leaves_state_unchanged(tmp_path: Path):
    """Cancelling a non-blocking OQ does not modify oq-state.json (it was never set)."""
    state_file = tmp_path / "oq-state.json"

    result = _oq_emit(tmp_path, question="Non-blocking to cancel", blocking="false")
    assert result.returncode == 0
    oq_id = result.stdout.strip()

    # No oq-state.json should exist yet.
    assert not state_file.is_file()

    _oq_cancel(tmp_path, oq_id)

    # Still no oq-state.json after cancel (we never created one).
    assert not state_file.is_file(), (
        "oq-state.json must not be created by cancelling a non-blocking OQ"
    )


def test_cancel_other_blocking_oq_leaves_awaiting_state_intact(tmp_path: Path):
    """Cancelling OQ-A does not reset oq-state when it is blocked on OQ-B (different oq_id)."""
    # Emit OQ-A as blocking — this sets oq-state to awaiting-decision blocked_on=oq_id_a.
    result_a = _oq_emit(
        tmp_path,
        question="Question A (blocking)",
        blocking="true",
        checkpoint_ref="null",
    )
    assert result_a.returncode == 0
    oq_id_a = result_a.stdout.strip()

    state_before = json.loads((tmp_path / "oq-state.json").read_text())
    assert state_before["blocked_on"] == oq_id_a

    # Emit OQ-B as non-blocking (state stays awaiting-decision).
    result_b = _oq_emit(tmp_path, question="Question B (non-blocking)", blocking="false")
    assert result_b.returncode == 0
    oq_id_b = result_b.stdout.strip()
    assert oq_id_a != oq_id_b

    # Cancel OQ-B (non-blocking, not the one state is blocked on) — state must be unchanged.
    _oq_cancel(tmp_path, oq_id_b)

    state_after = json.loads((tmp_path / "oq-state.json").read_text())
    assert state_after["lifecycle_state"] == "awaiting-decision", (
        "Cancelling a different OQ must not reset oq-state"
    )
    assert state_after["blocked_on"] == oq_id_a


# ──────────────────────────────────────────────────────────────────────────────
# Open-set exclusion: cancelled OQ excluded from naive open-set (OQ-INV-13)
#
# This proves the parent's open-set query (questions where status==open and no
# decision file) correctly excludes cancelled OQs — without importing oq-parent.sh.
# ──────────────────────────────────────────────────────────────────────────────

def test_cancelled_oq_excluded_from_open_set(tmp_path: Path):
    """After cancel, a naive open-set scan excludes the cancelled oq_id (OQ-INV-13).

    Open-set: questions/<oq_id>.json where status==open AND no decisions/<oq_id>.json.
    This is the parent's view; we replicate it in-test without importing oq-parent.sh.
    """
    # Emit two OQs: cancel one, leave one open.
    result_keep = _oq_emit(tmp_path, question="Keep me open")
    assert result_keep.returncode == 0
    oq_id_keep = result_keep.stdout.strip()

    result_cancel = _oq_emit(tmp_path, question="Cancel me")
    assert result_cancel.returncode == 0
    oq_id_cancel = result_cancel.stdout.strip()

    _oq_cancel(tmp_path, oq_id_cancel)

    # Compute open-set inline (replicate parent logic without importing oq-parent.sh).
    questions_dir = tmp_path / "questions"
    decisions_dir = tmp_path / "decisions"
    open_set = set()
    for f in questions_dir.glob("*.json"):
        if f.name.startswith("."):
            continue
        rec = json.loads(f.read_text())
        if rec.get("status") == "open":
            oq_id = f.stem
            decision_file = decisions_dir / f"{oq_id}.json"
            if not decision_file.is_file():
                open_set.add(oq_id)

    assert oq_id_keep in open_set, "Open OQ must appear in open-set"
    assert oq_id_cancel not in open_set, (
        "Cancelled OQ must be excluded from open-set (OQ-INV-13)"
    )


# ──────────────────────────────────────────────────────────────────────────────
# CLI dispatch guard: sourcing must not auto-run
# ──────────────────────────────────────────────────────────────────────────────

def test_bash_cli_dispatch_oq_emit(tmp_path: Path):
    """bash oq-worker.sh oq_emit ... dispatches correctly when executed directly."""
    context_ref_json = json.dumps({})
    result = subprocess.run(
        [
            "bash", str(_OQ_WORKER_SH), "oq_emit",
            "worker-cli", "43", "implement",
            "CLI dispatch test?", "normal", "false",
            context_ref_json, str(tmp_path), "2026-05-29T10:00:00Z", "null",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"CLI dispatch failed: {result.stderr}"
    oq_id = result.stdout.strip()
    assert oq_id.startswith("oq-")
    assert (tmp_path / "questions" / f"{oq_id}.json").is_file()
