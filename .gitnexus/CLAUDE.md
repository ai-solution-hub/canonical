<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **canonical**. Use the GitNexus MCP tools to understand code, assess
impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal
> first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function,
  class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})`
  and report the blast radius (direct callers, affected processes, risk level) to the
  user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only
  affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before
  proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find
  execution flows instead of grepping. It returns process-grouped results ranked by
  relevance.
- When you need full context on a specific symbol — callers, callees, which execution
  flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the
  call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected
  scope.

## Resources

| Resource                                       | Use for                                  |
| ---------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/canonical/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/canonical/clusters`       | All functional areas                     |
| `gitnexus://repo/canonical/processes`      | All execution flows                      |
| `gitnexus://repo/canonical/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->

<!-- code-intel:propagation-start -->

## Propagation discipline

Sub-agents inherit this project-global code-intelligence directive ONLY if the
Orchestrator's dispatch brief explicitly names the code-intelligence tools (per **Inv
10**). The Orchestrator MUST verify, before dispatch, that any code-touching brief
contains the tool-discipline instruction blocks — citing the relevant invariants by
number:

- **Inv 2** (Planner): the Planner must embed tool-discipline instructions when authoring
  subtask briefs that involve symbol modification.
- **Inv 3** (Executor): the Executor must apply tool-discipline (impact analysis before
  edit, detect-changes before commit) on every code-touching subtask.
- **Inv 7** (Checker): the Checker must verify that tool-discipline steps were performed
  and audit artefacts (blast radius, detect-changes output) are present in the journal.
- **Inv 8** (Curator): the Curator must confirm that completed subtasks reflect the
  tool-discipline pattern before updating the ledger.

A sub-agent dispatched WITHOUT tool-discipline instructions on a code-touching brief
should escalate to the Orchestrator — this is a brief-composition defect, not a sub-agent
failure. The pattern is identical to skill/agent/directive on the `main` branch
propagating to sub-agent worktrees at creation time.

<!-- code-intel:propagation-end -->
