---
name: triage-finding
description:
  Decide whether a finding surfaced by a task-executor or workflow-checker
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

---

## Inputs

The curator agent invokes this skill with a finding packet:

| Field | Description |
|-------|-------------|
| `finding.source` | `task-executor` or `workflow-checker` |
| `finding.source_context` | Task ID-N (or Subtask ID-N.M if surfaced mid-subtask), branch, commit SHA |
| `finding.description` | The finding itself, verbatim |
| `finding.evidence` | `file:line` references + observed behaviour |
| `finding.source_recommendation` | Source agent's recommendation, if any |
| `task_context.spec_path` | Spec/plan the current Task (ID-N) is anchored on |
| `task_context.subtask_scope` | Current Subtask (ID-N.M) scope summary |
| `task_context.subtask_file_ownership` | The Subtask's declared `file_ownership_allowed` globs |
| `task_context.acceptance_criteria` | Current Subtask acceptance criteria |

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

### Branch A — Is it in-scope for the current Subtask? (binary rule)

**Binary in-scope-ness rule (per s48-feedback B10):**

A finding is **IN-SCOPE** (and therefore routed as a Subtask under the current Task ID-N) when **either** of these predicates holds:

1. **File-path predicate** — The finding's evidence `file:line` references fall **within the current Subtask's declared `file_ownership_allowed` globs** (`task_context.subtask_file_ownership`).
2. **Axis predicate** — The finding is a **spec-compliance issue against the current Subtask slice** (the implementation diverges from `task_context.spec_path` for the slice the current Subtask is delivering, or fails one of the Subtask's `acceptance_criteria`).

If **either** predicate holds → IN-SCOPE → **Decision: `subtask`**.
If **neither** predicate holds → OUT-OF-SCOPE → continue to Branch B / C / D.

**No grey area.** There is no third "judgement call" path. If the finding does not pass file-path or axis, it is out-of-scope by definition — even if the executor "noticed it while in the area" or it "feels related". Out-of-scope findings route to Branch B, C, or D per the cross-cutting / tactical / no-action criteria below.

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
in_scope_predicate_matched: "file-path" | "axis"  # which of the two binary predicates triggered
```

The orchestrator allocates the new Subtask ID-N.M and decides whether to fold it into the current wave or schedule it for a fix wave.

### Branch B — Is it strategic / cross-cutting?

Reached only when Branch A's binary in-scope-ness rule returned OUT-OF-SCOPE.

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

Reached only when Branches A and B did not match.

A finding is a **backlog** candidate when **all** of these hold:

1. Scope is contained to a single feature area.
2. Effort is "weeks" or smaller (not "months").
3. It is not blocking any currently-active Task ID-N (otherwise Branch A's file-path or axis predicate would have matched).
4. The current Subtask ID-N.M is not already touching the same surface (otherwise Branch A's file-path predicate would have matched).

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
  status: "spec_needed" | "needs_research" | "parked" | "ready"
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

## Step 3: Output the decision

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

- Source Task / Subtask ID (`ID-N` if surfaced at Task level; `ID-N.M` if surfaced mid-Subtask).
- Source commit SHA (if from a checker).
- Session counter (e.g. `kh-prod-readiness-s47`).

The `update-roadmap-backlog` skill attaches this to the resulting ledger entry via the schema-appropriate fields (`session_refs` + `commit_refs` for roadmap; `surfaced` for backlog).

---

## Failure modes to avoid

1. **Defaulting everything to backlog.** Backlog should not be a dumping ground. Use `no-action` when warranted.
2. **Defaulting everything to subtask.** Subtasks balloon the current Task ID-N's scope. Apply the binary in-scope-ness rule strictly — `subtask` requires **file-path within `subtask_file_ownership` OR axis = spec-compliance against the Subtask slice**. Anything else is OUT-OF-SCOPE.
3. **Promoting style nits to the roadmap.** Roadmap is strategic capability; "rename this variable for clarity" is not roadmap material.
4. **Missing existing coverage.** Always check roadmap + backlog before promoting; duplicates fragment the ledger.
5. **Following legacy file naming when applying decision logic.** Target semantics drive the decision; the write layer reconciles to the current files.
6. **Inventing a grey-area "judgement call" for Branch A.** The binary rule is intentional (per s48-feedback B10). If the executor "noticed it while in the area" but the file-path is outside `subtask_file_ownership` and the finding is not a spec-compliance issue against the Subtask slice, it is OUT-OF-SCOPE. Route to B / C / D.

---

## Examples

### Example 1 — Cross-cutting auth pattern

**Finding:** "Found that all routes under `app/api/coverage/` use the old `getAuthorisedClient()` return-shape `{ authorised }` instead of the new `{ success }` pattern. Out of scope for current Subtask ID-7.3 (which is one specific coverage route)."

**Decision walk:**
- Branch A (file-path predicate): `app/api/coverage/*` files outside `subtask_file_ownership` (Subtask ID-7.3 owns only one route). NOT IN-SCOPE.
- Branch A (axis predicate): The finding is not a spec-compliance issue against Subtask ID-7.3's slice — Subtask ID-7.3's spec only requires its one route conform. NOT IN-SCOPE.
- Branch A → OUT-OF-SCOPE. Continue.
- Branch B? Yes — cross-cuts multiple routes, is an infra pattern, weeks of effort.
- **Decision: `roadmap`** under §{auth-infra-section, or new section}.

### Example 2 — Direct consequence of current change

**Finding:** "Renamed `lib/foo/bar.ts` to `lib/foo/baz.ts` as part of Subtask ID-9.2. Found 4 callers in `lib/other/...` that still import from the old path."

**Decision walk:**
- Branch A (file-path predicate): The 4 caller files are in `lib/other/...`, OUTSIDE Subtask ID-9.2's `file_ownership_allowed` globs. Does not match.
- Branch A (axis predicate): The rename is a Subtask ID-9.2 deliverable; leaving callers broken violates the implicit acceptance criterion that the codebase compiles after the rename. MATCHES spec-compliance against Subtask slice.
- Branch A → IN-SCOPE.
- **Decision: `subtask`** with new Subtask ID-9.M under Task ID-9 to update the 4 callers. `in_scope_predicate_matched: "axis"`.

### Example 3 — Style nit

**Finding:** "Variable name `tmpResult` in `lib/foo/bar.ts:42` could be clearer." Current Subtask ID-12.1 owns `lib/foo/bar.ts`.

**Decision walk:**
- Branch A (file-path predicate): `lib/foo/bar.ts` IS within Subtask ID-12.1's `subtask_file_ownership`. File-path predicate MATCHES.
- Branch A → IN-SCOPE by file-path predicate.
- However, the finding's content is a pure-style nit with no functional impact. Even though it is technically in-scope, applying it has no acceptance-criteria consequence and creates churn.
- **Decision: `subtask`** with `in_scope_predicate_matched: "file-path"`, but the Subtask spec must capture that the change is style-only and may be deprioritised by the Orchestrator. Alternatively, **`no-action`** is acceptable if the curator judges the nit not worth the Subtask overhead — record that judgement explicitly in `noaction_reason`.

> Binary in-scope-ness governs routing, not effort. The Orchestrator may still defer or skip a low-value Subtask after seeing the spec.

### Example 4 — Feature-scoped tech debt

**Finding:** "The search filter component (`components/search/Filter.tsx`) re-renders on every keystroke because of an unstable empty-array default. Out of scope for current Subtask ID-14.2 (which is in `components/digest/`)."

**Decision walk:**
- Branch A (file-path predicate): `components/search/Filter.tsx` is OUTSIDE Subtask ID-14.2's `file_ownership_allowed` (`components/digest/**`). NOT IN-SCOPE.
- Branch A (axis predicate): Not a spec-compliance issue against Subtask ID-14.2's slice. NOT IN-SCOPE.
- Branch A → OUT-OF-SCOPE. Continue.
- Branch B? No — single feature (search), not cross-cutting.
- Branch C? Yes — tactical, single-feature, weeks-scope, no current Task touches search.
- **Decision: `backlog`** in `track: search`, `type: tech-debt`, `priority: medium`.

---

## What this skill is NOT

- Not a write skill. No file edits; output is a decision only.
- Not a code-review skill. Doesn't audit code; takes a finding as input.
- Not Taskmaster-coupled. No `task-master` commands.

## What hands off to `update-roadmap-backlog`

For `roadmap` and `backlog` decisions, the curator agent immediately invokes `update-roadmap-backlog` with the decision payload as input. That skill performs the actual JSON edit and any pipeline regeneration.
