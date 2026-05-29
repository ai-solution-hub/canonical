---
name: evaluate-workflow
description:
  Use when the workflow-evaluator agent runs the efficiency-evaluation
  lane over an archived session corpus. Computes the RESEARCH §7
  efficiency-metric set (token usage per role, duplicated reads,
  redundant dispatches incl. E1/E6, megaturns, E3/E4 coordination
  overhead) and surfaces recurring cross-session findings to the
  Curator. Triggered by the workflow-evaluator agent on operator
  command or scheduled sweep. Does NOT write retro records (the
  orchestrator-of-orchestrators' handoff habit owns authoring) and
  does NOT dual-write to Mempalace (diary-only per S274). Adjudication
  is the sibling skill evaluate-findings, not this one.
allowed-tools: Read, Bash, Grep, Glob, Write
---

# evaluate-workflow — Efficiency-Metric Computation for the KH Evaluator

Computes the efficiency-metric set across an archived session corpus and
surfaces recurring cross-session findings. This is the **efficiency
lane** companion skill for the `.claude/agents/workflow-evaluator.md`
agent. The companion adjudication lane is the sibling skill
`evaluate-findings` (Subtask {48.14}); this skill never invokes it and
the agent dispatches the two lanes independently per trigger.

This skill is **NOT** for per-session retro authoring — that is the
orchestrator-of-orchestrators' `handoff` habit. It is **NOT** for
findings adjudication — that is `evaluate-findings`. It is **NOT** a
session-end hook — the evaluator is triggered + async per
`docs/specs/id-48-workflow-evaluation/RESEARCH.md` §13.1–§13.2, and any
work that would block teardown belongs elsewhere.

## What this skill does

The Knowledge Hub SDLC produces a durable per-worker corpus under
`docs/workflow-evaluation/sessions/S<NNN>/<worker>/` (Subtask {48.15}
archives `events.jsonl`, `oq-pending.md`, `final_report.yaml`,
`meta.json` before the teardown `rm -rf`). This skill reads that corpus
programmatically and produces a structured efficiency report.

Two outputs, both narrow and well-defined:

1. **Efficiency-metric table** — the RESEARCH §7 metric set, computed
   per session in the requested range and rolled up across the range.
2. **Recurring-finding surface** — observed efficiency patterns that
   appear across multiple sessions in the range, flagged for the
   Curator and for the next O-of-O `handoff` to consider as retro
   candidates.

The recurring-finding surface is the C5 guard referenced in PLAN §13.5
— a finding seen once is a data point; the same finding observed three
or more times across distinct sessions is a signal worth a follow-up
Subtask. The skill does not decide that follow-up — it surfaces the
pattern; the O-of-O decides whether to author a retro candidate, and
`evaluate-findings` later gates that candidate against the existing
corpus.

## What this skill does NOT do

Stated explicitly so the boundary is unambiguous:

- **Does not write retro records.** The retro ledger
  (`docs/reference/product-retros.json`) is authored by the O-of-O via
  the `handoff` habit (RESEARCH §13.1). This skill produces a report
  and recommendations; it never adds a new record to the ledger.
- **Does not dual-write to Mempalace.** Mempalace is diary-only per
  S274. Structured retro feedback lives in the retro ledger; this skill
  writes one report file under `docs/workflow-evaluation/reports/` and
  stops there.
- **Does not adjudicate findings.** Conflict resolution between a new
  candidate finding and the existing retro corpus is the sibling skill
  `evaluate-findings` (the §13.3 seven-step playbook). If the trigger
  asks for both lanes, the agent dispatches them as separate
  invocations — this skill never calls the adjudication playbook.
- **Does not invent new findings.** Recurring-finding surfacing is
  pattern-counting across the archived corpus, not creative
  re-extraction. Patterns surface; the O-of-O decides.
- **Does not block session teardown.** The evaluator agent runs
  triggered + async (RESEARCH §13.2). Any caller that expects a
  synchronous response inside a live session is using the wrong
  surface.
- **Does not hard-delete or modify archived corpus files.** The corpus
  is git-tracked and read-only from this skill's perspective.

## What you receive (from the workflow-evaluator agent)

When the agent invokes this skill for the efficiency lane, the brief
carries:

| Field | Source |
|---|---|
| **Trigger source** | `operator-command` / `scheduled-sweep` / `handoff-flagged-pending` — cadence context only. |
| **Session range** | Explicit range, e.g. `S270..S276`. The skill never defaults to "the current session" — it operates on a backlog of archived sessions. |
| **Archived corpus path** | `docs/workflow-evaluation/sessions/S<NNN>/<worker>/` per session in the range, populated by Subtask {48.15}. |
| **Checker verdicts + worker reports** | The JSON verdicts left by `task-checker` in subtask `<info added on …>` journals plus per-worker `final_report.yaml` files (which carry `token_usage_by_role` + `token_usage_total`, computed at archive time from the worker transcript's `message.usage` per ID-48.17 — the canonical token source). |
| **Reporting destination** | A file path under `docs/workflow-evaluation/reports/`. Never the retro ledger. |

If any of these is missing, escalate to the agent. Do not default. Do
not guess. If the archived corpus path does not exist for a requested
session, the corpus archival skill ({48.15}) may not have run for that
session — escalate so the agent can decide whether to skip that session
or abort the sweep.

## Efficiency-metric set (RESEARCH §7)

Compute one row per session in the requested range, then a roll-up row.
Each metric corresponds to a concrete observed failure class in the
S262–S264 corpus; the definitions trace back to RESEARCH §7 so the
Curator can cross-reference.

### 1. Token usage per role / per dispatch

Cost attribution across Planner / Executor / Checker / Curator /
Orchestrator. **Source: `token_usage_by_role` in the archived
`final_report.yaml`, computed at archive time from `message.usage` in
the worker session transcript** (`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`,
joined via `meta.json.session_id`). The roll-up is performed by
`lib/workflow-evaluation/token-rollup.ts`, invoked from `stop-worker.sh`
teardown (ID-48.17) — NOT computed by this skill at run-time, because the
transcript is uncommitted + retention-windowed and may be purged by the
time the evaluator runs. `token_usage_total` carries the session total;
`token_usage_by_role.<role>` carries the per-role breakdown
(`{input, output, cache_creation, cache_read, total, turn_count}`).

Worker-level attribution is the primary unit today
(`token_usage_by_role: { sub_orchestrator: { … } }`, matching S280 B4 —
the sub-orchestrator is the primary unit). Child-role (Executor /
Checker) attribution is a **v2 follow-up**: it requires the deeper child
`agent-<hash>` / sidechain transcripts, which are one level deeper and
un-archived today. Roll-up shows mean ± stddev per role across the range
so outlier sessions stand out.

If `token_usage_by_role` is absent or its role entry is `null` (with a
`token_usage_note` explaining a purged transcript), treat token usage as
unavailable for that worker — do not fabricate a count. The legacy
`parse-session.py` tiktoken count is a cl100k_base (OpenAI) content
proxy and is NOT canonical; use it only as a fallback cross-check.

**`/insights` (Anthropic Claude Code usage-insights) is a complementary
operator spot-check, not the canonical source.** It is a cloud / CLI
usage surface (not a locally-installed command — there is no
`.claude/commands/insights` and no plugin) that reports interactive
single-session usage, not per-WORKER / per-ROLE attribution over the
archived corpus. It is useful for an operator sanity-check of a live
session's spend, but it does not replace the transcript-usage join: the
evaluator's canonical token source is `token_usage_by_role` in the
archived `final_report.yaml`. Do not build an `/insights` integration.

### 2. Duplicated reads

Same file path read by N distinct workers (or the same worker N times)
in a single session-wave. Source: `events.jsonl` Read-tool events
keyed by `file_path`. The signal: the orchestrator could have cached
the read in the dispatch brief and saved the downstream tokens.
Report top offenders (file path + read count + workers involved).

### 3. Redundant dispatches

Concrete observed instances of a downstream dispatch that
silently failed and forced the orchestrator to re-do the work inline.
RESEARCH §7 names two classes worth a guard:

- **E1** — `agent-creator` sub-dispatch failed silently because the
  sub-agent lacked the Agent/Task tool; orchestrator re-did the work
  inline.
- **E6** — `workflow-curator` triaged but did not execute the
  `update-roadmap-backlog` writes; orchestrator wrote directly.

Detection: `events.jsonl` dispatch event followed by an inline
equivalent in the same worker stream within a short window, with no
intervening evidence the sub-dispatch produced the expected artefact.
Report observed instance counts per class.

### 4. Megaturn detection

Single turns that exceed a token-count or tool-call threshold (the
compaction-risk surface — large turns that push the context window
toward auto-compaction). Source: the per-turn token array emitted by the
token roll-up (`lib/workflow-evaluation/token-rollup.ts`, ID-48.17) from
the worker session transcript's per-assistant-turn `message.usage` —
NOT a derived count from `events.jsonl`. Report count per session and
the top-3 by tokens.

### 5. Coordination overhead

Two named classes from RESEARCH §7:

- **E4** — N-way `task-list.json` reconciliation cost when parallel
  workers edited the ledger concurrently. Detection: ledger-conflict
  markers in `events.jsonl` git events, or multiple successive ledger
  rewrites by different workers in a short window.
- **E3** — stale-worktree `git fetch + reset --hard` cost per dispatch
  (the worktree-isolation tax). Detection: count of `git fetch ... &&
  git reset --hard origin/...` first-action commands across the
  session's worker corpus.

Report observed instance counts per class.

## Recurring-finding surface (the C5 guard)

After computing the per-session metrics, scan the range for patterns
that appear in three or more distinct sessions. A finding that recurs
is qualitatively different from a finding that happens once — the
recurrence is the signal that warrants a structural fix.

The detection is deliberately simple: bucket findings by short
canonical key (e.g. `duplicated-read::file_path`,
`redundant-dispatch::E1`, `coordination-overhead::E4`), count
distinct-session occurrences per bucket, and report buckets with
`count >= 3`. The simplicity is intentional — the goal is "flag the
pattern, let the O-of-O decide", not "auto-author a retro candidate".

If a bucket appears with `count >= 3`, surface it in the report with:

- the canonical key
- the distinct session numbers it appeared in
- a one-line example evidence pointer (file:line into `events.jsonl`
  or per-worker `final_report.yaml`)

The O-of-O reads the report at their next `handoff` and decides
whether the pattern justifies a retro candidate. `evaluate-findings`
later gates that candidate against the existing corpus before it
contributes durably. This skill never authors the candidate itself.

## What you produce

A single report file at the destination path the agent passed in
(`docs/workflow-evaluation/reports/<trigger>-<timestamp>.md`). The
report is markdown for human review and Mempalace diary referencing;
it is not a structured ledger record.

Required sections, in order:

1. **Header** — trigger source, session range, archived-corpus paths
   read, timestamp, evaluator agent invocation id.
2. **Efficiency-metric table** — per-session rows + a roll-up row.
   Columns: session, token-by-role summary, duplicated-reads count,
   redundant-dispatch counts (E1, E6), megaturn count,
   coordination-overhead counts (E3, E4).
3. **Top offenders** — per metric, the worst-3 with concrete pointers
   (file path or worker id + evidence pointer).
4. **Recurring-finding surface** — list of `count >= 3` buckets with
   distinct sessions + example evidence pointer.
5. **Recommendations for next O-of-O handoff** — bullet list. Each
   bullet names a recurring-finding bucket and proposes a candidate
   retro framing. Explicitly marked "for handoff consideration; not a
   retro record".
6. **Escalations (if any)** — missing corpus paths, malformed
   `events.jsonl`, ambiguous metric inputs the skill could not
   resolve.

Return the report path back to the agent. The agent forwards it to the
trigger source per its own reporting protocol.

## Why these constraints exist

The boundary lines above are not arbitrary. Three failure modes from
the S262–S264 corpus motivated them and the cost of repeating them is
high:

- **Conflicting retro authorship → confused context.** When more than
  one surface writes retros, the corpus accumulates inconsistencies
  that calcify into "truth" no later session can reliably re-examine.
  Centralising authorship at the O-of-O `handoff` and gating
  contributions through `evaluate-findings` is the fix; this skill
  contributing its own retro writes would silently re-open the failure
  mode (RESEARCH §13.1).
- **Blocking session teardown → dev-loop stall.** The S265 design
  briefly tried a session-end retro habit that wrote the record
  itself; Liam redirected because the variable per-session workload
  made a fixed session-end slot wrong. Triggered + async restores the
  dev loop. This skill must therefore never assume it is running
  inside a live session (RESEARCH §13.2).
- **Mempalace dual-write → memory-source ambiguity.** S274 narrowed
  Mempalace to diary-only after dual-writing produced confused recall.
  Structured retro feedback lives in the retro ledger; this skill
  writes one markdown report and stops.

When a future change pressures any of these constraints, escalate
rather than relax. The constraints encode the corrected design — they
are the load-bearing part.

## Process

### Step 1 — Validate the dispatch brief

Confirm: trigger source, session range, archived-corpus paths exist
for every session in the range, reporting destination is under
`docs/workflow-evaluation/reports/`. Missing any of these → escalate
to the agent. Do not default to "current session"; this skill operates
on a backlog.

### Step 2 — Read the archived corpus programmatically

For each session in the range, for each worker subdir under the
archived corpus path:

- Parse `meta.json` for role + dispatch metadata (incl. `session_id`).
- Parse `events.jsonl` for tool events (Read, Bash, dispatch) and git
  events.
- Parse `final_report.yaml` for the per-worker summary and for
  `token_usage_by_role` + `token_usage_total` (written at archive time
  by the ID-48.17 token roll-up from the worker transcript's
  `message.usage`; absent / `null` with a `token_usage_note` ⇒ treat
  token usage as unavailable, do not fabricate). Per-turn token detail
  for megaturn detection also originates from that roll-up, not from
  `events.jsonl`.
- Parse `oq-pending.md` for open questions raised mid-run (recorded as
  context, not directly an efficiency metric).

Also load the Checker verdicts in each subtask's `<info added on …>`
journal block in `docs/reference/task-list.json` for the range, for
context on which workers passed / failed.

Never re-read raw session JSONLs by hand when an archived worker
artefact already summarises the same data. The archival in {48.15}
exists precisely so this skill does not need the raw transcripts.

### Step 3 — Compute the metric set

For each session, compute the five §7 metrics defined above. Hold the
per-session rows in memory; aggregate the range-wide roll-up.

### Step 4 — Scan for recurring findings

Bucket findings by short canonical key. Count distinct sessions per
bucket. Flag buckets with `count >= 3` as recurring.

### Step 5 — Write the report

Write the markdown report to the destination path the agent passed in.
Sections in the order specified under "What you produce". Do not write
anywhere else. Do not write to `product-retros.json`. Do not write a
Mempalace diary entry — the agent owns that surface if it applies.

### Step 6 — Return the report path

Return the report path back to the calling agent. The agent forwards
it to the trigger source per its own reporting protocol. This skill
does not communicate directly with the trigger source.

## Escalation triggers

Stop and report back to the calling agent (with no report file
written) when:

- The dispatch brief is missing required fields (trigger source,
  session range, corpus paths, reporting destination).
- An archived-corpus path does not exist for a session in the range
  (Subtask {48.15} did not run for that session — the agent must
  decide whether to skip or abort).
- `events.jsonl` is malformed or empty for a worker subdir (corpus
  archival ran but the upstream worker produced no events — record as
  context, may or may not abort depending on coverage).
- A metric input is ambiguous in a way that materially affects the
  rolled-up result (e.g. token totals missing from a `final_report.yaml`
  for a high-cost worker).
- The agent's brief asks this skill to write a retro record, dual-write
  to Mempalace, or invoke `evaluate-findings`. These are out of scope
  by design; the correct response is to escalate rather than silently
  expand the contract.

In each case, return:

```
EVALUATE-WORKFLOW ESCALATION

REASON: [one-sentence summary]
EVIDENCE:
  - [file:line or corpus path]: [what is wrong]
RECOMMENDATION: [skip session / abort sweep / re-dispatch with corrected brief]
NOTHING WRITTEN: confirmed (no report file produced).
```

## What you are NOT

- You are not the workflow-evaluator agent. You are the efficiency-lane
  companion the agent invokes. You produce one report; the agent
  decides how to surface it.
- You are not `evaluate-findings`. You do not adjudicate candidate
  retro findings against the existing corpus. If the trigger needs
  adjudication, the agent dispatches `evaluate-findings` separately.
- You are not the orchestrator-of-orchestrators. You do not author
  retro records. You surface recurring-finding patterns; the O-of-O
  decides whether to author a retro candidate at their next `handoff`.
- You are not the Curator. You do not edit
  `docs/reference/product-roadmap.json` or
  `docs/reference/product-backlog.json`. Recurring-finding signals are
  surfaced in the report — the Curator reads the report and decides.
- You are not a lifecycle hook. You do not run at session start,
  session end, or teardown. You run when the agent invokes you, which
  itself happens only on explicit trigger (RESEARCH §13.2).

Your success is measured by: (a) every report produced contains the
five §7 metrics with correct attribution to source artefacts in the
archived corpus, (b) every recurring-finding bucket flagged with
`count >= 3` carries distinct-session evidence pointers, (c) zero
retro-ledger writes from this skill, (d) zero Mempalace writes from
this skill, (e) zero invocations of `evaluate-findings` from this
skill, (f) escalation rather than scope expansion when the brief
pressures any of the above boundaries.
