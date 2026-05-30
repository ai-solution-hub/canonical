#!/usr/bin/env bash
# crash-shim.sh — deterministic crash-injection harness for the OQ atomic publish.
#
# Test-only artefact (ID-43.10).  It does NOT modify oq-core.sh / oq-worker.sh /
# oq-parent.sh — it MIRRORS oq-core.sh's atomic_publish write sequence exactly
# (same-directory dotfile → fsync(file) → fsync(dir) → rename → fsync(dir)) but
# inserts a controllable BARRIER between the dotfile write and the rename.  That
# barrier lets a concurrent reader observe the in-flight state deterministically,
# proving OQ-INV-3 (no partial record ever visible) without racing the real,
# uninterruptible atomic_publish.
#
# Why a mirror and not a hook: atomic_publish performs write→fsync→rename inside a
# single inline Python step and cannot be paused mid-flight from the outside.  The
# shim reproduces that exact sequence so the property under test — "a reader sees
# either nothing or the complete record, never a truncated one" — is exercised at
# the same commit point (POSIX rename(2)) the real code uses.
#
# Usage:
#   crash-shim.sh publish <dir> <name> <payload_file> <signal_dir>
#
#   <dir>          target directory (e.g. .../questions)
#   <name>         final record name (e.g. <oq_id>.json)
#   <payload_file> file holding the already-stamped canonical JSON payload
#                  (a file, not an argv string, so >4KB records are handled cleanly)
#   <signal_dir>   coordination directory; the shim writes:
#                    <signal_dir>/tmp_name   — basename of the in-flight dotfile
#                    <signal_dir>/tmp_ready  — created once the dotfile is fsync'd
#                                              and BEFORE the rename (the barrier)
#                    <signal_dir>/done       — created after the rename + dir fsync
#                  and WAITS for:
#                    <signal_dir>/proceed    — created by the test to release the
#                                              barrier and perform the rename
#
# Exit codes:
#   0 — published (rename committed).
#   1 — argument or I/O error.
#   2 — barrier wait timed out (the test never created <signal_dir>/proceed).

set -uo pipefail

_BARRIER_TIMEOUT_SECONDS=30   # bound the wait so a stuck test cannot hang the suite

cmd_publish() {
    local dir="${1:?crash-shim publish: dir argument is required}"
    local name="${2:?crash-shim publish: name argument is required}"
    local payload_file="${3:?crash-shim publish: payload_file argument is required}"
    local signal_dir="${4:?crash-shim publish: signal_dir argument is required}"

    if [[ ! -f "$payload_file" ]]; then
        echo "crash-shim: payload file not found: ${payload_file}" >&2
        return 1
    fi

    mkdir -p "$dir" "$signal_dir"

    # ── Phase 1: write the dotfile tmp IN the target dir + fsync (mirror step). ──
    # The tmp name is a dotfile inside $dir, exactly like atomic_publish, so the
    # rename is same-filesystem atomic and readers (which skip dotfiles) never see it.
    local tmp_name=".${name}.tmp.$$.shim"
    local tmp_path="${dir}/${tmp_name}"
    local final_path="${dir}/${name}"

    python3 - "$tmp_path" "$dir" "$payload_file" <<'PY'
import os, sys
tmp_path     = sys.argv[1]
target_dir   = sys.argv[2]
payload_file = sys.argv[3]

with open(payload_file, "rb") as fh:
    data = fh.read()

fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
try:
    os.write(fd, data)
    os.fsync(fd)
finally:
    os.close(fd)

# fsync the directory entry for the dotfile (durability of the in-flight tmp).
dir_fd = os.open(target_dir, os.O_RDONLY)
try:
    os.fsync(dir_fd)
finally:
    os.close(dir_fd)
PY
    local phase1_rc=$?
    if [[ $phase1_rc -ne 0 ]]; then
        echo "crash-shim: phase-1 dotfile write failed" >&2
        return 1
    fi

    # ── Barrier: announce the in-flight dotfile, then WAIT for the test. ──
    printf '%s' "$tmp_name" > "${signal_dir}/tmp_name"
    : > "${signal_dir}/tmp_ready"

    local waited=0
    while [[ ! -e "${signal_dir}/proceed" ]]; do
        sleep 0.05
        waited=$(python3 -c "print($waited + 0.05)")
        if python3 -c "import sys; sys.exit(0 if float('$waited') >= $_BARRIER_TIMEOUT_SECONDS else 1)"; then
            echo "crash-shim: barrier timed out waiting for ${signal_dir}/proceed" >&2
            return 2
        fi
    done

    # ── Phase 2: atomic rename + dir fsync (the commit point). ──
    python3 - "$tmp_path" "$final_path" "$dir" <<'PY'
import os, sys
tmp_path   = sys.argv[1]
final_path = sys.argv[2]
target_dir = sys.argv[3]

os.rename(tmp_path, final_path)

dir_fd = os.open(target_dir, os.O_RDONLY)
try:
    os.fsync(dir_fd)
finally:
    os.close(dir_fd)
PY
    local phase2_rc=$?
    if [[ $phase2_rc -ne 0 ]]; then
        echo "crash-shim: phase-2 rename failed" >&2
        return 1
    fi

    : > "${signal_dir}/done"
    return 0
}

# CLI dispatch.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    cmd="${1:?crash-shim.sh: command argument required (publish)}"
    shift
    case "$cmd" in
        publish) cmd_publish "$@" ;;
        *)
            echo "crash-shim.sh: unknown command — expected 'publish'" >&2
            exit 1
            ;;
    esac
fi
