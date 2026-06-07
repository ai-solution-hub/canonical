# cmux Sub-Orchestrator Brief — S274 / ID-48 selective (48.3, 48.11, 48.12, 48.4) + S271 delta apply

**Worker name:** `subo-id-48-selective` **Parent tip SHA:** `f63aba0a` **Worker branch:**
`cmux-worker-subo-id-48-selective-<auto>` **Role:** SUB-ORCHESTRATOR (not leaf worker)

## READ FIRST (in order)

1. `docs/reference/task-list.json` — ID-48 record (currently `pending`; 13 Subtasks
   listed).
2. `docs/specs/workflow-evaluation/RESEARCH.md` — read ENTIRELY incl. §13 S271 addendum
   (authoritative where it conflicts with §3/§5/§11).
3. `docs/specs/workflow-evaluation/PLAN.md` — read ENTIRELY incl. S271 ADDENDUM (lines
   66-128 = prose deltas NOT yet applied to ledger).
4. `docs/specs/workflow-evaluation/feedback-dossier-S264.md` — Liam's original feedback
   inputs (§4.G retro-habit; §5 OQs).
5. `docs/themes/workflow-orchestration/memory-transcript.md` — design seed for
   `evaluate-findings` skill (Reddit offline-maintenance / conflict-resolution pattern).
6. `.claude/skills/workflow-orchestration/SKILL.md`,
   `.claude/skills/update-skill/SKILL.md`, `.claude/skills/agent-development/SKILL.md`,
   `.claude/skills/create-skill/SKILL.md`.

## CRITICAL — Liam S274 corrections (must be reflected before child dispatch)

1. **Retro authoring belongs to O-of-O, NOT evaluator** (S271 addendum §13.1; user
   re-confirmed S274). Evaluator GATES what enters durable corpus via `evaluate-findings`
   skill. {48.5} description in task-list.json currently still carries the OLD scope
   ("6-category retro-fill + dual-write to retro ledger and Mempalace diary") — this MUST
   be corrected before any Phase 2 dispatch.
2. **Mempalace is for diary entries only — NOT structured retro feedback.** Structured
   retros live in the retro ledger (`product-retros.json`). User S274: "we won't be
   putting structured retro feedback into mempalace. That would instead be something that
   we add to the retro ledger." → Any dual-write language that survived in the live ledger
   or in any child Executor brief MUST be stripped.

## Scope — Phase 0 ledger delta apply (FIRST ACTION; per Liam S274)

Before dispatching ANY Phase 2 Executor, you apply the S271 + S274 ledger deltas via the
ledger CLI on your worker branch:

1. **Update {48.5} description** — re-scope per PLAN.md S271 addendum line 96-99:
   > "Author the workflow-evaluator capability as a TRIGGERED / ASYNC agent+skill combo
   > (RESEARCH §13). Companion skill `evaluate-workflow` narrowed to efficiency-metrics +
   > recurring-finding surfacing; it does NOT write the retro record (O-of-O `handoff`
   > owns authoring). Triggered/async dispatch, never blocking session-end. Re-baseline
   > build-phase order: `prompt-engineering` → `agent-development` → `create-skill`."
   - Also update {48.5} description to drop any "dual-write to Mempalace" language.
     Mempalace is diary-only.
2. **Add {48.14} — `evaluate-findings` skill** (NEW Subtask per PLAN.md S271 line
   102-103):
   - Title: `evaluate-findings skill — adjudication playbook for retro candidate findings`
   - Description:
     `Per RESEARCH §13.3 + memory-transcript.md design seed: candidate-select → similarity-pair → 3-verdict forced choice (deprecate_existing / deprecate_candidate / keep_both) → recency guard → staged writes → soft-delete with supersedingRecordId → batch-stamp last_conflict_check. Triggered by workflow-evaluator. Owned by evaluator (gates corpus); does NOT author retro records (O-of-O owns).`
   - testStrategy:
     `.claude/skills/evaluate-findings/SKILL.md exists; running on a sample candidate vs corpus produces a verdict + recency-guard trace + soft-delete entry.`
   - dependencies: `[3]` (needs 48.3 retro schema fields).
   - Status: `pending`.
3. **Add {48.15} — worker-corpus archival** (NEW per PLAN.md S271 line 104-107):
   - Title: `worker-corpus archival — stop-worker.sh --archive flag (pull forward)`
   - Description:
     `Promote {48.2} S266 fold-in #2: a --archive <dir> flag on stop-worker.sh archives {events.jsonl, oq-pending.md, final_report.yaml, meta.json} to docs/workflow-evaluation/sessions/S<NNN>/<worker>/ BEFORE teardown rm -rf. Data dependency for {48.14} adjudication corpus. Pull forward to run alongside Cluster 4.`
   - testStrategy:
     `stop-worker.sh --archive docs/workflow-evaluation/sessions/S<NNN>/ archives the 4 files before teardown; teardown still completes.`
   - dependencies: `[]`.
   - Status: `pending`.
4. **Commit Phase 0 delta** on your worker branch with a conventional commit like
   `chore(ledger): ID-48 — apply S271 + S274 deltas (rescope 48.5, add 48.14 + 48.15)`.

## Scope — Phase 1+ child Executor dispatches (after delta-apply commit)

The 4 Subtasks Liam directed for THIS session, in dependency order:

### {48.11} Hook 1 — sentinel-gated agent/skill edits (deps: `[]`)

- Dispatch ONE `task-executor` via `implement-subtask`.
- Surface: `.claude/hooks/` (PreToolUse hook for `.claude/agents|skills` edits requiring
  recent `create-skill`/`update-skill`/`agent-development` sentinel) + relevant skill
  bodies (sentinel-write on invocation).
- testStrategy: editing without sentinel blocked; with sentinel allowed.
- `task-checker` gate.

### {48.12} Hook 2 — scoped sandbox + prettier pre-commit (deps: `[11]` — dependency on 48.11 lands first)

- Dispatch ONE `task-executor` via `implement-subtask`.
- Surface: `.claude/settings.local.json` (scoped `dangerouslyDisableSandbox` for new
  skill-dir creation) + `.claude/skills/session-driver-cmux/scripts/launch-worker.sh` (or
  worktree hook script) to wire prettier pre-commit into agent worktrees.
- testStrategy: new `.claude/skills/<dir>/` no longer triggers sandbox prompt; agent
  worktrees have prettier hook.
- `task-checker` gate.

### {48.3} Retro ledger surface (deps: `[]`)

- Dispatch ONE `task-executor` via `implement-subtask`.
- Surface: `lib/validation/retro-schema.ts` (NEW), `docs/reference/product-retros.json`
  (NEW, ≥1 record S264 migrated), per-record mirrors at `docs/reference/retros/S<NNN>.md`,
  freshness/shape guard test.
- **CRITICAL** (S271 RESEARCH §13.4 — cheap-now-expensive-to-retrofit): RetroRecordSchema
  MUST include the soft-delete / adjudication fields from the outset:
  `deprecated: boolean`, `deprecation_reason: string | null`,
  `superseding_record_id: string | null`, `last_conflict_check: timestamp | null`. These
  power {48.14} `evaluate-findings` later — don't omit.
- Migrate `docs/specs/workflow-evaluation/retro-S264.md` as the first record.
- testStrategy per ledger 48.3 record + the 4 new fields.
- `task-checker` gate.

### {48.4} Conventions — RESEARCH.md naming + ID-prefixed spec dirs (deps: `[]`)

Per Liam S274: "For 48.4, I updated any files during the recent cleanup which should have
been named RESEARCH.md - just need to check that the convention exists for new files.
Preference would be to update existing spec folders with the ID-prefix - sub-o to check
whether any of the new ID-9 doc skills would help here."

- Dispatch ONE `task-executor` via `implement-subtask`.
- Sub-task work:
  1. **Audit step**: scan `docs/specs/*/` for any non-RESEARCH.md-named research artefacts
     (e.g., `research.md`, `*-research.md`). Liam already updated some during cleanup —
     confirm convention IS adopted for new files (forward convention). Codify in
     `.claude/skills/spec-driven-implementation/SKILL.md` or `CLAUDE.md` if not already.
  2. **ID-prefix folder convention**: rename existing spec folders to include ID-prefix
     (e.g., `docs/specs/id-52-form-extraction/` → `docs/specs/ID-52-form-extraction/`).
     USER PREFERENCE: update existing folders (not just forward) — but verify scope vs
     link-graph blast radius (use GitNexus impact-analysis + ast-dataflow rename-sweep
     skill for any rename).
  3. **Check ID-9 doc skills** — per Liam: "check whether any of the new ID-9 doc skills
     would help here." Inspect ID-9 outputs (e.g., `keep-docs-in-sync`,
     `sync-source-docs`, `missing-docs`, the docubot pipeline) for relevance to
     spec-folder renames.
  4. The 2 renames Liam called out in 48.4 testStrategy:
     `docs/research/docs-site-rebuild-research.md` → `docs/specs/ID-9-<slug>/RESEARCH.md`;
     and `docs/specs/workflow-evaluation/` → `docs/specs/id-48-workflow-evaluation/`
     (post-investigation).
- testStrategy per ledger 48.4 record + ID-prefix convention surface check.
- Use `ast-dataflow rename-sweep` after any rename to catch all references.
- `task-checker` gate.

## OUT-OF-SCOPE for THIS sub-orchestrator

- {48.5}, {48.6}, {48.7}, {48.8}, {48.9}, {48.10}, {48.13} — NOT this session. Other
  Subtasks remain `pending` after Phase 0 delta-apply.
- {48.14}, {48.15} — created in Phase 0 but NOT implemented this session (impl is S275+).

## Operating constraints — REQUIRED

- **You are SUB-ORCHESTRATOR.** Planner / Executor / Checker dispatches only.
- **You own ALL ledger writes.** All Phase 0 deltas + Subtask journal blocks go via ledger
  CLI on your worker branch.
- **No `AskUserQuestion` — NESTED-AGENT BAN.**
- **Cherry-pick safety:** child Executor first action =
  `git fetch origin main && git reset --hard origin/main`.
- **GitNexus discipline:** Executors run `gitnexus_impact` before edits.
- **ledger CLI gotchas** (from `id52-final.yaml.ledger_cli_defects`):
  - `add-subtask` stdout is 34–67 KB (warnings dump) — suppress with `> /dev/null` +
    verify via `get`.
  - `--depends` / `--id` named flags coerce to number despite string schema — omit; use
    auto-id; cross-link in description.
  - `update-subtask <id> status_note` — note `status_note` is Task-level only, not
    Subtask.
- **Final report.** Before `/exit`, write `<events_dir>/final_report.yaml` with:
  `summary`, `phase_0_deltas_commit`, `subtasks_implemented` (48.11, 48.12, 48.3, 48.4),
  `subtasks_created` (48.14, 48.15), `commits_chain`, `OQs_for_parent`, `renames_applied`
  (full path before→after list).

## Success criteria

- Phase 0 delta-apply commit landed on worker branch (48.5 rescoped; 48.14 + 48.15 added).
- 48.11 + 48.12 + 48.3 + 48.4 done (4 Subtasks).
- 48.4 renames: 2 spec folders renamed with ID-prefix + ID-9 RESEARCH.md rename; all
  references updated (ast-dataflow rename-sweep PASS).
- 48.3 RetroRecordSchema includes 4 soft-delete fields from the outset.
- Final report YAML present.

## DO NOT

- DO NOT implement {48.5}, {48.6}, {48.7+} — out of session scope.
- DO NOT dual-write retro content to Mempalace — that's the corrected scope.
- DO NOT touch any Task other than ID-48 in `task-list.json`.
- DO NOT push to `origin`.
- DO NOT batch the 4 impl Subtasks into one Executor — one Executor per Subtask (parallel
  where deps allow: {48.11} and {48.3} and {48.4} can dispatch in parallel; {48.12} waits
  on {48.11}).
