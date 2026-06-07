# OQ-escalation (paste-in brief fragment)

> Parents append this section to a sub-orchestrator's `--brief` (mirrors the
> `final_report.yaml` convention). It tells the worker how to surface an Open
> Question (OQ) to you and how to receive your decision. Full protocol:
> `${KH_PRIVATE_DOCS_DIR}/docs-site/src/content/docs/specs/id-43-oq-escalation/PRODUCT.md`; helper scripts:
> `.claude/skills/session-driver-cmux/scripts/oq-{core,worker,parent}.sh`.

## When to use the channel

Use the OQ channel when you hit a question only the parent can resolve — spec
ambiguity, scope renegotiation, a cross-Task dependency that breaks the
sibling-only constraint, or a Checker-FAIL pattern needing parent judgement.
Resolve in-scope questions yourself; only escalate what the parent owns.

## Where the channel lives

Your OQ root is your session's events directory plus `/oq`:

```
<events_dir>/oq/
  questions/<oq_id>.json   # you write   (OQ records)
  decisions/<oq_id>.json   # parent writes (decision records)
  oq-state.json            # your lifecycle marker (working | awaiting-decision)
```

`<events_dir>` is `.claude/cmux-events/<your-session-id>/`. Load the worker
helpers once:

```bash
SDC=".claude/skills/session-driver-cmux/scripts"
source "$SDC/oq-worker.sh"      # sources oq-core.sh; defines oq_emit / oq_cancel / oq_poll_decision / oq_restart_classify
OQ_ROOT="<events_dir>/oq"
NOW() { python3 -c "from datetime import datetime,timezone; print(datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))"; }
```

## Emit an OQ

```bash
# oq_emit <worker_id> <task_id> <phase> <question> <urgency> <blocking> \
#         <context_ref_json> <oq_root> <emitted_at> [<checkpoint_ref_json>]
oq_id=$(oq_emit "$WORKER_ID" 43 plan \
  "PRODUCT.md §3.2 and TECH.md §4 disagree on the decision schema — which governs?" \
  high true \
  '{"file":"${KH_PRIVATE_DOCS_DIR}/docs-site/src/content/docs/specs/id-43-oq-escalation/TECH.md","subtask_id":"43.7","phase":"plan"}' \
  "$OQ_ROOT" "$(NOW)" \
  '{"phase":"plan","note":"resume at TECH §4 reconciliation"}')
```

- `urgency` ∈ `low | normal | high`. `blocking` is `true` or `false`.
- `context_ref` carries enough for the parent to act without re-deriving (file,
  commit, subtask_id, phase).
- `oq_id` is derived from `(task_id, phase, question, context_ref)` — re-emitting
  the same question is idempotent (same id, no duplicate). A genuinely new
  question gets a new id; link a refinement with the channel's `supersedes`.
- For a **blocking** OQ, pass a `checkpoint_ref` (opaque to the channel) that
  lets you resume the blocked step **without re-running it** after the decision.

## The two-state contract (OQ-INV-8 / OQ-INV-24) — load-bearing

- **Blocking OQ:** after emit, your `oq-state.json` flips to `awaiting-decision`.
  Make **no** progress that depends on the answer. You MAY do independent
  side-work (tests, journal). You MUST NOT `/exit` while a blocking OQ is
  undecided — stay parked in `awaiting-decision` until the decision lands.
- **Non-blocking OQ:** you continue immediately; check for the decision
  opportunistically at a phase boundary and apply it if still relevant.
- There is no "seen" signal: the only acknowledgement is the decision file.
  Absence of `decisions/<oq_id>.json` means "no decision yet".

## Poll for the decision (blocking OQs)

```bash
oq_poll_decision "$OQ_ROOT" "$oq_id"   # polls decisions/<oq_id>.json; resets state to working on arrival
```

- Default cadence 2 s; the parent's decision is observed within the 10 s budget.
  The parent may also fire a `send-prompt` nudge, but the **decision file is
  authoritative** — never act on the prompt text alone.
- Applying a decision twice is a no-op (idempotent); a corrupt decision fails
  closed (channel error, state unchanged) rather than unblocking you wrongly.

## Cancel an OQ you no longer need

```bash
oq_cancel "$oq_id" "$OQ_ROOT" "$(NOW)"   # writes a terminal status:cancelled record; never deletes
```

## On restart (crash recovery)

Before doing any new work after a relaunch, re-classify from disk — no parent
involvement needed:

```bash
oq_restart_classify "$OQ_ROOT"
# Per-OQ lines: RESOLVED|DECIDED|UNRESOLVED <oq_id>
# Then one resume directive:
#   RESUME_POLL  <oq_id>  -> resume oq_poll_decision (do NOT re-run the produced work; use checkpoint_ref)
#   RESUME_APPLY <oq_id>  -> the decision arrived while you were down; apply it (idempotent)
#   RESUME_NONE           -> nothing blocking; carry on
```
