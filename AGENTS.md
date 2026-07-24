# AGENTS.md

Project conventions for Intent specialist agents (Coordinator, implementors, verifiers)
working in this repository. CLAUDE.md governs the codebase — commands, architecture,
environment, cross-cutting code conventions — and is read first; this file adds the
working-agreement layer on top and does not duplicate it.

The docs-corpus style guide that previously lived here (voice, terminology, frontmatter,
content-type style, AI-invisibility) now lives in the PRIVATE `knowledge-hub-docs-site`
repo's root `AGENTS.md` (resolve the checkout via `KH_PRIVATE_DOCS_DIR`). Docs-authoring
operators load that copy; nothing in this repo depends on the retired sections.

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

## Ledger protocol

The task ledger is ordna (private docs-site; access rules in CLAUDE.md § Ledgers) and
stays canonical for task state.

- **Workers edit task files directly.** Update `${KH_PRIVATE_DOCS_DIR}/tasks/id-N.md`
  (frontmatter + body) as work progresses; the Coordinator alone moves a task to `done`
  (the dependency-gated terminal status).
- **Verify live status before citing.** Before citing a task / subtask / decision-record
  state in a conclusion, check the task file's `status` frontmatter (`cat` the file, or
  `ordna show <id>` from the docs-site root).
- **Conventions live in `${KH_PRIVATE_DOCS_DIR}/tasks/AGENTS.md`** — file format,
  statuses, id scheme. `.ordna/config.yaml` comments are ephemeral (the CLI rewrites the
  file on every run), so config commentary belongs in that AGENTS.md, never in the yaml.
- **Intent notes are the working record; specs export.** Workspace spec and task notes
  carry the session's running state; durable spec content exports to
  `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/id-N-<slug>/` at closeout.

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
