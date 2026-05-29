#!/usr/bin/env bash
# oq-parent.sh — Parent-side facade for the OQ (Outgoing Queue) mailbox.
#
# USAGE (direct invocation):
#   oq-parent.sh oq_list_open  <oq_root>
#   oq-parent.sh oq_decide     <oq_root> <oq_id> <decided_at> <decider_id> \
#                               <outcome> <answer> <directive_json> [worker_name]
#
# USAGE (sourcing — for testing):
#   source /path/to/oq-parent.sh
#   oq_list_open  "$oq_root"
#   oq_decide     "$oq_root" "$oq_id" "$decided_at" "$decider_id" \
#                 "$outcome" "$answer" "$directive_json" [worker_name]
#
# Sourcing is safe — top-level CLI dispatch is guarded by:
#   if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then "$@"; fi
# so no side effects occur when the file is sourced by tests.
#
# Dependency surface: bash + coreutils + python3 (stdlib only) + oq-core.sh.
# No external pip/npm packages.
#
# OQ invariant coverage:
#   OQ-INV-4   — oq_list_open sorts by in-record seq (FIFO); never by mtime/filename.
#   OQ-INV-10  — oq_decide is the authoritative writer of decisions/<oq_id>.json.
#   OQ-INV-11  — no received/acks artefact written (the decision FILE is authoritative).
#   OQ-INV-13  — oq_decide refuses to write a decision for a cancelled OQ.
#   OQ-INV-14  — enumeration via list_records (dotfiles excluded, from oq-core.sh).
#   OQ-INV-15  — the filename stem of decisions/<oq_id>.json IS the oq_id (structural addressing).
#   OQ-INV-17  — decision records are built + validated via oq-core.sh helpers.
#   OQ-INV-19  — directive is DATA ONLY; no eval/exec/source path executes directive contents.
#   OQ-INV-23  — cancelled OQs are dropped from the open list.
#   OQ-INV-33  — decide-once guard: a second oq_decide for the same oq_id is refused.

# ──────────────────────────────────────────────────────────────────────────────
# Source oq-core.sh relative to this script so paths resolve regardless of CWD.
# BASH_SOURCE[0] is this file (whether executed or sourced).
# ──────────────────────────────────────────────────────────────────────────────
_OQ_PARENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=oq-core.sh
source "${_OQ_PARENT_DIR}/oq-core.sh"

# ──────────────────────────────────────────────────────────────────────────────
# _oq_get_field "$file" "$field"
#
# Internal helper: read a single top-level string or integer field from a JSON
# file using Python (stdlib json) — no jq required.
# Prints the field value to stdout; returns non-zero on missing field or error.
# ──────────────────────────────────────────────────────────────────────────────
_oq_get_field() {
    local file="${1:?_oq_get_field: file argument is required}"
    local field="${2:?_oq_get_field: field argument is required}"

    python3 - "$file" "$field" <<'PY'
import json, sys

path  = sys.argv[1]
field = sys.argv[2]

try:
    with open(path, "r", encoding="utf-8") as fh:
        obj = json.load(fh)
except (OSError, json.JSONDecodeError) as exc:
    print(f"channel error: _oq_get_field: cannot read {path!r} — {exc}", file=sys.stderr)
    sys.exit(1)

if field not in obj:
    print(f"channel error: _oq_get_field: field {field!r} not found in {path!r}", file=sys.stderr)
    sys.exit(1)

print(obj[field], end="")
PY
}

# ──────────────────────────────────────────────────────────────────────────────
# oq_list_open "$oq_root"
#
# Compute {questions/*.json} − {decisions/*.json}, drop any with
# status:'cancelled', then sort the remaining records by their in-record 'seq'
# field (FIFO — lowest seq first).
#
# Output: one oq_id per line, in seq-ascending order (FIFO).
# Prints nothing and exits 0 if there are no open questions.
#
# Invariants: OQ-INV-4 (seq-sorted FIFO), OQ-INV-14 (list_records), OQ-INV-23.
# Fail-closed: a corrupt question record surfaces a channel error, not a silent
# skip (verify_record is called on every candidate).
# ──────────────────────────────────────────────────────────────────────────────
oq_list_open() {
    local oq_root="${1:?oq_list_open: oq_root argument is required}"

    local questions_dir="${oq_root}/questions"
    local decisions_dir="${oq_root}/decisions"

    # Delegate the entire computation to Python (stdlib only) so we remain
    # compatible with bash 3.2 (macOS /bin/bash) — no mapfile, no declare -A.
    #
    # Python reads the question records (using the same enumeration logic as
    # list_records in oq-core.sh: *.json excluding dotfiles, sorted), excludes
    # decided and cancelled OQs, then sorts by seq ascending (FIFO — OQ-INV-4).
    # Each question record is verified via oq-canonical.py before inclusion
    # (fail-closed — a corrupt record is a channel error, not a silent skip).
    #
    # $_OQ_CANONICAL_PY is set by oq-core.sh (sourced above).
    python3 - "$questions_dir" "$decisions_dir" "$_OQ_CANONICAL_PY" <<'PY'
import json, os, subprocess, sys

questions_dir = sys.argv[1]
decisions_dir = sys.argv[2]
canonical_py  = sys.argv[3]


def list_records(dirpath):
    """Sorted *.json paths excluding dotfiles — mirrors list_records in oq-core.sh."""
    if not os.path.isdir(dirpath):
        return []
    entries = [
        os.path.join(dirpath, e)
        for e in os.listdir(dirpath)
        if e.endswith(".json") and not e.startswith(".")
    ]
    return sorted(entries)


def verify(filepath):
    """Pipe file contents through oq-canonical.py verify; return True on success."""
    try:
        with open(filepath, "r", encoding="utf-8") as fh:
            contents = fh.read()
    except OSError as exc:
        print(f"channel error: oq_list_open: cannot read {filepath!r} — {exc}", file=sys.stderr)
        return False
    result = subprocess.run(
        [sys.executable, canonical_py, "verify"],
        input=contents,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
    return result.returncode == 0


# Collect decided oq_ids (filename stem IS the oq_id — OQ-INV-15).
decided_ids = set()
for path in list_records(decisions_dir):
    stem = os.path.splitext(os.path.basename(path))[0]
    decided_ids.add(stem)

# Process question records: verify, exclude decided/cancelled, collect (seq, oq_id).
candidates = []
for path in list_records(questions_dir):
    # Fail-closed integrity check (OQ-INV-27).
    if not verify(path):
        print(f"channel error: oq_list_open: corrupt question record: {path}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(path, "r", encoding="utf-8") as fh:
            rec = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"channel error: oq_list_open: cannot read {path!r} — {exc}", file=sys.stderr)
        sys.exit(1)

    oq_id = rec.get("oq_id")
    if oq_id is None:
        print(f"channel error: oq_list_open: missing oq_id in {path!r}", file=sys.stderr)
        sys.exit(1)

    # Exclude decided OQs.
    if oq_id in decided_ids:
        continue

    # Exclude cancelled OQs (OQ-INV-23, OQ-INV-13).
    if rec.get("status") == "cancelled":
        continue

    seq = rec.get("seq")
    if not isinstance(seq, int):
        print(f"channel error: oq_list_open: invalid seq in {path!r}: {seq!r}", file=sys.stderr)
        sys.exit(1)

    candidates.append((seq, oq_id))

# Sort by seq ascending (FIFO — OQ-INV-4) and print oq_ids.
candidates.sort(key=lambda t: t[0])
for _, oq_id in candidates:
    print(oq_id)
PY
}

# ──────────────────────────────────────────────────────────────────────────────
# oq_decide "$oq_root" "$oq_id" "$decided_at" "$decider_id" \
#           "$outcome" "$answer" "$directive_json" [worker_name]
#
# Write a durable decision record to decisions/<oq_id>.json.
#
# Arguments:
#   oq_root        — the OQ root directory for this cmux session.
#   oq_id          — the oq_id being decided (must have a matching question).
#   decided_at     — caller-supplied UTC ISO-8601 timestamp (pinnable for tests).
#   decider_id     — identity string for the decision-maker (e.g. "liam").
#   outcome        — one of: answered | deferred | cancelled | abort_task
#   answer         — free-text answer to the question.
#   directive_json — JSON object or "null"; stored as DATA ONLY (OQ-INV-19).
#   worker_name    — (optional) cmux worker name for the post-decision nudge.
#                    When supplied, a best-effort send-prompt.sh nudge is fired
#                    AFTER the decision commits — see the NUDGE NOTE below.
#
# DECIDE-ONCE GUARD (OQ-INV-33):
#   If decisions/<oq_id>.json already exists, refuse with a non-zero exit and a
#   UK-English error message.  The guard is disk-derived and is checked before
#   any write.
#
# CANCELLED OQ GUARD (OQ-INV-13):
#   If the source question has status:'cancelled', refuse to write a decision.
#
# DIRECTIVE IS DATA ONLY (OQ-INV-19):
#   directive_json is parsed into a JSON structure and stored verbatim.
#   There is NO eval/exec/source path that executes directive contents.
#
# NUDGE NOTE:
#   The send-prompt.sh nudge fires AFTER the decision file is durably committed.
#   THE DECISION FILE IS AUTHORITATIVE.  The nudge is a latency optimisation
#   only (wakes the worker's poll loop sooner so it notices the decision
#   without waiting for its next scheduled poll).  If send-prompt.sh is absent
#   or fails, the decision outcome is already durably committed and is unaffected.
#   We never write a received/acks artefact (OQ-INV-11; OQ-Q1 ratified NO).
#
# Invariants: OQ-INV-10,11,13,14,15,17,19,33.
# ──────────────────────────────────────────────────────────────────────────────
oq_decide() {
    local oq_root="${1:?oq_decide: oq_root argument is required}"
    local oq_id="${2:?oq_decide: oq_id argument is required}"
    local decided_at="${3:?oq_decide: decided_at argument is required}"
    local decider_id="${4:?oq_decide: decider_id argument is required}"
    local outcome="${5:?oq_decide: outcome argument is required}"
    local answer="${6:?oq_decide: answer argument is required}"
    local directive_json="${7:?oq_decide: directive_json argument is required}"
    local worker_name="${8:-}"   # optional — for the post-decision nudge only

    local questions_dir="${oq_root}/questions"
    local decisions_dir="${oq_root}/decisions"

    # ── DECIDE-ONCE GUARD (OQ-INV-33) ─────────────────────────────────────────
    # If the decision file already exists, refuse — never re-decide.
    local decision_file="${decisions_dir}/${oq_id}.json"
    if [[ -f "$decision_file" ]]; then
        echo "channel error: oq_decide: decision for ${oq_id} already exists — re-deciding is not permitted (OQ-INV-33)" >&2
        return 1
    fi

    # ── SOURCE QUESTION GUARD ──────────────────────────────────────────────────
    # The question must exist.
    local question_file="${questions_dir}/${oq_id}.json"
    if [[ ! -f "$question_file" ]]; then
        echo "channel error: oq_decide: question not found: ${question_file}" >&2
        return 1
    fi

    # Fail-closed integrity check on the question record.
    if ! verify_record "$question_file" >/dev/null 2>&1; then
        verify_record "$question_file" >/dev/null
        return 1
    fi

    # ── CANCELLED OQ GUARD (OQ-INV-13) ────────────────────────────────────────
    # If the question is cancelled, refuse to write a decision.
    local q_status
    q_status="$(_oq_get_field "$question_file" "status")" || return 1
    if [[ "$q_status" == "cancelled" ]]; then
        echo "channel error: oq_decide: question ${oq_id} is cancelled — no decision may be written (OQ-INV-13)" >&2
        return 1
    fi

    # ── BUILD + VALIDATE DECISION RECORD (OQ-INV-17) ──────────────────────────
    # build_decision_record + validate_decision_record from oq-core.sh.
    # directive_json is passed through as DATA ONLY — no eval/exec/source path
    # exists anywhere in this file that would execute directive contents (OQ-INV-19).
    local stamped_json
    stamped_json="$(build_decision_record \
        "$oq_id" "$decided_at" "$decider_id" "$outcome" "$answer" "$directive_json")" \
        || return 1

    # Write to a temp file so we can validate before publishing.
    local tmp_validate
    tmp_validate="$(mktemp /tmp/oq-decide-validate.XXXXXX.json)"
    # shellcheck disable=SC2064
    trap "rm -f '$tmp_validate'" EXIT

    printf '%s' "$stamped_json" > "$tmp_validate"

    if ! validate_decision_record "$tmp_validate" >/dev/null 2>&1; then
        validate_decision_record "$tmp_validate" >/dev/null
        rm -f "$tmp_validate"
        return 1
    fi

    rm -f "$tmp_validate"
    trap - EXIT

    # ── ATOMIC PUBLISH (OQ-INV-5, OQ-INV-15) ─────────────────────────────────
    # The filename stem IS the oq_id (structural addressing — OQ-INV-15).
    # atomic_publish handles mkdir -p, fsync, and same-dir dotfile tmp rename.
    # The stamped_json payload is already canonical + checksummed.
    mkdir -p "$decisions_dir"
    atomic_publish "$decisions_dir" "${oq_id}.json" "$stamped_json" || return 1

    # ── POST-DECISION NUDGE (best-effort, non-correctness — OQ-INV-11) ────────
    # THE DECISION FILE IS AUTHORITATIVE.  This nudge is a latency optimisation
    # only: it wakes the worker's poll loop sooner so it notices the decision
    # without waiting for its next scheduled poll.  If send-prompt.sh is absent
    # or fails, the decision outcome is already durably committed above and is
    # unaffected.  We never write a received/acks artefact (OQ-INV-11).
    if [[ -n "$worker_name" ]]; then
        local _send_prompt_sh="${_OQ_PARENT_DIR}/send-prompt.sh"
        if [[ -x "$_send_prompt_sh" ]]; then
            # Swallow all errors — the nudge is non-correctness.
            "$_send_prompt_sh" "$worker_name" "decision ready for ${oq_id}" 2>/dev/null || true
        fi
    fi

    return 0
}

# ──────────────────────────────────────────────────────────────────────────────
# CLI dispatch guard — only fires when executed directly, not when sourced.
# This allows tests to `source oq-parent.sh` and call functions directly.
# ──────────────────────────────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    "$@"
fi
