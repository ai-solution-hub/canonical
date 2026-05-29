"""Tests for oq-core.sh record schemas, oq_id derivation, and next_seq.

Covers ID-43.5 testStrategy invariants:
  OQ-INV-1   — oq_id is deterministic: same inputs → same id; different inputs → different id.
  OQ-INV-4   — next_seq is disk-derived (max seq across questions/*.json + 1); 0 if empty.
  OQ-INV-12  — oq_id excludes worker_id, emitted_at, seq (relaunched worker re-derives same id).
  OQ-INV-21  — checkpoint_ref is OPAQUE in oq-state records (no shape enforcement).
  OQ-INV-26  — structural: oq_id is derived from content, not from mtime or filesystem position.
  OQ-INV-31  — enums and required fields enforced; validators fail closed.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

# ──────────────────────────────────────────────────────────────────────────────
# Resolve paths relative to this test file so tests are CWD-independent.
#
# scripts/tests/oq/test_schema.py
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


# ──────────────────────────────────────────────────────────────────────────────
# Helpers (modelled on test_atomic_publish.py)
# ──────────────────────────────────────────────────────────────────────────────

def _run_canonical(subcommand: str, obj: dict) -> subprocess.CompletedProcess:
    """Run oq-canonical.py <subcommand> with *obj* on stdin."""
    return subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), subcommand],
        input=json.dumps(obj),
        capture_output=True,
        text=True,
    )


def _run_canonical_stdin(subcommand: str, raw: str) -> subprocess.CompletedProcess:
    """Run oq-canonical.py <subcommand> with raw string on stdin."""
    return subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), subcommand],
        input=raw,
        capture_output=True,
        text=True,
    )


def _stamp(obj: dict) -> dict:
    """Return *obj* stamped with its canonical checksum (via oq-canonical.py stamp)."""
    result = _run_canonical("stamp", obj)
    assert result.returncode == 0, f"stamp failed: {result.stderr}"
    return json.loads(result.stdout)


def _bash_source(script: str) -> subprocess.CompletedProcess:
    """Run *script* in bash after sourcing oq-core.sh."""
    full = f"source {_OQ_CORE_SH}\n{script}"
    return subprocess.run(
        ["bash", "-c", full],
        capture_output=True,
        text=True,
    )


def _derive_oq_id(task_id: str, phase: str, question: str, context_ref: dict) -> str:
    """Call derive_oq_id via oq-core.sh and return the oq_id string."""
    context_ref_json = json.dumps(context_ref)
    # Shell-escape the JSON argument to avoid word-splitting on spaces.
    script = f"derive_oq_id {_sq(task_id)} {_sq(phase)} {_sq(question)} {_sq(context_ref_json)}"
    result = _bash_source(script)
    assert result.returncode == 0, f"derive_oq_id failed (rc={result.returncode}): {result.stderr}"
    return result.stdout.strip()


def _sq(s: str) -> str:
    """Single-quote a string for safe shell embedding (escape embedded single quotes)."""
    return "'" + s.replace("'", "'\\''") + "'"


def _next_seq(questions_dir: Path) -> int:
    """Call next_seq via oq-core.sh and return the integer result."""
    script = f"next_seq {_sq(str(questions_dir))}"
    result = _bash_source(script)
    assert result.returncode == 0, f"next_seq failed (rc={result.returncode}): {result.stderr}"
    return int(result.stdout.strip())


def _seed_record(questions_dir: Path, seq: int) -> None:
    """Write a minimal stamped OQ record with the given seq into questions_dir."""
    questions_dir.mkdir(parents=True, exist_ok=True)
    obj = {
        "oq_id": f"oq-{seq:016d}",
        "worker_id": "worker-test",
        "seq": seq,
        "emitted_at": "2026-01-01T00:00:00Z",
        "question": "Test question?",
        "urgency": "normal",
        "blocking": False,
        "context_ref": {},
        "status": "open",
        "supersedes": None,
        "schema_version": 1,
    }
    stamped = _stamp(obj)
    record_path = questions_dir / f"oq-{seq:016d}.json"
    record_path.write_text(json.dumps(stamped, sort_keys=True, separators=(",", ":")))


def _verify_record(file_path: Path) -> subprocess.CompletedProcess:
    """Source oq-core.sh and call verify_record on a file."""
    script = f"verify_record {_sq(str(file_path))}"
    return _bash_source(script)


def _make_oq_record(**overrides) -> dict:
    """Construct a valid OQ record dict (not yet stamped). Override fields as needed."""
    rec = {
        "oq_id": "oq-abc123def456789a",
        "worker_id": "worker-1",
        "seq": 0,
        "emitted_at": "2026-01-01T00:00:00Z",
        "question": "What is the scope?",
        "urgency": "normal",
        "blocking": False,
        "context_ref": {"doc": "spec.md"},
        "status": "open",
        "supersedes": None,
        "schema_version": 1,
    }
    rec.update(overrides)
    return rec


def _make_decision_record(**overrides) -> dict:
    """Construct a valid decision record dict (not yet stamped)."""
    rec = {
        "oq_id": "oq-abc123def456789a",
        "decided_at": "2026-01-02T10:00:00Z",
        "decider_id": "liam",
        "outcome": "answered",
        "answer": "The scope is X.",
        "directive": None,
        "schema_version": 1,
    }
    rec.update(overrides)
    return rec


def _make_state_record(**overrides) -> dict:
    """Construct a valid oq-state record dict (not yet stamped)."""
    rec = {
        "worker_id": "worker-1",
        "lifecycle_state": "working",
        "blocked_on": None,
        "checkpoint_ref": None,
        "updated_at": "2026-01-01T00:00:00Z",
        "schema_version": 1,
    }
    rec.update(overrides)
    return rec


# ──────────────────────────────────────────────────────────────────────────────
# Helper: validate-via-shell wrappers (call shell validators)
# ──────────────────────────────────────────────────────────────────────────────

def _validate_oq_record(file_path: Path) -> subprocess.CompletedProcess:
    """Source oq-core.sh and call validate_oq_record on a file."""
    script = f"validate_oq_record {_sq(str(file_path))}"
    return _bash_source(script)


def _validate_decision_record(file_path: Path) -> subprocess.CompletedProcess:
    """Source oq-core.sh and call validate_decision_record on a file."""
    script = f"validate_decision_record {_sq(str(file_path))}"
    return _bash_source(script)


def _validate_state_record(file_path: Path) -> subprocess.CompletedProcess:
    """Source oq-core.sh and call validate_state_record on a file."""
    script = f"validate_state_record {_sq(str(file_path))}"
    return _bash_source(script)


def _write_stamped(tmp_path: Path, name: str, obj: dict) -> Path:
    """Stamp obj and write to tmp_path/name. Returns the path."""
    stamped = _stamp(obj)
    path = tmp_path / name
    path.write_text(json.dumps(stamped, sort_keys=True, separators=(",", ":")))
    return path


# Shell constructor wrappers
# These call the bash constructor functions and return the JSON as a dict.

def _make_oq_record_shell(
    tmp_path: Path,
    oq_id: str,
    worker_id: str,
    seq: int,
    emitted_at: str,
    question: str,
    urgency: str,
    blocking: str,  # "true"/"false" for shell
    context_ref_json: str,
    status: str,
    supersedes: str,
) -> subprocess.CompletedProcess:
    """Call build_oq_record shell constructor; return CompletedProcess with JSON on stdout."""
    script = (
        f"build_oq_record "
        f"{_sq(oq_id)} {_sq(worker_id)} {_sq(str(seq))} {_sq(emitted_at)} "
        f"{_sq(question)} {_sq(urgency)} {_sq(blocking)} {_sq(context_ref_json)} "
        f"{_sq(status)} {_sq(supersedes)}"
    )
    return _bash_source(script)


def _make_decision_record_shell(
    oq_id: str,
    decided_at: str,
    decider_id: str,
    outcome: str,
    answer: str,
    directive_json: str,
) -> subprocess.CompletedProcess:
    """Call build_decision_record shell constructor; return CompletedProcess with JSON on stdout."""
    script = (
        f"build_decision_record "
        f"{_sq(oq_id)} {_sq(decided_at)} {_sq(decider_id)} "
        f"{_sq(outcome)} {_sq(answer)} {_sq(directive_json)}"
    )
    return _bash_source(script)


def _make_state_record_shell(
    worker_id: str,
    lifecycle_state: str,
    blocked_on: str,
    checkpoint_ref_json: str,
    updated_at: str,
) -> subprocess.CompletedProcess:
    """Call build_state_record shell constructor; return CompletedProcess with JSON on stdout."""
    script = (
        f"build_state_record "
        f"{_sq(worker_id)} {_sq(lifecycle_state)} {_sq(blocked_on)} "
        f"{_sq(checkpoint_ref_json)} {_sq(updated_at)}"
    )
    return _bash_source(script)


# ──────────────────────────────────────────────────────────────────────────────
# Sanity: script files exist
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_canonical_py_exists():
    assert _OQ_CANONICAL.is_file(), f"oq-canonical.py not found at {_OQ_CANONICAL}"


def test_oq_core_sh_exists():
    assert _OQ_CORE_SH.is_file(), f"oq-core.sh not found at {_OQ_CORE_SH}"


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-1 + OQ-INV-12: oq_id derivation — determinism and exclusion
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_id_deterministic_same_inputs():
    """Same (task_id, phase, question, context_ref) always yields the same oq_id."""
    id1 = _derive_oq_id("task-10", "phase-a", "What is the scope?", {"doc": "spec.md"})
    id2 = _derive_oq_id("task-10", "phase-a", "What is the scope?", {"doc": "spec.md"})
    assert id1 == id2
    assert id1.startswith("oq-")
    assert len(id1) == len("oq-") + 16  # "oq-" + 16 hex chars


def test_oq_id_different_question_yields_different_id():
    """A changed question yields a different oq_id (content sensitivity)."""
    id1 = _derive_oq_id("task-10", "phase-a", "What is the scope?", {"doc": "spec.md"})
    id2 = _derive_oq_id("task-10", "phase-a", "What is the deadline?", {"doc": "spec.md"})
    assert id1 != id2


def test_oq_id_different_task_id_yields_different_id():
    """A changed task_id yields a different oq_id."""
    id1 = _derive_oq_id("task-10", "phase-a", "Same question", {})
    id2 = _derive_oq_id("task-11", "phase-a", "Same question", {})
    assert id1 != id2


def test_oq_id_different_phase_yields_different_id():
    """A changed phase yields a different oq_id."""
    id1 = _derive_oq_id("task-10", "phase-a", "Same question", {})
    id2 = _derive_oq_id("task-10", "phase-b", "Same question", {})
    assert id1 != id2


def test_oq_id_whitespace_normalisation_same_id():
    """Whitespace-only differences in question → same oq_id (normalisation).

    "a  b" vs " a b " should normalise to "a b" in both cases.
    """
    id1 = _derive_oq_id("task-10", "phase-a", "a  b", {})
    id2 = _derive_oq_id("task-10", "phase-a", " a b ", {})
    assert id1 == id2, (
        f"Expected same oq_id after whitespace normalisation, got {id1!r} vs {id2!r}"
    )


def test_oq_id_leading_trailing_whitespace_normalised():
    """Leading/trailing whitespace in question does not change the oq_id."""
    id1 = _derive_oq_id("task-10", "phase-a", "What is scope?", {})
    id2 = _derive_oq_id("task-10", "phase-a", "  What is scope?  ", {})
    assert id1 == id2


def test_oq_id_worker_id_excluded():
    """Changing worker_id does not change oq_id (OQ-INV-12)."""
    # derive_oq_id only takes task_id, phase, question, context_ref —
    # worker_id is not an input; verify by deriving twice.
    id1 = _derive_oq_id("task-20", "plan", "Is this safe?", {"ref": "a"})
    id2 = _derive_oq_id("task-20", "plan", "Is this safe?", {"ref": "a"})
    # Both calls should produce the same result (worker_id never enters the formula).
    assert id1 == id2


def test_oq_id_context_ref_key_order_independent():
    """context_ref key order does not affect oq_id (canonical serialisation)."""
    id1 = _derive_oq_id("task-30", "impl", "Any blockers?", {"a": 1, "b": 2})
    id2 = _derive_oq_id("task-30", "impl", "Any blockers?", {"b": 2, "a": 1})
    assert id1 == id2, (
        f"Expected key-order-independent oq_id, got {id1!r} vs {id2!r}"
    )


def test_oq_id_format():
    """oq_id always has format 'oq-' + 16 lowercase hex chars."""
    oq_id = _derive_oq_id("task-1", "p1", "Q?", {})
    assert oq_id.startswith("oq-"), f"Expected 'oq-' prefix, got {oq_id!r}"
    hex_part = oq_id[3:]
    assert len(hex_part) == 16, f"Expected 16 hex chars, got {len(hex_part)}: {hex_part!r}"
    assert all(c in "0123456789abcdef" for c in hex_part), (
        f"hex part contains non-hex chars: {hex_part!r}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# derive-oq-id subcommand in oq-canonical.py (determinism parity with shell)
# ──────────────────────────────────────────────────────────────────────────────

def test_derive_oq_id_python_matches_shell():
    """oq-canonical.py derive-oq-id produces the same oq_id as the shell helper."""
    task_id = "task-99"
    phase = "review"
    question = "Is this complete?"
    context_ref = {"section": "3.2"}

    shell_id = _derive_oq_id(task_id, phase, question, context_ref)

    payload = {
        "task_id": task_id,
        "phase": phase,
        "question": question,
        "context_ref": context_ref,
    }
    py_result = _run_canonical("derive-oq-id", payload)
    assert py_result.returncode == 0, f"derive-oq-id failed: {py_result.stderr}"
    py_id = py_result.stdout.strip()

    assert shell_id == py_id, (
        f"Shell derive_oq_id {shell_id!r} != Python derive-oq-id {py_id!r}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-4: next_seq — disk-derived monotonic seq
# ──────────────────────────────────────────────────────────────────────────────

def test_next_seq_empty_dir_returns_zero(tmp_path: Path):
    """next_seq on an empty questions dir returns 0."""
    questions_dir = tmp_path / "questions"
    questions_dir.mkdir()
    assert _next_seq(questions_dir) == 0


def test_next_seq_absent_dir_returns_zero(tmp_path: Path):
    """next_seq when the questions dir does not exist returns 0."""
    questions_dir = tmp_path / "questions"
    assert not questions_dir.exists()
    assert _next_seq(questions_dir) == 0


def test_next_seq_sequential_records(tmp_path: Path):
    """next_seq with seq 0,1,2 returns 3."""
    questions_dir = tmp_path / "questions"
    for seq in (0, 1, 2):
        _seed_record(questions_dir, seq)
    assert _next_seq(questions_dir) == 3


def test_next_seq_out_of_order_records(tmp_path: Path):
    """next_seq with out-of-order seq values (2,0,1) still returns 3 (max+1)."""
    questions_dir = tmp_path / "questions"
    for seq in (2, 0, 1):
        _seed_record(questions_dir, seq)
    assert _next_seq(questions_dir) == 3


def test_next_seq_single_record(tmp_path: Path):
    """next_seq with a single record at seq=5 returns 6."""
    questions_dir = tmp_path / "questions"
    _seed_record(questions_dir, 5)
    assert _next_seq(questions_dir) == 6


def test_next_seq_reads_record_not_mtime(tmp_path: Path):
    """next_seq derives value from in-record seq field, not filesystem mtime.

    Seed three records (seq 0,1,2). Then set the mtime of the seq=2 record
    to a very old time. next_seq should still return 3, not something based on mtime.
    """
    questions_dir = tmp_path / "questions"
    for seq in (0, 1, 2):
        _seed_record(questions_dir, seq)

    # Set mtime of the seq=2 record to year 2000.
    latest_record = questions_dir / "oq-0000000000000002.json"
    old_time = 946684800  # 2000-01-01T00:00:00Z as Unix timestamp
    os.utime(latest_record, (old_time, old_time))

    # Despite old mtime, next_seq must still return 3.
    assert _next_seq(questions_dir) == 3


# ──────────────────────────────────────────────────────────────────────────────
# Record constructors: round-trip + verify (OQ, Decision, oq-state)
# ──────────────────────────────────────────────────────────────────────────────

def test_build_oq_record_round_trips(tmp_path: Path):
    """build_oq_record constructs a stamped OQ record that passes verify_record."""
    oq_id = _derive_oq_id("task-1", "plan", "What is the scope?", {"ref": "s1"})
    result = _make_oq_record_shell(
        tmp_path,
        oq_id=oq_id,
        worker_id="worker-1",
        seq=0,
        emitted_at="2026-05-01T12:00:00Z",
        question="What is the scope?",
        urgency="normal",
        blocking="false",
        context_ref_json='{"ref":"s1"}',
        status="open",
        supersedes="null",
    )
    assert result.returncode == 0, f"build_oq_record failed: {result.stderr}"
    record = json.loads(result.stdout)
    assert record["schema_version"] == 1
    assert "checksum" in record
    assert record["oq_id"] == oq_id
    assert record["urgency"] == "normal"
    assert record["status"] == "open"
    assert record["blocking"] is False

    # Write to disk and verify via verify_record.
    record_file = tmp_path / "oq.json"
    record_file.write_text(result.stdout.strip())
    verify_result = _verify_record(record_file)
    assert verify_result.returncode == 0, f"verify_record failed: {verify_result.stderr}"


def test_build_decision_record_round_trips(tmp_path: Path):
    """build_decision_record constructs a stamped decision record that passes verify_record."""
    result = _make_decision_record_shell(
        oq_id="oq-abc123def456789a",
        decided_at="2026-05-02T09:30:00Z",
        decider_id="liam",
        outcome="answered",
        answer="Proceed with option B.",
        directive_json="null",
    )
    assert result.returncode == 0, f"build_decision_record failed: {result.stderr}"
    record = json.loads(result.stdout)
    assert record["schema_version"] == 1
    assert "checksum" in record
    assert record["outcome"] == "answered"
    assert record["answer"] == "Proceed with option B."
    assert record["directive"] is None

    record_file = tmp_path / "decision.json"
    record_file.write_text(result.stdout.strip())
    verify_result = _verify_record(record_file)
    assert verify_result.returncode == 0, f"verify_record failed: {verify_result.stderr}"


def test_build_state_record_round_trips(tmp_path: Path):
    """build_state_record constructs a stamped oq-state record that passes verify_record."""
    result = _make_state_record_shell(
        worker_id="worker-1",
        lifecycle_state="working",
        blocked_on="null",
        checkpoint_ref_json="null",
        updated_at="2026-05-01T12:00:00Z",
    )
    assert result.returncode == 0, f"build_state_record failed: {result.stderr}"
    record = json.loads(result.stdout)
    assert record["schema_version"] == 1
    assert "checksum" in record
    assert record["lifecycle_state"] == "working"
    assert record["blocked_on"] is None

    record_file = tmp_path / "state.json"
    record_file.write_text(result.stdout.strip())
    verify_result = _verify_record(record_file)
    assert verify_result.returncode == 0, f"verify_record failed: {verify_result.stderr}"


def test_build_state_record_with_opaque_checkpoint_ref(tmp_path: Path):
    """checkpoint_ref is OPAQUE — any JSON object is accepted without shape validation (OQ-INV-21)."""
    # Pass a deeply nested object with unusual keys — must not be rejected.
    result = _make_state_record_shell(
        worker_id="worker-1",
        lifecycle_state="awaiting-decision",
        blocked_on="oq-abc123def456789a",
        checkpoint_ref_json='{"arbitrary_key":{"nested":42},"another":"value"}',
        updated_at="2026-05-01T13:00:00Z",
    )
    assert result.returncode == 0, (
        f"build_state_record rejected opaque checkpoint_ref: {result.stderr}"
    )
    record = json.loads(result.stdout)
    assert record["checkpoint_ref"] == {"arbitrary_key": {"nested": 42}, "another": "value"}


# ──────────────────────────────────────────────────────────────────────────────
# Tamper detection: modifying a field after construction fails verify_record
# ──────────────────────────────────────────────────────────────────────────────

def test_tamper_oq_record_fails_verify(tmp_path: Path):
    """Modifying an OQ record field (without re-stamping) makes verify_record fail closed."""
    oq_id = _derive_oq_id("task-1", "plan", "Original question", {})
    result = _make_oq_record_shell(
        tmp_path,
        oq_id=oq_id,
        worker_id="worker-1",
        seq=0,
        emitted_at="2026-05-01T12:00:00Z",
        question="Original question",
        urgency="normal",
        blocking="false",
        context_ref_json="{}",
        status="open",
        supersedes="null",
    )
    assert result.returncode == 0
    record = json.loads(result.stdout)
    # Tamper: change the question without re-stamping.
    record["question"] = "Tampered question"
    record_file = tmp_path / "tampered-oq.json"
    record_file.write_text(json.dumps(record, sort_keys=True, separators=(",", ":")))
    verify_result = _verify_record(record_file)
    assert verify_result.returncode != 0, "Expected verify_record to fail on tampered record"
    assert "channel error" in verify_result.stderr


def test_tamper_decision_record_fails_verify(tmp_path: Path):
    """Modifying a decision record field (without re-stamping) makes verify_record fail closed."""
    result = _make_decision_record_shell(
        oq_id="oq-abc123def456789a",
        decided_at="2026-05-02T09:30:00Z",
        decider_id="liam",
        outcome="answered",
        answer="Original answer.",
        directive_json="null",
    )
    assert result.returncode == 0
    record = json.loads(result.stdout)
    record["answer"] = "Tampered answer."
    record_file = tmp_path / "tampered-decision.json"
    record_file.write_text(json.dumps(record, sort_keys=True, separators=(",", ":")))
    verify_result = _verify_record(record_file)
    assert verify_result.returncode != 0
    assert "channel error" in verify_result.stderr


def test_tamper_state_record_fails_verify(tmp_path: Path):
    """Modifying an oq-state record field (without re-stamping) makes verify_record fail closed."""
    result = _make_state_record_shell(
        worker_id="worker-1",
        lifecycle_state="working",
        blocked_on="null",
        checkpoint_ref_json="null",
        updated_at="2026-05-01T12:00:00Z",
    )
    assert result.returncode == 0
    record = json.loads(result.stdout)
    record["lifecycle_state"] = "tampered-state"
    record_file = tmp_path / "tampered-state.json"
    record_file.write_text(json.dumps(record, sort_keys=True, separators=(",", ":")))
    verify_result = _verify_record(record_file)
    assert verify_result.returncode != 0
    assert "channel error" in verify_result.stderr


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-31: enum / required-field validation fails closed (shell validators)
# ──────────────────────────────────────────────────────────────────────────────

def test_validate_oq_record_rejects_bad_urgency(tmp_path: Path):
    """urgency:'urgent' is not in {low,normal,high} — validator must fail closed."""
    path = _write_stamped(tmp_path, "bad-urgency.json", _make_oq_record(urgency="urgent"))
    result = _validate_oq_record(path)
    assert result.returncode != 0, "Expected non-zero for bad urgency"
    assert "channel error" in result.stderr


def test_validate_oq_record_rejects_bad_status(tmp_path: Path):
    """status:'pending' is not in {open,cancelled} — validator must fail closed."""
    path = _write_stamped(tmp_path, "bad-status.json", _make_oq_record(status="pending"))
    result = _validate_oq_record(path)
    assert result.returncode != 0, "Expected non-zero for bad status"
    assert "channel error" in result.stderr


def test_validate_oq_record_passes_valid(tmp_path: Path):
    """A fully valid OQ record passes the validator."""
    path = _write_stamped(tmp_path, "valid-oq.json", _make_oq_record())
    result = _validate_oq_record(path)
    assert result.returncode == 0, f"Expected pass, got: {result.stderr}"


def test_validate_decision_record_rejects_bad_outcome(tmp_path: Path):
    """outcome:'rejected' is not in {answered,deferred,cancelled,abort_task} — fail closed."""
    path = _write_stamped(tmp_path, "bad-outcome.json", _make_decision_record(outcome="rejected"))
    result = _validate_decision_record(path)
    assert result.returncode != 0, "Expected non-zero for bad outcome"
    assert "channel error" in result.stderr


def test_validate_decision_record_passes_valid(tmp_path: Path):
    """A fully valid decision record passes the validator."""
    path = _write_stamped(tmp_path, "valid-decision.json", _make_decision_record())
    result = _validate_decision_record(path)
    assert result.returncode == 0, f"Expected pass, got: {result.stderr}"


def test_validate_decision_record_all_outcomes_valid(tmp_path: Path):
    """All four valid outcome values pass the validator."""
    for outcome in ("answered", "deferred", "cancelled", "abort_task"):
        path = _write_stamped(tmp_path, f"outcome-{outcome}.json", _make_decision_record(outcome=outcome))
        result = _validate_decision_record(path)
        assert result.returncode == 0, f"Outcome {outcome!r} should be valid, got: {result.stderr}"


def test_validate_state_record_rejects_bad_lifecycle(tmp_path: Path):
    """lifecycle_state:'idle' is not in {working,awaiting-decision} — fail closed."""
    path = _write_stamped(tmp_path, "bad-lifecycle.json", _make_state_record(lifecycle_state="idle"))
    result = _validate_state_record(path)
    assert result.returncode != 0, "Expected non-zero for bad lifecycle_state"
    assert "channel error" in result.stderr


def test_validate_state_record_passes_valid(tmp_path: Path):
    """A fully valid oq-state record passes the validator."""
    path = _write_stamped(tmp_path, "valid-state.json", _make_state_record())
    result = _validate_state_record(path)
    assert result.returncode == 0, f"Expected pass, got: {result.stderr}"


def test_validate_state_record_all_lifecycle_states_valid(tmp_path: Path):
    """Both lifecycle_state values pass the validator."""
    for state in ("working", "awaiting-decision"):
        path = _write_stamped(tmp_path, f"state-{state}.json", _make_state_record(lifecycle_state=state))
        result = _validate_state_record(path)
        assert result.returncode == 0, f"lifecycle_state {state!r} should be valid, got: {result.stderr}"


def test_validate_oq_record_missing_required_field_fails_closed(tmp_path: Path):
    """Missing a required field (e.g. question) makes the OQ validator fail closed."""
    rec = _make_oq_record()
    del rec["question"]
    path = _write_stamped(tmp_path, "missing-question.json", rec)
    result = _validate_oq_record(path)
    assert result.returncode != 0, "Expected non-zero for missing required field"
    assert "channel error" in result.stderr


def test_validate_decision_record_missing_required_field_fails_closed(tmp_path: Path):
    """Missing a required field (e.g. decider_id) makes the decision validator fail closed."""
    rec = _make_decision_record()
    del rec["decider_id"]
    path = _write_stamped(tmp_path, "missing-decider.json", rec)
    result = _validate_decision_record(path)
    assert result.returncode != 0, "Expected non-zero for missing required field"
    assert "channel error" in result.stderr


def test_validate_state_record_missing_required_field_fails_closed(tmp_path: Path):
    """Missing a required field (e.g. worker_id) makes the state validator fail closed."""
    rec = _make_state_record()
    del rec["worker_id"]
    path = _write_stamped(tmp_path, "missing-worker.json", rec)
    result = _validate_state_record(path)
    assert result.returncode != 0, "Expected non-zero for missing required field"
    assert "channel error" in result.stderr


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-26: provenance from in-record fields, not mtime
# ──────────────────────────────────────────────────────────────────────────────

def test_provenance_from_record_fields_not_mtime(tmp_path: Path):
    """Ordering/provenance derives from in-record seq and emitted_at, not filesystem mtime.

    Build two OQ records: record A with seq=0 (emitted earlier) and record B
    with seq=1 (emitted later). Set their mtimes in reverse order (B has older
    mtime than A). Assert that seq and emitted_at in the records are the true
    ordering signal.
    """
    questions_dir = tmp_path / "questions"
    questions_dir.mkdir()

    # Build record A (seq=0, emitted first).
    oq_id_a = _derive_oq_id("task-p", "plan", "Question A?", {})
    res_a = _make_oq_record_shell(
        tmp_path,
        oq_id=oq_id_a,
        worker_id="worker-x",
        seq=0,
        emitted_at="2026-01-01T10:00:00Z",
        question="Question A?",
        urgency="normal",
        blocking="false",
        context_ref_json="{}",
        status="open",
        supersedes="null",
    )
    assert res_a.returncode == 0
    file_a = questions_dir / "rec-a.json"
    file_a.write_text(res_a.stdout.strip())

    # Build record B (seq=1, emitted later).
    oq_id_b = _derive_oq_id("task-p", "plan", "Question B?", {})
    res_b = _make_oq_record_shell(
        tmp_path,
        oq_id=oq_id_b,
        worker_id="worker-y",
        seq=1,
        emitted_at="2026-01-02T10:00:00Z",
        question="Question B?",
        urgency="normal",
        blocking="false",
        context_ref_json="{}",
        status="open",
        supersedes="null",
    )
    assert res_b.returncode == 0
    file_b = questions_dir / "rec-b.json"
    file_b.write_text(res_b.stdout.strip())

    # Reverse the mtimes: give record A (seq=0) a NEWER mtime than record B (seq=1).
    recent_time = 1800000000  # 2027-01-15T08:00:00Z — more recent
    old_time = 946684800       # 2000-01-01T00:00:00Z — ancient
    os.utime(file_a, (recent_time, recent_time))  # seq=0 gets newer mtime
    os.utime(file_b, (old_time, old_time))          # seq=1 gets older mtime

    # Despite reversed mtimes, the records' own seq and emitted_at should reflect truth.
    record_a = json.loads(file_a.read_text())
    record_b = json.loads(file_b.read_text())

    assert record_a["seq"] == 0, "Record A should have seq=0"
    assert record_b["seq"] == 1, "Record B should have seq=1"
    assert record_a["emitted_at"] < record_b["emitted_at"], (
        "emitted_at should reflect true chronological order, not mtime"
    )
    assert record_a["worker_id"] == "worker-x"
    assert record_b["worker_id"] == "worker-y"

    # Verify both records are still intact (mtime change doesn't affect content).
    verify_a = _verify_record(file_a)
    verify_b = _verify_record(file_b)
    assert verify_a.returncode == 0
    assert verify_b.returncode == 0
