# Task Planner — reporting templates

Emit-templates the `task-planner` agent returns to the Orchestrator after each
spec-authoring Subtask kind, plus the escalation template. Match the relevant block to the
Subtask kind you authored.

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
OPEN QUESTIONS - [is anything ambiguous/unknown before the spec(s) can be authored]
```

## After `{N.2}` PRODUCT and/or `{N.3}` TECH

```
SPEC COMPLETE — ID-N.M

OUTPUT LOCATION: ${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/<feature-slug>/
INVARIANTS COUNT: {N}
ACCEPTANCE-VERIFIABLE: [is every invariant is testable - highlight if not]
MIGRATION PLAN: included / not-applicable
OPEN QUESTIONS - [is anything ambiguous/unknown before spec(s) can be decomposed]
NOTES FOR {N.4} PLAN (if applicable):
  - [decomposition recommendation: needed / not-needed and why]
  - [estimated effort: < 2h / 2-4h / > 4h]
```

## After `{N.4}` PLAN

The SUBTASK RECORDS block is the JSON array which is required for
`bun scripts/ledger-cli.ts add-subtasks <taskId> --file -`.

```
PLAN COMPLETE — ID-N.4

DECOMPOSITION SCOPE: {M} Subtasks ({N.5} through {N.M+4})
SUBTASK RECORDS (TM-shape JSON, for `add-subtasks <taskId> --file -`):
  [
    { "id": 5, "title": "...", "details": "...", "testStrategy": "...", "dependencies": [], ... },
    { "id": 6, "title": "...", "details": "...", "testStrategy": "...", "dependencies": [5], ... },
    ...
  ]
NOTES:
  - [anything the Orchestrator needs for dispatch planning]
```

## Escalation (spec ambiguity, etc.)

```
ESCALATION — ID-N.M

REASON: [one-sentence summary]
EVIDENCE:
  - [spec gap, or upstream-spec ambiguity]
RECOMMENDATION: [Research required / Clarification required]
NOTHING WRITTEN OR PARTIAL OUTPUT AT: [path, if any partial artefact exists]
```
