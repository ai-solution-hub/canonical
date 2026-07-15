# Workflow surface map

Which dev-lifecycle skills and agents depend on which workflow tooling and data shapes.
This is the starting knowledge for a propagation sweep — it is a living record, not a
freeze. When a sweep finds a dependency not listed here, add it.

Roots swept (rediscover, never trust this list blindly):

- canonical `.claude/skills/` (+ each skill's `references/`, `scripts/`)
- canonical `.claude/agents/` (+ `agents/references/`)
- docs-site `.claude/skills/` (+ docs-site `CLAUDE.md`)

Seed re-grep:

```bash
CANON=~/Documents/development/canonical
DOCS=~/Documents/development/knowledge-hub-docs-site
grep -rlnE "ledger-cli|task-list\.json|product-backlog|append-journal|<info added on" \
  "$CANON/.claude/skills" "$CANON/.claude/agents" "$DOCS/.claude/skills" "$DOCS/CLAUDE.md"
```

---

## Tooling & data-shape glossary (the things that go stale)

**`ledger-cli`** — `bun scripts/ledger-cli.ts <verb> …` in the canonical repo, operating on
the ledgers in the docs-site repo. The command surface as currently described across the
surface:

| Verb | Shape as referenced today | Notes |
|------|---------------------------|-------|
| `show <ledger> <id> [--full\|--summary\|--no-journals\|--fields csv]` | record (`ledger`: task\|backlog\|retro; `roadmap`/`umbrellas` are **RETIRED** `<ledger>` values, see below). **S447: DEFAULT is size-shaped ≤48KB** — stubs subtask journals → degrades to summary; `--full` opts out (verbatim) | do NOT treat a bare `show` as journal-complete on large tasks |
| `get <ledger> <id> [field]` | single field; **S447: `get task <N>.<M> [field]` reaches one subtask** (no whole-task fetch); no field = show | |
| `journal <taskId>` / `journal <taskId.subId> [--last n]` | **S447 READ command** — per-subtask index (counts) / chronological thread; `--last` warns on supersession; resolves compaction archive-pointers | start-session, handoff, task-checker |
| `list <ledger> [filters]` | filtered snapshot; **S447: default `list task` roll-up now `{id,title,status,subtasks}`** (subtasks done/total) | start-session, triage-finding |
| `append-journal <taskId[.subId]> <text>` | **WRITE** verb — append `<info added on …>` block to `details` (the read counterpart is `journal`; NOT renamed) | update-roadmap-backlog, cli-mechanics |
| `add-subtask <taskId> …` / `add-subtasks <taskId> --file -` | insert Subtask(s) | task-planner, workflow-curator, triage-finding |
| `update-{backlog,task,subtask}` / `flip-{task,subtask}` | field / status edits (`update-roadmap` is **RETIRED**, see below) | update-roadmap-backlog |
| `schema [ledger|recordKind]` | prints field name + type + budget | triage-finding, field-schemas |
| `show initiatives [id]` / `list initiatives` / `list projects [--initiative <id>]` / `show project <slug>` | **ID-148.6 — initiatives read verbs (landed)** | start-session §2e, workflow-curator |
| `create-project <initiativePath> <projectJson>` / `update-project <slug> <field> <value>` / `delete-project <slug>` (rejects project-not-empty) / `link-tasks`\|`unlink-tasks <slug> <ids…>` / `link-backlog`\|`unlink-backlog <slug> <ids…>` / `move-task`\|`move-backlog <id> --from <slug> --to <slug>` | **ID-148.7 — initiatives write verbs (landed).** Every verb builds a `ServerIntent` routed through the transport — no in-process writer (DR-073/074) | update-roadmap-backlog (no designed Create-mode mapping yet — ID-148.11 ambiguous case) |

**RETIRED verbs (ID-148.8/DR-073/074 — return a clean `retired-verb`/`retired-flag`
envelope, nothing read/written, before any file access):** `update-roadmap` → use the
initiatives project verbs (`update-project` et al.); `create-theme` → use the initiatives
`create-project` verb; `update-umbrella` → **no direct replacement**, the umbrella
surface is fully retired; `show|list roadmap` → use `show|list initiatives`; `show|list
umbrellas` → **no direct replacement**; `promote --capability-theme` → **no replacement
flag**, `capability_theme`/`themes[]` retire with no analog.

**Ledgers** (docs-site `src/content/docs/ledgers/`, addressed via `${KH_PRIVATE_DOCS_DIR}`):
`task-list.json` (multi-MB — slice-read only, never wholesale), `product-backlog.json`,
`product-retros.json`, and the SERVER-managed `initiatives.json` (writes via `ServerIntent`
through the task-view patch-server, no in-process writer, DR-073/074; mirrors are
server-generated — `scripts/regen-mirrors.sh` requests them from task-view, does not
generate them locally). `product-roadmap.json` **no longer exists** — its data was
repurposed server-side into `initiatives.json` (the roadmap ledger's server arm was
REPURPOSED, not deleted — `lib/ledger/detect-schema.ts` registers `kind:'initiatives'`).
`umbrellas.json` remains on disk but is fully unmaintained (file-delete deferred per OQ4)
— do not read or write it.

**Markdown mirrors** — per-record `tasks/`, `backlog/` (and retros) markdown mirrors of the
JSON ledgers. Executors must NOT commit ledger JSONs or their mirrors in a worker branch.

**Journals** — `<info added on YYYY-MM-DDTHH:MM:SS.sssZ>` blocks appended to a Subtask/Task
`details` field. THE canonical home for session-by-session narrative. Written by
`append-journal`; rendered by `show task`.

**Subtask id form** — `N.M` (e.g. `35.38`).

---

## Dependency table — file → what it references

Legend: **cli** = invokes `ledger-cli` verbs · **task-list** = names/reads `task-list.json` ·
**backlog** = names `product-backlog.json` · **journal** = describes `<info added on …>` /
`append-journal` · **mirror** = ledger markdown mirrors.

### canonical `.claude/agents/`

| File | Depends on |
|------|-----------|
| `task-executor.md` | cli (`get task <N>`), task-list, journal (Step 8 appends block), mirror (must not commit) |
| `task-planner.md` | cli (`add-subtasks <taskId> --file -`) |
| `task-checker.md` | journal (reads `<info added on …>` blocks in `details`) |
| `workflow-curator.md` | cli (`show backlog`, `show initiatives`/`list projects` — `show roadmap`/`get roadmap … linked_tasks` are RETIRED — `add-subtask(s)`), task-list, backlog, journal, mirror, slice-read discipline |
| `references/shared-discipline.md` | cli, backlog, journal, mirror + **the server-ledger cutover note (line ~211)** |
| `references/planner-reporting.md` | cli (`add-subtasks <taskId> --file -`) |

### canonical `.claude/skills/`

| File | Depends on |
|------|-----------|
| `start-session/SKILL.md` | cli (`show task`, `get task <field>`, `list task --status/--since`, `list retro --recent`, `list projects`), task-list (multi-MB wholesale warning), initiatives (2e — SERVER-managed), journal |
| `handoff/SKILL.md` | cli (`show task <id>`), journal (`<info added on …>`), mirror |
| `implement-subtask/SKILL.md` | cli (`get task <N>`), task-list (slice-read), journal (appends block) |
| `workflow-orchestration/SKILL.md` | cli (`show task/backlog`), task-list, journal, mirror, slice-read ingress |
| `workflow-orchestration/references/{dispatch-primitives,external-references,lifecycle-detail}.md` | cli (`show task <N>`), task-list |
| `triage-finding/SKILL.md` | cli (`get`/`show <ledger> <id>`, `list task --status`, `add-subtask`, `schema`), journal |
| `triage-finding/references/examples.md` | cli (`list projects`; `show roadmap` retired, examples annotated) |
| `update-roadmap-backlog/SKILL.md` | cli (nearly every backlog/task write verb incl. `append-journal`, `flip-subtask`; roadmap/umbrella verbs retired, annotated in place), task-list, backlog, journal, mirror |
| `update-roadmap-backlog/references/cli-mechanics.md` | cli (verb→command reference table), task-list, backlog, journal |
| `update-roadmap-backlog/references/field-schemas.md` | cli (`schema`), field names/budgets |
| `spec-driven-implementation/SKILL.md` | task-list |
| `write-product-spec/SKILL.md`, `write-tech-spec/SKILL.md` | task-list |
| `session-driver-cmux/SKILL.md` + `scripts/{worktree-pre-commit,launch-worker,oq-*,watch-fleet}.sh` + `oq-brief-fragment.md` | cli, backlog, mirror, journal (worktree ledger mirrors, pre-commit guard) |

### docs-site `.claude/skills/`

| File | Depends on |
|------|-----------|
| `evaluate-workflow/SKILL.md` + `references/metrics.md` | task-list, journal (Checker verdicts in `<info added on …>`), `final_report.yaml` token fields |
| `evaluate-findings/SKILL.md` | `product-retros.json` corpus (adjudication) |
| `check-for-broken-links/SKILL.md` | cli (`update-backlog <id> notes --file -`), backlog |
| `evaluate-workflow/SKILL.md` | reads subtask `<info added on …>` journals directly from `task-list.json` — **compaction-aware**: done-task journals may be archived stubs pointing at `ledgers/archive/ID-N-journals.md` |
| `sync-ledger-context/SKILL.md` | ledger→docs drift back-propagation; docs opt in via `kh_ledger_sources` frontmatter. Referenced from handoff Step 3a, workflow-orchestration decision-register wiring, workflow-curator DR-intent path as the supersession/staleness trigger |

docs-site `CLAUDE.md` — describes GitNexus tooling + the canonical↔docs cross-repo layout;
"mirror" there refers to the ledger mirror-drift parity decision (STAGE2-PARITY-FOLLOWUP).

**Cross-cutting habit:** handoff Step 2 now prompts a `propagate-workflow-change` run before
teardown when a session changed workflow tooling/shapes/process — this skill's own trigger.

---

## In-flight change to watch — server-ledger cutover

`agents/references/shared-discipline.md` (~line 211) already states that gates and mirror
regen are moving **server-side into the task-view patch-server substrate**, superseding the
`ledger-cli`. Spec: `id-90-server-ledger-cutover` (docs-site
`src/content/docs/specs/`). When that cutover lands, EVERY `bun scripts/ledger-cli.ts …`
reference in the table above becomes a propagation target — this is the largest pending sweep
this skill exists to carry.

The S447 read-path additions have **landed** (glossary above updated): `show` shaping flags +
the ≤48KB valve, the `get task <N>.<M>` subtask path, the new `journal` READ command (the read
counterpart to `append-journal`, which is unchanged — NOT a rename), and the `list task`
subtasks roll-up. Propagated into start-session, handoff, implement-subtask, task-executor,
task-checker, workflow-orchestration (+ dispatch-primitives).

**Compaction SessionEnd hook** (`.claude/hooks/ledger-compact-session-end.sh`, wired in
`.claude/settings.json`) archives DONE/CANCELLED-task journals to
`{ledgerDir}/archive/ID-N-journals.md`, leaving archive-pointer stubs in `details`. It runs
automatically and `journal <taskId.subId>` resolves the pointers transparently — no
manual-compaction prose exists in the workflow skills to update.

**umbrellas.json — RETIRED (ID-148.8/DR-073/074, no direct replacement).** Historical
shape: cross-Task strategic groupings (`{id,title,substrate_doc,task_ids[]}`), membership
written via `update-umbrella`, read via `show umbrellas`/`show umbrellas <umbrellaId>`
(S450), surfaced at start-session 2e by scanning `task_ids[]`. All of that is gone —
`update-umbrella` and `show|list umbrellas` return a clean `retired-verb` envelope; the
file remains on disk but is unmaintained (file-delete deferred per OQ4) — **do not read or
write it**. The initiatives → sub-initiatives → projects topology is the replacement
strategic-grouping model (start-session 2e now surfaces the owning Initiative/Project via
`list projects` or a direct `Read` of `initiatives.json`, ~40KB), but there is no
initiatives-side analog of "add this Task to a cross-cutting grouping after the fact" —
`create-project` requires an existing initiative/sub-initiative path and there is no verb
to create a brand-new top-level initiative. This procedural gap is unresolved — see
ID-148.11's ambiguous-cases list.

### ID-148 — initiatives cutover (landed, ID-148.8/DR-073/074)

The roadmap-theme + umbrella surface described above by "RETIRED" tags is the largest
sweep this skill has carried since the S447 read-path additions (previous entry). Landed:
initiatives is a SERVER-managed ledger (no in-process writer, ID-148.7 write verbs are
ServerIntents); `capability_theme`/`themes[]` retire with no analog; `originating_session`
(array) replaces `session_refs` on initiatives-ledger records only — task-list/backlog
`session_refs` usage is UNCHANGED, do not sweep it; `DocLinkSchema` lives at
`lib/validation/doc-link.ts`; `TASK_VIEW_TAG` = `v0.10.1-task-view`. Propagated (ID-148.11)
into: update-roadmap-backlog (+ both references/), propagate-workflow-change (this file),
workflow-orchestration, triage-finding (+ examples.md), start-session, workflow-curator.md,
shared-discipline.md, root CLAUDE.md, plus ~19 docs-site reference docs. **Open gap**: no
curator write path exists for a `decision: roadmap`-shaped finding (no verb creates a new
top-level initiative) — flagged to the owner, not resolved by this sweep.

## Homograph traps (grep over-matches — discard these)

- `chrome-cdp/scripts/cdp.mjs` — "mirror" = CDP/DOM mirror, not a ledger mirror.
- `check-for-broken-links/scripts/check_links.py` — "mirror" is unrelated to ledgers.
- `keep-docs-in-sync`, `review-docs-pr`, `sync-source-docs` — "mirror" = docs mirroring
  source code, a different concept from ledger markdown mirrors.
- `json.dumps(...)` anywhere in `scripts/` — not a ledger `dump`.
- `audit-skill/scripts/detect-drift.sh` — contains `ledger-cli` as a **detector regex
  token**, not an instruction to run it; patch only if the token itself is renamed.
