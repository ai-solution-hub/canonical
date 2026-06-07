# AGENTS.md

This file is the docs-corpus style guide for the Knowledge Hub. It is loaded by every
docs-authoring agent — docubot, the five ported skills (`review-docs-pr`,
`sync-source-docs`, `missing-docs`, `check-for-broken-links`, `docs-seo-audit`), and by
any human contributor reviewing or amending content under `docs/` or
`docs-site/src/content/`.

For project-wide conventions, see CLAUDE.md. This file adds docs-corpus-specific
conventions on top. The two files are complementary: CLAUDE.md governs the codebase
(commands, architecture, testing, Supabase, gotchas) and AGENTS.md governs the written
corpus (voice, terminology, frontmatter, content-type style, AI-invisibility).

For code-intelligence workflow (gitnexus + ast-dataflow), see `.gitnexus/CLAUDE.md` and
`.ast-dataflow/CLAUDE.md` — imported by root CLAUDE.md.

Spec source: `docs/specs/id-9-astro-starlight-docs-foundation/PRODUCT.md` Inv-51,
`docs/specs/id-9-astro-starlight-docs-foundation/TECH.md` §6.1 + §6.3.

---

## 1. Voice and tone

The docs corpus reads like internal technical writing for a small engineering team.
Direct, evidence-bearing, low-ornament. The reader is a platform engineer or AI
development partner, not a marketing prospect.

### 1.1 UK English (canonical)

All docs prose uses UK English orthography. This rule is canonical to this file —
`keep-docs-in-sync` references this section rather than restating it (per OQ-PLAN-3 Option
A non-duplication).

- Spell `colour`, `organisation`, `behaviour`, `centre`, `licence` (noun) / `license`
  (verb), `programme` (initiative) / `program` (software), `analyse`, `optimise`,
  `realise`, `recognise`.
- Use DD/MM/YYYY for dates. Example: `21/05/2026`, not `05/21/2026` or `2026-05-21`. ISO
  8601 is permitted only inside code blocks, log examples, or YAML frontmatter values
  where the surrounding tool requires it (e.g. `lastUpdated:` in Starlight frontmatter
  accepts ISO; the `kh_last_verified` field requires DD/MM/YYYY per the Zod regex in
  `docs-site/src/content.config.ts`).
- Quote with double-quotes for prose and single-quotes only inside code-fenced examples
  where the language convention requires it.
- Single space between sentences. No Oxford comma unless its absence would create
  ambiguity.

### 1.2 Professional-direct tone

- Lead with the verb. "Configure the cron schedule before deploying" rather than "You will
  want to configure the cron schedule before deploying."
- State invariants as invariants. "The build fails on malformed frontmatter" rather than
  "the build might fail on malformed frontmatter."
- Cite specs, runbooks, file paths, and line numbers when the reader would otherwise need
  to grep. A bare claim with no anchor is a rewrite candidate.

### 1.3 No marketing copy

The docs corpus describes how the platform works. It does not sell the platform.

- Avoid superlatives ("powerful", "seamless", "robust", "industry- leading",
  "best-in-class") and aspirational adjectives unless they describe a measurable
  invariant.
- Avoid value claims unmoored from behaviour ("delights users", "saves time", "unlocks
  insights"). Document the mechanism, not the promise.
- The platform's design philosophy lives in `docs/reference/state-of-the-product.md` and
  adjacent canon. Doc pages reference that philosophy by link; they do not paraphrase it.

### 1.4 No emoji

Markdown bodies contain no emoji. This rule applies to:

- Docs pages under `docs/` and `docs-site/src/content/docs/`.
- Generated content written by docubot or any of the five ported skills.
- Commit messages produced by docs-authoring workflows.

Exceptions are limited to mechanical surfaces that already use icon glyphs by convention
(badge images, status indicators emitted by external tooling). Inline body prose remains
glyph-free.

### 1.5 No second-person addressing the reader-as-buyer

Use "you" when guiding a reader through a procedure ("you run `bun install`"). Avoid "you"
framings that imply audience-as-prospect ("you will love how fast it is").

---

## 2. Terminology

The following terms have canonical resolutions across the docs corpus. Doc-authoring
agents emit the canonical form by default and only emit a non-canonical form when quoting
a historical artefact.

| Term             | Canonical form                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name     | **Knowledge Hub**                                                                                     | Capitalised both words. Never "knowledge hub", "KnowledgeHub", or "KH" in body prose. "KH" is permitted in commit messages, task-IDs, and short-form internal references where space is constrained.                                                                                                                                                             |
| "The platform"   | Refers to the Knowledge Hub product surface as a whole.                                               | Acceptable as a synonym for Knowledge Hub when the noun has already been introduced in the page. Prefer the proper name on first mention.                                                                                                                                                                                                                        |
| "The app"        | Refers to the Next.js application under `app/` specifically.                                          | Distinguished from the platform — "the app" excludes the Python pipeline, the docs site, the MCP surface. Use when scope matters.                                                                                                                                                                                                                                |
| Change Reports   | **Change Reports** (capitalised noun phrase)                                                          | Renamed from "Digest" per S248 (commit `dc1d7850`) + S251 W1B closeout (`20260521123659_s251_w1b_rename_digest_to_change_reports.sql`). Never emit "Digest" in new prose. Historical references in archived planning artefacts may retain "Digest"; copy them verbatim and add a parenthetical `(now Change Reports)` if the reader would otherwise be confused. |
| docubot          | **docubot** (lowercase, one word)                                                                     | The GitHub-Actions-driven docs-PR bot ported from Warp. Distinct from "Claude" (the model) and "the SDK" (`@anthropic-ai/claude-agent-sdk`). When prose needs to disambiguate, say "the docubot workflow", "Claude (Anthropic's model)", "the Claude Agent SDK".                                                                                                 |
| Claude           | **Claude** (the LLM)                                                                                  | Use when referring to the model itself, never as a verb ("Claude wrote this") in user-facing prose — that would violate Inv-23 (AI-invisibility) on the user-facing surface. Internal docs may state model usage for engineers.                                                                                                                                  |
| the SDK          | **the Claude Agent SDK** on first mention; `the SDK` on subsequent.                                   | npm package `@anthropic-ai/claude-agent-sdk`. Distinct from `@anthropic-ai/sdk` (the lower-level API client).                                                                                                                                                                                                                                                    |
| Workspace        | **Workspace** (capitalised when referring to the entity)                                              | The post-S247-W1 successor to "project". Schema: `workspaces` table. Historical "bid" and "project" tables/types renamed under the procurement umbrella per S248 T4.                                                                                                                                                                                             |
| Bid              | **Procurement** (umbrella term)                                                                       | Renamed from "Bid" / "Bids" umbrella per S248 T4 — API paths `app/api/bids/* → app/api/procurement/*`. Schema retains `bid_*` table names where the unit-of-work is a question or response within a workspace; surface naming uses Procurement.                                                                                                                  |
| Content Items    | **Content Items** (capitalised when referring to the type)                                            | The atomic record in the knowledge base. Schema: `content_items` table.                                                                                                                                                                                                                                                                                          |
| Quality score    | **Quality score** (lowercase "score")                                                                 | Per `docs/reference/ai-visibility-policy.md` Rule 2: "Quality: 78", not "AI Quality Score".                                                                                                                                                                                                                                                                      |
| Summary / digest | **Summary** (singular) or **Change Reports** (the surface).                                           | Rule 2 again — never "AI-generated summary".                                                                                                                                                                                                                                                                                                                     |
| Domain           | **Domain** (the taxonomy axis)                                                                        | Distinct from "Sector". Domain is the platform's primary classification axis; Sector is a secondary descriptor on some content. Source: `docs/reference/entity-type-taxonomy-spec.md`.                                                                                                                                                                           |
| Layer            | **Layer** (the vocabulary axis)                                                                       | The five-layer vocabulary scheme (`contexts/layer-vocabulary.tsx`). Capitalise when referencing a specific Layer (e.g. "Layer 3"); lowercase as the abstract noun ("the layer system").                                                                                                                                                                          |
| Sector           | **Sector** (the secondary descriptor)                                                                 | UK SMB sector classification. Lowercase as the abstract noun unless titlecased in a heading.                                                                                                                                                                                                                                                                     |
| Reference doc    | **Reference doc** / **Reference document**                                                            | Pages under `docs/reference/`. They are canonical, point-in-time-stable, and bear a `<!-- Last verified: DD/MM/YYYY -->` header.                                                                                                                                                                                                                                 |
| Runbook          | **Runbook**                                                                                           | Pages under `docs/runbooks/`. Operational procedures with explicit step ordering and rollback advice.                                                                                                                                                                                                                                                            |
| Spec             | **Spec** (a `{N.x}` ratified PRODUCT.md / TECH.md pair) or **research spec** (a `{N.1}` RESEARCH.md). | Pages under `docs/specs/<task-slug>/`. The `{N.1}` RESEARCH → `{N.2}` PRODUCT → `{N.3}` TECH → `{N.4}` PLAN chain is canonical per `docs/plans/phase-0-investigation/kh-sdlc-workflow.md`.                                                                                                                                                                       |
| Subtask          | **Subtask** (one `ID-N.M` unit of work)                                                               | Capitalised when referring to a specific Subtask; lowercase as the abstract noun.                                                                                                                                                                                                                                                                                |
| Wave             | **Wave** (a Subtask group dispatched in parallel)                                                     | Capitalised when numbered (e.g. "Wave 2"); lowercase as the abstract noun.                                                                                                                                                                                                                                                                                       |
| MCP              | **MCP** (Model Context Protocol)                                                                      | Acronym uppercase. Spell out on first mention in a long-form doc; acronym thereafter.                                                                                                                                                                                                                                                                            |
| pipeline         | **Pipeline** (the Python ingestion + classification surface).                                         | Code lives in `scripts/kb_pipeline/`. Distinct from "the app" (TypeScript / Next.js) and "the docs site".                                                                                                                                                                                                                                                        |

### 2.1 Where to find more canonical terms

- Taxonomy: `docs/reference/entity-type-taxonomy-spec.md`.
- Schema entity names: the generated types in `supabase/types/database.types.ts` (consume
  via `Tables<'x'>` / `Enums<'x'>`; see CLAUDE.md "TypeScript conventions").
- State-of-the-product nouns: `docs/reference/state-of-the-product.md`.
- AI-visibility resolutions: `docs/reference/ai-visibility-policy.md`.

When adding a new canonical term to the corpus, update this table in the same commit that
introduces the term to a published doc.

---

## 3. Frontmatter contract

Every markdown file published through the docs site MUST validate against the Zod schema
in `docs-site/src/content.config.ts`. The schema is reproduced here as the authoritative
author-facing contract; the file remains the runtime source of truth.

### 3.1 Required field

- `title` — string, required. Comes from Starlight's base `docsSchema()`. The page H1 is
  rendered from this; do not also write an H1 in the body.

  Source files under `docs/` SHOULD declare an explicit `title:`. As a safety net,
  `docs-site/scripts/sync-content.ts` derives a fallback title at build time for any
  source missing one — first from the document's first H1 heading (`# …`), otherwise from
  the filename converted to Title Case — so `astro check` is not blocked by an omitted
  title. This derivation is a backstop, not the primary mechanism: it lives in the sync
  layer and never mutates the source file, and it emits a
  `[sync-content] derived title for …` log line for traceability. Always prefer an
  explicit `title:` over relying on the fallback.

### 3.2 Optional author-facing fields

- `description` — string. Shown in search results and in some navigation surfaces.
- `sidebar` — object. Starlight's sidebar configuration (label override, order, badge).
  See Starlight's `docsSchema` for the full shape.
- `lastUpdated` — ISO 8601 date string or boolean. When provided, overrides the
  git-derived last-updated timestamp. The site renders the value as DD/MM/YYYY in the
  `en-GB` locale per the S62F-ID-9.5 Inv-14 fix.

### 3.3 Sync-managed fields — do NOT hand-edit

These three fields are managed by `docs-site/scripts/sync-content.ts` at build time.
Hand-edits are overwritten on the next sync run unless `kh_docubot_owned: true` is set.

- `kh_source` — repo-relative path of the source markdown under `docs/`. Written by the
  sync script when it copies the source into
  `docs-site/src/content/docs/<space>/<file>.md`. Optional.
- `kh_last_verified` — DD/MM/YYYY string. Enforced by the Zod regex
  `/^\d{2}\/\d{2}\/\d{4}$/`. A malformed value (ISO 8601, US-style, hyphen separator)
  fails the build at `astro check` time per Inv-16.
- `kh_docubot_owned` — boolean. When `true`, the sync script skips this path on subsequent
  runs so docubot edits are not clobbered. Set this flag only when docubot writes directly
  to `docs-site/src/content/docs/` without a corresponding source file under `docs/`.
  Optional.

### 3.4 Unknown fields

The schema rejects unknown fields where Starlight's intersection shape allows the
rejection to be expressed. See the in-file comment block in
`docs-site/src/content.config.ts` for the current carve-out on `docsSchema({ extend })` —
the gap is documented and surfaced to the ID-9 Checker rather than papered over.

### 3.5 Example

```markdown
---
title: Reviewing a docs-PR
description:
  Walkthrough of the review-docs-pr workflow output, what its findings mean, and how to
  act on them.
sidebar:
  order: 3
kh_source: docs/runbooks/review-docs-pr.md
kh_last_verified: 21/05/2026
---

The first paragraph of the doc. No H1 — the title is rendered from the frontmatter.
```

---

## 4. Content-type style guides

Every published doc resolves to exactly one of four content types. The content type
determines the document's structural shape and the expectations a reader brings to it.
When the right type is ambiguous, pick the type the reader's task most closely matches,
not the type the material most closely resembles.

### 4.1 Concept docs

A concept doc explains a model or invariant. It answers "what is X?" and "why is X this
way?" rather than "how do I do X?".

Structural shape:

1. One-paragraph definition that resolves the noun.
2. Diagram or schematic if the relationship between entities is non-obvious. Plain ASCII
   or Mermaid; no marketing imagery.
3. Invariants — bulleted list, each invariant cite-able by number.
4. Cross-references to procedural docs where the reader's next action lives.

Voice rules: present-tense, declarative. No second-person. Avoid "we recommend" — state
the invariant.

Example: `docs/reference/ai-visibility-policy.md` (rules-as-invariants shape).

### 4.2 Procedural docs

A procedural doc walks a reader through a task. It answers "how do I X?".

Structural shape:

1. One-paragraph statement of what the procedure accomplishes and when to use it (not the
   converse).
2. Prerequisites — bulleted list, each prerequisite verifiable.
3. Steps — ordered list, each step a single shell command, edit, or verification. Steps
   that combine more than one action are rewrite candidates.
4. Rollback — what to do if a step fails.
5. Verification — how the reader confirms the procedure succeeded.

Voice rules: second-person imperative ("Run the migration", "Verify the count"). Avoid
passive constructions ("the migration is run").

Example: `docs/runbooks/staging-refresh.md`.

### 4.3 Reference docs

A reference doc is a canonical index of values. It answers "what is the value of X?" or
"what are the allowed values for X?".

Structural shape:

1. One-line scope statement at the top.
2. A `<!-- Last verified: DD/MM/YYYY -->` header beneath the title.
3. Tables or definition lists, organised by the lookup pattern a reader is most likely to
   use.
4. Cross-references only when essential — reference docs strive to be self-contained for
   the lookup task.

Voice rules: no prose for prose's sake. A reference doc reads like a data sheet. Headings
and table cells; sentences only where definition requires.

Examples: `docs/reference/state-of-the-product.md`,
`docs/reference/entity-type-taxonomy-spec.md`.

### 4.4 Troubleshooting docs

A troubleshooting doc helps a reader diagnose a symptom. It answers "X is failing — what
now?".

Structural shape:

1. The symptom in the reader's voice ("The build fails with
   `Error: kh_last_verified must match DD/MM/YYYY`").
2. The cause — one paragraph stating the underlying invariant the symptom violates.
3. The fix — ordered list, same shape as a procedural doc's Steps.
4. How to confirm the fix landed.

Voice rules: lead with the symptom verbatim. Avoid "if you see X" constructions — write
the symptom as a heading the reader can find by searching for the literal error string.

---

## 5. AI-invisibility

The Knowledge Hub treats AI as invisible infrastructure, not a visible product feature.
This rule is canonical to this file — `keep-docs-in-sync` references this section rather
than restating it (per OQ-PLAN-3 Option A non-duplication). The full policy lives at
`docs/reference/ai-visibility-policy.md`; this section codifies what authors must do.

### 5.1 The four rules (per Inv-23)

- **AI processing is invisible.** Classification, embedding, entity extraction,
  summarisation, quality scoring, freshness calculation, deduplication, and layer
  inference are backend operations. User-facing docs MUST NOT describe these as
  "AI-powered" or "three-pass AI pipeline" features.
- **AI-derived outputs are presented as platform features.** Quality scores, freshness
  states, classification confidence, summaries, and Change Reports are platform
  capabilities. "Quality: 78", not "AI Quality Score". "Summary", not "AI-generated
  summary".
- **Claude bridge actions are visible and honestly labelled.** Buttons and prompts routing
  users TO Claude (via claude.ai, Claude Desktop, Claude Code) are integration
  touchpoints, not AI branding. "Continue in Claude" is fine; "AI-powered workspace" is
  not.
- **No in-app chat sidebar.** The platform does not embed a generic chat surface. Docs
  describing such a surface are out of date and should be flagged for rewrite.

### 5.2 Forbidden tokens (CI-enforced)

The docs site's CI guard fails the build when any synced page contains text matching the
regex `AI-powered|Sparkles|powered by (Claude|GPT|Anthropic|OpenAI)`. See TECH §2.10 +
`docs-site/__tests__/ai-invisibility-guard.test.ts`.

If you must reference the underlying model in engineering-facing material (e.g. a runbook
explaining which model the pipeline uses for classification), do so without prefixing the
noun with "AI-powered": write "the classification pipeline uses claude-sonnet-4-6", not
"the AI-powered classification pipeline".

### 5.3 Authoring discipline

- Describe mechanisms, not magic. "The classifier reads the content text and emits a
  Domain tag" rather than "AI determines the Domain".
- Where the user-facing surface presents a derived value, describe the value as a platform
  attribute. The reader does not need to know it was AI-derived.
- When in doubt, consult `docs/reference/ai-visibility-policy.md` and the worked examples
  in §3 of that file.

### 5.4 Where the rule does not apply

- Internal engineering docs explaining how a classifier works (`docs/specs/`,
  `docs/plans/`). These may name the model, describe the prompt shape, and discuss tuning.
  They do not surface to users.
- Commit messages and PR descriptions. These reference internal tooling without
  constraint.
- This file. AGENTS.md is itself an internal style guide; references to "AI-derived" or
  "the classifier emits" appear here as authoring guidance, not as user-facing copy.

---

_End of AGENTS.md. Append-only changes — when adding a new canonical term, rule, or
content type, extend the relevant section rather than overwriting prior guidance.
Cross-reference CLAUDE.md for project-wide rules; cross-reference `.gitnexus/CLAUDE.md` +
`.ast-dataflow/CLAUDE.md` for code-intelligence workflow._

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **knowledge-hub** (47771 symbols, 70848 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/knowledge-hub/context` | Codebase overview, check index freshness |
| `gitnexus://repo/knowledge-hub/clusters` | All functional areas |
| `gitnexus://repo/knowledge-hub/processes` | All execution flows |
| `gitnexus://repo/knowledge-hub/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
