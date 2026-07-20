---
name: audit-skill
description: Audit a single skill or agent file — plus its references/ and scripts/ — for accreted drift, strip it in place, and show the diff. Drift means historical session refs (S###), provenance archaeology ({N.M} / ID-N.M / OQ-S### / "post-S280"), inlined verbosity ("why these constraints exist" essays, restated or triplicated boundaries, "your success is measured by…" lists, paths repeated many times), un-extracted reference blocks (inlined rubrics/templates/metric defs with no code-intel marker), and stale cross-refs (dead path citations, orphaned reference links, stale numeric budgets). Use this whenever a SKILL.md or agent .md has grown bloated, or when asked to "de-drift", "slim down", "clean up", "remediate", "strip", or "audit" one — and specifically when create-skill / update-skill / agent-development won't help, because those only govern NEW content and never remove already-accreted cruft. Operates on ONE target file per invocation: fresh single-file context is the anti-drift mechanism, so never batch or sweep.
---

# Audit Skill

`create-skill`, `update-skill`, and `agent-development` keep _new_ content clean. None of
them remove drift that has already accreted. This skill is the missing strip pass: point
it at one bloated skill or agent file, and it rewrites the body to current best practice
in place, then shows you the diff.

## The one-file contract (why this is not a sweep)

Drift accretes through a specific failure: an agent updates one file well, then relapses
into inlining context and verbosity on the next file in the same pass. A multi-file sweep
re-creates that failure by construction. So this skill audits **one target file per
invocation, in fresh context**. If several files need cleaning, invoke it once per file,
separately — never loop over them in one pass. The relapse is the whole problem.

## Step 1 — Resolve the target and its related files

The target is the single file named in the invocation: a `SKILL.md` or an agent `.md`.
Audit it together with everything it owns:

- **Skills:** `references/*.md`, `scripts/*`, `assets/*` under the skill directory.
- **Agents:** any `references/` files the agent points to.

Related files get the same drift check (stale comments, dead path refs, archaeology) but a
lighter hand — strip cruft, never rewrite working logic in a script.

## Step 2 — Run the detector

```
scripts/detect-drift.sh <path-to-target>
```

It prints deterministic flags grouped by category, with line numbers, plus the frontmatter
boundary and size signals. Treat it as a worklist, not a verdict — it surfaces candidates;
you judge each one. Run it on related `references/*.md` too.

The detector is necessarily incomplete — its regexes miss shapes, especially novel ones.
After it runs, sweep the body by eye for any session/spec/subtask token it didn't flag;
the Category-A cues in `drift-taxonomy.md` list the shapes to scan for.

## Step 3 — Preserve frontmatter byte-identical (load-bearing)

Everything between the opening `---` and the next `---` is mandated-verbatim:
`description:`, `model:`, `effort:`, `color:`, and agent `<example>` blocks. These are
tuned for triggering and dispatch — an `S###` ref inside `description:` is deliberate, not
drift. Every strip in this skill applies to the body only; the detector prints the line
where the body starts. **Frontmatter can be edited if not doing so would contradict what
the skill now describes.**

## Step 4 — Strip drift by category

Full taxonomy with keep/cut rules and worked examples: **read
`references/drift-taxonomy.md`** before editing. What to do with each category:

| Category                                                                                                                                             | Action                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Provenance archaeology** (`S###`, `{N.M}`, `ID-N.M`, `OQ-S###`, "post-S280", `Q-TAG-N`, dated refs)                                            | **Strip.** Keep the rule, cut the archaeology. Retain a bare spec anchor (`RESEARCH §7`) only where it genuinely aids navigation.                                                                                                  |
| **B — Verbosity** ("why these constraints exist" essays, restated/triplicated boundary sections, "your success is measured by…", paths repeated ≥3×) | **Strip.** Collapse duplicate boundaries to one; state a long path once.                                                                                                                                                           |
| **C — Un-extracted reference blocks** (inlined rubrics/templates/metric defs with **no** code-intel marker)                                          | **Extract** to `references/` (Step 5).                                                                                                                                                                                             |
| **D — Cross-file / cross-repo duplication** (a block triplicated across sibling agents/skills)                                                       | **Report only.** A single-file pass cannot safely single-source across files — removing the block here breaks the file unless the shared reference already exists. Flag for a coordinated pass.                                    |
| **E — Stale cross-refs** (dead path citations, orphaned reference links, stale numeric budgets)                                                      | **Fix** where the correct target is unambiguous; **flag** where it is not.                                                                                                                                                         |
| **P — Protected pins** (`<!-- code-intel:* -->` anchor blocks; any block whose strings a test in `__tests__/` asserts)                               | **Never touch.** Deliberate inline pins (e.g. code-intelligence anchors guarded by `__tests__/docs/code-intelligence-integration.test.ts`). Do not extract, do not remove markers, do not strip the asserted strings. Report only. |

Auto-strip A, B, C, E within the target+related set. Never auto-apply D or P.

**Preflight before extracting or removing ANY block** (a category-C block or a section you
suspect is stale): grep the test suite for the target file and the block's distinctive
strings — `grep -rl "<distinctive string>" __tests__/`. If a test asserts them, the block
is **protected (P)** — leave it verbatim and report it. A passing suite is a hard gate:
re-run the relevant test after editing. This is why `<!-- code-intel:* -->` blocks are
never extraction debt in this repo — they are test-pinned anchors, not un-extracted
references.

## Step 5 — Extract un-extracted reference blocks

This is the highest-risk edit — it moves content, not just deletes it. For each block of
reference-grade detail (rubrics, report templates, metric definitions, protocol mechanics)
inlined in the body:

1. Create `references/<topic>.md` holding the block.
2. Replace the body block with a one-line pointer (e.g. "read `references/<topic>.md` when
   you need X").
3. **No duplication:** each fact lives in EITHER the body OR a reference, never both.

## Step 6 — Show the diff and report

After editing, surface:

1. `git diff --stat`, then the full `git diff` of every file touched.
2. A short **findings report** (template below): what was stripped, what was extracted,
   and the **report-only** items (category D, ambiguous E) a human or the orchestrator
   must handle.
3. The detector re-run, to confirm body flags are clear — remaining hits should be inside
   frontmatter only.

### Report template

```
# Drift audit — <target>
## Stripped (body)
- A/archaeology: <n> refs removed (S###, {N.M}, …)
- B/verbosity: <what collapsed>
## Extracted
- references/<topic>.md  (<n> lines moved)
## Fixed cross-refs
- <old> → <new | removed>
## Report-only (needs a coordinated/multi-file pass)
- D: <block> triplicated across <files>
- E: <ambiguous stale ref>
## Size: <before> → <after> lines
```

## Scope guard

This skill removes drift; it does not add features, rewrite logic, or change behaviour. If
a file is structurally wrong rather than merely bloated, that is a `create-skill` /
`update-skill` job — say so and stop.
