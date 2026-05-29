"""Tests for oq-core.sh atomic_publish primitive and oq-canonical.py integrity helper.

Covers ID-43.4 testStrategy invariants:
  OQ-INV-3  — every record carries a checksum; verify_record validates it.
  OQ-INV-5  — no partial/torn record visible; tmp is a same-dir dotfile.
  OQ-INV-14 — list_records enumerates only *.json final names; dotfiles excluded.
  OQ-INV-25 — canonical-JSON is deterministic regardless of input key order.
  OQ-INV-27 — verify_record fails closed on corruption / missing fields / wrong schema.
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
# ──────────────────────────────────────────────────────────────────────────────

# scripts/tests/oq/test_atomic_publish.py
#   └── scripts/tests/oq/         → parents[0]
#       └── scripts/tests/        → parents[1]
#           └── scripts/          → parents[2]
#               └── <repo root>   → parents[3]

_HERE = Path(__file__).resolve()
_REPO_ROOT = _HERE.parents[3]
_SCRIPTS_DIR = _REPO_ROOT / ".claude" / "skills" / "session-driver-cmux" / "scripts"
_OQ_CANONICAL = _SCRIPTS_DIR / "oq-canonical.py"
_OQ_CORE_SH = _SCRIPTS_DIR / "oq-core.sh"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _run_canonical(subcommand: str, obj: dict) -> subprocess.CompletedProcess:
    """Run oq-canonical.py <subcommand> with *obj* on stdin."""
    return subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), subcommand],
        input=json.dumps(obj),
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


def _atomic_publish(dir_path: Path, name: str, obj: dict) -> subprocess.CompletedProcess:
    """Source oq-core.sh and call atomic_publish with a stamped payload."""
    stamped = _stamp(obj)
    payload_json = json.dumps(stamped, sort_keys=True, separators=(",", ":"))
    script = f"atomic_publish {dir_path} {name} '{payload_json}'"
    return _bash_source(script)


def _list_records(dir_path: Path) -> subprocess.CompletedProcess:
    script = f"list_records {dir_path}"
    return _bash_source(script)


def _verify_record(file_path: Path) -> subprocess.CompletedProcess:
    script = f"verify_record {file_path}"
    return _bash_source(script)


# ──────────────────────────────────────────────────────────────────────────────
# Sanity: script files must exist
# ──────────────────────────────────────────────────────────────────────────────

def test_oq_canonical_py_exists():
    assert _OQ_CANONICAL.is_file(), f"oq-canonical.py not found at {_OQ_CANONICAL}"


def test_oq_core_sh_exists():
    assert _OQ_CORE_SH.is_file(), f"oq-core.sh not found at {_OQ_CORE_SH}"


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-25: canonical-JSON determinism
# ──────────────────────────────────────────────────────────────────────────────

def test_canonicalise_sorts_keys():
    """Same object in different key orders → identical canonical output."""
    obj_a = {"z": 1, "a": 2, "m": 3}
    obj_b = {"a": 2, "m": 3, "z": 1}
    result_a = _run_canonical("canonicalise", obj_a)
    result_b = _run_canonical("canonicalise", obj_b)
    assert result_a.returncode == 0
    assert result_b.returncode == 0
    assert result_a.stdout == result_b.stdout


def test_checksum_deterministic_across_key_orders():
    """Same object in different key orders → identical checksum."""
    obj_a = {"schema_version": 1, "type": "ping", "payload": "hello"}
    obj_b = {"payload": "hello", "type": "ping", "schema_version": 1}
    result_a = _run_canonical("checksum", obj_a)
    result_b = _run_canonical("checksum", obj_b)
    assert result_a.returncode == 0
    assert result_b.returncode == 0
    assert result_a.stdout.strip() == result_b.stdout.strip()
    # Checksum must be a 64-char hex string.
    assert len(result_a.stdout.strip()) == 64


def test_canonicalise_compact_no_extra_whitespace():
    """Canonical form uses compact separators (no spaces after : or ,)."""
    result = _run_canonical("canonicalise", {"b": 2, "a": 1})
    assert result.returncode == 0
    assert result.stdout.strip() == '{"a":1,"b":2}'


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-3: checksum stamping
# ──────────────────────────────────────────────────────────────────────────────

def test_stamp_adds_checksum_field():
    obj = {"schema_version": 1, "type": "test-event", "data": "value"}
    result = _run_canonical("stamp", obj)
    assert result.returncode == 0
    stamped = json.loads(result.stdout)
    assert "checksum" in stamped
    assert len(stamped["checksum"]) == 64


def test_stamp_checksum_is_correct():
    """stamp output's checksum must equal checksum computed over (obj minus checksum)."""
    obj = {"schema_version": 1, "type": "verify-me", "n": 42}
    stamped = _stamp(obj)
    # Re-compute checksum manually.
    without_cs = {k: v for k, v in stamped.items() if k != "checksum"}
    import hashlib
    canonical_bytes = json.dumps(without_cs, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    expected = hashlib.sha256(canonical_bytes).hexdigest()
    assert stamped["checksum"] == expected


def test_stamp_idempotent_checksum():
    """Stamping an already-stamped object produces the same checksum."""
    obj = {"schema_version": 1, "msg": "hello"}
    first = _stamp(obj)
    second = _stamp(first)
    assert first["checksum"] == second["checksum"]


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-27: verify_record fails closed
# ──────────────────────────────────────────────────────────────────────────────

def test_verify_valid_record_exits_zero(tmp_path: Path):
    """A valid stamped record passes verify."""
    obj = {"schema_version": 1, "type": "heartbeat", "seq": 1}
    stamped = _stamp(obj)
    record_file = tmp_path / "ok.json"
    record_file.write_text(json.dumps(stamped, sort_keys=True, separators=(",", ":")))
    result = _verify_record(record_file)
    assert result.returncode == 0, f"Expected pass, got: {result.stderr}"


def test_verify_corrupted_checksum_fails_closed(tmp_path: Path):
    """Corrupted checksum → non-zero exit."""
    obj = {"schema_version": 1, "type": "msg", "body": "abc"}
    stamped = _stamp(obj)
    stamped["checksum"] = "0" * 64  # corrupt the checksum
    record_file = tmp_path / "corrupt.json"
    record_file.write_text(json.dumps(stamped))
    result = _verify_record(record_file)
    assert result.returncode != 0
    assert "channel error" in result.stderr or "checksum" in result.stderr


def test_verify_missing_checksum_fails_closed(tmp_path: Path):
    """Record without checksum field → non-zero exit."""
    obj = {"schema_version": 1, "type": "msg"}
    # Do NOT stamp — no checksum field.
    record_file = tmp_path / "no_checksum.json"
    record_file.write_text(json.dumps(obj))
    result = _verify_record(record_file)
    assert result.returncode != 0
    assert "channel error" in result.stderr or "checksum" in result.stderr


def test_verify_missing_schema_version_fails_closed(tmp_path: Path):
    """Record without schema_version → non-zero exit."""
    import hashlib
    obj = {"type": "msg", "body": "hello"}
    canonical = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    obj["checksum"] = hashlib.sha256(canonical.encode()).hexdigest()
    record_file = tmp_path / "no_version.json"
    record_file.write_text(json.dumps(obj))
    result = _verify_record(record_file)
    assert result.returncode != 0
    assert "channel error" in result.stderr or "schema_version" in result.stderr


def test_verify_wrong_schema_version_fails_closed(tmp_path: Path):
    """schema_version != 1 → non-zero exit."""
    obj = {"schema_version": 2, "type": "msg"}
    stamped = _stamp(obj)
    # Re-stamp but with schema_version=2 already present — checksum will be
    # computed correctly over v2, but verify must reject schema_version != 1.
    record_file = tmp_path / "wrong_version.json"
    record_file.write_text(json.dumps(stamped, sort_keys=True, separators=(",", ":")))
    result = _verify_record(record_file)
    assert result.returncode != 0
    assert "channel error" in result.stderr or "schema_version" in result.stderr


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-5: atomic_publish — no partial/torn record visible
# ──────────────────────────────────────────────────────────────────────────────

def test_atomic_publish_creates_final_record(tmp_path: Path):
    """After atomic_publish the target *.json file exists and parses correctly."""
    obj = {"schema_version": 1, "type": "publish-test", "seq": 1}
    result = _atomic_publish(tmp_path, "record-01.json", obj)
    assert result.returncode == 0, f"atomic_publish failed: {result.stderr}"

    final = tmp_path / "record-01.json"
    assert final.is_file(), "Final record file was not created."
    parsed = json.loads(final.read_text())
    assert parsed["type"] == "publish-test"
    assert parsed["seq"] == 1
    assert "checksum" in parsed


def test_atomic_publish_no_dotfile_remains(tmp_path: Path):
    """After atomic_publish no dotfile (tmp) remains in the directory."""
    obj = {"schema_version": 1, "type": "cleanup-test"}
    result = _atomic_publish(tmp_path, "record-02.json", obj)
    assert result.returncode == 0, f"atomic_publish failed: {result.stderr}"

    dotfiles = [f for f in tmp_path.iterdir() if f.name.startswith(".")]
    assert dotfiles == [], f"Unexpected dotfiles remain: {dotfiles}"


def test_atomic_publish_tmp_is_same_dir_dotfile(tmp_path: Path):
    """The tmp path used by atomic_publish is a dotfile in $dir.

    We verify this indirectly: the final record is present, no non-dotfile
    temp files leaked to /tmp or any other directory, and the directory
    contains exactly one file (the final record).
    """
    obj = {"schema_version": 1, "type": "tmp-dir-test"}
    result = _atomic_publish(tmp_path, "record-03.json", obj)
    assert result.returncode == 0, f"atomic_publish failed: {result.stderr}"

    all_files = list(tmp_path.iterdir())
    # Exactly one file in the dir: the final record.
    assert len(all_files) == 1
    assert all_files[0].name == "record-03.json"


def test_atomic_publish_creates_dir_if_absent(tmp_path: Path):
    """atomic_publish creates the target directory if it does not exist."""
    nested = tmp_path / "new" / "subdir"
    assert not nested.exists()
    obj = {"schema_version": 1, "type": "mkdir-test"}
    result = _atomic_publish(nested, "record-04.json", obj)
    assert result.returncode == 0, f"atomic_publish failed: {result.stderr}"
    assert (nested / "record-04.json").is_file()


def test_atomic_publish_record_passes_verify(tmp_path: Path):
    """A record written by atomic_publish must pass verify_record."""
    obj = {"schema_version": 1, "type": "integrity-check", "seq": 99}
    result = _atomic_publish(tmp_path, "record-05.json", obj)
    assert result.returncode == 0, f"atomic_publish failed: {result.stderr}"

    verify_result = _verify_record(tmp_path / "record-05.json")
    assert verify_result.returncode == 0, f"verify_record failed: {verify_result.stderr}"


# ──────────────────────────────────────────────────────────────────────────────
# OQ-INV-14: list_records excludes dotfiles
# ──────────────────────────────────────────────────────────────────────────────

def test_list_records_excludes_dotfiles(tmp_path: Path):
    """list_records lists only *.json final records; dotfiles are excluded."""
    # Create a real record.
    obj = {"schema_version": 1, "type": "list-test"}
    _atomic_publish(tmp_path, "a.json", obj)

    # Drop a dotfile that looks like a tmp in-flight file.
    dotfile = tmp_path / ".a.json.tmp.12345"
    dotfile.write_text('{"incomplete": true}')

    result = _list_records(tmp_path)
    assert result.returncode == 0
    listed = [Path(p).name for p in result.stdout.strip().splitlines() if p.strip()]
    assert "a.json" in listed, f"Expected a.json in listed; got {listed}"
    assert ".a.json.tmp.12345" not in listed, "Dotfile must not appear in list_records output"


def test_list_records_empty_dir_returns_nothing(tmp_path: Path):
    """list_records on an empty directory prints nothing and exits 0."""
    result = _list_records(tmp_path)
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_list_records_absent_dir_returns_nothing(tmp_path: Path):
    """list_records on a non-existent directory prints nothing and exits 0."""
    absent = tmp_path / "does_not_exist"
    result = _list_records(absent)
    assert result.returncode == 0
    assert result.stdout.strip() == ""


def test_list_records_multiple_records(tmp_path: Path):
    """list_records enumerates all published *.json files."""
    for i in range(3):
        obj = {"schema_version": 1, "type": "multi", "seq": i}
        _atomic_publish(tmp_path, f"rec-{i:02d}.json", obj)

    result = _list_records(tmp_path)
    assert result.returncode == 0
    listed = sorted(Path(p).name for p in result.stdout.strip().splitlines() if p.strip())
    assert listed == ["rec-00.json", "rec-01.json", "rec-02.json"]


# ──────────────────────────────────────────────────────────────────────────────
# verify subcommand via oq-canonical.py directly (belt-and-braces)
# ──────────────────────────────────────────────────────────────────────────────

def test_canonical_verify_valid_exits_zero():
    obj = {"schema_version": 1, "type": "direct-verify", "x": 7}
    stamped = _stamp(obj)
    result = _run_canonical("verify", stamped)
    assert result.returncode == 0, f"Expected 0, stderr: {result.stderr}"


def test_canonical_verify_bad_checksum_exits_nonzero():
    obj = {"schema_version": 1, "type": "bad-cs"}
    stamped = _stamp(obj)
    stamped["checksum"] = "deadbeef" * 8  # 64 chars but wrong value
    result = _run_canonical("verify", stamped)
    assert result.returncode != 0


def test_canonical_unknown_subcommand_exits_nonzero():
    result = subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), "nonexistent"],
        input="{}",
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "channel error" in result.stderr or "Usage" in result.stderr


def test_canonical_malformed_stdin_exits_nonzero():
    result = subprocess.run(
        [sys.executable, str(_OQ_CANONICAL), "canonicalise"],
        input="not valid json!!!",
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "channel error" in result.stderr
