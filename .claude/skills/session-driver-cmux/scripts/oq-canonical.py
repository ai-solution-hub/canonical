#!/usr/bin/env python3
"""oq-canonical.py — canonical-JSON and checksum helper for the OQ mailbox.

Subcommands (reads a JSON object on stdin):
    canonicalise  — write canonical JSON (sorted keys, compact) to stdout.
    checksum      — compute SHA-256 over canonical form (minus "checksum" key) → hex.
    stamp         — add/replace the "checksum" key in the object; write canonical JSON.
    verify        — validate a record: recompute checksum, require schema_version == 1.
                    Exit 0 on success; exit non-zero with UK-English error on stderr.

Dependency surface: stdlib only (json, hashlib, sys).

OQ invariant notes:
  OQ-INV-3   — every record carries a SHA-256 checksum over its content fields.
  OQ-INV-25  — canonical-JSON is deterministic (sort_keys=True, compact separators).
  OQ-INV-27  — verify fails closed: on any mismatch / missing field it exits non-zero.
"""

from __future__ import annotations

import hashlib
import json
import sys


def _canonical_bytes(obj: dict) -> bytes:
    """Return the canonical UTF-8 JSON encoding of *obj*.

    Canonical form: keys sorted, compact separators (",", ":"), no trailing
    newline.  This is the byte sequence used as the checksum input.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _compute_checksum(obj: dict) -> str:
    """Return the SHA-256 hex digest over canonical-JSON of *obj* minus its
    "checksum" key.  The "checksum" field itself is excluded so that the value
    can be embedded inside the same object without circularity.
    """
    obj_without_checksum = {k: v for k, v in obj.items() if k != "checksum"}
    return hashlib.sha256(_canonical_bytes(obj_without_checksum)).hexdigest()


def _read_stdin_json() -> dict:
    """Read and parse a JSON object from stdin.  Fail closed on any error."""
    raw = sys.stdin.read()
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"channel error: malformed JSON on stdin — {exc}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(obj, dict):
        print("channel error: stdin JSON must be an object (dict), not a scalar or array", file=sys.stderr)
        sys.exit(1)
    return obj


def cmd_canonicalise(obj: dict) -> None:
    """Write canonical JSON of *obj* to stdout."""
    sys.stdout.write(json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n")


def cmd_checksum(obj: dict) -> None:
    """Print the SHA-256 hex digest over canonical-JSON of *obj* (minus checksum key)."""
    print(_compute_checksum(obj))


def cmd_stamp(obj: dict) -> None:
    """Embed the computed checksum into *obj* and write canonical JSON to stdout."""
    obj["checksum"] = _compute_checksum(obj)
    cmd_canonicalise(obj)


def cmd_verify(obj: dict) -> None:
    """Verify record integrity.  Fails closed on any violation.

    Checks:
      1. "schema_version" field must be present and equal to 1.
      2. "checksum" field must be present.
      3. Recomputed SHA-256 over (record minus "checksum") must equal record["checksum"].

    Exit 0 on success; exit non-zero with a UK-English channel-error message on stderr.
    """
    if "schema_version" not in obj:
        print("channel error: record is missing required field 'schema_version'", file=sys.stderr)
        sys.exit(1)
    if obj["schema_version"] != 1:
        print(
            f"channel error: unsupported schema_version {obj['schema_version']!r} — expected 1",
            file=sys.stderr,
        )
        sys.exit(1)
    if "checksum" not in obj:
        print("channel error: record is missing required field 'checksum'", file=sys.stderr)
        sys.exit(1)
    stored = obj["checksum"]
    computed = _compute_checksum(obj)
    if stored != computed:
        print(
            f"channel error: checksum mismatch — stored {stored!r} does not match computed {computed!r}",
            file=sys.stderr,
        )
        sys.exit(1)
    # All checks passed — exit 0 implicitly.


_SUBCOMMANDS = {
    "canonicalise": cmd_canonicalise,
    "checksum": cmd_checksum,
    "stamp": cmd_stamp,
    "verify": cmd_verify,
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in _SUBCOMMANDS:
        known = ", ".join(sorted(_SUBCOMMANDS))
        msg = f"Usage: oq-canonical.py <subcommand>  [known: {known}]"
        if len(sys.argv) >= 2:
            msg = f"channel error: unknown subcommand {sys.argv[1]!r}. {msg}"
        print(msg, file=sys.stderr)
        sys.exit(1)

    obj = _read_stdin_json()
    _SUBCOMMANDS[sys.argv[1]](obj)


if __name__ == "__main__":
    main()
