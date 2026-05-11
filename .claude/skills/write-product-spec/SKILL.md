---
name: write-product-spec
description: Write a PRODUCT.md spec for a significant user-facing feature in Knowledge Hub, focused on detailed behavior and validation. Use when the user asks for a product spec, desired behavior doc, or PRD, wants to define feature behavior before implementation, or when the feature is substantial or behaviorally ambiguous enough that a written spec would improve implementation or review.
---

# write-product-spec

Write a `PRODUCT.md` spec for a significant feature in Knowledge Hub.

## Overview

The product spec should make the desired behavior unambiguous enough that an agent can implement it correctly and avoid regressions. Describe the feature purely from the user's perspective — what the user sees, does, and experiences, and the invariants that must hold for them. Do not include implementation details (internal types, state layout, module boundaries, data flow, algorithms).

"User" is not limited to the end user of the Knowledge Hub app. It means whoever consumes the surface being designed:

- For UI / UX features: the human using the web app (admin, reviewer, bid author, etc.).
- For a data model: the code that reads and writes that model.
- For an API, protocol, or library: the callers of that API — other services, client code, plugins, or agents.
- For an MCP tool: the LLM (Claude) invoking the tool, plus whoever is steering the LLM.
- For a CLI tool or developer-facing surface: the developer invoking it.
- For the Python ingestion pipeline: the operator running the job + the downstream MCP/UI consumers of the resulting `content_items` rows.

The spec should describe behavior from that consumer's perspective: the shape of the surface, the operations they can perform, what they see back, invariants they can rely on, and edge cases they must handle — without prescribing how the surface is implemented underneath.

Implementation details, validation, and test planning live in a companion `TECH.md`, produced by the `write-tech-spec` skill. Writing the product spec is usually the first step of a two-step process: once `PRODUCT.md` is agreed on, invoke `write-tech-spec` to produce `TECH.md` for the same feature (or let the user know that's the expected next step). The product spec should be written so the tech spec can be written directly from it.

Write specs to `specs/<id>/PRODUCT.md`, where `<id>` is one of:

- a GitHub issue id, prefixed with `gh-` (e.g. `specs/gh-4567/PRODUCT.md`)
- a Linear ticket number if Liam is using one for the feature (e.g. `specs/APP-1234/PRODUCT.md`)
- a short kebab-case feature name (e.g. `specs/q-a-workspace-scoping/PRODUCT.md`)
- once Taskmaster is installed (S232 WP4+), align `<id>` with the Taskmaster task ID for the feature so `specs/<id>/` maps cleanly to the task tree.

`specs/` should contain only id-named directories as direct children — no engineer-named subdirectories.

Ticket / issue references are optional. If Liam has a GitHub issue or Linear ticket, use its id. If not, ask for a feature name to use as the directory. Only create a new GitHub issue or Linear ticket when explicitly asked; in that case use `gh` CLI for GitHub or Linear MCP tools for Linear (and `AskUserQuestion` if labels or repo are unclear).

## Before writing

Gather only the context you need: directory id (GitHub issue, Linear ticket, kebab feature name, or Taskmaster task ID), feature summary, target users, key behaviors, edge cases, and how the feature will be validated. Use `AskUserQuestion` for missing context rather than guessing.

### Figma mocks

If the feature has any UI or interaction design, ask the user whether a Figma mock exists before drafting the Behavior section, and include the link in the spec when one is provided. A mock is often the most reliable source of truth for visual states, spacing, and edge-case layouts — not asking can cause the Behavior section to guess at intent the designer already settled.

- If the user provides a link, include it under a short `## Figma` section (or inline near the top of Behavior) as `Figma: <link>`.
- If the user confirms no mock exists, note `Figma: none provided` so the absence is explicit rather than ambiguous.
- If the feature is purely backend (data model, API, MCP tool, CLI with no visual surface), skip the question and omit the section.

Do not silently drop design context; an explicit "none" is preferable to no mention at all on features where design would normally be expected.

### Knowledge Hub design system

For any UI feature, the Behavior section must reference the **Warm Meridian** design system (`docs/design/warm-meridian-implementation-spec.md`) where colour / spacing / typography decisions matter. Use semantic tokens (never raw Tailwind colours). WCAG 2.1 AA: never colour alone for meaning. UK English throughout (DD/MM/YYYY, "colour", "organisation"). These are project-wide invariants — call them out when a state, error, or affordance would otherwise be ambiguous about colour-only signalling.

## Structure

Required sections:

1. **Summary** — 1–3 sentences describing the feature and desired outcome.
2. **Behavior** — The meat of the spec. An exhaustive English description of how the feature works, written as numbered, testable invariants. See "The Behavior section" below — this is where the spec earns its length, and everything else should stay thin to avoid duplicating it.

Optional sections — include only when they add signal beyond the core. Omit the heading entirely if empty; do not write "None" as a placeholder.

- **Problem** — Include only when the motivation isn't obvious from Summary.
- **Goals / Non-goals** — Include when scope is ambiguous or has been contested.
- **Figma** — Include with a link when one exists, or an explicit `Figma: none provided` note when design matters but no mock exists. Omit entirely for non-visual features. See "Figma mocks" above.
- **Open questions** — Prefer inline `**Open question:** …` next to the relevant behavior. Include a dedicated section only if there are multiple unresolved questions worth collecting.

Do not include Validation, Success criteria, or Testing sections. Validation and test planning live in the companion `TECH.md` (produced by `write-tech-spec`). Write Behavior as numbered invariants that are testable on their own — the tech spec can reference them directly.

## The Behavior section

Behavior is the spec. Everything else is framing.

The goal of Behavior is a complete English description of how the feature works, detailed enough that a tech spec can be written directly from it without the author having to guess or re-derive product intent. If a reader finishes Behavior with questions about what the feature does in some situation, the section is not done.

Describe, at minimum:

- Default behavior and the happy-path user flow.
- Every user-visible state and the transitions between them.
- All inputs the user can provide and how the feature responds.
- Empty states, error states, loading / pending states, and cancellation.
- Edge cases a reasonable implementer would not think to ask about — permission denied, offline, timeouts, races between state changes, multiple concurrent instances, stale or missing data, focus loss mid-interaction, interactions with adjacent features.
- Keyboard, accessibility, and focus expectations where relevant.
- Invariants that must hold at all times and behaviors that must not regress.

For Knowledge Hub specifically, also consider:

- RLS / role coupling — admin / editor / reviewer / viewer roles see different surfaces; spec which roles can perform which operations.
- Multi-tenant / workspace scoping — if the feature touches `q_a_pairs`, `content_items`, or any workspace-scoped table, spec what is visible across workspaces vs scoped within.
- MCP-tool consumption — for features that surface via MCP, spec the tool's response shape, two-step list/preview → get/verbatim contract, and citation requirements.
- AI-invisible-infrastructure invariants — see `docs/reference/ai-visibility-policy.md`. AI-driven enrichments should not appear as user-facing AI features; the platform behaves as if the data was always there.

Length Behavior to match the feature. Trivial features may need a handful of invariants; complex features may need many, with sub-sections per flow or state. The rest of the spec should stay thin so Behavior can be as exhaustive as the feature requires without producing a bloated document overall. Err toward enumerating one more edge case rather than one fewer.

## Length heuristic

Behavior should be as long as the feature requires — do not truncate edge cases to hit a line target. The heuristic below applies to everything around Behavior (Summary, optional sections): keep that framing thin so the spec's total length reflects the feature's actual complexity, not structural overhead.

- Trivial fix or narrow UI tweak: no spec.
- Small feature (single module, few edge cases): framing plus Behavior typically ~30–60 lines total.
- Medium feature (cross-module, multiple states): typically ~80–150 lines total.
- Large or behaviorally rich feature: longer is fine, and most of the length should live in Behavior.

If you find yourself writing the same idea in Summary, Problem, Goals, and Behavior, collapse the framing — not the Behavior content.

## Writing guidance

- Prefer concrete, observable behavior over aspirational wording.
- Write Behavior as a list of invariants rather than prose when possible.
- Capture invariants that must not regress and edge cases that are easy to miss.
- Avoid implementation details unless unavoidable for the UX.
- Each section should earn its place — if a section would repeat another or contain only boilerplate, omit it.
- UK English (`colour`, `organisation`, DD/MM/YYYY) throughout.

## Keep the spec current

Approved specs may ship in the same PR as the implementation. As implementation evolves, update `PRODUCT.md` in the same PR when user-facing behavior or UX details change. The checked-in spec should describe the feature that actually ships.

For large features, the implementer may optionally keep a `DECISIONS.md` file summarizing concrete decisions made during design and implementation. Offer it when it would help future agents; otherwise skip it.

Once Gitbook integration is wired (planned), approved + shipped specs may also be published as user-facing docs via the Gitbook sync. The checked-in `PRODUCT.md` remains the canonical source of truth; Gitbook is the publishing surface.

## Related Skills

- `write-tech-spec` — companion implementation spec.
- `documentation-and-adrs` — for architectural decision records that outlive a single feature.
- `spec-driven-development` — broader spec-first workflow.

## Example Behavior section

A sample Behavior section for a hypothetical feature: rendering GitHub-flavored Markdown tables in a content-display surface. It demonstrates the expected shape — numbered, testable, user-perspective invariants that enumerate defaults, edge cases, malformed input, streaming, selection/copy, search, sharing, theming, and cross-surface consistency, with one inline open question. (Example carried from the upstream Warp version of this skill; substitute KH equivalents — bid response viewer, Q&A library cell renderer, content_item body display — when authoring a real spec.)

````markdown
## Behavior

1. When a rendered content block contains a GitHub-flavored Markdown table (a header row, a separator row of one or more `---` segments, and one or more body rows, all delimited by `|`), that table renders as a visually formatted table — not as raw pipe-delimited text.

2. The table renders with:
   - A visually distinct header row.
   - Aligned columns based on the separator row: `|:---|` left-align, `|:---:|` center, `|---:|` right-align. `|---|` with no colons falls back to the default alignment (left for text, right for numeric-looking values).
   - Visible row separators (or equivalent spacing) consistent with the active Warm Meridian theme.

3. Inline markdown inside a cell renders inline: bold, italic, inline code, strikethrough, and links all render the same way they do in the surrounding block output. Line breaks inside a cell (`<br>` or escaped `\n`) render as in-cell line breaks.

4. Column widths are chosen to fit the table's natural content when it fits inside the container. If a single cell's content is very long, that cell wraps its text within its column rather than forcing the column to an unreasonable width.
   - **Open question:** when a wrapped cell would produce an unreasonably tall row, do we clip with an "expand" affordance, or let the row grow unbounded?

5. Horizontal scrolling: when the table's total width exceeds the container width — many columns, or wide columns that can't reasonably be narrowed — the table becomes horizontally scrollable within the container. Scrolling horizontally reveals off-screen columns without clipping or truncating them. Vertical scrolling of the container continues to work independently of table scroll.

6. When the container is resized (browser resize, sidebar open/close, panel split), the table reflows to the new width without losing row or column order.

7. Empty cells render as visibly empty (same row height as surrounding cells, no placeholder text). A row with all empty cells still renders as a row.

8. A table with only a header and separator (zero body rows) renders as a header-only table, not as raw text.

9. A single-column table renders as a single-column table (not collapsed to a bullet list or similar).

10. Malformed tables fall back gracefully:
    - Missing separator row → rendered as preformatted text, not as a table.
    - Ragged rows (some rows have fewer or more cells than the header) → missing cells render empty; extra cells are shown, with the header row extended visually if possible. The block should never silently drop data.
    - Unclosed table (last row truncated mid-stream) → rendered as a partial table; see (11).

11. Streaming output: while content is still being produced (e.g. AI response streaming), the table renders incrementally. New rows append as they arrive. The header row locks in as soon as the separator line is received; rows before the separator render as plain text until the table is recognized.

12. Selection and copy:
    - Selecting across cells with the mouse or keyboard selects their visible text content.
    - Copying the selection produces tab-separated plain text by default (one row per line, cells separated by tabs). An affordance (context menu, shortcut) lets the user copy the original markdown source instead.
    - Copying the entire block preserves the original markdown source verbatim.

13. Search within a block (find-in-block) matches against cell text content. Matches highlight in place in the rendered cell; navigating matches scrolls the table into view, including horizontally if the match is in an off-screen column.

14. Sharing or exporting a block (download, share link, save as file) preserves the original markdown source, not the rendered form.

15. Theming: table borders, header backgrounds, alternating row shading (if any), and link/code styles all come from the active Warm Meridian theme via semantic tokens. No hard-coded colours (per project-wide invariant).

16. Markdown tables render consistently wherever block-level markdown already renders — content_item body, Q&A answer cell, AI response, change-report. The same input produces the same table in each surface.

17. Non-table pipe content is not misrendered as a table. Text that contains `|` characters but no valid header-separator line remains plain text, even if it visually resembles a table.
````
