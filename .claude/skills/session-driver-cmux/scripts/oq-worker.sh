#!/usr/bin/env bash
# oq-worker.sh — worker-side OQ (Outgoing Question) facade.
#
# USAGE (sourced):
#   source /path/to/oq-worker.sh
#   oq_emit <worker_id> <task_id> <phase> <question> <urgency> <blocking> \
#            <context_ref_json> <oq_root_dir> <emitted_at> [<checkpoint_ref_json>]
#   oq_cancel <oq_id> <oq_root_dir> <updated_at>
#
# USAGE (executed directly — for shell tests):
#   bash oq-worker.sh oq_emit ...
#   bash oq-worker.sh oq_cancel ...
#
# DIRECTORY LAYOUT CONVENTION:
#   <oq_root>/              — root passed to oq_emit / oq_cancel
#     questions/<oq_id>.json   — OQ records (worker writes)
#     decisions/<oq_id>.json   — decision records (parent writes — ID-43.7)
#     oq-state.json            — lifecycle marker (worker writes)
#
# EXIT CODES FOR oq_emit:
#   0  — success: question emitted (or idempotent short-circuit: already emitted + unresolved)
#   2  — OQ_ALREADY_RESOLVED: question exists + decision exists; caller must apply decision.
#        stdout carries the line: OQ_ALREADY_RESOLVED:<oq_id>
#   1  — any other error (missing argument, build failure, publish failure).
#
# OQ invariant coverage:
#   OQ-INV-2   — immutability: a second status:open write to an existing oq_id is REJECTED
#                by the idempotency short-circuit. The only legal overwrite of an existing
#                slot is a status:cancelled record (oq_cancel).
#   OQ-INV-6   — no-retract: oq_cancel NEVER deletes a file; it overwrites the slot with
#                a terminal status:cancelled record that preserves the original content.
#   OQ-INV-7   — emitted_at is caller-supplied (pinnable for tests / crash-re-emit).
#   OQ-INV-8   — OQ record fields: all required fields present in the emitted record.
#   OQ-INV-9   — worker_id is stamped into the record.
#   OQ-INV-12  — oq_id excludes worker_id/emitted_at/seq (idempotency short-circuit uses
#                the stable derive_oq_id to detect re-emit of the same logical question).
#   OQ-INV-13  — cancel via oq_cancel; if the OQ was blocking, oq-state is reset to working.
#   OQ-INV-21  — checkpoint_ref is OPAQUE: stored verbatim, not shape-validated.
#   OQ-INV-22  — seq is disk-derived via next_seq (crash-safe, not in-memory).
#   OQ-INV-26  — oq_id is derived from content (task_id/phase/question/context_ref), not
#                from mtime or filesystem position.

# ──────────────────────────────────────────────────────────────────────────────
# Source oq-core.sh from the same directory as this script.
# BASH_SOURCE[0] works correctly whether this file is sourced or executed.
# ──────────────────────────────────────────────────────────────────────────────
_OQ_WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly _OQ_WORKER_DIR

# shellcheck source=oq-core.sh
source "${_OQ_WORKER_DIR}/oq-core.sh"

# ──────────────────────────────────────────────────────────────────────────────
# oq_emit — emit an outgoing question from the worker.
#
# Signature:
#   oq_emit <worker_id> <task_id> <phase> <question> <urgency> <blocking>
#           <context_ref_json> <oq_root_dir> <emitted_at> [<checkpoint_ref_json>]
#
# Arguments:
#   worker_id         — stable worker identifier (e.g. "worker-abc123").
#   task_id           — the task this question belongs to (e.g. "43").
#   phase             — the current execution phase (e.g. "implement").
#   question          — the question text.
#   urgency           — one of: low | normal | high.
#   blocking          — "true" (worker must wait) or "false" (worker may continue).
#   context_ref_json  — JSON object providing provenance/context (e.g. '{"spec":"TECH.md"}').
#   oq_root_dir       — the oq/ root directory for this worker session.
#   emitted_at        — caller-supplied ISO-8601 UTC timestamp (pinnable for tests).
#   checkpoint_ref_json — (optional) JSON value representing the worker checkpoint.
#                         Required (non-null) when blocking=true; ignored when blocking=false.
#                         Defaults to "null" if omitted.
#
# Exit codes:
#   0 — success (new emit) or idempotent short-circuit (already emitted, no decision yet).
#       Prints the oq_id to stdout on either path.
#   2 — OQ_ALREADY_RESOLVED: question+decision both exist; caller must apply the decision.
#       Prints "OQ_ALREADY_RESOLVED:<oq_id>" to stdout.
#   1 — argument or build/publish error. UK-English error on stderr.
#
# Immutability (OQ-INV-2):
#   If questions/<oq_id>.json exists with status:open and no decision, oq_emit does NOT
#   overwrite it (idempotent short-circuit). The ONLY legal overwrite of an existing slot
#   is a status:cancelled record via oq_cancel.
#
# Blocking ordering (OQ-INV-21 + load-bearing):
#   When blocking:true, the questions/<oq_id>.json is committed to disk BEFORE the
#   oq-state.json is flipped to awaiting-decision. This ensures the parent never sees
#   awaiting-decision pointing at an OQ file it cannot yet read.
# ──────────────────────────────────────────────────────────────────────────────
oq_emit() {
    local worker_id="${1:?oq_emit: worker_id argument is required}"
    local task_id="${2:?oq_emit: task_id argument is required}"
    local phase="${3:?oq_emit: phase argument is required}"
    local question="${4:?oq_emit: question argument is required}"
    local urgency="${5:?oq_emit: urgency argument is required}"
    local blocking="${6:?oq_emit: blocking argument is required (true|false)}"
    local context_ref_json="${7:?oq_emit: context_ref_json argument is required}"
    local oq_root_dir="${8:?oq_emit: oq_root_dir argument is required}"
    local emitted_at="${9:?oq_emit: emitted_at argument is required}"
    local checkpoint_ref_json="${10:-null}"

    local questions_dir="${oq_root_dir}/questions"
    local decisions_dir="${oq_root_dir}/decisions"

    # ── Step 1: Derive the stable oq_id from content inputs (OQ-INV-1,12,26). ──
    local oq_id
    oq_id=$(derive_oq_id "$task_id" "$phase" "$question" "$context_ref_json")
    local rc=$?
    if [[ $rc -ne 0 ]]; then
        # derive_oq_id already emitted the error to stderr.
        return 1
    fi

    local question_file="${questions_dir}/${oq_id}.json"
    local decision_file="${decisions_dir}/${oq_id}.json"

    # ── Step 2: Idempotency short-circuit (OQ-INV-12, OQ-INV-2). ──
    if [[ -f "$question_file" ]]; then
        if [[ -f "$decision_file" ]]; then
            # Already resolved: question + decision both exist.
            # Signal the caller to apply the decision rather than re-emitting.
            echo "OQ_ALREADY_RESOLVED:${oq_id}"
            return 2
        else
            # Already emitted but unresolved: skip the write, return success.
            # This is the crash-re-emit / idempotent path (OQ-INV-12).
            echo "$oq_id"
            return 0
        fi
    fi

    # ── Step 3: Compute seq from disk (OQ-INV-4,22). ──
    local seq
    seq=$(next_seq "$questions_dir")
    local seq_rc=$?
    if [[ $seq_rc -ne 0 ]]; then
        echo "channel error: oq_emit: failed to compute next_seq for ${questions_dir}" >&2
        return 1
    fi

    # ── Step 4: Build and atomically publish the OQ record. ──
    local oq_record
    oq_record=$(build_oq_record \
        "$oq_id" "$worker_id" "$seq" "$emitted_at" "$question" \
        "$urgency" "$blocking" "$context_ref_json" "open" "null")
    local build_rc=$?
    if [[ $build_rc -ne 0 ]]; then
        # build_oq_record already emitted the error to stderr.
        return 1
    fi

    atomic_publish "$questions_dir" "${oq_id}.json" "$oq_record"
    local pub_rc=$?
    if [[ $pub_rc -ne 0 ]]; then
        echo "channel error: oq_emit: failed to publish OQ record for ${oq_id}" >&2
        return 1
    fi

    # ── Step 5: Handle oq-state flip for blocking questions (OQ-INV-21). ──
    # ORDERING IS LOAD-BEARING: the question file must be committed (step 4) before
    # the state is flipped to awaiting-decision. The parent must never see
    # awaiting-decision pointing at an OQ file it cannot yet read.
    if [[ "$blocking" == "true" ]]; then
        local state_record
        state_record=$(build_state_record \
            "$worker_id" "awaiting-decision" "$oq_id" "$checkpoint_ref_json" "$emitted_at")
        local state_rc=$?
        if [[ $state_rc -ne 0 ]]; then
            # build_state_record already emitted the error to stderr.
            return 1
        fi

        atomic_publish "$oq_root_dir" "oq-state.json" "$state_record"
        local state_pub_rc=$?
        if [[ $state_pub_rc -ne 0 ]]; then
            echo "channel error: oq_emit: failed to publish oq-state.json for ${oq_id}" >&2
            return 1
        fi
    fi
    # Non-blocking: do not flip oq-state. Leave it as-is (working or absent).

    echo "$oq_id"
    return 0
}

# ──────────────────────────────────────────────────────────────────────────────
# oq_cancel — cancel an open OQ (OQ-INV-6, OQ-INV-13).
#
# Signature:
#   oq_cancel <oq_id> <oq_root_dir> <updated_at>
#
# Arguments:
#   oq_id        — the stable oq_id of the question to cancel.
#   oq_root_dir  — the oq/ root directory for this worker session.
#   updated_at   — caller-supplied ISO-8601 UTC timestamp for the cancellation.
#
# Behaviour:
#   1. Reads the existing questions/<oq_id>.json to extract the original
#      question/emitted_at/seq (preserved in the cancellation record).
#   2. Atomically overwrites questions/<oq_id>.json with a terminal record:
#      {status:"cancelled", supersedes:<oq_id>, ...original fields preserved...}.
#   3. NEVER deletes the file (no-retract, OQ-INV-6).
#   4. If oq-state.json shows lifecycle_state="awaiting-decision" with
#      blocked_on=<oq_id>, resets it to lifecycle_state="working"/blocked_on=null.
#
# Exit codes:
#   0 — success.
#   1 — error (missing file, parse failure, build/publish failure). UK-English error on stderr.
# ──────────────────────────────────────────────────────────────────────────────
oq_cancel() {
    local oq_id="${1:?oq_cancel: oq_id argument is required}"
    local oq_root_dir="${2:?oq_cancel: oq_root_dir argument is required}"
    local updated_at="${3:?oq_cancel: updated_at argument is required}"

    local questions_dir="${oq_root_dir}/questions"
    local state_file="${oq_root_dir}/oq-state.json"
    local question_file="${questions_dir}/${oq_id}.json"

    # Verify the question file exists before attempting cancellation.
    if [[ ! -f "$question_file" ]]; then
        echo "channel error: oq_cancel: question file not found: ${question_file}" >&2
        return 1
    fi

    # ── Step 1: Read the original record to preserve content fields. ──
    # Extract the original question, emitted_at, seq, worker_id, blocking, urgency,
    # context_ref from the on-disk record. We use Python for safe JSON parsing.
    local original_fields
    original_fields=$(python3 - "$question_file" <<'PY'
import json, sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as fh:
        rec = json.load(fh)
except (OSError, json.JSONDecodeError) as exc:
    print(f"channel error: oq_cancel: cannot read question file — {exc}", file=sys.stderr)
    sys.exit(1)

# Output as a JSON object so the caller can parse it cleanly.
fields = {
    "question":    rec.get("question", ""),
    "emitted_at":  rec.get("emitted_at", ""),
    "seq":         rec.get("seq", 0),
    "worker_id":   rec.get("worker_id", ""),
    "blocking":    rec.get("blocking", False),
    "urgency":     rec.get("urgency", "normal"),
    "context_ref": rec.get("context_ref", {}),
}
print(json.dumps(fields))
PY
)
    local read_rc=$?
    if [[ $read_rc -ne 0 ]]; then
        # Python already emitted the error to stderr.
        return 1
    fi

    # ── Step 2: Parse original fields from the JSON bundle. ──
    local orig_question orig_emitted_at orig_seq orig_worker_id orig_blocking_str orig_urgency orig_context_ref
    orig_question=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['question'])" "$original_fields")
    orig_emitted_at=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['emitted_at'])" "$original_fields")
    orig_seq=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['seq'])" "$original_fields")
    orig_worker_id=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['worker_id'])" "$original_fields")
    orig_blocking_str=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(str(d['blocking']).lower())" "$original_fields")
    orig_urgency=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['urgency'])" "$original_fields")
    orig_context_ref=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(json.dumps(d['context_ref']))" "$original_fields")

    # ── Step 3: Build the cancellation record, preserving original content fields. ──
    # status:cancelled, supersedes:<oq_id>, original question/emitted_at/seq preserved.
    local cancel_record
    cancel_record=$(build_oq_record \
        "$oq_id" "$orig_worker_id" "$orig_seq" "$orig_emitted_at" "$orig_question" \
        "$orig_urgency" "$orig_blocking_str" "$orig_context_ref" "cancelled" "\"${oq_id}\"")
    local build_rc=$?
    if [[ $build_rc -ne 0 ]]; then
        # build_oq_record already emitted the error to stderr.
        return 1
    fi

    # ── Step 4: Atomically overwrite the question slot (no delete — OQ-INV-6). ──
    atomic_publish "$questions_dir" "${oq_id}.json" "$cancel_record"
    local pub_rc=$?
    if [[ $pub_rc -ne 0 ]]; then
        echo "channel error: oq_cancel: failed to publish cancellation record for ${oq_id}" >&2
        return 1
    fi

    # ── Step 5: Reset oq-state if it was awaiting-decision blocked on this oq_id. ──
    # Read oq-state.json; if lifecycle_state=awaiting-decision AND blocked_on=<oq_id>,
    # reset to lifecycle_state=working / blocked_on=null.
    if [[ -f "$state_file" ]]; then
        local state_needs_reset
        state_needs_reset=$(python3 - "$state_file" "$oq_id" <<'PY'
import json, sys

state_path = sys.argv[1]
cancel_oq_id = sys.argv[2]
try:
    with open(state_path, "r", encoding="utf-8") as fh:
        state = json.load(fh)
except (OSError, json.JSONDecodeError):
    # Cannot read state — treat as no-reset needed.
    sys.exit(0)

if (state.get("lifecycle_state") == "awaiting-decision"
        and state.get("blocked_on") == cancel_oq_id):
    print("yes")
PY
)
        if [[ "$state_needs_reset" == "yes" ]]; then
            # Extract worker_id from state for the reset record.
            local state_worker_id
            state_worker_id=$(python3 - "$state_file" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    state = json.load(fh)
print(state.get("worker_id", ""))
PY
)
            local reset_record
            reset_record=$(build_state_record \
                "$state_worker_id" "working" "null" "null" "$updated_at")
            local reset_rc=$?
            if [[ $reset_rc -ne 0 ]]; then
                # build_state_record already emitted the error to stderr.
                return 1
            fi

            atomic_publish "$oq_root_dir" "oq-state.json" "$reset_record"
            local reset_pub_rc=$?
            if [[ $reset_pub_rc -ne 0 ]]; then
                echo "channel error: oq_cancel: failed to reset oq-state.json after cancel" >&2
                return 1
            fi
        fi
    fi

    return 0
}

# ──────────────────────────────────────────────────────────────────────────────
# CLI dispatch — guarded so sourcing this file does NOT auto-run the dispatcher.
# Tests can call: bash oq-worker.sh oq_emit ...
#                 bash oq-worker.sh oq_cancel ...
# ──────────────────────────────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    cmd="${1:?oq-worker.sh: command argument required (oq_emit | oq_cancel)}"
    shift
    case "$cmd" in
        oq_emit)   oq_emit "$@" ;;
        oq_cancel) oq_cancel "$@" ;;
        *)
            echo "channel error: oq-worker.sh: unknown command — expected oq_emit or oq_cancel" >&2
            exit 1
            ;;
    esac
fi
