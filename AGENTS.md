# AGENTS.md

Project conventions for Intent specialist agents (Coordinator, implementors, verifiers)
working in this repository. CLAUDE.md governs the codebase — commands, architecture,
environment, cross-cutting code conventions — and is read first; this file adds the
working-agreement layer on top and does not duplicate it.

## Verification standards

What "done" means for any change. Verifiers gate on these; implementors self-check
before reporting.

- **The right tests, not just green tests.** Tests verify real behaviour through the
  public surface (HTTP route, exported function, rendered component, MCP tool), never
  implementation detail. Verification means confirming the correct tests exist for the
  change and align with the behaviour-first doctrine in `docs/reference/testing/`
  (`test-philosophy.md` + `testing-patterns.md`) — not merely that a suite was run. Run
  Vitest with `bun run test`; plain `bun test` invokes Bun's own runner, not Vitest.
- **Implementation must be wired in.** A change is not complete until it is reachable in
  the running product: components mounted, routes registered, functions called, flags
  read. "The spec didn't explicitly require mounting" is not a defence — unreachable
  code fails verification.
- **Constraints escalate rather than spawn workarounds.** When a brief constraint ("no
  backend changes", "reuse existing setup only") — or an unexpected reality such as dead
  code the brief assumed live, tests that pass without testing real logic, or a
  spec-vs-reality mismatch — would force an awkward workaround, STOP and escalate to the
  Coordinator with evidence (file:line, observed vs expected behaviour). The outcome is
  scope renegotiation or spec amendment, never a silently worked-around architecture.
- **Gate on substance, not ceremony.** These points are the whole verification gate —
  there is no review process to satisfy on top (no severity-label taxonomies, sign-off
  rounds, or checklist rituals). A verdict is a judgement on the axes above backed by
  evidence (file:line, observed vs expected), not a completed form.
- **No silent Supabase failures.** Use `sb()` (fail-fast) or `tryQuery()`
  (Result-returning) from `@/lib/supabase/safe`; composite responses via
  `warningsEnvelope()`. Never raw `.from().select()` with an unchecked `error` — ESLint
  `local/no-unchecked-supabase-error` blocks it.
- **UK English** in prose and UI copy ("colour", "organisation", "behaviour");
  DD/MM/YYYY dates outside code and frontmatter.

## Research discipline

Empirical grounding precedes spec authoring and non-trivial implementation: use the
`research` skill. Task type and size determine which tooling research draws on (code
intelligence, DB interrogation, domain skills, memory and the decision register, web
research) — there is no blanket per-step tool mandate. Small tasks fold research into
spec authoring.

## Reporting

Keep tool results and report payloads bounded. Never inline a large artefact into a
report — write it to a file and return the path (anything beyond ~64K is always
file-and-path). Bound noisy commands at source: `git diff --stat` before any full diff,
explicit paths over whole-tree dumps, narrowed globs on `grep`.

<!-- code-intelligence:start -->
<!-- code-intelligence:keep -->

# Code Intelligence

## Gitnexus

GitNexus indexes this repo as **canonical** and exposes on-demand code-intelligence MCP tools. Use them when they earn their keep — as a faster path to understanding and safer edits — not by blanket per-edit mandate.

- **Exploration / "how does X work?"** — `query` and `context` return process-grouped execution flows; reach for them instead of grepping when the call graph is the answer.
- **Change safety / refactors** — `impact` sizes the blast radius, `rename` does call-graph-aware renames, `detect_changes` scopes a diff (`base_ref: "main"`).
- Pass `repo: 'canonical'` on gitnexus MCP calls. Per-task how-to lives in the skill files under `.claude/skills/gitnexus/` (exploring, impact-analysis, refactoring).
- A stale-index warning on every commit is expected (the post-commit hook compares the index to the new HEAD). 

## Cocoindex Code

The `ccc` skill provides you with AST-based semantic code search, cover TS, Python, and the database schema.

## AST-dataflow

A type-checker-resolved symbol and dataflow analysis for TypeScript repos, with a Python column-lineage companion. Answers the questions grep cannot: exact call sites, column read/write sites, string-literal AST context, re-export chains, type-position blast radius, and cross-language schema coverage.

<!-- code-intelligence:end -->
