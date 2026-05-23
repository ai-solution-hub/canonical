---
name: keep-docs-in-sync
description:
  Knowledge Hub docs-corpus operating rules loaded by docubot and the
  five ported docs skills (review-docs-pr, sync-source-docs,
  missing-docs, check-for-broken-links, docs-seo-audit). Encodes KH
  docs/ IA conventions, Warm Meridian theming pointers, AI-invisibility
  + UK English cross-references to AGENTS.md, documentation-inventory
  guard, commit + PR conventions, and the single-comment guardrail.
  Loaded alongside AGENTS.md per TECH §6.3.
allowed-tools: Read, Bash, Grep, Glob
---

# keep-docs-in-sync — KH docs-corpus operating rules

This skill is loaded by `scripts/docubot/run-agent.ts` and
`scripts/skills/run-skill.ts` into the prompt context of every
docs-authoring agent (per TECH §6.3 loading contract). It is the
canonical "how does docubot author KH docs?" reference. It pairs with
`AGENTS.md` — AGENTS.md governs voice + terminology + frontmatter +
content-type style + AI-invisibility; this skill governs the
operational mechanics of producing those docs (IA, theming pointers,
inventory awareness, commit conventions, single-comment guardrail).

Spec source: `docs/specs/astro-starlight-docs-foundation/PRODUCT.md`
Inv-52 + Inv-37; `docs/specs/astro-starlight-docs-foundation/TECH.md`
§6.2 + §6.3.

---

## 1. KH `docs/` IA conventions

The Knowledge Hub docs corpus uses a five-space information
architecture (per PRODUCT Inv-4). Sources live under `docs/` and the
docs site renders them under matching top-level routes.

| Space                   | Source path under `docs/`     | Site route                  | Purpose                                                                            |
| ----------------------- | ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| product-functionality   | `docs/product-functionality/` | `/product-functionality/`   | User-facing capability docs — what the platform does, audience-first.              |
| ontology                | `docs/ontology/`              | `/ontology/`                | Canonical vocabularies — Domain, Sector, Layer, taxonomy.                          |
| reference               | `docs/reference/`             | `/reference/`               | Lookup-shaped, point-in-time-stable docs with `<!-- Last verified -->` headers.    |
| runbooks                | `docs/runbooks/`              | `/runbooks/`                | Operational procedures with explicit step ordering and rollback advice.            |
| decisions               | `docs/specs/<task-slug>/`     | `/decisions/`               | Ratified `{N.2}` PRODUCT + `{N.3}` TECH spec pairs surfaced as decision records.   |

Sidebar order is fixed in `docs-site/astro.config.mjs`:
`product-functionality → ontology → reference → runbooks → decisions`.

**Cross-space link rule (Inv-6).** Cross-space links MUST use absolute
site paths (e.g. `/runbooks/staging-refresh/`), never relative paths.
Relative links work within a space (`./neighbour`) but break when the
target lives in another space — the docs site's broken-link CI guard
fails the build for cross-space relative links per Inv-12.

**Include-by-default + deny-list (Inv-3).** Every markdown file under
`docs/` is synced into the docs site unless an explicit deny-list
entry in `docs-site/sync-manifest.json` excludes it. Removal from
publication is tracked through the sync diff per Inv-22.

**Author-managed landing pages (Inv-5).** Each of the five spaces has
an author-managed `index.md` landing. Sync scripts skip these — they
are not regenerated.

---

## 2. Warm Meridian palette + typography references

The docs site mirrors the platform's Warm Meridian design system.
Theming is governed by source-of-truth files, not by ad-hoc colour
overrides in markdown bodies.

**Source of truth.** The full Warm Meridian token catalogue lives in
`docs/design/warm-meridian-implementation-spec.md` (semantic tokens,
typography scale, dark-mode behaviour, accessibility constraints). The
philosophy that drives the catalogue lives in
`docs/design/warm-meridian-philosophy.md`. The visual identity sheet
is `docs/design/warm-meridian-identity.pdf`.

**Mirror file.** Tokens used by the docs site are mirrored in
`docs-site/src/styles/warm-meridian.css`. A CI token-drift guard fails
the build if the mirrored block drifts from `app/globals.css` per
TECH §2.7.

**Authoring constraints.**

- Markdown bodies do NOT define colour values. Theming is a runtime
  concern — authors use Starlight callouts (`:::note`, `:::tip`,
  `:::caution`, `:::danger`) and Markdown structure, not inline
  styles.
- New typography hooks (e.g. a new heading rule) are added in
  `app/globals.css` first, then mirrored into the docs-site CSS — never
  the other way around.
- Code blocks render via expressive-code per TECH §2.8; line numbers
  and syntax themes are configured globally, not per-page.

---

## 3. AI-invisibility policy reference

The Knowledge Hub treats AI as invisible infrastructure, not a visible
product feature. AGENTS.md §5 is canonical for the rule set; this
section is a pointer per OQ-PLAN-3 Option A non-duplication. See
AGENTS.md §5 for the four rules, the CI-enforced forbidden-token
regex, and the authoring-discipline guidance. The full policy lives in
`docs/reference/ai-visibility-policy.md`.

**Operational reminders for docs work.**

- The docs site CI guard fails the build when any synced page matches
  `AI-powered|Sparkles|powered by (Claude|GPT|Anthropic|OpenAI)` per
  TECH §2.10 + `docs-site/__tests__/ai-invisibility-guard.test.ts`.
- Internal engineering docs under `docs/specs/` and `docs/plans/` may
  name the model in mechanism-level explanations (see AGENTS.md §5.4
  for the carve-out).
- When summarising platform-derived values, describe them as platform
  attributes — never as "AI-generated" outputs.

---

## 4. UK English requirements

All docs-corpus prose uses UK English. AGENTS.md §1 is canonical for
the rule set; this section is a pointer per OQ-PLAN-3 Option A
non-duplication. See AGENTS.md §1 for orthography, date format
(DD/MM/YYYY), quote conventions, and the tone rules.

**Operational reminders for docs work.**

- Dates in body prose: `21/05/2026`, never `05/21/2026` or
  `2026-05-21`. ISO 8601 is permitted inside code blocks and YAML
  frontmatter values where the surrounding tool requires it.
- The `kh_last_verified` frontmatter field is enforced by the Zod
  regex `/^\d{2}\/\d{2}\/\d{4}$/` in
  `docs-site/src/content.config.ts`. A malformed value fails the
  build at `astro check` time per Inv-16.
- No marketing copy. No emoji in markdown bodies. No
  reader-as-prospect framings.

---

## 5. Documentation inventory — do not recreate existing docs

Before authoring a new doc, consult
`docs/reference/documentation-inventory.md`. This file is the
canonical index of every reference doc, runbook, and spec the docs
corpus already carries. Docubot and the ported skills consult it
during the authoring pass per Inv-31; missing-docs uses it to scope
its audit per Inv-40.

**Authoring discipline.**

- Search the inventory by topic before drafting. Most "missing doc"
  intuitions resolve to an existing page that needs updating, not a
  new file.
- If a relevant page exists, extend it. The site's
  `<!-- Last verified -->` header bumps when content changes; that is
  the freshness signal.
- If no page exists, create one in the correct space per §1 — and add
  an entry to `docs/reference/documentation-inventory.md` in the same
  commit so the index stays accurate.
- Reference docs (under `docs/reference/`) carry a
  `<!-- Last verified: DD/MM/YYYY -->` header beneath the title. Bump
  the header whenever the canonical facts change.

---

## 6. Commit and PR conventions

Docs-corpus changes use the same Conventional Commits convention as
the rest of the project. Commits run through
`commit-commands:commit-push-pr` when shipping a docs PR end-to-end,
or `commit-commands:commit` for local commits without a PR.

**Commit-message shape.**

- `docs(<scope>): <subject>` for additions and edits inside `docs/` —
  e.g. `docs(reference): refresh schema-quick-reference for S62 W2`.
- `feat(docs-site): <subject>` for changes to the docs site itself
  (Astro config, theming, sync script).
- `fix(<scope>): <subject>` for corrections to published docs that
  resolve a reader-reported defect.
- Body cites the spec slice or task ID — e.g. `ID-9.10` or
  `PRODUCT.md Inv-52` — so future readers can find the acceptance
  criterion fast.

**PR shape.**

- One concern per PR. A docs PR that also bundles unrelated code
  changes is a candidate for split.
- The PR description references the source spec or runbook update
  that triggered the change. If the trigger was a code change (schema
  rename, MCP tool addition, route move), the description names the
  PR that introduced it.
- Reviews routed via `review-docs-pr` post a single, structured
  comment (see §7) — manual reviewers add inline comments alongside.

---

## 7. Single-comment guardrail

Docubot and the ported skills post **exactly one** comment per PR
review per run. The pattern is ported verbatim from Warp (per Inv-27)
and prevents reviewer-noise from drowning out the substantive
findings.

**Mechanics.**

- A skill's run emits one consolidated `review.json` or report
  artefact (per the skill's contract — see PRODUCT Inv-38..Inv-42).
- The driver script (`scripts/skills/run-skill.ts`) renders the
  artefact into a single comment body and posts it via
  `gh pr comment` — never via inline review comments.
- Severity-label prefixes (`[CRITICAL]`, `[IMPORTANT]`,
  `[SUGGESTION]`, `[NIT]`) sort findings inside the single comment
  body; emoji prefixes are explicitly NOT used (per the AGENTS.md §1
  no-emoji rule).
- A re-run on the same PR replaces the prior comment, not appends —
  the driver matches by a marker line in the comment body.

**Why this matters.** Multi-comment review patterns are noisy, hard
to triage at PR-close time, and break when the same skill runs more
than once on a long-lived branch. The single-comment guardrail keeps
the review surface scannable and the audit trail deterministic.
