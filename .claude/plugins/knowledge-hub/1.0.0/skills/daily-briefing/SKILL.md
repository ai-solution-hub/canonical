---
name: daily-briefing
description: >-
  Per-day operational stand-up aggregation. Surfaces what needs attention today:
  review queue, active assignments, change reports, bid status, and sector
  intelligence highlights. Adapts output to the user's persona (bid-writer, SI
  analyst, admin, marketing, sales). Use when the user says "daily briefing",
  "start my day", "morning brief", "what's on my plate today", "stand up", "what
  do I need to do today", "morning update", or "daily update".
---

# Daily Briefing

Per-day operational stand-up aggregation across the knowledge base. Answers
"what do I need to act on today?" with persona-adapted output.

This skill is distinct from the `/kb:briefing` command, which serves a different
purpose: session reorientation and catch-up after time away ("what did I
miss?"). If the user wants a catch-up briefing rather than a daily stand-up,
redirect them to `/kb:briefing`.

## Persona Detection

Determine the user's persona before assembling the briefing. Use a three-tier
fallback:

1. **Explicit instruction.** The user says "as a bid writer" or "for sales" --
   use directly.
2. **Conversational inference.** If the user's recent messages or active tasks
   clearly indicate a role (editing bid responses = Rachel; reviewing SI feeds =
   James; triaging governance queue = Sarah; preparing case studies = Marketing;
   pipeline/deals = Sales), infer and continue.
3. **Ambiguous / no context.** Ask once: "Which role shall I tailor this for?
   (bid writing / sector intelligence / admin / marketing / sales)" Then cache
   the answer for the conversation.

Always open output with the persona indicator so misdetection is visible and
correctable:

```
> Persona: [Rachel / James / Sarah / Marketing / Sales] -- say "actually I'm [role]" to adjust
```

## Personas and Tool Sequences

### Rachel (Bid Writer)

Rachel's day starts with "what reviews are assigned to me?" followed by bid
pipeline status.

**Step 1 (parallel):**

- `get_assignments_for_user(status: "active")`
- `get_review_queue(status: "unverified", limit: 10)`

**Step 2 (parallel):**

- `list_active_bids(limit: 10)`
- `get_change_report(period_days: 7)`

**Output sections (in order):**

1. Active Assignments
2. Review Queue (unverified items, limit 10)
3. Bid Pipeline Status
4. Change Report (7 days)

---

### James (SI Analyst)

James's workflow centres on sector monitoring. Requires workspace resolution
before intelligence data.

**Step 0 -- Workspace Resolution:** Call
`list_user_workspaces(type: "intelligence")` and resolve:

- **0 workspaces** -- skip the Intelligence section entirely; add footer note
  "No intelligence workspaces available."
- **1 workspace** -- use it silently (autofetch).
- **2+ workspaces** -- ask: "Which intelligence workspace? (Options: [name -- id
  prefix]...)" Cache the answer for the conversation.

**Step 1 (parallel):**

- `get_intelligence_summary(workspace_id: <resolved>, period: "7d", limit: 15)`
- `get_change_report(period_days: 7)`

**Step 2 (parallel):**

- `get_governance_queue(limit: 10)`
- `get_review_queue(status: "unverified", limit: 5)`

**Output sections (in order):**

1. Intelligence Highlights
2. Change Report (7 days)
3. Governance Queue
4. Review Queue (limit 5)

---

### Sarah (Admin)

Admin sees the full operational picture across all reviewers.

**Step 1 (parallel):**

- `get_governance_queue(limit: 15)`
- `get_review_queue(status: "all", limit: 15)`
- `get_assignments_for_user(status: "active")`

**Step 2 (parallel):**

- `get_change_report(period_days: 7)`
- `list_active_bids(limit: 20)`

**Output sections (in order):**

1. Governance Queue
2. Review Queue (all statuses, limit 15)
3. Active Assignments (all users -- admin privilege)
4. Change Report (7 days)
5. Bid Pipeline Status

---

### Marketing

Marketing cares about new content for case studies and collateral, plus market
signals. Requires workspace resolution for intelligence data.

**Step 0 -- Workspace Resolution:** Same as James (see above). Call
`list_user_workspaces(type: "intelligence")`. Resolve per the 0/1/2+ logic.

**Step 1 (parallel):**

- `get_change_report(period_days: 7, keywords: ["case_study", "capability_statement", "client_story", "collateral"])`
- `get_intelligence_summary(workspace_id: <resolved>, period: "7d", limit: 10)`
  (skip if no workspace resolved)

**Step 2:**

- `list_active_bids(limit: 10)` -- show only won/completed bids relevant to
  marketing collateral

**Output sections (in order):**

1. Change Report (keyword-filtered to marketing content types)
2. Intelligence Highlights (if workspace available)
3. Bid Pipeline (won status only)

> Richer Marketing-specific tools (asset pipeline, campaign metrics, case-study
> generation) are deferred to H2 -- tracked as backlog OPS-25.

---

### Sales

Sales persona delegates to the Anthropic `sales:daily-briefing` skill for
CRM/calendar/pipeline coverage, supplemented with KB data.

**Step 1 (parallel):**

- `get_change_report(period_days: 1)`
- `list_active_bids(limit: 10)`

**Step 2 -- Delegation:** After rendering the KB supplement sections, invoke the
`sales:daily-briefing` skill **by explicit skill name** (not by trigger phrase
-- this avoids routing ambiguity since both skills share trigger phrases like
"start my day").

**If `sales:daily-briefing` skill is available on the host:** Render the KB
supplement first, then immediately invoke `sales:daily-briefing` in the same
turn for CRM/calendar/deal coverage. Frame the transition:

```
---
## CRM & Pipeline (via Sales Briefing)
```

Then invoke the skill by name.

**If `sales:daily-briefing` skill is NOT available (Anthropic plugin not
installed):** Produce a KB-only Sales aggregation with Sales-oriented framing:

1. Bid Pipeline (active bids first)
2. Change Report (last 24h)
3. Review Queue summary (count only)

Include a one-line note: "Install the Sales plugin for full
CRM/calendar/pipeline coverage."

**Output sections (in order):**

1. KB Supplement: Change Report (24h) + Bid Pipeline
2. CRM & Pipeline (delegated to `sales:daily-briefing`, or KB-only fallback)

---

## Output Format

All personas receive markdown structured as:

```markdown
# Daily Briefing -- [DD/MM/YYYY]

> Persona: [Rachel / James / Sarah / Marketing / Sales] -- say "actually I'm
> [role]" to adjust

## [Section 1]

...

## [Section N]

...

## Recommended Actions

1. **[Action]** -- [why]
2. **[Action]** -- [why]
3. **[Action]** -- [why]

---

[N] review items | [N] active bids | [N] changes (7d) | [N] assignments
```

### Constraints

- Use UK date format (DD/MM/YYYY) throughout.
- Recommended Actions capped at 5, urgency-sorted. Synthesise from aggregated
  data (e.g. "Bid X deadline in 2 days with 4 unanswered questions").
- Sections render in persona-specific priority order as documented above.
- Footer always shows counts (0 where applicable).

## Empty-State Handling

| Condition                  | Behaviour                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| No review queue items      | Omit section. Footer: "Review queue: clear"                                                                     |
| No active assignments      | Omit section. Footer: "No active assignments"                                                                   |
| No change report items     | Header + "No content changes in the last 7 days"                                                                |
| No active bids             | Omit section. Footer: "No active bids"                                                                          |
| No intelligence highlights | Omit section. Footer: "No recent intelligence signals"                                                          |
| No governance items        | Omit section. Footer: "Governance queue: clear"                                                                 |
| All sections empty         | "Nothing requires your attention today. Your KB is in good shape." + suggest `/kb:coverage` for a deeper check. |

Empty sections are omitted from the body; the footer always shows counts.

## MCP Tools Reference

| Tool                       | Personas                        | Purpose                                                                  |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `list_user_workspaces`     | James, Marketing                | Resolve intelligence workspace before calling `get_intelligence_summary` |
| `get_intelligence_summary` | James, Marketing                | Sector intelligence highlights for a single workspace                    |
| `get_review_queue`         | Rachel, James, Sarah            | Items pending content review                                             |
| `get_assignments_for_user` | Rachel, Sarah                   | Review assignments (active/completed)                                    |
| `get_change_report`        | All                             | Recent KB additions, updates, removals                                   |
| `list_active_bids`         | Rachel, Sarah, Marketing, Sales | Active bid pipeline status                                               |
| `get_governance_queue`     | James, Sarah                    | Items pending governance review                                          |

## Related Skills and Commands

- `/kb:briefing` -- Reorientation after time away ("what did I miss?"). Distinct
  from this skill.
- `sales:daily-briefing` -- Anthropic CRM/calendar/pipeline briefing. Delegated
  to by Sales persona.
- `@content-governance` -- Interactive governance triage workflow.
- `@coverage` -- Domain coverage analysis.
