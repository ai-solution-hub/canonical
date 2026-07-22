---
name: research
description:
  Empirically ground a task BEFORE spec authoring — interrogate the codebase and database,
  consult the task-type-relevant domain skills and current library docs, recall memory, the
  decision register, and related specs, and research externally when warranted, producing a
  RESEARCH.md ({N.1}) the PRODUCT and TECH authors can trust without re-investigating. Use
  when starting the spec chain for a new Task ID-N, when asked to research, investigate, or
  ground a task before design, when a Planner is about to write PRODUCT.md or TECH.md and
  no RESEARCH.md exists, or when deciding whether existing patterns should be built on or
  fixed first.
---
# research

Ground a task in empirical evidence before any spec is written.

## Purpose

Research exists so the spec-authoring agents can focus on producing high-quality, accurate specs instead of investigating, and so executors receive briefs that never require an investigation wave before implementation. It is also the owner's technical eyes: Liam is non-technical, so research must surface what he cannot — hidden assumptions, weak foundations, and better options that exist outside the repo — before anything is built on them. A spec grounded in guesswork produces confident-looking plans on wrong foundations; research is where that is caught.

Every research pass must ultimately answer two questions (see "The two questions" below):

1. **What are we not thinking about, but should be?**
2. **If this breaks in three months, what's the most likely reason?**

## When to use, and right-sizing

Research happens for **every** task; a RESEARCH.md *document* does not. The Coordinator/Orchestrator decides the fan-out by task type and size:

- **Small** (single-file change, clear approach, well-trodden area): no RESEARCH.md. Research folds into PRODUCT/TECH authoring — `write-product-spec` and `write-tech-spec` direct their own investigation when no RESEARCH.md exists.
- **Standard** (multi-module, some ambiguity): one researcher runs this skill inline and writes `{N.1}` RESEARCH.md before PRODUCT/TECH are authored.
- **Large / novel / cross-cutting** (compound invariants, unfamiliar domain, replaceable subsystem): the researcher may dispatch its own sub-agents — e.g. one per input below, or a spike agent that prototypes to learn — and merge findings into a single RESEARCH.md.
- **Follow-on** (a predecessor task's RESEARCH.md already covers the ground): don't re-research — delta-check it for staleness (have dependencies landed? decisions ruled since? libraries moved?) and record only the deltas.

**The task type determines the toolset, not the dispatch brief.** A schema task needs DB interrogation and the Supabase skill; a UI task needs the frontend skills and perhaps UX trend research; a pipeline task needs the cocoindex skill. Derive the relevant subset of the inputs below from what the task touches — do not run every input ceremonially, and do not wait to be told which to run.

## Method — the four inputs

Work through the inputs relevant to the task type. Each exists to answer a different question; skipping a relevant one leaves a blind spot the specs will inherit.

### (i) Codebase and database interrogation

*What is already in place, and is it sound?*

Use the code-intelligence tooling to map the territory: GitNexus (`query` for the concept, `context` on named symbols, `impact` for blast radius), `ccc` semantic search for unfamiliar surfaces, and `ast-dataflow` for schema-touching or refactor precision (column reads/writes, type-checker-resolved callers). Tool catalogue and query shapes: `.gitnexus/CLAUDE.md` and `.ast-dataflow/CLAUDE.md` — cite them, don't reproduce them. For the database: schema truth is the generated types (`supabase/types/database.types.ts` + JSONB overrides); for live-data questions (row counts, actual value distributions, orphaned rows) run read-only queries against staging.

Interrogation has two distinct outputs, and the second is the one most often missed:

- **Patterns to follow** — the existing conventions the implementation should extend.
- **Issues and inconsistencies to NOT build on** — anything unsound in the area the task touches (e.g. the silent-failure test patterns that later had to be unpicked platform-wide). Each issue found gets an explicit **resolve-first vs build-on** call in RESEARCH.md, flagged for the owner where it needs a judgement call. Building on a known-bad foundation because nobody made the call is the failure mode this input exists to prevent.

### (ii) Task-type domain skills and library docs

*What does a high-quality implementation look like?*

Read the domain skills colocated with the code the task touches, and pull current library documentation via Context7 MCP rather than trusting training-data memory:

| Task touches | Skills at |
| --- | --- |
| Frontend / UI | components/.claude/skills/ (tailwind-design-system, vercel-react-best-practices, interaction-design, web-quality-audit, …) |
| API routes | app/api/.claude/skills/ (api-and-interface-design) |
| DB / schema | supabase/.claude/skills/ (supabase-postgres-best-practices) |
| Ingestion pipeline | scripts/.claude/skills/ (cocoindex) |
| Deploy / infra | deploy/.claude/skills/ (coolify-compose, coolify-deploy) |
| E2E testing | e2e/.claude/skills/ (playwright-best-practices) |
| CI / workflows | .github/.claude/skills/ (github-actions-templates, ci-cd-and-automation, codeql) |
| MCP surface | lib/mcp/.claude/skills/ (mcp-builder, prompt-engineering-patterns) |
| OKF | lib/okf/.claude/skills/ (okf) |
| Docs / ADRs | docs-site .claude/skills/ (documentation-and-adrs) |

Record the best-practice constraints that should shape the design, not summaries of the skills themselves.

### (iii) Memory, decision register, and related specs

*What has the platform already learned or decided?*

- **Memory**: run a recall pass (the `recall-grounding` skill) seeded by the task's domain — prior sessions frequently hold the "we tried this and it failed because…" context that no doc captures.
- **Decision register**: read the in-force `DR-NNN` entries (`${KH_PRIVATE_DOCS_DIR}/src/content/docs/reference/decision-register.md`). Cite the governing DR wherever the task touches settled ground; never re-derive or re-litigate a settled ruling.
- **Related specs and tasks**: check `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/` for sibling specs in the same area, and the ledger for adjacent tasks (`bun scripts/ledger-cli.ts show task <id>` — never read the ledger JSONs wholesale).

### (iv) External research — when warranted

*Is there a better answer outside the repo?*

Web-search when the task touches territory where the ecosystem may have moved or a third-party option may beat a custom build. Two precedents set the bar: the custom ingestion pipeline (tens of thousands of LOC) was replaced by battle-tested cocoindex, and OKF usage came from spotting a relevant external trend. Look for: established libraries or services that would replace custom code, current best practice for the problem shape, and (for user-facing work) UX patterns and trends the design should be at the forefront of. Skip this input entirely for tasks squarely inside well-understood repo territory.

## The two questions

Close every research pass by answering these explicitly — they are RESEARCH.md sections, not an afterthought. They exist to catch problems while they are still cheap, before foundations are laid:

1. **What are we not thinking about, but should be?** — second-order effects, adjacent surfaces the task will disturb, operational concerns (auth, RLS, migrations, deploy), and anything the inputs surfaced that the task framing ignores.
2. **If this breaks in three months, what's the most likely reason?** — name the weakest assumption, the most fragile dependency, or the drift-prone coupling, and say what would make it robust.

Vague answers ("edge cases", "scale") mean the research isn't done; each answer should be concrete enough that a spec section or test could be written from it.

## Output — RESEARCH.md

Write to `${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/id-N-<slug>/RESEARCH.md` (the `{N.1}` artefact — dir convention as in `spec-driven-implementation`). Structure:

```markdown
# RESEARCH — ID-N <title>

## What exists today          <!-- findings with file:line evidence -->
## Issues found               <!-- each with a resolve-first vs build-on call; owner-flagged where judgement is needed -->
## Best practice              <!-- constraints from domain skills + current library docs -->
## Prior decisions & context  <!-- DR-NNN citations, related specs/tasks, memory recall -->
## External findings          <!-- only when input (iv) ran; omit heading otherwise -->
## What are we not thinking about?
## If this breaks in three months, why?
## Open questions             <!-- decisions the owner or spec authors must make -->
```

Findings, not designs: cite evidence (`file.ts:42`, DR-NNN, doc URLs) and state implications; leave behaviour to PRODUCT.md and implementation planning to TECH.md. If research surfaces a new binding ruling, return a DR-intent to the Orchestrator rather than writing the register in-branch. UK English throughout.

## Boundaries

- This skill governs the **research phase only**. It creates no obligation on downstream agents to use code-intelligence tooling at every step — that conflation caused the friction it was meant to remove. Executors and checkers work from the specs; ad-hoc or non-specced work uses code-intel as it sees fit.
- Research informs; it does not decide. Resolve-vs-build-on calls and scope changes are surfaced for the owner, not silently absorbed into the plan.
- Don't restate reference docs, skills, or the decision register — cite them.

## Related skills

- `spec-driven-implementation` — the spec chain this feeds ({N.1} → {N.4}).
- `write-product-spec` / `write-tech-spec` — consumers of RESEARCH.md; they self-direct research for small tasks where no RESEARCH.md exists.
- `workflow-orchestration` — Coordinator-side dispatch and right-sizing of the chain.