#!/usr/bin/env python3
"""oq-canonical.py — canonical-JSON and checksum helper for the OQ mailbox.

Subcommands (reads a JSON object on stdin):
    canonicalise  — write canonical JSON (sorted keys, compact) to stdout.
    checksum      — compute SHA-256 over canonical form (minus "checksum" key) → hex.
    stamp         — add/replace the "checksum" key in the object; write canonical JSON.
    verify        — validate a record: recompute checksum, require schema_version == 1.
                    Exit 0 on success; exit non-zero with UK-English error on stderr.
                    Optional second argument: record type (oq|decision|state) adds
                    enum + required-field validation for that type.
    derive-oq-id  — read {task_id, phase, question, context_ref} from stdin; print oq_id.
                    Formula: "oq-" + sha256_hex(task_id "|" phase "|" content_hash)[0:16]
                    where content_hash = sha256_hex(normalised(question) "|" canonical(context_ref)).
                    normalised = trim + collapse-internal-whitespace-runs to single space.

Dependency surface: stdlib only (json, hashlib, re, sys).

OQ invariant notes:
  OQ-INV-1   — oq_id is deterministic: same (task_id, phase, question, context_ref) → same id.
  OQ-INV-3   — every record carries a SHA-256 checksum over its content fields.
  OQ-INV-12  — oq_id excludes worker_id, emitted_at, seq.
  OQ-INV-25  — canonical-JSON is deterministic (sort_keys=True, compact separators).
  OQ-INV-27  — verify fails closed: on any mismatch / missing field it exits non-zero.
  OQ-INV-31  — record-type validators enforce enums + required fields; fail closed.
"""

from __future__ import annotations

import hashlib
import json
import re
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


def _verify_base(obj: dict) -> None:
    """Core integrity checks shared by all record types.

    Checks:
      1. "schema_version" field must be present and equal to 1.
      2. "checksum" field must be present.
      3. Recomputed SHA-256 over (record minus "checksum") must equal record["checksum"].

    Exits non-zero with UK-English channel-error on any violation.
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


# ──────────────────────────────────────────────────────────────────────────────
# Record-type validators (OQ-INV-31)
# Required fields and enum membership for each on-disk record type.
# ──────────────────────────────────────────────────────────────────────────────

# Fields that must be present in each record type (beyond schema_version + checksum).
_OQ_REQUIRED_FIELDS: tuple[str, ...] = (
    "oq_id",
    "worker_id",
    "seq",
    "emitted_at",
    "question",
    "urgency",
    "blocking",
    "context_ref",
    "status",
    "supersedes",
)

_DECISION_REQUIRED_FIELDS: tuple[str, ...] = (
    "oq_id",
    "decided_at",
    "decider_id",
    "outcome",
    "answer",
    "directive",
)

_STATE_REQUIRED_FIELDS: tuple[str, ...] = (
    "worker_id",
    "lifecycle_state",
    "blocked_on",
    "checkpoint_ref",
    "updated_at",
)

_OQ_URGENCY_VALUES: frozenset[str] = frozenset({"low", "normal", "high"})
_OQ_STATUS_VALUES: frozenset[str] = frozenset({"open", "cancelled"})
_DECISION_OUTCOME_VALUES: frozenset[str] = frozenset({"answered", "deferred", "cancelled", "abort_task"})
_STATE_LIFECYCLE_VALUES: frozenset[str] = frozenset({"working", "awaiting-decision"})


def _validate_oq_fields(obj: dict) -> None:
    """Validate required fields and enums for an OQ record.  Exits non-zero on violation."""
    for field in _OQ_REQUIRED_FIELDS:
        if field not in obj:
            print(
                f"channel error: OQ record is missing required field {field!r}",
                file=sys.stderr,
            )
            sys.exit(1)
    urgency = obj["urgency"]
    if urgency not in _OQ_URGENCY_VALUES:
        print(
            f"channel error: OQ record has invalid urgency {urgency!r} — "
            f"expected one of {sorted(_OQ_URGENCY_VALUES)}",
            file=sys.stderr,
        )
        sys.exit(1)
    status = obj["status"]
    if status not in _OQ_STATUS_VALUES:
        print(
            f"channel error: OQ record has invalid status {status!r} — "
            f"expected one of {sorted(_OQ_STATUS_VALUES)}",
            file=sys.stderr,
        )
        sys.exit(1)


def _validate_decision_fields(obj: dict) -> None:
    """Validate required fields and enums for a decision record.  Exits non-zero on violation."""
    for field in _DECISION_REQUIRED_FIELDS:
        if field not in obj:
            print(
                f"channel error: decision record is missing required field {field!r}",
                file=sys.stderr,
            )
            sys.exit(1)
    outcome = obj["outcome"]
    if outcome not in _DECISION_OUTCOME_VALUES:
        print(
            f"channel error: decision record has invalid outcome {outcome!r} — "
            f"expected one of {sorted(_DECISION_OUTCOME_VALUES)}",
            file=sys.stderr,
        )
        sys.exit(1)


def _validate_state_fields(obj: dict) -> None:
    """Validate required fields and enums for an oq-state record.  Exits non-zero on violation."""
    for field in _STATE_REQUIRED_FIELDS:
        if field not in obj:
            print(
                f"channel error: oq-state record is missing required field {field!r}",
                file=sys.stderr,
            )
            sys.exit(1)
    lifecycle_state = obj["lifecycle_state"]
    if lifecycle_state not in _STATE_LIFECYCLE_VALUES:
        print(
            f"channel error: oq-state record has invalid lifecycle_state {lifecycle_state!r} — "
            f"expected one of {sorted(_STATE_LIFECYCLE_VALUES)}",
            file=sys.stderr,
        )
        sys.exit(1)
    # checkpoint_ref is OPAQUE (OQ-INV-21): any JSON value (including null/obj) is accepted.
    # No shape validation is performed on checkpoint_ref.


_RECORD_TYPE_VALIDATORS = {
    "oq": _validate_oq_fields,
    "decision": _validate_decision_fields,
    "state": _validate_state_fields,
}


def cmd_verify(obj: dict) -> None:
    """Verify record integrity.  Fails closed on any violation.

    Usage:
        oq-canonical.py verify          — checksum + schema_version only.
        oq-canonical.py verify oq       — as above + OQ required fields + enums.
        oq-canonical.py verify decision — as above + decision required fields + enums.
        oq-canonical.py verify state    — as above + oq-state required fields + enums.

    Exit 0 on success; exit non-zero with a UK-English channel-error message on stderr.
    """
    _verify_base(obj)

    # Optional second argument: record-type for additional field/enum validation.
    if len(sys.argv) >= 3:
        record_type = sys.argv[2]
        if record_type not in _RECORD_TYPE_VALIDATORS:
            known = ", ".join(sorted(_RECORD_TYPE_VALIDATORS))
            print(
                f"channel error: unknown record type {record_type!r} for verify — "
                f"expected one of {known}",
                file=sys.stderr,
            )
            sys.exit(1)
        _RECORD_TYPE_VALIDATORS[record_type](obj)

    # All checks passed — exit 0 implicitly.


# ──────────────────────────────────────────────────────────────────────────────
# oq_id derivation (OQ-INV-1, OQ-INV-12)
# ──────────────────────────────────────────────────────────────────────────────

def _normalise_question(question: str) -> str:
    """Normalise a question string for stable oq_id derivation.

    Normalisation rules (OQ-INV-1):
      1. Strip leading and trailing whitespace.
      2. Collapse every run of internal whitespace to a single space.
    """
    return re.sub(r"\s+", " ", question.strip())


def _derive_oq_id(task_id: str, phase: str, question: str, context_ref: object) -> str:
    """Compute the deterministic oq_id from its four inputs.

    Formula (OQ-INV-1, OQ-INV-12):
      content_hash = sha256_hex(normalised(question) "|" canonical_json(context_ref))
      oq_id        = "oq-" + sha256_hex(task_id "|" phase "|" content_hash)[0:16]

    worker_id, emitted_at, and seq are deliberately excluded so that a
    relaunched worker or crash-re-emit re-derives the same id.
    """
    # Canonicalise context_ref to ensure key-order independence.
    if isinstance(context_ref, dict):
        canonical_context = json.dumps(
            context_ref, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
    else:
        # Non-dict values (e.g. null) are serialised as-is.
        canonical_context = json.dumps(context_ref, ensure_ascii=False)

    normalised_q = _normalise_question(question)

    content_hash_input = f"{normalised_q}|{canonical_context}"
    content_hash = hashlib.sha256(content_hash_input.encode("utf-8")).hexdigest()

    outer_input = f"{task_id}|{phase}|{content_hash}"
    outer_hash = hashlib.sha256(outer_input.encode("utf-8")).hexdigest()

    return "oq-" + outer_hash[:16]


def cmd_derive_oq_id(obj: dict) -> None:
    """Read {task_id, phase, question, context_ref} from stdin and print the oq_id.

    Stdin JSON shape:
      {
        "task_id":     "<string>",
        "phase":       "<string>",
        "question":    "<string>",
        "context_ref": <any JSON value — typically an object>
      }

    Prints the oq_id (e.g. "oq-a1b2c3d4e5f6a7b8") to stdout.
    Exits non-zero with UK-English channel-error on missing/wrong-type fields.
    """
    for field in ("task_id", "phase", "question"):
        if field not in obj:
            print(
                f"channel error: derive-oq-id input is missing required field {field!r}",
                file=sys.stderr,
            )
            sys.exit(1)
        if not isinstance(obj[field], str):
            print(
                f"channel error: derive-oq-id field {field!r} must be a string, "
                f"got {type(obj[field]).__name__!r}",
                file=sys.stderr,
            )
            sys.exit(1)
    if "context_ref" not in obj:
        print(
            "channel error: derive-oq-id input is missing required field 'context_ref'",
            file=sys.stderr,
        )
        sys.exit(1)

    oq_id = _derive_oq_id(
        task_id=obj["task_id"],
        phase=obj["phase"],
        question=obj["question"],
        context_ref=obj["context_ref"],
    )
    print(oq_id)


_SUBCOMMANDS = {
    "canonicalise": cmd_canonicalise,
    "checksum": cmd_checksum,
    "stamp": cmd_stamp,
    "verify": cmd_verify,
    "derive-oq-id": cmd_derive_oq_id,
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
