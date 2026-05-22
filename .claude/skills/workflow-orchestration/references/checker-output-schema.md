# Checker output schema + finding routing

JSON shape every Checker emits, the verdict mapping the Orchestrator
applies, and the binary in-scope-ness rule that routes findings to
fix-Executor vs Curator.

## Finding routing

When a Checker returns PASS_WITH_NOTES or FAIL, or an Executor escalates
mid-task, each finding routes through a **binary in-scope-ness rule**. The
Orchestrator evaluates the rule directly — the predicate:

> A finding is **in-scope** if and only if its `location` (file path) falls
> within the file-ownership set of the current subtask brief, **OR** the
> finding's `axis` is `spec-compliance` against the subtask's spec slice.

If the Orchestrator cannot decide in-scope vs out-of-scope (ambiguity),
the finding goes to the Curator. Ambiguity is a Curator decision input, not
an Orchestrator routing input.

### In-scope → fix-Executor

The Orchestrator dispatches a fix-Executor with the finding packet. Three
fix-flows:

- **Type (a) — missed-but-correctly-detailed**: fix-Executor implements the
  missing piece against the existing subtask brief. No spec change.
- **Type (b) — functionally incorrect**: fix-Executor re-implements against
  the spec slice. The original implementation diverged from the spec.
- **Type (c) — straightforward inline fix**: fix-Executor applies the
  Checker's `fix_recommendation` directly. No re-implementation.

If the finding reveals that the spec itself is wrong (implementation
discovery requires spec amendment), the Orchestrator re-engages a Planner to update PRODUCT.md / TECH.md,
re-runs the Checker on the amended spec, then re-decomposes implementation
subtasks.

### Out-of-scope → Curator

The Orchestrator dispatches the `workflow-curator` agent with the finding
packet. The Curator runs `triage-finding`, then — if the decision is
`roadmap` or `backlog` — invokes `update-roadmap-backlog` to write the
JSON ledger. If `subtask`, the Curator appends a subtask to the current
Task (or a future Task) and reports back. If `no-action`, the Curator logs
the justification.

The Orchestrator does **not** carry out-of-scope findings in working
memory. Curator dispatch keeps the main session's context lean across
multi-wave sessions.

### Checker output schema

Checker output is JSON-shaped so the routing logic is mechanical. The
Orchestrator does not re-read Checker prose; it routes from the JSON:

```json
{
  "subtaskId": "ID-15.7",
  "verdict": "PASS" | "PASS_WITH_NOTES" | "FAIL",
  "findings": [
    {
      "severity": "blocker" | "important" | "nit" | "fyi",
      "scope": "in-scope" | "out-of-scope",
      "axis": "spec-compliance" | "code-quality" | "test-quality" | "design-tokens" | "type-design" | "silent-failure" | "performance" | "security",
      "location": "path/to/file.ts:42",
      "description": "Free-text description.",
      "fix_recommendation": "Free-text or null if Curator-triage required."
    }
  ]
}
```

Verdict mapping:

- **PASS** — zero findings of any severity. Checker may set the subtask
  group's subtasks to `done`.
- **PASS_WITH_NOTES** — only `nit` / `fyi` findings; Orchestrator routes
  them but the subtask group is not blocked.
- **FAIL** — at least one `blocker` or `important` finding. Orchestrator
  must dispatch fix-Executor(s) before the subtask group closes.

The Checker may pre-populate `scope` in its output. The Orchestrator
re-evaluates against the binary rule (the Checker's view of "in-scope" can
differ from the Orchestrator's view of file-ownership, and the
Orchestrator's view wins).
