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
