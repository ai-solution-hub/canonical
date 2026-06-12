# Task Planner — reporting templates

Emit-templates the `task-planner` agent returns to the Orchestrator after each
spec-authoring Subtask kind, plus the escalation template. The agent body
(`.claude/agents/task-planner.md` §Reporting) carries the one-line pointer here; the
verbatim blocks live here. Match the relevant block to the Subtask kind you authored.

## After `{N.1}` RESEARCH

```
RESEARCH COMPLETE — ID-N.1

OUTPUT: ${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/<feature-slug>/RESEARCH.md
DOMAIN SKILLS INVOKED:
  - [skill-name-1]
  - [skill-name-2]
KEY FINDINGS:
  - [one-line summary 1]
  - [one-line summary 2]
RECOMMENDATIONS FOR {N.2} PRODUCT:
  - [direction the Product spec should take]
```

## After `{N.2}` PRODUCT

```
PRODUCT SPEC COMPLETE — ID-N.2

OUTPUT: ${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/<feature-slug>/PRODUCT.md
INVARIANTS COUNT: {N}
ACCEPTANCE-VERIFIABLE: Yes — every invariant is testable.
PRECEDENT SKILLS INVOKED:
  - write-product-spec
NOTES FOR {N.3} TECH (fresh Planner):
  - [direction the Tech spec should take]
  - [any open questions deferred to Tech]
```

## After `{N.3}` TECH

```
TECH SPEC COMPLETE — ID-N.3

OUTPUT: ${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/<feature-slug>/TECH.md
PROPOSED-CHANGES COUNT: {N} (one per PRODUCT invariant — verified one-to-one mapping)
MIGRATION PLAN: included / not-applicable
PRECEDENT SKILLS INVOKED:
  - write-tech-spec
NOTES FOR {N.4} PLAN (if applicable):
  - [decomposition recommendation: needed / not-needed and why]
  - [estimated effort: < 2h / 2-4h / > 4h]
```

## After `{N.4}` PLAN

The SUBTASK RECORDS block is the JSON array the Orchestrator feeds to
`bun scripts/ledger-cli.ts add-subtasks <taskId> --file -`.

```
PLAN COMPLETE — ID-N.4

DECOMPOSITION SCOPE: {M} Subtasks ({N.5} through {N.M+4})
SIBLING-ONLY DEPS: verified — no cross-Task dependencies expressed.
25-SUBTASK CEILING: {M} of 25 (within soft cap / approaching cap / split recommended).
PRECEDENT SKILLS INVOKED:
  - planning-and-task-breakdown
SUBTASK RECORDS (TM-shape JSON, for `add-subtasks <taskId> --file -`):
  [
    { "id": 5, "title": "...", "details": "...", "testStrategy": "...", "dependencies": [], ... },
    { "id": 6, "title": "...", "details": "...", "testStrategy": "...", "dependencies": [5], ... },
    ...
  ]
NOTES:
  - [anything the Orchestrator needs for dispatch planning]
```

## Escalation (sibling-only constraint violated, spec ambiguity, etc.)

```
ESCALATION — ID-N.M

REASON: [one-sentence summary]
EVIDENCE:
  - [the constraint conflict, spec gap, or upstream-spec ambiguity]
RECOMMENDATION: [Task split / Task merge / Orchestrator clarification / re-engage predecessor Planner]
NOTHING WRITTEN OR PARTIAL OUTPUT AT: [path, if any partial artefact exists]
```
