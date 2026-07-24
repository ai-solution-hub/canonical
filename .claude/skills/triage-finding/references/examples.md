# triage-finding — Worked Examples

Five worked decision walks for the `triage-finding` decision tree. The contract itself
lives in `SKILL.md` Step 2 (Branch A/B/C/D/E); these examples only illustrate it.

> **Note (ID-165 ordna cutover):** Examples 1 and 5 below illustrate Branch B ("roadmap"
> decision) using the historical "theme" vocabulary. The classification logic they
> illustrate still applies; the write surface is now plain initiative docs
> (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives/`) — see SKILL.md's
> Branch B note for the current state and the open mint-vs-attach owner call.

## Example 1 — Cross-cutting auth pattern (roadmap routing)

**Finding:** "Found that all routes under `app/api/coverage/` use the old
`getAuthorisedClient()` return-shape `{ authorised }` instead of the new `{ success }`
pattern. Out of scope for current Subtask ID-7.3 (which is one specific coverage route)."

**Decision walk:**

- Branch A (file-path predicate): `app/api/coverage/*` files outside
  `subtask_file_ownership` (Subtask ID-7.3 owns only one route). NOT IN-SCOPE.
- Branch A (axis predicate): The finding is not a spec-compliance issue against Subtask
  ID-7.3's slice — Subtask ID-7.3's spec only requires its one route conform. NOT
  IN-SCOPE.
- Branch A → OUT-OF-SCOPE. Continue.
- Branch B (new strategic capability): condition 1 — check existing coverage for "auth
  pattern modernisation" in the initiative docs
  (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives/`). No existing coverage.
  condition 2 — multi-route refactor that cross-cuts auth surface; multi-week scope. BOTH
  HOLD.
- **Decision: `roadmap`** with `roadmap_proposed_theme`
  `{ title: "auth pattern modernisation", time_horizon: "next", initial_linked_tasks: [], initial_linked_backlog: [] }`.

## Example 2 — Direct consequence of current change

**Finding:** "Renamed `lib/foo/bar.ts` to `lib/foo/baz.ts` as part of Subtask ID-9.2.
Found 4 callers in `lib/other/...` that still import from the old path."

**Decision walk:**

- Branch A (file-path predicate): The 4 caller files are in `lib/other/...`, OUTSIDE
  Subtask ID-9.2's `file_ownership_allowed` globs. Does not match.
- Branch A (axis predicate): The rename is a Subtask ID-9.2 deliverable; leaving callers
  broken violates the implicit acceptance criterion that the codebase compiles after the
  rename. MATCHES spec-compliance against Subtask slice.
- Branch A → IN-SCOPE.
- **Decision: `subtask`** with new Subtask ID-9.M under Task ID-9 to update the 4 callers.
  `in_scope_predicate_matched: "axis"`.

## Example 3 — Style nit

**Finding:** "Variable name `tmpResult` in `lib/foo/bar.ts:42` could be clearer." Current
Subtask ID-12.1 owns `lib/foo/bar.ts`.

**Decision walk:**

- Branch A (file-path predicate): `lib/foo/bar.ts` IS within Subtask ID-12.1's
  `subtask_file_ownership`. File-path predicate MATCHES.
- Branch A → IN-SCOPE by file-path predicate.
- However, the finding's content is a pure-style nit with no functional impact. Even
  though it is technically in-scope, applying it has no acceptance-criteria consequence
  and creates churn.
- **Decision: `subtask`** with `in_scope_predicate_matched: "file-path"`, but the Subtask
  spec must capture that the change is style-only and may be deprioritised by the
  Orchestrator. Alternatively, **`no-action`** is acceptable if the curator judges the nit
  not worth the Subtask overhead — record that judgement explicitly in `noaction_reason`.

> Binary in-scope-ness governs routing, not effort. The Orchestrator may still defer or
> skip a low-value Subtask after seeing the spec.

## Example 4 — Feature-scoped tech debt

**Finding:** "The search filter component (`components/search/Filter.tsx`) re-renders on
every keystroke because of an unstable empty-array default. Out of scope for current
Subtask ID-14.2 (which is in `components/change-reports/`)."

**Decision walk:**

- Branch A (file-path predicate): `components/search/Filter.tsx` is OUTSIDE Subtask
  ID-14.2's `file_ownership_allowed` (`components/change-reports/**`). NOT IN-SCOPE.
- Branch A (axis predicate): Not a spec-compliance issue against Subtask ID-14.2's slice.
  NOT IN-SCOPE.
- Branch A → OUT-OF-SCOPE. Continue.
- Branch B? condition 1 — search is already covered by an existing theme (e.g. "search
  experience"). FAILS condition 1. Skip Branch B.
- Branch C? Yes — tactical, single-feature, weeks-scope, no current Task touches search.
- **Decision: `backlog`** in `track: search`, `type: tech_debt`, `priority: medium` (the
  old backlog `rank` field is retired with the ordna cutover).

## Example 5 — New capability theme proposal (Branch B routing)

**Finding (Checker surfacing):** "While verifying Subtask ID-22.3's auth-coupling cleanup,
noticed the codebase has no abstraction for tenant-scoped DB connections. Multi-tenant
deployments would require a new layer in `lib/supabase/` plus per-route propagation of a
tenant id. Out of scope for current Subtask ID-22.3 (which only touches one route)."

**Decision walk:**

- Branch A (file-path predicate): the proposed change spans `lib/supabase/**` and many
  routes — OUTSIDE Subtask ID-22.3's `file_ownership_allowed`
  (`app/api/coverage/route.ts`). NOT IN-SCOPE.
- Branch A (axis predicate): Subtask ID-22.3's spec doesn't mention multi-tenancy — not a
  spec-compliance issue against that slice. NOT IN-SCOPE.
- Branch A → OUT-OF-SCOPE. Continue.
- Branch B (new strategic capability):
  - condition 1 — inspect existing coverage in the initiative docs
    (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/ledgers/initiatives/`). No existing
    initiative covers "multi-tenant deployments" (none of the linked work enumerates
    tenant-scoping work). HOLDS.
  - condition 2 — multi-month scope, cuts across every authenticated route, requires
    schema changes (tenant id columns), middleware changes (request-context propagation),
    and possibly RLS rewrites. Genuinely cross-cutting at the headline level. HOLDS.
- BOTH conditions hold → **Decision: `roadmap`** with:
  ```yaml
  roadmap_proposed_theme:
    title: 'multi-tenant deployments'
    description:
      'Add tenant-scoped data isolation across the entire authenticated surface — schema
      changes for tenant id propagation, middleware for request-context tenancy, RLS
      policy review per tenant, and admin UX for tenant provisioning. Outcome: a single
      Knowledge Hub deployment serves multiple isolated customer organisations.'
    time_horizon: 'later'
    initial_linked_tasks: []
    initial_linked_backlog: []
  ```
- Historical: the curator used to append the theme to a roadmap ledger; subsequent active
  work items (per Branch C findings) got added to `linked_backlog[]` over time. That
  write path is retired — the brief now goes to the owner for an initiative-doc edit (see
  the note at the top of this file). Subtask ID-22.3 itself remains unchanged — the
  finding is OUT-OF-SCOPE for that Subtask.
