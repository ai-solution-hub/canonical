"""Tests for oq-parent.sh: parent decide + delivery + decide-once guard.

Covers ID-43.7 testStrategy invariants:
  OQ-INV-4   — oq_list_open sorts by in-record seq (FIFO); never by mtime/filename.
  OQ-INV-10  — oq_decide is the authoritative writer of decisions/<oq_id>.json.
  OQ-INV-11  — no received/acks artefact written; decision file is authoritative.
  OQ-INV-13  — oq_decide refuses to write a decision for a cancelled OQ.
  OQ-INV-15  — filename stem of decisions/<oq_id>.json IS the oq_id (structural addressing).
  OQ-INV-17  — decision records pass verify_record (checksum + schema_version + enums).
  OQ-INV-19  — directive is DATA ONLY; no eval/exec/source path executes directive contents.
  OQ-INV-23  — cancelled OQs are dropped from the open list.
  OQ-INV-33  — decide-once guard: a second oq_decide for the same oq_id is refused.
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
# scripts/tests/oq/test_decide.py
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
_OQ_PARENT_SH = _SCRIPTS_DIR / "oq-parent.sh"


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


def _bash_core(script: str) -> subprocess.CompletedProcess:
    """Run *script* in bash after sourcing oq-core.sh (no oq-parent.sh)."""
    full = f"source {_OQ_CORE_SH}\n{script}"
    return subprocess.run(["bash", "-c", full], capture_output=True, text=True)


def _bash_parent(script: str) -> subprocess.CompletedProcess:
    """Run *script* in bash after sourcing oq-parent.sh (which sources oq-core.sh)."""
    full = f"source {_OQ_PARENT_SH}\n{script}"
    return subprocess.run(["bash", "-c", full], capture_output=True, text=True)


def _seed_oq_question(
    questions_dir: Path,
    oq_id: str,
    seq: int,
    status: str = "open",
) -> Path:
    """Write a minimal stamped OQ question record into questions_dir.

    Uses oq-core.sh build_oq_record so the fixture is constructed by the same
    helpers as production code.  Does NOT depend on oq-worker.sh.
    """
    questions_dir.mkdir(parents=True, exist_ok=True)
    script = (
        f"build_oq_record "
        f"{_sq(oq_id)} "           # oq_id
        f"'worker-test' "          # worker_id
        f"{_sq(str(seq))} "        # seq
        f"'2026-01-01T00:00:00Z' " # emitted_at
        f"'Test question?' "       # question
        f"'normal' "               # urgency
        f"'false' "                # blocking
        f"'{{}}' "                 # context_ref_json
        f"{_sq(status)} "          # status
        f"'null'"                  # supersedes
    )
    result = _bash_core(script)
    assert result.returncode == 0, (
        f"build_oq_record failed for {oq_id!r} (rc={result.returncode}): {result.stderr}"
    )
    record_path = questions_dir / f"{oq_id}.json"
    record_path.write_text(result.stdout.strip(), encoding="utf-8")
    return record_path


def _oq_list_open(oq_root: Path) -> subprocess.CompletedProcess:
    """Call oq_list_open via oq-parent.sh."""
    script = f"oq_list_open {_sq(str(oq_root))}"
    return _bash_parent(script)


def _oq_decide(
    oq_root: Path,
    oq_id: str,
    decided_at: str = "2026-05-01T10:00:00Z",
    decider_id: str = "liam",
    outcome: str = "answered",
    answer: str = "The answer is 42.",
    directive_json: str = "null",
    worker_name: str = "",
) -> subprocess.CompletedProcess:
    """Call oq_decide via oq-parent.sh."""
    args = (
        f"{_sq(str(oq_root))} "
        f"{_sq(oq_id)} "
        f"{_sq(decided_at)} "
        f"{_sq(decider_id)} "
        f"{_sq(outcome)} "
        f"{_sq(answer)} "
        f"{_sq(directive_json)}"
    )
    if worker_name:
        args += f" {_sq(worker_name)}"
    script = f"oq_decide {args}"
    return _bash_parent(script)


def _verify_record(file_path: Path) -> subprocess.CompletedProcess:
    """Source oq-core.sh and call verify_record on a file."""
    script = f"verify_record {_sq(str(file_path))}"
    return _bash_core(script)


# ──────────────────────────────────────────────────────────────────────────────
# Sanity: script files must exist
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_parent_sh_exists():
    assert _OQ_PARENT_SH.is_file(), f"oq-parent.sh not found at {_OQ_PARENT_SH}"


def test_oq_parent_sh_is_executable():
    assert _OQ_PARENT_SH.stat().st_mode & 0o111, "oq-parent.sh must be executable"


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-4 / OQ-INV-23: oq_list_open — FIFO ordering and filtering
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_list_open_fifo_order(tmp_path: Path):
    """oq_list_open returns open questions sorted by seq ascending (FIFO).

    Seed questions with seq values 2, 0, 1 — oq_list_open must return them
    in seq order: 0, 1, 2.  Ordering is by the in-record seq field, never by
    filename or mtime (OQ-INV-4).
    """
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"

    oq_id_seq2 = "oq-aa00000000000002"
    oq_id_seq0 = "oq-aa00000000000000"
    oq_id_seq1 = "oq-aa00000000000001"

    # Seed out of order: 2, 0, 1.
    _seed_oq_question(questions_dir, oq_id_seq2, seq=2)
    _seed_oq_question(questions_dir, oq_id_seq0, seq=0)
    _seed_oq_question(questions_dir, oq_id_seq1, seq=1)

    result = _oq_list_open(oq_root)
    assert result.returncode == 0, f"oq_list_open failed: {result.stderr}"

    listed = [line for line in result.stdout.strip().splitlines() if line.strip()]
    assert listed == [oq_id_seq0, oq_id_seq1, oq_id_seq2], (
        f"Expected FIFO order [seq0, seq1, seq2], got {listed!r}"
    )


def test_oq_list_open_excludes_decided(tmp_path: Path):
    """oq_list_open excludes questions that have already been decided."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"

    oq_id_open = "oq-bb00000000000000"
    oq_id_decided = "oq-bb00000000000001"

    _seed_oq_question(questions_dir, oq_id_open, seq=0)
    _seed_oq_question(questions_dir, oq_id_decided, seq=1)

    # Decide oq_id_decided.
    decide_result = _oq_decide(oq_root, oq_id_decided, outcome="answered")
    assert decide_result.returncode == 0, f"oq_decide failed: {decide_result.stderr}"

    result = _oq_list_open(oq_root)
    assert result.returncode == 0, f"oq_list_open failed: {result.stderr}"

    listed = [line for line in result.stdout.strip().splitlines() if line.strip()]
    assert oq_id_open in listed, "Open question should be listed"
    assert oq_id_decided not in listed, "Decided question must not be listed"


def test_oq_list_open_excludes_cancelled(tmp_path: Path):
    """oq_list_open excludes questions with status:'cancelled' (OQ-INV-23)."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"

    oq_id_open = "oq-cc00000000000000"
    oq_id_cancelled = "oq-cc00000000000001"

    _seed_oq_question(questions_dir, oq_id_open, seq=0, status="open")
    _seed_oq_question(questions_dir, oq_id_cancelled, seq=1, status="cancelled")

    result = _oq_list_open(oq_root)
    assert result.returncode == 0, f"oq_list_open failed: {result.stderr}"

    listed = [line for line in result.stdout.strip().splitlines() if line.strip()]
    assert oq_id_open in listed, "Open question should be listed"
    assert oq_id_cancelled not in listed, "Cancelled question must not be listed"


def test_oq_list_open_fifo_with_filtering(tmp_path: Path):
    """oq_list_open with seq=2,0,1: decided and cancelled are excluded; remainder sorted."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"

    oq_seq0 = "oq-dd00000000000000"  # open → seq=0 (should appear first)
    oq_seq1 = "oq-dd00000000000001"  # decided → excluded
    oq_seq2 = "oq-dd00000000000002"  # cancelled → excluded
    oq_seq3 = "oq-dd00000000000003"  # open → seq=3 (should appear second)

    _seed_oq_question(questions_dir, oq_seq0, seq=0)
    _seed_oq_question(questions_dir, oq_seq1, seq=1)
    _seed_oq_question(questions_dir, oq_seq2, seq=2, status="cancelled")
    _seed_oq_question(questions_dir, oq_seq3, seq=3)

    # Decide seq1.
    decide_result = _oq_decide(oq_root, oq_seq1, outcome="answered")
    assert decide_result.returncode == 0

    result = _oq_list_open(oq_root)
    assert result.returncode == 0, f"oq_list_open failed: {result.stderr}"

    listed = [line for line in result.stdout.strip().splitlines() if line.strip()]
    assert listed == [oq_seq0, oq_seq3], (
        f"Expected [oq_seq0, oq_seq3] in FIFO order; got {listed!r}"
    )


def test_oq_list_open_empty_returns_nothing(tmp_path: Path):
    """oq_list_open on a root with no questions prints nothing and exits 0."""
    oq_root = tmp_path / "oq"
    result = _oq_list_open(oq_root)
    assert result.returncode == 0
    assert result.stdout.strip() == ""


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-15: structural addressing — filename stem IS the oq_id
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_decide_addressing_stem_is_oq_id(tmp_path: Path):
    """oq_decide writes decisions/<oq_id>.json; the filename stem is exactly oq_id.

    Decide two distinct questions (OQ-X and OQ-Y) and assert:
    - Reading decisions/<X>.json yields X's decision (not Y's).
    - Reading decisions/<Y>.json yields Y's decision (not X's).
    - The oq_id field in each file matches the filename stem.
    """
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"

    oq_x = "oq-ee00000000000000"
    oq_y = "oq-ee00000000000001"

    _seed_oq_question(questions_dir, oq_x, seq=0)
    _seed_oq_question(questions_dir, oq_y, seq=1)

    res_x = _oq_decide(oq_root, oq_x, answer="Answer for X", outcome="answered")
    res_y = _oq_decide(oq_root, oq_y, answer="Answer for Y", outcome="deferred")
    assert res_x.returncode == 0, f"oq_decide for OQ-X failed: {res_x.stderr}"
    assert res_y.returncode == 0, f"oq_decide for OQ-Y failed: {res_y.stderr}"

    decisions_dir = oq_root / "decisions"

    # Read and parse each decision file by its oq_id stem.
    file_x = decisions_dir / f"{oq_x}.json"
    file_y = decisions_dir / f"{oq_y}.json"
    assert file_x.is_file(), f"Expected decision file for {oq_x}"
    assert file_y.is_file(), f"Expected decision file for {oq_y}"

    rec_x = json.loads(file_x.read_text())
    rec_y = json.loads(file_y.read_text())

    # oq_id field must match the filename stem.
    assert rec_x["oq_id"] == oq_x, (
        f"File {file_x.name}: oq_id field {rec_x['oq_id']!r} != stem {oq_x!r}"
    )
    assert rec_y["oq_id"] == oq_y, (
        f"File {file_y.name}: oq_id field {rec_y['oq_id']!r} != stem {oq_y!r}"
    )

    # Decision content is oq_id-specific (no cross-contamination).
    assert rec_x["answer"] == "Answer for X", "X's decision must contain X's answer"
    assert rec_y["answer"] == "Answer for Y", "Y's decision must contain Y's answer"
    assert rec_x["oq_id"] != rec_y["oq_id"], "The two decisions must address different oq_ids"


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-33 + OQ-INV-10: decide-once guard
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_decide_once_guard_refuses_second_decide(tmp_path: Path):
    """A second oq_decide for the same oq_id is REFUSED (non-zero) — OQ-INV-33.

    The first decision must remain intact and the second call must not overwrite it.
    """
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-ff00000000000000"
    _seed_oq_question(questions_dir, oq_id, seq=0)

    # First decide — must succeed.
    res1 = _oq_decide(oq_root, oq_id, answer="First answer", outcome="answered")
    assert res1.returncode == 0, f"First oq_decide failed: {res1.stderr}"

    # Read the first decision.
    decision_file = oq_root / "decisions" / f"{oq_id}.json"
    first_decision = json.loads(decision_file.read_text())
    assert first_decision["answer"] == "First answer"

    # Second decide — must be REFUSED.
    res2 = _oq_decide(oq_root, oq_id, answer="Second answer", outcome="deferred")
    assert res2.returncode != 0, "Second oq_decide must be refused (non-zero)"
    assert "channel error" in res2.stderr, (
        f"Expected 'channel error' in stderr; got: {res2.stderr!r}"
    )

    # The first decision must still be intact — not overwritten.
    still_first = json.loads(decision_file.read_text())
    assert still_first["answer"] == "First answer", (
        f"First decision was overwritten: {still_first['answer']!r}"
    )


def test_oq_decide_once_guard_error_message_uk_english(tmp_path: Path):
    """The decide-once refusal message is a UK-English 'channel error:' message."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-ff00000000000001"
    _seed_oq_question(questions_dir, oq_id, seq=0)

    _oq_decide(oq_root, oq_id, outcome="answered")

    res2 = _oq_decide(oq_root, oq_id, outcome="deferred")
    assert res2.returncode != 0
    # Must start with "channel error:" (UK-English, fail-closed convention).
    assert res2.stderr.strip().startswith("channel error:"), (
        f"Expected 'channel error:' prefix; got: {res2.stderr!r}"
    )
    # Must mention the oq_id so the caller can diagnose which decision already exists.
    assert oq_id in res2.stderr, f"Expected oq_id {oq_id!r} in the error message"


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-13: cancelled OQ → no decision may be written
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_decide_refuses_cancelled_question(tmp_path: Path):
    """oq_decide on a cancelled OQ is refused with non-zero exit (OQ-INV-13)."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-ee00000000000010"
    _seed_oq_question(questions_dir, oq_id, seq=0, status="cancelled")

    result = _oq_decide(oq_root, oq_id, outcome="answered")
    assert result.returncode != 0, "oq_decide on cancelled OQ must be refused"
    assert "channel error" in result.stderr, (
        f"Expected 'channel error' in stderr; got: {result.stderr!r}"
    )
    # No decision file must have been written.
    decision_file = oq_root / "decisions" / f"{oq_id}.json"
    assert not decision_file.exists(), "No decision file must be written for a cancelled OQ"


def test_oq_decide_refuses_cancelled_leaves_no_artefact(tmp_path: Path):
    """After refusing a cancelled OQ, no artefact of any kind exists in decisions/."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-ee00000000000011"
    _seed_oq_question(questions_dir, oq_id, seq=0, status="cancelled")

    _oq_decide(oq_root, oq_id, outcome="answered")

    decisions_dir = oq_root / "decisions"
    if decisions_dir.exists():
        artefacts = list(decisions_dir.iterdir())
        assert artefacts == [], (
            f"Expected no artefacts in decisions/ after cancelled refuse; found: {artefacts}"
        )


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-19: directive is DATA ONLY — no eval/exec/source path
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_decide_directive_stored_verbatim(tmp_path: Path):
    """A directive JSON object is stored verbatim in the decision record — DATA ONLY."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-gg00000000000000"
    _seed_oq_question(questions_dir, oq_id, seq=0)

    directive = {"kind": "abort_task", "reason": "scope exceeded"}
    result = _oq_decide(
        oq_root, oq_id, outcome="abort_task",
        directive_json=json.dumps(directive),
    )
    assert result.returncode == 0, f"oq_decide with directive failed: {result.stderr}"

    decision_file = oq_root / "decisions" / f"{oq_id}.json"
    rec = json.loads(decision_file.read_text())
    assert rec["directive"] == directive, (
        f"Expected directive {directive!r} to be stored verbatim; got {rec['directive']!r}"
    )


def test_oq_decide_directive_shell_injection_inert(tmp_path: Path):
    """A directive containing shell-injection-looking content is stored as inert data.

    This test verifies that oq_decide does NOT execute the directive; the
    shell-unsafe string is stored literally and the side-effect (touching a
    sentinel file) does NOT occur.
    """
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-gg00000000000001"
    _seed_oq_question(questions_dir, oq_id, seq=0)

    # Sentinel file that would be created if the directive were executed as shell.
    sentinel = tmp_path / "PWNED"

    # A directive payload that looks like a shell command.
    malicious_directive = {"kind": "eval", "cmd": f"touch {sentinel}"}
    result = _oq_decide(
        oq_root, oq_id, outcome="answered",
        directive_json=json.dumps(malicious_directive),
    )
    assert result.returncode == 0, f"oq_decide failed: {result.stderr}"

    # The sentinel file must NOT exist — directive was not executed.
    assert not sentinel.exists(), (
        "Sentinel file created — directive content was executed as shell (OQ-INV-19 violated)"
    )

    # The directive must be stored as data.
    decision_file = oq_root / "decisions" / f"{oq_id}.json"
    rec = json.loads(decision_file.read_text())
    assert rec["directive"] == malicious_directive, (
        f"Directive not stored verbatim: {rec['directive']!r}"
    )


def test_oq_parent_sh_has_no_eval_on_directive(tmp_path: Path):
    """grep oq-parent.sh for eval/exec/source acting on directive contents.

    This is a static code check: assert there is no code path in oq-parent.sh
    that passes directive content to eval, exec, or source.
    """
    content = _OQ_PARENT_SH.read_text(encoding="utf-8")
    lines = content.splitlines()

    # Patterns that would indicate directive content is being executed.
    # We look for eval or source/. invocations that reference directive-related
    # variable names.  The oq-parent.sh comment that mentions eval in the
    # invariant description is exempt; we check for actual executable invocations.
    suspicious = []
    for i, line in enumerate(lines, start=1):
        stripped = line.strip()
        # Skip comment lines.
        if stripped.startswith("#"):
            continue
        # Check for eval with any reference to directive content.
        if "eval" in stripped and "directive" in stripped:
            suspicious.append((i, line))
        # Check for source/. that could run directive content.
        if ("source " in stripped or stripped.startswith(". ")) and "directive" in stripped:
            suspicious.append((i, line))

    assert suspicious == [], (
        "Found potential eval/exec/source-on-directive in oq-parent.sh:\n"
        + "\n".join(f"  line {ln}: {txt}" for ln, txt in suspicious)
    )


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-11: no received/acks artefact after a happy-path decide
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_decide_no_received_acks_artefact(tmp_path: Path):
    """After a successful oq_decide, no received/acks file or directory exists under oq_root."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-hh00000000000000"
    _seed_oq_question(questions_dir, oq_id, seq=0)

    result = _oq_decide(oq_root, oq_id, outcome="answered")
    assert result.returncode == 0, f"oq_decide failed: {result.stderr}"

    # Recursively scan oq_root for any file/dir named 'received' or 'acks'.
    suspicious_artefacts = []
    for item in oq_root.rglob("*"):
        name = item.name.lower()
        if "received" in name or "acks" in name:
            suspicious_artefacts.append(item)

    assert suspicious_artefacts == [], (
        f"Found received/acks artefact(s) under oq_root (OQ-INV-11 violated): "
        f"{suspicious_artefacts}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-17: decision record passes verify_record (checksum + schema_version + enums)
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_decide_decision_passes_verify_record(tmp_path: Path):
    """The written decision file must pass verify_record (OQ-INV-17)."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-ii00000000000000"
    _seed_oq_question(questions_dir, oq_id, seq=0)

    result = _oq_decide(oq_root, oq_id, outcome="answered", answer="Verified answer.")
    assert result.returncode == 0, f"oq_decide failed: {result.stderr}"

    decision_file = oq_root / "decisions" / f"{oq_id}.json"
    assert decision_file.is_file(), "Decision file must exist"

    verify_result = _verify_record(decision_file)
    assert verify_result.returncode == 0, (
        f"Decision record failed verify_record: {verify_result.stderr}"
    )


def test_oq_decide_all_valid_outcomes_pass_verify(tmp_path: Path):
    """All four valid outcome values produce a decision that passes verify_record."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"

    outcomes = ["answered", "deferred", "cancelled", "abort_task"]
    for i, outcome in enumerate(outcomes):
        oq_id = f"oq-jj0000000000000{i}"
        _seed_oq_question(questions_dir, oq_id, seq=i)
        result = _oq_decide(oq_root, oq_id, outcome=outcome)
        assert result.returncode == 0, (
            f"oq_decide with outcome {outcome!r} failed: {result.stderr}"
        )
        decision_file = oq_root / "decisions" / f"{oq_id}.json"
        verify_result = _verify_record(decision_file)
        assert verify_result.returncode == 0, (
            f"Decision with outcome {outcome!r} failed verify_record: {verify_result.stderr}"
        )


def test_oq_decide_decision_has_correct_fields(tmp_path: Path):
    """The decision record contains all required fields with correct values."""
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-kk00000000000000"
    _seed_oq_question(questions_dir, oq_id, seq=0)

    decided_at = "2026-05-29T14:30:00Z"
    decider_id = "liam"
    outcome = "answered"
    answer = "This is the definitive answer."
    directive = {"kind": "continue", "notes": "proceed as planned"}

    result = _oq_decide(
        oq_root, oq_id,
        decided_at=decided_at,
        decider_id=decider_id,
        outcome=outcome,
        answer=answer,
        directive_json=json.dumps(directive),
    )
    assert result.returncode == 0, f"oq_decide failed: {result.stderr}"

    decision_file = oq_root / "decisions" / f"{oq_id}.json"
    rec = json.loads(decision_file.read_text())

    assert rec["oq_id"] == oq_id
    assert rec["decided_at"] == decided_at
    assert rec["decider_id"] == decider_id
    assert rec["outcome"] == outcome
    assert rec["answer"] == answer
    assert rec["directive"] == directive
    assert rec["schema_version"] == 1
    assert "checksum" in rec
    assert len(rec["checksum"]) == 64


# ──────────────────────────────────────────────────────────────────────────────
# Nudge non-correctness: oq_decide succeeds even without send-prompt.sh / cmux
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_decide_succeeds_without_worker_name(tmp_path: Path):
    """oq_decide without a worker_name succeeds and the decision file is complete.

    The nudge (send-prompt.sh) is optional — omitting worker_name must not
    affect correctness.  The decision file is the authoritative artefact.
    """
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-ll00000000000000"
    _seed_oq_question(questions_dir, oq_id, seq=0)

    # No worker_name supplied.
    result = _oq_decide(oq_root, oq_id, outcome="answered", answer="No nudge needed.")
    assert result.returncode == 0, f"oq_decide failed without worker_name: {result.stderr}"

    decision_file = oq_root / "decisions" / f"{oq_id}.json"
    assert decision_file.is_file(), "Decision file must be written even without a nudge"
    rec = json.loads(decision_file.read_text())
    assert rec["answer"] == "No nudge needed."
    assert rec["oq_id"] == oq_id


def test_oq_decide_succeeds_with_unavailable_cmux(tmp_path: Path):
    """oq_decide succeeds and the decision file is complete even when cmux is unavailable.

    Supply a worker_name so the nudge path is attempted.  Send-prompt.sh
    will fail because cmux is not running; this must NOT affect the decide
    outcome.  The decision file is the authoritative artefact (OQ-INV-11).
    """
    oq_root = tmp_path / "oq"
    questions_dir = oq_root / "questions"
    oq_id = "oq-ll00000000000001"
    _seed_oq_question(questions_dir, oq_id, seq=0)

    # Supply a worker name — the nudge will fail (cmux not running), but must
    # not affect the decide outcome.
    result = _oq_decide(
        oq_root, oq_id, outcome="answered",
        answer="Nudge may fail silently.",
        worker_name="non-existent-worker",
    )
    assert result.returncode == 0, (
        f"oq_decide failed when nudge is unavailable: {result.stderr}"
    )

    decision_file = oq_root / "decisions" / f"{oq_id}.json"
    assert decision_file.is_file(), "Decision file must be written even when nudge fails"
    rec = json.loads(decision_file.read_text())
    assert rec["answer"] == "Nudge may fail silently."
    assert rec["oq_id"] == oq_id


# ──────────────────────────────────────────────────────────────────────────────
# Sourcing guard: sourcing oq-parent.sh must not auto-run anything
# ──────────────────────────────────────────────────────────────────────────────

def test_sourcing_oq_parent_sh_has_no_side_effects(tmp_path: Path):
    """Sourcing oq-parent.sh alone (no function calls) must produce no output and exit 0."""
    result = subprocess.run(
        ["bash", "-c", f"source {_OQ_PARENT_SH}"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"Sourcing oq-parent.sh failed: {result.stderr}"
    assert result.stdout == "", (
        f"Sourcing oq-parent.sh produced unexpected stdout: {result.stdout!r}"
    )
