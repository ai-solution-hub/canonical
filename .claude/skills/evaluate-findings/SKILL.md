---
name: evaluate-findings
description:
  Use when the workflow-evaluator agent runs an adjudication sweep over
  candidate retro findings against the existing `product-retros.json`
  corpus. Drives the RESEARCH §13.3 seven-step playbook —
  candidate-select → similarity-pair → 3-verdict forced choice →
  recency-guard → staged-writes → soft-delete/supersede → batch-stamp.
  Triggered by the workflow-evaluator agent on operator command,
  scheduled sweep, or O-of-O handoff flag. Does NOT author retro records
  (the orchestrator-of-orchestrators' handoff habit owns authoring per
  S271 §13.1), NOT invent new findings (adjudicates between EXISTING
  records only), and NOT hard-delete (soft-delete + supersede chain
  only). Efficiency-metric computation is the sibling skill
  evaluate-workflow, not this one.
allowed-tools: Read, Bash, Grep, Glob, Write, Edit
---

# evaluate-findings — Adjudication Playbook for Retro Candidate Findings

Gates the Knowledge Hub retro corpus (`docs/reference/product-retros.json`)
by adjudicating candidate findings against existing non-deprecated records.
This is the **adjudication lane** companion skill for the
`.claude/agents/workflow-evaluator.md` agent. The companion efficiency
lane is the sibling skill `evaluate-workflow` (Subtask {48.5}); this
skill never invokes it, and the agent dispatches the two lanes
independently per trigger.

This skill is **NOT** for per-session retro authoring — that is the
orchestrator-of-orchestrators' `handoff` habit (RESEARCH §13.1). It is
**NOT** for efficiency-metric computation — that is `evaluate-workflow`.
It is **NOT** a session-end hook — the evaluator is triggered + async
per RESEARCH §13.2, and any work that would block teardown belongs
elsewhere.

## What this skill does

Walks the seven-step adjudication playbook (RESEARCH §13.3) over a
candidate set of retro findings, decides for each candidate–existing pair
whether to deprecate one side, keep both, or flag for human ruling, and
stages soft-delete + supersede writes against `product-retros.json` (the
agent commits the staged batch; this skill produces the staged actions).

The playbook is modelled directly on the offline-maintenance
conflict-resolution sweep in
`docs/themes/workflow-orchestration/memory-transcript.md`, KH-adapted
for an MD/JSON corpus rather than a vector store (the transcript itself
flags this mechanism swap is needed).

Three outputs, all narrow and well-defined:

1. **Verdict list** — per candidate–existing pair: one of
   `deprecate_existing` / `deprecate_candidate` / `keep_both`, with a
   `superseding_record_id` link where applicable, and a one-line
   justification.
2. **Recency-guard trace** — every verdict that was downgraded from
   `deprecate_existing` to `keep_both` because the candidate was older
   than the existing record. This trace is load-bearing for human
   review (RESEARCH §13.3 step 4).
3. **Staged soft-delete entries** — for verdicts the recency guard did
   not downgrade: `deprecated = true` + `deprecation_reason` +
   `superseding_record_id` updates the agent will apply transactionally.

## What this skill does NOT do

Stated explicitly so the boundary is unambiguous:

- **Does not author retro records.** The retro ledger
  (`docs/reference/product-retros.json`) is authored by the O-of-O via
  the `handoff` habit (RESEARCH §13.1). This skill gates the corpus —
  it never adds a new finding to it.
- **Does not invent new findings.** Scope guard from RESEARCH §13.3:
  this skill adjudicates conflicts between EXISTING records only. It is
  not a re-extraction surface and it does not pull new findings from
  session transcripts or anywhere else. New candidates arrive from
  upstream (the O-of-O `handoff` write); this skill decides what
  happens to them in the corpus.
- **Does not hard-delete.** Deprecation is always soft-delete +
  supersede chain. No record is ever physically removed. The supersede
  link makes the deprecation chain auditable in git-tracked JSON. If a
  later sweep produces a different verdict, the original record is
  still inspectable and re-instatable.
- **Does not compute efficiency metrics.** Efficiency-metric
  computation across the archived session corpus is the sibling skill
  `evaluate-workflow`. If the trigger asks for both lanes, the agent
  dispatches them as separate invocations — this skill never calls the
  efficiency playbook.
- **Does not dual-write to Mempalace.** Mempalace is diary-only per
  S274. Structured retro adjudication lives in the retro ledger; this
  skill stages writes to `product-retros.json` and stops there.
- **Does not block session teardown.** The evaluator agent runs
  triggered + async (RESEARCH §13.2). Any caller that expects a
  synchronous response inside a live session is using the wrong
  surface.

## What you receive (from the workflow-evaluator agent)

When the agent invokes this skill for the adjudication lane, the brief
carries:

| Field | Source |
|---|---|
| **Trigger source** | `operator-command` / `scheduled-sweep` / `handoff-flagged-pending` — cadence context only. |
| **Candidate set** | The un-checked subset of `product-retros.json` records (or per-finding entries) — those with `deprecated = false AND last_conflict_check` unset. The candidate set is named explicitly in the brief; this skill never defaults to "everything in the file". |
| **Corpus state** | The current `product-retros.json` snapshot — the existing non-deprecated records the candidate set is adjudicated against. Per §13.4 the records carry `deprecated`, `deprecation_reason`, `superseding_record_id`, `last_conflict_check`. |
| **Similarity surface (optional)** | Mempalace semantic surface (`mempalace_search`, `mempalace_kg_query`) as a similarity analogue for vector lookup — OQ-S271-4. Default mechanism is category-scoped keyword overlap within the JSON corpus; the Mempalace surface is a supplement, not a replacement. |
| **Reporting destination** | A file path under `docs/workflow-evaluation/reports/` for the verdict list + recency-guard trace, plus the staged-writes payload returned to the agent for transactional application. Never a direct hand-off to the retro ledger by this skill. |

If any required field (trigger source, candidate set, corpus state,
reporting destination) is missing, escalate to the agent. Do not
default. Do not guess. If the candidate set is empty, return an empty
adjudication report rather than scanning the whole corpus.

## The seven-step playbook (RESEARCH §13.3)

Each step has a mechanism + the transcript analogue it ports + the
KH-specific softening (where applicable). Walk them in order. Do not
skip; do not re-order.

### Step 1 — Candidate selection (recency / idempotency filter)

Pick up findings **never conflict-checked**.

- Transcript analogue: `deprecated = false AND last_conflict_check = 0`.
- KH mechanism: filter the candidate set passed by the agent to records
  where `deprecated = false AND last_conflict_check IS NULL`. Records
  with a prior `last_conflict_check` timestamp are skipped — the sweep
  is idempotent.
- Why this matters: previously-adjudicated findings calcifying into
  un-re-examinable truth is the failure mode the gate is designed to
  prevent on the other side; equally, re-adjudicating an already-handled
  finding burns tokens and risks flip-flop verdicts. The
  `last_conflict_check` stamp (set in step 7) is what makes the next
  sweep cheap.

### Step 2 — Similarity-pair construction

For each candidate, find the most-similar existing non-deprecated
records.

- Transcript analogue: top-5 vector matches above a cosine threshold.
- KH mechanism: **category-scoped keyword/semantic overlap** within
  `product-retros.json`. For each candidate, compare against existing
  records in the same category (e.g. a new `failed_assumptions[]` entry
  is compared against existing `failed_assumptions[]` entries across
  records, plus related categories per the retro schema). Optionally
  back this with the Mempalace `mempalace_search` /
  `mempalace_kg_query` semantic surface as a vector analogue (this is
  the OQ-S271-4 mechanism choice — Mempalace is a supplement, not a
  replacement; default to keyword-overlap if Mempalace is unavailable).
- **Dedupe pairs with a canonical key** so A-vs-B and B-vs-A are not
  adjudicated twice in the same sweep. Canonical-key construction: sort
  the two record ids lexically and join with `::` (e.g.
  `S262::S264-q3`); this is the pair identifier used in the verdict
  list output.
- Output of this step: a deduplicated set of candidate–existing pairs,
  each pair labelled with the candidate id, the existing id, the
  category, and the similarity signal that surfaced it.

### Step 3 — Verdict (forced tool-use, three outcomes)

Send each pair to the model with a forced decision returning exactly
one of:

- **`deprecate_existing`** — the candidate supersedes the existing
  record (the candidate is the new truth).
- **`deprecate_candidate`** — the existing record stands (the candidate
  duplicates or contradicts established truth without new evidence).
- **`keep_both`** — both records remain in the active corpus (either
  the records cover different facets, or the evidence is too ambiguous
  to choose).

Each verdict carries a **`superseding_record_id`** so the audit trail
records what replaced what (only populated for `deprecate_*` verdicts;
null for `keep_both`).

**Bias toward `keep_both` when in doubt.** This is the transcript's
explicit default and the conservative choice — reversible beats
aggressive. If the evidence does not clearly favour one record over the
other, the verdict is `keep_both`. The corpus tolerates moderate
redundancy far better than it tolerates confidently-wrong deprecation.

### Step 4 — Recency guard (the load-bearing safety check)

Before acting on any `deprecate_existing` verdict: check the candidate's
`created_at` (or equivalent timestamp) against the existing record's.
**If the candidate is OLDER than the existing record, downgrade the
verdict to `keep_both`.**

Quoting RESEARCH §13.3: "Killing a newer record needs stronger evidence
than an LLM hunch on two snippets."

This is the **single most important mechanism in the playbook** — it
prevents confidently-wrong deprecation of fresher truth. Every
recency-guard downgrade is recorded in the recency-guard trace (output
2) for human inspection at the next O-of-O `handoff`.

A symmetric check applies to `deprecate_candidate` verdicts only as a
sanity reality check (a much newer candidate being marked redundant by
an older existing record is suspicious) — but the asymmetry is
intentional: deprecating the existing record is the higher-impact
action and so carries the load-bearing safety stop; deprecating the
candidate is the safer default and does not need the same hard guard.

### Step 5 — Staged writes (transactional, no partial deprecations)

Stage all soft-delete + supersede actions per candidate before any
write hits the corpus. The agent applies the staged batch
transactionally.

- **Drop the whole stage on mid-batch error.** Partial deprecations
  leave the corpus in an inconsistent state where some records reference
  superseding ids that do not yet exist (or worse, that were never
  applied). The atomicity is non-negotiable.
- **If one pair already deprecated the candidate, skip the remaining
  pairs for that candidate.** A candidate cannot supersede multiple
  existing records and simultaneously be deprecated by another existing
  record — the verdict graph would contradict itself. Skip-after-deprecate
  preserves a consistent supersede chain.
- The staged-writes payload returned to the agent is the structured
  patch the agent will apply (record ids + the field deltas:
  `deprecated`, `deprecation_reason`, `superseding_record_id`).

### Step 6 — Soft-delete + supersede trail (NOT hard delete)

Deprecation is always implemented as:

- `deprecated = true`
- `deprecation_reason = "conflict-resolution:superseded-by:<superseding_record_id>"`
  (or a more specific reason string for non-supersede deprecations, but
  the conflict-resolution case is the dominant one for this skill)
- `superseding_record_id = <id>` (the record that replaced this one;
  null only for deprecation reasons that do not involve a successor —
  rare in this skill's playbook).

**No record is ever physically removed.** The record vanishes from
active retrieval (any reader that filters `deprecated = false` will not
see it) but stays inspectable in the git-tracked JSON. The supersede
link makes the deprecation chain auditable: any reader can follow
`superseding_record_id` from an old record forward to its current
successor.

Why this matters: the failure mode the gate is designed to prevent is
stale resolutions calcifying into un-re-examinable truth. A
soft-deleted record is still re-examinable; a hard-deleted record is
not. Git history is not a substitute — readers should not need to
`git log` to find what a record used to say.

### Step 7 — Batch-stamp survivors

After the staged batch is applied, set `last_conflict_check = now()` on:

- Every survivor (record that came through with `deprecated` still
  `false`).
- Every record whose pairs all came back `keep_both` (including the
  candidates that survived).

This makes step 1 idempotent for the next sweep — the next run only
examines genuinely new arrivals. Without this stamp, every sweep would
re-adjudicate the entire non-deprecated corpus.

The batch-stamp is part of the staged-writes payload returned to the
agent; the agent applies it in the same transaction as the deprecations
so survivors and deprecations are stamped consistently.

## Governing principles (RESEARCH §13.3, verbatim intent)

- **No single source is canonical.** The retro ledger is not "the
  truth"; it is the durable corpus of *findings as adjudicated at
  decision time*. The model verdict at the moment of adjudication is
  "truth at decision time" — nothing more.
- **The recency guard is the sanity check.** It is the one
  mechanism in the playbook that does not trust the model verdict — it
  trusts the timestamps. When the verdict and the timestamps disagree,
  the timestamps win (specifically: a younger existing record beats a
  `deprecate_existing` verdict from an older candidate).
- **Git-tracked soft-delete history means any resolution can be
  re-examined.** A deprecated record is not gone. If a later sweep
  uncovers evidence that contradicts an earlier deprecation, the
  earlier deprecation can be flagged and the record re-instated. The
  supersede chain is auditable forward; the git history is auditable
  backward.
- **Stale resolutions must NOT calcify into un-re-examinable truth.**
  This is the core anti-failure mode. The `last_conflict_check` stamp
  makes sweeps idempotent in the *short* run; the soft-delete history +
  the recency guard make resolutions revisable in the *long* run.
- **Bias to `keep_both` when in doubt.** Every other principle on this
  list reinforces this one. The corpus tolerates redundancy. The
  corpus does not tolerate confidently-wrong deprecation.

## Scope guard (KH-specific softening)

Unlike the transcript's fully-autonomous auto-extraction corpus, KH
retros are *human / O-of-O-authored* and comparatively low-volume. The
gate's job is **conflict adjudication across records**, not
re-extraction.

This skill **does not invent new findings**. New candidates arrive from
upstream (the O-of-O `handoff` write, or an explicit operator command
that loaded a candidate set). The skill decides keep / deprecate /
supersede + flags "changes required to current records" for the O-of-O.

**Auto-`deprecate_existing` should remain rare** — recency-guarded +
`keep_both`-biased. When the evidence is genuinely ambiguous, the gate
may instead emit a **`conflict_note` / "needs human ruling"** flag
rather than acting — the conservative path (OQ-S271-1, KH-leaning).
This is a deliberate KH softening of the transcript's autonomous
stance, because KH volumes do not justify the same automation
aggression.

A `conflict_note` is encoded as a `keep_both` verdict with an explicit
`conflict_note` field on the verdict-list entry. The O-of-O reads the
note at the next `handoff` and decides whether to author a fresh retro
record that resolves the conflict (which itself becomes a candidate at
the *next* sweep).

## What you produce

A single adjudication report at the destination path the agent passed
in (`docs/workflow-evaluation/reports/<trigger>-<timestamp>-findings.md`),
plus a structured staged-writes payload returned to the agent for
transactional application. The report is markdown for human review;
the staged-writes payload is the patch the agent applies to
`product-retros.json`.

Required report sections, in order:

1. **Header** — trigger source, candidate set summary (count + ids),
   corpus snapshot id (e.g. git SHA of `product-retros.json` at read
   time), timestamp, evaluator agent invocation id.
2. **Verdict list** — one row per deduped pair. Columns: canonical
   pair key, candidate id, existing id, category, verdict
   (`deprecate_existing` / `deprecate_candidate` / `keep_both`),
   `superseding_record_id` (where applicable), `conflict_note` (where
   applicable), one-line justification.
3. **Recency-guard trace** — every `deprecate_existing` verdict that
   was downgraded to `keep_both` because the candidate was older.
   Columns: pair key, candidate timestamp, existing timestamp, age
   delta. Explicitly marked "downgraded by recency guard".
4. **Staged soft-delete entries** — the staged-writes payload in
   human-readable form. Each row: record id, new `deprecated` value,
   new `deprecation_reason`, new `superseding_record_id`. Marked
   "staged for agent to apply transactionally — not yet written".
5. **Batch-stamp targets** — the survivor + all-`keep_both` set that
   will receive `last_conflict_check = <timestamp>` in the same
   transaction.
6. **Escalations (if any)** — missing fields, malformed corpus
   entries, similarity surface unavailable when required, candidate
   sets that contain records already deprecated, agent-brief
   contradictions.

Return the report path + the structured staged-writes payload back to
the agent. The agent commits the batch (or aborts on mid-batch error
per step 5). This skill does not write to `product-retros.json`
directly.

## Why these constraints exist

The boundary lines above are not arbitrary. Three failure modes from
the S262–S264 corpus motivated them and the cost of repeating them is
high:

- **Conflicting retro findings → confused context.** When findings
  accumulate without adjudication, the corpus accumulates
  contradictions that downstream readers (agents and humans) cannot
  reliably resolve. The gate is the fix. The gate writing its *own*
  findings would silently re-open the failure mode — adjudication and
  authorship must stay separated (RESEARCH §13.1).
- **Confidently-wrong deprecation of fresher truth.** Without the
  recency guard, an LLM verdict on two snippets can deprecate a record
  that is in fact newer and correct. The recency guard is the
  load-bearing safety check; it is the single mechanism that does not
  trust the model verdict and the one that is most expensive to lose
  (RESEARCH §13.3 step 4).
- **Stale resolutions calcifying into un-re-examinable truth.** A
  hard-delete corpus loses the ability to re-examine earlier
  resolutions. A soft-delete + supersede chain preserves the audit
  trail without polluting active retrieval. The two mechanisms together
  — soft-delete during the sweep + git-tracked history of the JSON
  ledger — are what make any resolution revisable later (RESEARCH
  §13.3 governing principles).

When a future change pressures any of these constraints, escalate
rather than relax. The constraints encode the corrected design — they
are the load-bearing part.

## Process

### Step 1 — Validate the dispatch brief

Confirm: trigger source, candidate set (non-empty; ids resolvable
against the corpus), corpus state path (resolvable; readable),
reporting destination is under `docs/workflow-evaluation/reports/`.
Missing any of these → escalate to the agent. Do not default. Do not
guess.

Confirm every candidate id in the brief has `deprecated = false AND
last_conflict_check IS NULL` in the corpus state. Candidates that
already have a `last_conflict_check` timestamp violate the idempotency
filter and must be flagged in the escalations section rather than
re-adjudicated.

### Step 2 — Read the corpus state

Read `product-retros.json` in full (or the snapshot path passed in the
brief). Hold the candidate records + the existing non-deprecated
records in memory. Note the corpus snapshot id (git SHA at read time)
for the report header.

### Step 3 — Build the candidate–existing pair set

Apply step 2 of the playbook: category-scoped overlap construction +
canonical-key dedupe. Optionally back with Mempalace semantic surface
per OQ-S271-4. Hold the deduplicated pair set in memory.

### Step 4 — Adjudicate each pair (verdict + recency guard)

For each pair, apply step 3 (3-verdict forced choice) then step 4
(recency guard downgrade where applicable). Record every recency-guard
downgrade in a separate trace. Bias `keep_both` when in doubt; emit
`conflict_note` for genuinely ambiguous cases.

### Step 5 — Stage the writes

Apply step 5 (staged-writes construction). Build the soft-delete +
supersede payload per step 6 conventions. Skip-after-deprecate per the
per-candidate skip rule. The staged payload is per-pair atomic
internally but the whole batch is dropped on mid-batch error — the
agent owns the transactional commit.

### Step 6 — Build the batch-stamp target set

Apply step 7. Survivors + all-`keep_both` pair members receive
`last_conflict_check = <now>` in the same transaction the agent
applies.

### Step 7 — Write the report + return the payload

Write the adjudication markdown report to the destination path the
agent passed in. Sections in the order specified under "What you
produce". Return the structured staged-writes payload back to the
agent. Do not write anywhere else. Do not write to
`product-retros.json` directly. Do not write to Mempalace.

## Escalation triggers

Stop and report back to the calling agent (with no report file
written and no staged payload) when:

- The dispatch brief is missing required fields (trigger source,
  candidate set, corpus state, reporting destination).
- The candidate set is empty (the agent invoked this skill on a
  zero-candidate trigger — return an empty report header noting the
  zero-candidate condition rather than walking the playbook on an
  empty set).
- A candidate id in the brief is not present in the corpus state, or
  is present with `deprecated = true`, or has a non-null
  `last_conflict_check` (idempotency violation).
- The corpus state is malformed (schema parse fails per the {48.3}
  `RetroRecordSchema`; the soft-delete fields are missing on records
  that should carry them per the migration note in §13.4).
- A similarity surface required by the brief is unavailable (e.g.
  Mempalace MCP unreachable when the brief explicitly requires the
  semantic surface — fall back to keyword overlap with an escalation
  note unless the brief insists on the semantic surface).
- The agent's brief asks this skill to author a retro record, invent
  new findings, hard-delete a record, dual-write to Mempalace, or
  invoke `evaluate-workflow`. These are out of scope by design; the
  correct response is to escalate rather than silently expand the
  contract.
- A mid-batch error occurs during write-staging that the skill cannot
  recover from (e.g. supersede-chain contradiction) — drop the whole
  staged batch and escalate with the contradiction surfaced.

In each case, return:

```
EVALUATE-FINDINGS ESCALATION

REASON: [one-sentence summary]
EVIDENCE:
  - [record id or pair key]: [what is wrong]
RECOMMENDATION: [re-dispatch with corrected brief / skip the
                affected candidates / abort the sweep / refer to
                O-of-O for a fresh retro authoring]
NOTHING WRITTEN: confirmed (no report file produced, no staged
                 payload returned).
```

## What you are NOT

- You are not the workflow-evaluator agent. You are the adjudication-lane
  companion the agent invokes. You produce one report + one staged
  payload; the agent commits the batch.
- You are not `evaluate-workflow`. You do not compute efficiency
  metrics over the archived session corpus. If the trigger needs the
  efficiency lane, the agent dispatches `evaluate-workflow` separately.
- You are not the orchestrator-of-orchestrators. You do not author
  retro records. The O-of-O authors via `handoff`; you gate what enters
  the durable corpus.
- You are not the Curator. You do not edit
  `docs/reference/product-roadmap.json` or
  `docs/reference/product-backlog.json`. Adjudication output flows to
  the report + the staged payload; the Curator's surface is separate.
- You are not a lifecycle hook. You do not run at session start,
  session end, or teardown. You run when the agent invokes you, which
  itself happens only on explicit trigger (RESEARCH §13.2).
- You are not a re-extraction surface. You do not invent new findings.
  The scope guard is explicit: adjudicate between EXISTING records
  only.

Your success is measured by: (a) every verdict in the verdict list is
one of the three forced-choice outcomes with a one-line justification,
(b) every `deprecate_existing` verdict is recency-guard checked and any
downgrade is recorded in the trace, (c) every staged soft-delete entry
includes `deprecated`, `deprecation_reason`, and `superseding_record_id`
(no hard deletes), (d) every survivor + all-`keep_both` record is
included in the batch-stamp target set, (e) zero retro-ledger writes
directly from this skill (the agent commits the staged batch), (f)
zero Mempalace writes from this skill, (g) zero invocations of
`evaluate-workflow` from this skill, (h) escalation rather than scope
expansion when the brief pressures any of the above boundaries.
