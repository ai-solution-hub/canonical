---
name: triage-finding
description:
  Decide whether a finding surfaced by a task-executor or task-checker
  is (a) a Subtask of the current Task (ID-N.M), (b) a roadmap promotion
  (strategic / cross-cutting), (c) a backlog promotion (tactical /
  single-feature), or (d) no-action with justification. Decision uses the
  binary in-scope-ness rule: file-path within Subtask file_ownership OR axis
  is spec-compliance against the Subtask slice = IN-SCOPE; else OUT-OF-SCOPE.
  No grey area. Returns a structured decision the workflow-curator agent can
  act on. Triggered by the workflow-curator agent when the orchestrator
  routes a finding for triage.
allowed-tools: Read, Grep, Glob, Bash
---

# triage-finding — Decision Logic for Out-of-Scope Findings

Decides how to route a finding surfaced during workflow execution: keep it inside the current Task as a Subtask (ID-N.M), promote to roadmap, promote to backlog, or close as no-action. Returns a structured decision; does **not** perform any writes.

This skill is the decision half of the curator's job. The write half is `update-roadmap-backlog`.

**Terminology (per s48-feedback B2):** Tasks are addressed by `ID-N` (e.g. `ID-15`); Subtasks by `ID-N.M` (e.g. `ID-15.3`). This convention is consistent across the task list, backlog, roadmap, and all workflow prompts/docs. Earlier phrasing that referred to identifiers as `task` followed by hyphen-id or `subtask` followed by hyphen-id is retired in favour of `ID-N` / `ID-N.M`.

**Ledger CLI (v3) — read-only affordance:** This skill is decision-only and does not write. For targeted reads of a single ledger record (e.g. inspecting a candidate-duplicate's `linked_backlog[]`, `track`, or `priority`), prefer `bun scripts/ledger-cli.ts get <ledger> <id> [field]` or `bun scripts/ledger-cli.ts show <ledger> <id>` (the `Bash` allowed-tool is the channel) over loading the full backlog or full roadmap via `Read` + `Grep`. The CLI command surface is documented in `lib/ledger/README.md`; `bun scripts/ledger-cli.ts schema [ledger|recordKind]` prints each field's name + type + budget so curator decisions (which carry into `update-roadmap-backlog` writes) can be authored against the explicit schema rather than guessed. Subtask subcommands accept a unified dotted id-form `<taskId.subId>` (`update-subtask`, `flip-subtask`, `append-journal`, `delete-subtask`; legacy space-separated `<taskId> <subId>` still works) — see `bun scripts/ledger-cli.ts --help` when handing off to a write-mode skill.

**Field budgets:** Decision payloads carrying free-text fields (`subtask_spec.scope`, `backlog_slot.description`, `roadmap_proposed_theme.description`) are subject to the write-time budgets enforced downstream when `scripts/ledger-cli.ts` is invoked. As of ID-90.22 the budget gate fires server-side in the task-view patch-server substrate (the CLI is the operator surface, the substrate is the enforcement point — invariant 57); the budget thresholds and the `budget-exceeded` reject behaviour are unchanged, so size decision output the same way. The canonical budgets live in `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md` §2/§3 (Task.description ≤1500, Subtask.description ≤250, Subtask.testStrategy ≤300, Subtask.details unbudgeted append-only) — cite that doc when sizing decision output.

---

## Inputs

The curator agent invokes this skill with a finding packet:

| Field | Description |
|-------|-------------|
| `finding.source` | `task-executor` or `task-checker` |
| `finding.source_context` | Task ID-N (or Subtask ID-N.M if surfaced mid-subtask), branch, commit SHA |
| `finding.description` | The finding itself, verbatim |
| `finding.evidence` | `file:line` references + observed behaviour |
| `finding.source_recommendation` | Source agent's recommendation, if any |
| `task_context.spec_path` | Spec/plan the current Task (ID-N) is anchored on |
| `task_context.subtask_scope` | Current Subtask (ID-N.M) scope summary |
| `task_context.subtask_file_ownership` | The Subtask's declared `file_ownership_allowed` globs |
| `task_context.acceptance_criteria` | Current Subtask acceptance criteria |
| `task_context.parent_task_acceptance_criteria` | Parent Task ID-N's `## Acceptance criteria` excerpt (PRODUCT.md). Required input for Branch A predicate 3; the Orchestrator dispatcher MUST populate this — especially at wave close when the source Subtask has promoted to `done` and the Subtask-level fields above are stale. |
| `task_context.sibling_subtask_file_ownership` | Map of `{ subtask_id: file_ownership_allowed_globs }` for pending/in-progress sibling Subtasks under the same parent Task ID-N. Required input for Branch A predicate 3 (file-path arm). |

You also read the roadmap + backlog ledgers (at `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/`) to check for existing coverage — **slice reads only**, never wholesale `Read`:

- Candidate themes / existing coverage: `bun scripts/ledger-cli.ts show roadmap <themeId>`.
- Candidate tracks / existing coverage: `bun scripts/ledger-cli.ts show backlog <itemId>`.

---

## Step 1: Check for existing coverage

Before deciding anything new, check whether the roadmap or backlog already covers the finding's subject area. For record-anchored lookups (e.g. inspecting a candidate-duplicate's `linked_backlog[]` or `track`), use `bun scripts/ledger-cli.ts get <ledger> <id> [field]` / `show <ledger> <id>` (slice reads — see `lib/ledger/README.md` `read` group). For a thematic sweep across a ledger, `grep` the ledger JSON under `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/` for the term that names the finding's domain (`auth`, `design tokens`, `barrel exports`, etc.) — cheaper than a wholesale `Read`.

If an existing roadmap or backlog item already covers this finding:

- **Decision:** `no-action`
- **Justification:** "Already covered by {item-id} in {file}: {description}"
- Return immediately. Skip steps 2–4.

<!-- code-intel:curator-pregrep-start -->
### Caller-count pre-grep (Inv-8)

Before proceeding to Step 2, if the finding's evidence names a specific symbol (function, class, or method), run a caller-count check to inform the Branch B vs Branch C routing that follows. This step is informational — it does not override the decision tree — but it ensures the impact radius is recorded and reduces routing ambiguity between roadmap (multi-month, cross-cutting) and backlog (single-feature, tactical).

**Invocation pattern:**

```bash
# Step 1a: GitNexus graph-level caller count
gitnexus_context({name: '<symbolName>'})

# Step 1b: AST-level caller sweep (catches callers not indexed by GitNexus)
# ast-dataflow callers <symbolName>
bun scripts/ast-dataflow-cli.ts callers <symbolName>
```

Consult `.gitnexus/CLAUDE.md` for GitNexus tool usage conventions. Consult `.ast-dataflow/CLAUDE.md` for ast-dataflow query selection and CLI invocation patterns. Do not copy guide content inline — follow the linked files.

**Threshold for routing:**

- **≥ 10 callers across ≥ 3 modules** — the symbol has broad reach; the finding is more likely to be cross-cutting and multi-month in character. This is a signal that routes to **Branch B** (roadmap promotion — new capability theme) unless the finding's subject is clearly contained to a single feature area.
- **< 10 callers OR contained to ≤ 2 modules** — the symbol has narrow reach; the finding is more likely to be tactical and single-feature in character. This is a signal that routes to **Branch C** (backlog promotion — active work item) unless the finding's subject is genuinely cross-cutting at the headline level.

These thresholds are signals, not hard gates. The full Branch B / Branch C criteria in Step 2 govern the final decision. The caller-count check informs the "multi-month or cross-cutting" vs "weeks or smaller" judgement — do not short-circuit Step 2.

**Record the count.** Write the result into the ledger entry's `notes` field as:

> gitnexus caller count at triage: N callers across M modules

This ensures the routing rationale is visible in the ledger and the curator can reconstruct why a finding went to Branch B vs Branch C without re-running the analysis.
<!-- code-intel:curator-pregrep-end -->

---

## Step 2: Apply the decision tree

Walk the decision tree in order. Stop at the first match.

**Green-baseline rule — NEVER backlog a CI-red regression (top-of-tree gate):** A CI-red / failing-CI-job / baseline-guard breach (knip, agents-md-shape, reference-doc-paths) / build-break (`tsc`) regression is **never** routed to the backlog. It is an in-scope Subtask of the active Task (or of a dedicated baseline-health Task) and MUST be held open until the baseline is green again. The backlog is only for tactical future improvements that do NOT block the current green baseline. *Precedent: CI-red/guard breaches parked in backlog let a `tsc` build-break hide on `main` for ~4 sessions inside known-red CI.*

**Committed-work rule — concrete defects go to the Task List, not the backlog (per `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md` §0):** A finding that is *committed* work — a discovered defect/regression we will fix, or a scoped fix on a committed path (e.g. the critical path) — routes to the **Task List** (a new Task, or a Subtask if in-scope per Branch A), NOT the backlog. Branch C (backlog) is for *uncommitted candidates* only: items that still need a product/prioritisation decision before they would be worked. The commitment test: *have we committed to doing this?* Yes → Task List; not yet → Backlog.

**Recurrence rule — is this a recurrence of a prior flagged finding? → Task List, not backlog (per `task-list-discipline.md` §0; A3 resolve-at-source loop):** Before walking Branch A, ask: *is this finding a recurrence of one the `evaluate-workflow` recurring-finding surface has already flagged* — the same canonical key seen across ≥3 distinct sessions (e.g. the `recurring-issue-thrash` flag)? A recurrence-class finding is **committed work** per §0: the recurrence itself is the signal that the root cause must be fixed at source (a skill, a dispatch-brief template, or a CLAUDE.md gotcha), and that source fix is work we commit to, not an uncommitted candidate. So it routes to the **Task List** — a fix-at-source Subtask under the owning Task, or a new Task — NOT the backlog. This is the triage entry point for the A3 resolve-at-source loop: the loop's *fix at source* step lands as a Task-List item, never a backlog park. *Do not* re-route a recurrence the O-of-O has already marked `ignored` / `won't-fix` unless it is **materially different** (a different root cause or a wider blast radius) — an identical recurrence of a won't-fix finding is `no-action` (Branch D), not a fresh Task.

**Liam-driven promote (no finding source) — short-circuit at the top of the tree (per S62E sub-o 2 §2 carry-forward):**

This skill's canonical input is a finding packet from a `task-executor` or `task-checker`. However, the workflow-orchestration skill (or Orchestrator directly per S60 ratification) may invoke this skill on a backlog item being picked up for implementation — there is no finding source, only an Orchestrator-or-Liam decision to promote. When invoked under that shape:

- `finding.source` is set to `orchestrator-direct` (or `liam-direct`); `finding.source_context` carries the backlog item id; `finding.description` carries the Orchestrator's promotion rationale; `finding.evidence` is empty or carries the backlog item's existing `notes`.
- **Decision is short-circuit:** `decision: subtask` (Promote target = task-list) when Liam direction names a parent Task; `decision: roadmap`/`backlog` are NOT reachable from a Liam-driven promote (the item is already on the backlog). The actual Promote write is performed by `update-roadmap-backlog` Promote mode, which fires `bun scripts/ledger-cli.ts promote <backlogId> <taskJson>` — the atomic backlog-delete + task-create write. The skill never invokes that CLI directly.
- The decision-tree's binary in-scope-ness check (Branch A) and Branches B/C/D do NOT run in this mode — the promotion is the entire decision.
- Output: `decision: subtask` with `subtask_spec` populated from the backlog item's load-bearing fields (description → title; existing `details` → scope; existing `testStrategy` if present). Set `in_scope_predicate_matched: "liam-direction"`.

**If the case is genuinely ambiguous after walking the tree** (roadmap-vs-backlog unclear, impact radius unclear, "already covered" debatable):

- **If the Advisor tool is available** (Anthropic beta `advisor-tool-2026-03-01`): invoke it before forcing a decision. The advisor sees your full transcript (finding packet + roadmap/backlog reads) and returns advice on the branch-A/B/C/D choice. Record the decision yourself — advisor returns text only, not a write.
- **If advisor is not available**: return `decision: ambiguous` with `ambiguity_reason` and `suggested_resolution`. Do **not** default-promote ambiguous findings — that creates ledger noise. The orchestrator escalates to the product owner.

### Branch A — Is it in-scope for the current Subtask? (binary rule)

**Binary in-scope-ness rule (per s48-feedback B10; parent-Task-AC predicate added per S62F-WP3 audit):**

A finding is **IN-SCOPE** (and therefore routed as a Subtask under the current Task ID-N) when **any** of these predicates holds:

1. **File-path predicate** — The finding's evidence `file:line` references fall **within the current Subtask's declared `file_ownership_allowed` globs** (`task_context.subtask_file_ownership`).
2. **Axis predicate** — The finding is a **spec-compliance issue against the current Subtask slice** (the implementation diverges from `task_context.spec_path` for the slice the current Subtask is delivering, or fails one of the Subtask's `acceptance_criteria`).
3. **Parent-Task-AC predicate** — The finding's evidence demonstrates a failure of one of the **parent Task ID-N's acceptance criteria** (per the Task's spec PRODUCT.md `## Acceptance criteria` section), OR the finding's `file:line` evidence falls within a **sibling pending/in-progress Subtask's** declared `file_ownership_allowed` globs under the same Task ID-N. In this case, route as a new Subtask ID-N.M under Task ID-N (NOT under the current closed Subtask). This predicate is the dominant Branch A path at wave close, when the source Subtask has already promoted to `done` and the file-path / axis predicates against the closed Subtask context are vacuously empty.

If **any** predicate holds → IN-SCOPE → **Decision: `subtask`**.
If **none** of the predicates hold → OUT-OF-SCOPE → continue to Branch B / C / D.

**No grey area.** There is no fourth "judgement call" path. If the finding does not pass file-path, axis, or parent-Task-AC, it is out-of-scope by definition — even if the executor "noticed it while in the area" or it "feels related". Out-of-scope findings route to Branch B, C, or D per the cross-cutting / tactical / no-action criteria below.

The intent of the binary rule is to preserve task-driven discipline: the current Subtask has a tightly-bounded scope, and findings that fall outside that boundary belong on a different ledger entry (Subtask under another Task, backlog item, or roadmap entry).

**Produce a Subtask spec when Branch A matches:**

```yaml
title: "Fix {short description}"
parent_task_id: "ID-N"  # the current Task; the new Subtask will be allocated ID-N.M
scope: "{specific change required}"
acceptance_criteria:
  - "{measurable condition 1}"
  - "{measurable condition 2}"
suggested_skills:
  - "{kh skill name}: {when to invoke}"
estimated_effort: "{<30min | 30min-1h | 1-2h}"
file_ownership_allowed:
  - "{specific file or glob}"
in_scope_predicate_matched: "file-path" | "axis" | "parent-task-ac"  # which of the binary predicates triggered
```

The orchestrator allocates the new Subtask ID-N.M and decides whether to fold it into the current wave or schedule it for a fix wave.

> **Write substrate (downstream — informational):** The Orchestrator or `update-roadmap-backlog` materialises this spec via `bun scripts/ledger-cli.ts add-subtask <parent_task_id> --title <…> --description <…> --test-strategy <…> [--depends N,M]` (see `lib/ledger/README.md`). Omit `--id` — auto-id allocates the next available integer per Task. Keep `scope` + `acceptance_criteria` within the field budgets (see preamble) so the write does not hard-reject.

### Branch B — Is it a new capability theme? (Shape A — "capability theme promotion")

Reached only when Branch A's binary in-scope-ness rule returned OUT-OF-SCOPE.

Under Shape A (per `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/id-30-roadmap-backlog-consolidation/PRODUCT.md` inv 13 a + TECH §4.1), the Roadmap is a flat list of **themes** — multi-month capability areas, each with `linked_tasks[]` and `linked_backlog[]` chaining out to active work items. Branch B is reserved exclusively for findings that surface a **new capability theme not already on the Roadmap**.

A finding routes to Branch B when **both** of these hold:

1. **Not covered by an existing theme.** Inspect roadmap themes via `bun scripts/ledger-cli.ts show roadmap <themeId>` (slice read). The finding's subject is NOT covered by any existing theme's `linked_tasks[]` or `linked_backlog[]` chain (i.e. no existing theme already enumerates this capability area in its linked work). If the finding extends a theme's existing chain, it is Branch C (active work item) not Branch B.
2. **Multi-month or cross-cutting capability.** The capability is genuinely multi-month in scope OR cross-cuts multiple feature areas at the headline level (e.g. "support multi-tenant deployments", "ship sales-proposal as a sibling application"). Single-feature/weeks-scope items are Branch C, even if they touch territory adjacent to an existing theme.

**If both hold → Decision: `roadmap`.**

Propose the theme shape (the `update-roadmap-backlog` skill Create-mode populates the full RoadmapThemeSchema fields):

```yaml
roadmap_proposed_theme:
  title: "{short capability name — e.g. 'multi-tenant deployments'}"
  description: "{multi-sentence Markdown — why this capability matters; outcome shape}"
  time_horizon: "later"  # default per PRODUCT inv 13 a + P-OQ-2; curator may revise to now | next
  initial_linked_tasks: ["{source_task_id, if relevant}"]  # may be empty
  initial_linked_backlog: []  # empty by default; populated as backlog items accumulate
```

The curator (via `update-roadmap-backlog` Create) appends the theme to `themes[]`, populates `id` from next-free-bare-digit, and fills required schema fields (`status: "pending"` default per P-OQ-1; `session_refs` / `commit_refs` from provenance).

> If only condition 1 OR only condition 2 holds — e.g. uncovered but single-feature/weeks — route to Branch C as a `backlog` candidate. Branch B is for **new theme** introductions; existing themes accept new linked work via Branch C.

### Branch C — Is it an active work item? (Shape A — "active work item promotion")

Reached only when Branches A and B did not match.

A finding is a **backlog** candidate when **all** of these hold:

1. Scope is contained to a single feature area.
2. Effort is "weeks" or smaller (not "months").
3. No sibling pending/in-progress Subtask under any active Task ID-N owns the affected surface (otherwise Branch A's parent-Task-AC predicate would have matched).
4. The finding does not cause any active Task ID-N's `## Acceptance criteria` to fail (otherwise Branch A's parent-Task-AC predicate would have matched).
5. The current Subtask ID-N.M is not already touching the same surface (otherwise Branch A's file-path predicate would have matched).

This is the most common destination for non-blocking out-of-scope findings. Under Shape A (per PRODUCT inv 13 b + TECH §4.1), Branch C output gains `rank` — the within-priority-tier deterministic ordering integer (PRODUCT inv 3). The curator may set `rank` explicitly when the finding's evidence carries an obvious ordering signal; otherwise it defaults to `null` and the curator (or `update-roadmap-backlog` Update mode) sets it later.

**If yes → Decision: `backlog`.**

Identify the slot:

- Inspect existing backlog items via `bun scripts/ledger-cli.ts show backlog <itemId>` (slice read) to learn the `track` values in use.
- Identify the right track (`onboarding`, `authentication`, `search`, etc.) or propose a new one.
- Identify the right `type` (`feature` / `research` / etc. — see existing items for examples).

Output:

```yaml
backlog_slot:
  track: "{track-name}"
  type: "feature" | "research" | "infra" | "tech_debt"
  priority: "high" | "medium" | "low"  # default medium unless evidence supports otherwise
  status: "spec_needed" | "needs_research" | "parked" | "ready"
  rank: null | {integer}  # default null per PRODUCT inv 3; set explicitly if ordering signal present
```

> `rank` default is `null`. The schema does NOT enforce uniqueness or contiguity within a priority tier (PRODUCT inv 3); the `update-roadmap-backlog` Create / Update flows enforce discipline via the auto-shift collision policy (P-OQ-3 default).

### Branch D — None of the above

If none of A, B, C match, the finding does not warrant action.

**Decision: `no-action`.**

Possible reasons:

- "Style preference with no functional impact"
- "Debatable refactor with no clear benefit"
- "Documentation-only nit"
- "Already discussed and intentionally deferred (cite where)"

---

## Step 3: Output the decision

> **Write-time gates (downstream — informational):** The decision payload's downstream consumer (`update-roadmap-backlog` → `scripts/ledger-cli.ts`) enforces field budgets per {35.17} and the record-set delta per {35.16}; over-budget fields hard-reject unless `--force` is explicitly passed. Compose `subtask_spec.scope`, `backlog_slot.description`, and `roadmap_proposed_theme.description` within budget so the write succeeds first-try. Field budgets and write semantics live in `${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/task-list-discipline.md` §2/§3.

Return to the curator agent:

```yaml
decision: subtask | roadmap | backlog | no-action

justification: |
  {one-paragraph explanation of why this decision was reached.
   Cite which branch (A/B/C/D) and which specific criteria triggered it.}

# Branch A populated (also short-circuit Liam-driven promote — see Step 2 preamble)
subtask_spec:
  title: "..."
  scope: "..."
  acceptance_criteria: ["...", "..."]
  suggested_skills: ["..."]
  estimated_effort: "..."
  file_ownership_allowed: ["..."]
  in_scope_predicate_matched: "file-path" | "axis" | "parent-task-ac" | "liam-direction"

# Branch B populated (Shape A — capability theme promotion)
roadmap_proposed_theme:
  title: "..."
  description: "..."
  time_horizon: "now" | "next" | "later"  # default "later"
  initial_linked_tasks: ["..."]
  initial_linked_backlog: ["..."]

# Branch C populated (Shape A — active work item promotion)
backlog_slot:
  track: "..."
  type: "..."
  priority: "..."
  status: "..."
  rank: null | {integer}

# Branch D populated
noaction_reason: "..."
noaction_cross_reference: "{existing-item-id} in {file}" | null

# Optional flag
label_reversal_flag: "FLAG: ..." | null
```

Only the field set for the chosen branch should be populated; others should be `null` or omitted.

---

## Provenance handoff

You do not write provenance yourself, but the curator passes your decision to `update-roadmap-backlog` along with the source context:

- Source Task / Subtask ID (`ID-N` if surfaced at Task level; `ID-N.M` if surfaced mid-Subtask).
- Source commit SHA (if from a checker).
- Session counter (e.g. `kh-prod-readiness-s47`).

The `update-roadmap-backlog` skill attaches this to the resulting ledger entry via the schema-appropriate fields. Under the current `BacklogItemSchema` and `RoadmapThemeSchema`, both surfaces use `session_refs` + `commit_refs` (verified against `lib/validation/backlog-schema.ts` lines 132–138 and `lib/validation/roadmap-schema.ts` lines 146–148). The earlier `surfaced` field name is a stale pre-v2 reference and has been retired.

> **CLI input shape:** When provenance fields are involved, the curator-side input going INTO `update-roadmap-backlog` should be a JSON object (positional-JSON or `--file <path>`), not flag-by-flag — the CLI's named-flag mode covers only a subset of fields (per `bun scripts/ledger-cli.ts --help`: `--title --description --status --depends 1,2 --priority --id`), and `--session-refs` / `--commit-refs` are NOT named flags.

---

## Failure modes to avoid

1. **Defaulting everything to backlog.** Backlog should not be a dumping ground. Use `no-action` when warranted.
2. **Defaulting everything to subtask.** Subtasks balloon the current Task ID-N's scope. Apply the binary in-scope-ness rule strictly — `subtask` requires **file-path within `subtask_file_ownership`, OR axis = spec-compliance against the Subtask slice, OR parent-Task-AC = a parent-Task acceptance-criterion failure or sibling-Subtask file-ownership hit**. Anything else is OUT-OF-SCOPE.
3. **Promoting style nits to the roadmap.** Roadmap is strategic capability; "rename this variable for clarity" is not roadmap material.
4. **Missing existing coverage.** Always check roadmap + backlog before promoting; duplicates fragment the ledger.
5. **Following legacy file naming when applying decision logic.** Target semantics drive the decision; the write layer (`bun scripts/ledger-cli.ts` invoked via `update-roadmap-backlog`) reconciles to the current ledgers (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/{task-list,product-roadmap,product-backlog}.json`).
6. **Inventing a grey-area "judgement call" for Branch A.** The binary rule is intentional (per s48-feedback B10). If the executor "noticed it while in the area" but the file-path is outside `subtask_file_ownership`, the finding is not a spec-compliance issue against the Subtask slice, and the parent-Task-AC predicate also does not hold, it is OUT-OF-SCOPE. Route to B / C / D.
7. **Routing a tactical item to Branch B — it belongs on Backlog.** Under Shape A (per PRODUCT inv 13 a + TECH §4.1), Branch B = **new capability theme** only. A single-feature finding routes to Branch C even if it touches a theme's `linked_backlog` area or extends a theme's `linked_tasks[]` chain. Adding work to an existing theme is NOT a Branch B event — it is Branch C creating a backlog entry that the curator (or update-roadmap-backlog Update mode) later links into the theme. Only genuinely-new capability theme introductions justify Branch B.
8. **Treating wave-close findings as fully OOS when the current Subtask is closed.** When the orchestrator routes a wave-close batch where the source Subtask has already promoted to `done`, the curator MUST re-anchor Branch A on (a) sibling pending/in-progress Subtasks under the same parent Task ID-N, and (b) the parent Task's `## Acceptance criteria` (Branch A predicate 3). Treating the empty "current Subtask" context as definitively OOS produces false-negative Branch A misses (per S62F-WP3 audit — items 152/153/154 routed to backlog despite blocking ID-9 Third-1 acceptance).
9. **Demoting a started/in-flight Subtask to the backlog at session close.** Do NOT demote a started/in-flight Subtask to the backlog at session close. In-flight Subtasks carry over across session boundaries as `in_progress`/`pending` Subtask records — committed work stays on the Task List; the backlog is only for not-yet-committed ideas.

---

## Examples

Five worked decision walks — one per branch outcome (cross-cutting → roadmap; rename consequence → subtask; style nit → subtask/no-action; feature tech-debt → backlog; new capability → roadmap) — live in [references/examples.md](references/examples.md).

---

## What this skill is NOT

- Not a write skill. No file edits; output is a decision only.
- Not a code-review skill. Doesn't audit code; takes a finding as input.
- Not Taskmaster-coupled. No `task-master` commands.

## What hands off to `update-roadmap-backlog`

For `roadmap` and `backlog` decisions, the curator agent immediately invokes `update-roadmap-backlog` with the decision payload as input. That skill performs the actual JSON edit and any pipeline regeneration.
