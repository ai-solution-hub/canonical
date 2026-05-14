---
name: triage-finding
description:
  Decide whether a finding surfaced by a workflow-executor or workflow-checker
  is (a) a subtask of the current task, (b) a roadmap promotion (strategic /
  cross-cutting), (c) a backlog promotion (tactical / single-feature), or
  (d) no-action with justification. Returns a structured decision the
  workflow-curator agent can act on. Triggered by the workflow-curator agent
  when the orchestrator routes a finding for triage.
allowed-tools: Read, Grep, Glob, Bash
---

# triage-finding — Decision Logic for Out-of-Scope Findings

Decides how to route a finding surfaced during workflow execution: keep it inside the current task (subtask), promote to roadmap, promote to backlog, or close as no-action. Returns a structured decision; does **not** perform any writes.

This skill is the decision half of the curator's job. The write half is `update-roadmap-backlog`.

---

## Inputs

The curator agent invokes this skill with a finding packet:

| Field | Description |
|-------|-------------|
| `finding.source` | `workflow-executor` or `workflow-checker` |
| `finding.source_context` | Workpackage ID, branch, commit SHA |
| `finding.description` | The finding itself, verbatim |
| `finding.evidence` | `file:line` references + observed behaviour |
| `finding.source_recommendation` | Source agent's recommendation, if any |
| `task_context.spec_path` | Spec/plan the current task is anchored on |
| `task_context.workpackage_scope` | Current WP scope summary |
| `task_context.acceptance_criteria` | Current WP acceptance criteria |

You also read:

- `docs/reference/product-roadmap.json` — to check for existing coverage and identify candidate sections.
- `docs/reference/product-backlog.json` — to check for existing coverage and identify candidate tracks.

---

## Step 1: Check for existing coverage

Before deciding anything new, grep the roadmap and backlog for the finding's subject area:

```bash
# Use Grep on the JSON files for any term that names the finding's domain
# (e.g. "auth", "design tokens", "barrel exports", whichever applies)
```

If an existing roadmap or backlog item already covers this finding:

- **Decision:** `no-action`
- **Justification:** "Already covered by {item-id} in {file}: {description}"
- Return immediately. Skip steps 2–4.

---

## Step 2: Apply the decision tree

Walk the decision tree in order. Stop at the first match.

**If the case is genuinely ambiguous after walking the tree** (roadmap-vs-backlog unclear, impact radius unclear, "already covered" debatable):

- **If the Advisor tool is available** (Anthropic beta `advisor-tool-2026-03-01`): invoke it before forcing a decision. The advisor sees your full transcript (finding packet + roadmap/backlog reads) and returns advice on the branch-A/B/C/D choice. Record the decision yourself — advisor returns text only, not a write.
- **If advisor is not available**: return `decision: ambiguous` with `ambiguity_reason` and `suggested_resolution`. Do **not** default-promote ambiguous findings — that creates ledger noise. The orchestrator escalates to the product owner.

### Branch A — Is it in-scope for the current task?

A finding is **in-scope** (and therefore a `subtask`) when **any** of these hold:

1. It extends the current workpackage's acceptance criteria (the criterion was implicit but unspecified, and ignoring the finding leaves a hole in the criterion).
2. Closing the current task without addressing it would leave the system in a broken or partially-broken state (i.e. closing the task creates a regression).
3. The finding is a direct consequence of changes the current workpackage is making (e.g. moved a function, finding is "callers of the old location need updating" — those callers were always going to need updating; the finding just enumerates them).

**If yes → Decision: `subtask`.**

Produce a subtask spec:

```yaml
title: "Fix {short description}"
scope: "{specific change required}"
acceptance_criteria:
  - "{measurable condition 1}"
  - "{measurable condition 2}"
suggested_skills:
  - "{kh skill name}: {when to invoke}"
estimated_effort: "{<30min | 30min-1h | 1-2h}"
file_ownership_allowed:
  - "{specific file or glob}"
```

The orchestrator will decide whether to fold the subtask into the current wave or schedule it for a fix wave.

### Branch B — Is it strategic / cross-cutting?

A finding is a **roadmap** candidate when **any** of these hold:

1. It cross-cuts multiple features (touches more than one functional area, e.g. "auth pattern needs to change across all routes").
2. It is strategic — a product-level decision (e.g. "we should support multi-tenant deployments").
3. It is multi-month effort (anything estimated at "weeks" of work that spans feature boundaries).
4. It introduces a new top-level capability (new section under `state-of-the-product.md` §5 Feature State or §8 AI Integration Points).
5. It is a research item that, once resolved, will unblock multiple downstream features.

**If yes → Decision: `roadmap`.**

Identify the target section:

- Look at `docs/reference/product-roadmap.json` `sections[*].id` and `.title` to find the section the finding best fits.
- If no existing section fits, propose a new section (the `update-roadmap-backlog` skill handles the section structure).

Output:

```yaml
roadmap_target_section: "§{N.M}"  # e.g. "§9.15", or "new section" if none fits
section_title_if_new: "{title}"  # only if proposing a new section
```

### Branch C — Is it tactical, single-feature?

A finding is a **backlog** candidate when **all** of these hold:

1. Scope is contained to a single feature area.
2. Effort is "weeks" or smaller (not "months").
3. It is not blocking any currently-active workpackage (otherwise it would be a subtask).
4. The current task is not already touching the same surface (otherwise it would be a subtask).

This is the most common destination for non-blocking out-of-scope findings.

**If yes → Decision: `backlog`.**

Identify the slot:

- Read `docs/reference/product-backlog.json` `items[].track` for the list of existing tracks.
- Identify the right track (`onboarding`, `authentication`, `search`, etc.) or propose a new one.
- Identify the right `type` (`feature` / `research` / etc. — see existing items for examples).

Output:

```yaml
backlog_slot:
  track: "{track-name}"
  type: "feature" | "research" | "infra" | "tech-debt"
  priority: "high" | "medium" | "low"  # default medium unless evidence supports otherwise
  status: "needs_spec" | "needs_research" | "parked" | "ready"
```

### Branch D — None of the above

If none of A, B, C match, the finding does not warrant action.

**Decision: `no-action`.**

Possible reasons:

- "Style preference with no functional impact"
- "Debatable refactor with no clear benefit"
- "Documentation-only nit"
- "Already discussed and intentionally deferred (cite where)"

---

## Step 3: Check for label-reversal flag

**KH currently has roadmap and backlog labelled the wrong way around** (confirmed Session 46). Intended target semantics:

- Roadmap = strategic / cross-cutting / multi-month.
- Backlog = tactical / single-feature / weeks-scope.

The current file naming follows the *legacy* convention. The `triage-finding` decision uses **target** semantics — if you decide `roadmap`, the destination is the *strategic* register, regardless of what filename it currently has. The `update-roadmap-backlog` skill resolves the legacy → target mapping at write time.

**Flag the reversal if your decision contradicts what a naive read of the current files would suggest.** Include a one-line note in your output:

```
FLAG: target/legacy-label mismatch — decision is "{decision}" under target semantics; under legacy file naming this would land in "{opposite-file}". Migration is tracked separately.
```

This is informational only; no edits triggered.

---

## Step 4: Output the decision

Return to the curator agent:

```yaml
decision: subtask | roadmap | backlog | no-action

justification: |
  {one-paragraph explanation of why this decision was reached.
   Cite which branch (A/B/C/D) and which specific criteria triggered it.}

# Branch A populated
subtask_spec:
  title: "..."
  scope: "..."
  acceptance_criteria: ["...", "..."]
  suggested_skills: ["..."]
  estimated_effort: "..."
  file_ownership_allowed: ["..."]

# Branch B populated
roadmap_target_section: "§N.M" | "new"
roadmap_section_title_if_new: "..."

# Branch C populated
backlog_slot:
  track: "..."
  type: "..."
  priority: "..."
  status: "..."

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

- Source task ID (workpackage ID).
- Source commit SHA (if from a checker).
- Session counter (e.g. `kh-prod-readiness-s47`).

The `update-roadmap-backlog` skill attaches this to the resulting ledger entry via the schema-appropriate fields (`session_refs` + `commit_refs` for roadmap; `surfaced` for backlog).

---

## Failure modes to avoid

1. **Defaulting everything to backlog.** Backlog should not be a dumping ground. Use `no-action` when warranted.
2. **Defaulting everything to subtask.** Subtasks balloon the current wave's scope. Use them only when the finding genuinely belongs to the current task.
3. **Promoting style nits to the roadmap.** Roadmap is strategic capability; "rename this variable for clarity" is not roadmap material.
4. **Missing existing coverage.** Always check roadmap + backlog before promoting; duplicates fragment the ledger.
5. **Following legacy file naming when applying decision logic.** Target semantics drive the decision; the write layer reconciles to the current files.

---

## Examples

### Example 1 — Cross-cutting auth pattern

**Finding:** "Found that all routes under `app/api/coverage/` use the old `getAuthorisedClient()` return-shape `{ authorised }` instead of the new `{ success }` pattern. Out of scope for current WP (which is one specific coverage route)."

**Decision walk:**
- Branch A? No — it doesn't extend this WP's criteria; the current WP only touches one route.
- Branch B? Yes — cross-cuts multiple routes, is an infra pattern, weeks of effort.
- **Decision: `roadmap`** under §{auth-infra-section, or new section}.

### Example 2 — Direct consequence of current change

**Finding:** "Renamed `lib/foo/bar.ts` to `lib/foo/baz.ts`. Found 4 callers in `lib/other/...` that still import from the old path."

**Decision walk:**
- Branch A? Yes — directly caused by the current WP's change; leaving callers broken would regress.
- **Decision: `subtask`** with spec to update the 4 callers.

### Example 3 — Style nit

**Finding:** "Variable name `tmpResult` in `lib/foo/bar.ts:42` could be clearer."

**Decision walk:**
- Branch A? No.
- Branch B? No.
- Branch C? Arguable, but no functional value — pure style preference.
- **Decision: `no-action`** with reason "style preference, no functional impact".

### Example 4 — Feature-scoped tech debt

**Finding:** "The search filter component re-renders on every keystroke because of an unstable empty-array default. Out of scope for current WP (which is unrelated to search)."

**Decision walk:**
- Branch A? No — current WP doesn't touch search.
- Branch B? No — single feature (search), not cross-cutting.
- Branch C? Yes — tactical, single-feature, weeks-scope, no current task touches search.
- **Decision: `backlog`** in `track: search`, `type: tech-debt`, `priority: medium`.

---

## What this skill is NOT

- Not a write skill. No file edits; output is a decision only.
- Not a code-review skill. Doesn't audit code; takes a finding as input.
- Not Taskmaster-coupled. No `task-master` commands.

## What hands off to `update-roadmap-backlog`

For `roadmap` and `backlog` decisions, the curator agent immediately invokes `update-roadmap-backlog` with the decision payload as input. That skill performs the actual JSON edit and any pipeline regeneration.
