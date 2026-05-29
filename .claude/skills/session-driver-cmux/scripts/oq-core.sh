#!/usr/bin/env bash
# oq-core.sh — sourceable bash library for the OQ (Outgoing Queue) mailbox.
#
# USAGE: source /path/to/oq-core.sh
#
# This file exports functions ONLY — no top-level side effects — so it is safe
# to source from both worker and parent facades without altering the sourcing
# shell's options or state.
#
# Dependency surface: bash + coreutils + python3 (stdlib: json, hashlib, os, sys).
# No external pip/npm packages.  jq is NOT required by this library (all JSON
# work goes through oq-canonical.py).
#
# OQ invariant coverage:
#   OQ-INV-3  — every published record carries a SHA-256 checksum.
#   OQ-INV-5  — atomic publish: write dotfile tmp → fsync(file) → fsync(dir) →
#               rename(tmp, final) → fsync(dir).  tmp is in $dir so rename(2)
#               is same-filesystem and therefore atomic.
#   OQ-INV-14 — list_records enumerates only *.json final names; dotfiles
#               (including in-flight tmp files) are excluded.
#   OQ-INV-25 — canonical-JSON determinism delegated to oq-canonical.py.
#   OQ-INV-27 — verify_record fails closed (non-zero + stderr on any violation).
#
# fsync(dir) note:
#   Ordinary fsync meets the OQ-INV-5 crash/reboot durability bar on both
#   macOS and Linux.  F_FULLFSYNC on Darwin gives additional power-loss
#   durability beyond what POSIX requires — this is out of scope for now.
#   Flag to Liam if power-loss guarantees are ever required.
#
# atomic_publish contract note:
#   The caller is responsible for producing a stamped canonical-JSON payload
#   (via: echo '{...}' | python3 oq-canonical.py stamp).
#   atomic_publish durably publishes those exact bytes without re-encoding them.

# ──────────────────────────────────────────────────────────────────────────────
# Internal: resolve this script's directory so we can locate oq-canonical.py
# regardless of the caller's CWD.  Uses BASH_SOURCE[0] so this works when the
# file is sourced (not executed directly).
# ──────────────────────────────────────────────────────────────────────────────
OQ_CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly OQ_CORE_DIR

# ──────────────────────────────────────────────────────────────────────────────
# _oq_python — single chokepoint that locates oq-canonical.py next to oq-core.sh.
# All callers that need the Python helper use this variable so the path is
# never hardcoded twice.
# ──────────────────────────────────────────────────────────────────────────────
_OQ_CANONICAL_PY="${OQ_CORE_DIR}/oq-canonical.py"
readonly _OQ_CANONICAL_PY

# ──────────────────────────────────────────────────────────────────────────────
# atomic_publish "$dir" "$name" "$payload_json"
#
# Durably publish a stamped canonical-JSON record to $dir/$name.
#
# Pre-condition: $payload_json is already canonical + stamped (checksum present).
#   Callers should produce this with:
#     stamped=$(echo "$raw_json" | python3 "$_OQ_CANONICAL_PY" stamp)
#
# Write sequence (OQ-INV-5):
#   1. mkdir -p "$dir"
#   2. Write bytes to a dotfile tmp IN $dir: .<name>.tmp.$$.<random>
#      (same filesystem as the target → rename(2) is atomic).
#   3. os.fsync(file fd)
#   4. os.fsync(dir fd)
#   5. os.rename(tmp, "$dir/$name")
#   6. os.fsync(dir fd)
#
# The fsync + atomic rename is performed by an inline Python3 heredoc so we
# get real POSIX semantics (bash has no fsync builtin).
# ──────────────────────────────────────────────────────────────────────────────
atomic_publish() {
    local dir="${1:?atomic_publish: dir argument is required}"
    local name="${2:?atomic_publish: name argument is required}"
    local payload_json="${3:?atomic_publish: payload_json argument is required}"

    # Ensure the target directory exists.
    mkdir -p "$dir"

    # Delegate the fsync + atomic rename to Python so we get real OS semantics.
    # The tmp path is a dotfile inside $dir (never a scratch dir) so that
    # rename(2) is always same-filesystem and therefore atomic.
    python3 - "$dir" "$name" "$payload_json" <<'PY'
import os, sys

target_dir  = sys.argv[1]
record_name = sys.argv[2]
payload     = sys.argv[3]

import random, os.path

# Construct tmp path as a dotfile inside the target directory.
tmp_name = f".{record_name}.tmp.{os.getpid()}.{random.randint(0, 0xFFFF):04X}"
tmp_path  = os.path.join(target_dir, tmp_name)
final_path = os.path.join(target_dir, record_name)

# Step 1: write canonical bytes to the dotfile tmp.
data = payload.encode("utf-8")
fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
try:
    os.write(fd, data)
    # Step 2: fsync the file to flush data to stable storage.
    os.fsync(fd)
finally:
    os.close(fd)

# Step 3: fsync the directory to flush the new directory entry.
dir_fd = os.open(target_dir, os.O_RDONLY)
try:
    os.fsync(dir_fd)
finally:
    os.close(dir_fd)

# Step 4: atomic rename — same filesystem (both paths in target_dir).
os.rename(tmp_path, final_path)

# Step 5: fsync the directory again to flush the rename.
dir_fd2 = os.open(target_dir, os.O_RDONLY)
try:
    os.fsync(dir_fd2)
finally:
    os.close(dir_fd2)
PY
}

# ──────────────────────────────────────────────────────────────────────────────
# verify_record "$file"
#
# Pipe the file contents to oq-canonical.py verify.  Exit 0 if valid.
# On failure: emit "channel error: <reason>" to stderr and return the non-zero
# exit code from the Python helper.  FAIL CLOSED — never silently skips.
# ──────────────────────────────────────────────────────────────────────────────
verify_record() {
    local file="${1:?verify_record: file argument is required}"

    if [[ ! -f "$file" ]]; then
        echo "channel error: verify_record: file not found: ${file}" >&2
        return 1
    fi

    python3 "$_OQ_CANONICAL_PY" verify < "$file"
    local rc=$?
    if [[ $rc -ne 0 ]]; then
        # oq-canonical.py already emitted the specific error to stderr.
        # Return the non-zero code to the caller (fail closed).
        return $rc
    fi
    return 0
}

# ──────────────────────────────────────────────────────────────────────────────
# list_records "$dir"
#
# Print published record paths (one per line): $dir/*.json, excluding dotfiles.
# Prints nothing and returns 0 if the directory is absent or empty.
#
# Readers enumerate published *.json only; in-flight dotfile tmps are invisible
# (OQ-INV-14).
# ──────────────────────────────────────────────────────────────────────────────
list_records() {
    local dir="${1:?list_records: dir argument is required}"

    if [[ ! -d "$dir" ]]; then
        return 0
    fi

    # Use find to enumerate *.json files that do NOT start with a dot.
    # -maxdepth 1 keeps enumeration flat (no subdirectory traversal).
    # -name '*.json' matches final record names.
    # ! -name '.*'  excludes dotfiles (in-flight tmp and any other dotfiles).
    find "$dir" -maxdepth 1 -name '*.json' ! -name '.*' -type f | sort
}

# ──────────────────────────────────────────────────────────────────────────────
# derive_oq_id "$task_id" "$phase" "$question" "$context_ref_json"
#
# Compute the deterministic oq_id for an outgoing question.  Delegates to
# oq-canonical.py derive-oq-id so that the hash formula stays in one place
# and is guaranteed to be identical to any Python caller.
#
# Formula (OQ-INV-1, OQ-INV-12):
#   content_hash = sha256( normalised(question) "|" canonical_json(context_ref) )
#   oq_id        = "oq-" + sha256( task_id "|" phase "|" content_hash )[0:16]
#
# normalised(question) = trim + collapse internal whitespace runs to single space.
# canonical_json(context_ref) = sorted keys, compact separators (via oq-canonical.py).
#
# worker_id, emitted_at, and seq are deliberately NOT inputs (OQ-INV-12).
# A relaunched worker or crash-re-emit therefore re-derives the same id.
#
# Prints the oq_id (e.g. "oq-a1b2c3d4e5f6a7b8") to stdout.
# Fails closed (non-zero + stderr) on any derivation error.
# ──────────────────────────────────────────────────────────────────────────────
derive_oq_id() {
    local task_id="${1:?derive_oq_id: task_id argument is required}"
    local phase="${2:?derive_oq_id: phase argument is required}"
    local question="${3:?derive_oq_id: question argument is required}"
    local context_ref_json="${4:?derive_oq_id: context_ref_json argument is required}"

    # Build the stdin JSON for oq-canonical.py derive-oq-id.
    # We construct it via Python to ensure proper JSON escaping of all four fields.
    local oq_id
    oq_id=$(python3 - "$task_id" "$phase" "$question" "$context_ref_json" <<'PY'
import json, sys

task_id        = sys.argv[1]
phase          = sys.argv[2]
question       = sys.argv[3]
context_ref_raw = sys.argv[4]

try:
    context_ref = json.loads(context_ref_raw)
except json.JSONDecodeError as exc:
    print(f"channel error: derive_oq_id: context_ref_json is not valid JSON — {exc}", file=sys.stderr)
    sys.exit(1)

payload = json.dumps({
    "task_id":     task_id,
    "phase":       phase,
    "question":    question,
    "context_ref": context_ref,
}, ensure_ascii=False)
sys.stdout.write(payload)
PY
)
    local build_rc=$?
    if [[ $build_rc -ne 0 ]]; then
        # Python already emitted the channel error to stderr.
        return $build_rc
    fi

    # Pipe the payload JSON into oq-canonical.py derive-oq-id.
    local result
    result=$(echo "$oq_id" | python3 "$_OQ_CANONICAL_PY" derive-oq-id)
    local rc=$?
    if [[ $rc -ne 0 ]]; then
        return $rc
    fi
    echo "$result"
}

# ──────────────────────────────────────────────────────────────────────────────
# next_seq "$questions_dir"
#
# Return the next monotonic sequence number for a new OQ record (OQ-INV-4).
# Derived from the maximum "seq" field across all published records in
# $questions_dir/*.json (excluding dotfiles), then +1.
# Prints 0 if the directory is absent or contains no records.
#
# Disk-derived and crash-safe: reads from durable on-disk records, not an
# in-memory counter.  Ordering is by the in-record seq field, not mtime.
# ──────────────────────────────────────────────────────────────────────────────
next_seq() {
    local questions_dir="${1:?next_seq: questions_dir argument is required}"

    if [[ ! -d "$questions_dir" ]]; then
        echo "0"
        return 0
    fi

    # Collect all published *.json records (no dotfiles), read their seq fields,
    # find the maximum, then add 1.  Python handles the file enumeration and
    # JSON parsing so we never rely on filename ordering or mtime.
    python3 - "$questions_dir" <<'PY'
import json, os, sys

questions_dir = sys.argv[1]

max_seq = -1
try:
    entries = os.listdir(questions_dir)
except OSError:
    print(0)
    sys.exit(0)

for entry in entries:
    # Skip dotfiles (in-flight tmp files and any other dotfiles).
    if entry.startswith("."):
        continue
    if not entry.endswith(".json"):
        continue
    path = os.path.join(questions_dir, entry)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            obj = json.load(fh)
    except (OSError, json.JSONDecodeError):
        # Skip unreadable or malformed records; do not abort.
        continue
    seq = obj.get("seq")
    if isinstance(seq, int) and seq > max_seq:
        max_seq = seq

print(max_seq + 1)
PY
}

# ──────────────────────────────────────────────────────────────────────────────
# build_oq_record "$oq_id" "$worker_id" "$seq" "$emitted_at" "$question"
#                 "$urgency" "$blocking" "$context_ref_json" "$status"
#                 "$supersedes"
#
# Construct a stamped canonical OQ record and write it to stdout.
#
# Fields: oq_id, worker_id, seq(int), emitted_at(UTC ISO-8601), question,
#         urgency∈{low,normal,high}, blocking(bool), context_ref(obj),
#         status∈{open,cancelled}, supersedes(string|null),
#         schema_version:1, checksum.
#
# $blocking must be "true" or "false" (string).
# $supersedes must be a JSON-safe string (e.g. "null" or an oq_id string).
# $context_ref_json must be a valid JSON object string.
#
# Fails closed (non-zero + UK-English stderr) on any build error.
# ──────────────────────────────────────────────────────────────────────────────
build_oq_record() {
    local oq_id="${1:?build_oq_record: oq_id argument is required}"
    local worker_id="${2:?build_oq_record: worker_id argument is required}"
    local seq="${3:?build_oq_record: seq argument is required}"
    local emitted_at="${4:?build_oq_record: emitted_at argument is required}"
    local question="${5:?build_oq_record: question argument is required}"
    local urgency="${6:?build_oq_record: urgency argument is required}"
    local blocking="${7:?build_oq_record: blocking argument is required}"
    local context_ref_json="${8:?build_oq_record: context_ref_json argument is required}"
    local status="${9:?build_oq_record: status argument is required}"
    local supersedes="${10:?build_oq_record: supersedes argument is required}"

    python3 - \
        "$oq_id" "$worker_id" "$seq" "$emitted_at" "$question" \
        "$urgency" "$blocking" "$context_ref_json" "$status" "$supersedes" \
        "$_OQ_CANONICAL_PY" \
        <<'PY'
import json, subprocess, sys

oq_id           = sys.argv[1]
worker_id       = sys.argv[2]
seq_str         = sys.argv[3]
emitted_at      = sys.argv[4]
question        = sys.argv[5]
urgency         = sys.argv[6]
blocking_str    = sys.argv[7]
context_ref_raw = sys.argv[8]
status          = sys.argv[9]
supersedes_raw  = sys.argv[10]
canonical_py    = sys.argv[11]

# Parse seq as integer.
try:
    seq = int(seq_str)
except ValueError:
    print(f"channel error: build_oq_record: seq must be an integer, got {seq_str!r}", file=sys.stderr)
    sys.exit(1)

# Parse blocking as bool.
if blocking_str.lower() == "true":
    blocking = True
elif blocking_str.lower() == "false":
    blocking = False
else:
    print(f"channel error: build_oq_record: blocking must be 'true' or 'false', got {blocking_str!r}", file=sys.stderr)
    sys.exit(1)

# Parse context_ref JSON.
try:
    context_ref = json.loads(context_ref_raw)
except json.JSONDecodeError as exc:
    print(f"channel error: build_oq_record: context_ref_json is not valid JSON — {exc}", file=sys.stderr)
    sys.exit(1)

# Parse supersedes (must be JSON null or a string).
try:
    supersedes = json.loads(supersedes_raw)
except json.JSONDecodeError:
    # Treat as a plain string if it isn't valid JSON.
    supersedes = supersedes_raw
if supersedes is not None and not isinstance(supersedes, str):
    print(f"channel error: build_oq_record: supersedes must be a string or null, got {supersedes!r}", file=sys.stderr)
    sys.exit(1)

record = {
    "blocking":       blocking,
    "context_ref":    context_ref,
    "emitted_at":     emitted_at,
    "oq_id":          oq_id,
    "question":       question,
    "schema_version": 1,
    "seq":            seq,
    "status":         status,
    "supersedes":     supersedes,
    "urgency":        urgency,
    "worker_id":      worker_id,
}

# Stamp via oq-canonical.py.
payload = json.dumps(record, ensure_ascii=False)
result = subprocess.run(
    [sys.executable, canonical_py, "stamp"],
    input=payload,
    capture_output=True,
    text=True,
)
if result.returncode != 0:
    sys.stderr.write(result.stderr)
    sys.exit(result.returncode)
sys.stdout.write(result.stdout)
PY
}

# ──────────────────────────────────────────────────────────────────────────────
# build_decision_record "$oq_id" "$decided_at" "$decider_id" "$outcome"
#                       "$answer" "$directive_json"
#
# Construct a stamped canonical decision record and write it to stdout.
#
# Fields: oq_id, decided_at(UTC ISO-8601), decider_id,
#         outcome∈{answered,deferred,cancelled,abort_task},
#         answer, directive(obj|null), schema_version:1, checksum.
#
# $directive_json must be "null" or a valid JSON object string.
#
# Fails closed (non-zero + UK-English stderr) on any build error.
# ──────────────────────────────────────────────────────────────────────────────
build_decision_record() {
    local oq_id="${1:?build_decision_record: oq_id argument is required}"
    local decided_at="${2:?build_decision_record: decided_at argument is required}"
    local decider_id="${3:?build_decision_record: decider_id argument is required}"
    local outcome="${4:?build_decision_record: outcome argument is required}"
    local answer="${5:?build_decision_record: answer argument is required}"
    local directive_json="${6:?build_decision_record: directive_json argument is required}"

    python3 - \
        "$oq_id" "$decided_at" "$decider_id" "$outcome" "$answer" \
        "$directive_json" "$_OQ_CANONICAL_PY" \
        <<'PY'
import json, subprocess, sys

oq_id          = sys.argv[1]
decided_at     = sys.argv[2]
decider_id     = sys.argv[3]
outcome        = sys.argv[4]
answer         = sys.argv[5]
directive_raw  = sys.argv[6]
canonical_py   = sys.argv[7]

# Parse directive (must be JSON null or an object).
try:
    directive = json.loads(directive_raw)
except json.JSONDecodeError as exc:
    print(f"channel error: build_decision_record: directive_json is not valid JSON — {exc}", file=sys.stderr)
    sys.exit(1)
if directive is not None and not isinstance(directive, dict):
    print(f"channel error: build_decision_record: directive must be an object or null, got {type(directive).__name__!r}", file=sys.stderr)
    sys.exit(1)

record = {
    "answer":         answer,
    "decided_at":     decided_at,
    "decider_id":     decider_id,
    "directive":      directive,
    "oq_id":          oq_id,
    "outcome":        outcome,
    "schema_version": 1,
}

payload = json.dumps(record, ensure_ascii=False)
result = subprocess.run(
    [sys.executable, canonical_py, "stamp"],
    input=payload,
    capture_output=True,
    text=True,
)
if result.returncode != 0:
    sys.stderr.write(result.stderr)
    sys.exit(result.returncode)
sys.stdout.write(result.stdout)
PY
}

# ──────────────────────────────────────────────────────────────────────────────
# build_state_record "$worker_id" "$lifecycle_state" "$blocked_on"
#                   "$checkpoint_ref_json" "$updated_at"
#
# Construct a stamped canonical oq-state record and write it to stdout.
#
# Fields: worker_id, lifecycle_state∈{working,awaiting-decision},
#         blocked_on(string|null), checkpoint_ref(obj|null — OPAQUE, OQ-INV-21),
#         updated_at(UTC ISO-8601), schema_version:1, checksum.
#
# checkpoint_ref is OPAQUE: any JSON value (null or any object shape) is accepted
# without internal structure validation (OQ-INV-21).
#
# $blocked_on must be "null" or a string (the oq_id being waited on).
# $checkpoint_ref_json must be "null" or any valid JSON value.
#
# Fails closed (non-zero + UK-English stderr) on any build error.
# ──────────────────────────────────────────────────────────────────────────────
build_state_record() {
    local worker_id="${1:?build_state_record: worker_id argument is required}"
    local lifecycle_state="${2:?build_state_record: lifecycle_state argument is required}"
    local blocked_on="${3:?build_state_record: blocked_on argument is required}"
    local checkpoint_ref_json="${4:?build_state_record: checkpoint_ref_json argument is required}"
    local updated_at="${5:?build_state_record: updated_at argument is required}"

    python3 - \
        "$worker_id" "$lifecycle_state" "$blocked_on" \
        "$checkpoint_ref_json" "$updated_at" "$_OQ_CANONICAL_PY" \
        <<'PY'
import json, subprocess, sys

worker_id           = sys.argv[1]
lifecycle_state     = sys.argv[2]
blocked_on_raw      = sys.argv[3]
checkpoint_ref_raw  = sys.argv[4]
updated_at          = sys.argv[5]
canonical_py        = sys.argv[6]

# Parse blocked_on (must be null or a string).
try:
    blocked_on = json.loads(blocked_on_raw)
except json.JSONDecodeError:
    # Treat as a plain string if it is not valid JSON.
    blocked_on = blocked_on_raw
if blocked_on is not None and not isinstance(blocked_on, str):
    print(f"channel error: build_state_record: blocked_on must be a string or null, got {type(blocked_on).__name__!r}", file=sys.stderr)
    sys.exit(1)

# Parse checkpoint_ref — OPAQUE (OQ-INV-21): any JSON value is accepted.
try:
    checkpoint_ref = json.loads(checkpoint_ref_raw)
except json.JSONDecodeError as exc:
    print(f"channel error: build_state_record: checkpoint_ref_json is not valid JSON — {exc}", file=sys.stderr)
    sys.exit(1)

record = {
    "blocked_on":       blocked_on,
    "checkpoint_ref":   checkpoint_ref,
    "lifecycle_state":  lifecycle_state,
    "schema_version":   1,
    "updated_at":       updated_at,
    "worker_id":        worker_id,
}

payload = json.dumps(record, ensure_ascii=False)
result = subprocess.run(
    [sys.executable, canonical_py, "stamp"],
    input=payload,
    capture_output=True,
    text=True,
)
if result.returncode != 0:
    sys.stderr.write(result.stderr)
    sys.exit(result.returncode)
sys.stdout.write(result.stdout)
PY
}

# ──────────────────────────────────────────────────────────────────────────────
# validate_oq_record "$file"
# validate_decision_record "$file"
# validate_state_record "$file"
#
# Validate an on-disk record: integrity checks (checksum + schema_version == 1)
# plus record-type-specific required-field presence and enum membership.
#
# These are thin wrappers over "oq-canonical.py verify <type>" and therefore
# share the same fail-closed contract: non-zero exit + UK-English
# "channel error: …" to stderr on any violation.
#
# OQ-INV-27 (fail-closed) + OQ-INV-31 (enum/required-field validation).
# ──────────────────────────────────────────────────────────────────────────────
validate_oq_record() {
    local file="${1:?validate_oq_record: file argument is required}"

    if [[ ! -f "$file" ]]; then
        echo "channel error: validate_oq_record: file not found: ${file}" >&2
        return 1
    fi

    python3 "$_OQ_CANONICAL_PY" verify oq < "$file"
    local rc=$?
    if [[ $rc -ne 0 ]]; then
        return $rc
    fi
    return 0
}

validate_decision_record() {
    local file="${1:?validate_decision_record: file argument is required}"

    if [[ ! -f "$file" ]]; then
        echo "channel error: validate_decision_record: file not found: ${file}" >&2
        return 1
    fi

    python3 "$_OQ_CANONICAL_PY" verify decision < "$file"
    local rc=$?
    if [[ $rc -ne 0 ]]; then
        return $rc
    fi
    return 0
}

validate_state_record() {
    local file="${1:?validate_state_record: file argument is required}"

    if [[ ! -f "$file" ]]; then
        echo "channel error: validate_state_record: file not found: ${file}" >&2
        return 1
    fi

    python3 "$_OQ_CANONICAL_PY" verify state < "$file"
    local rc=$?
    if [[ $rc -ne 0 ]]; then
        return $rc
    fi
    return 0
}
