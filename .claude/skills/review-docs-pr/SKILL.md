---
name: review-docs-pr
description:
  Reviews Knowledge Hub documentation pull requests — both docubot-opened
  docs PRs (Phase-2 composability per Inv-35) and human-authored docs PRs.
  Emits a structured review.json (summary + severity-labelled comments) and
  posts the findings as a single source-PR comment. Ported from Warp's
  review-docs-pr, KH-adapted (UK English, no emoji, AI-invisibility, Warm
  Meridian). Driven by scripts/skills/run-skill.ts.
allowed-tools: Read, Bash, Grep, Glob, Write
---

# review-docs-pr — KH docs PR reviewer

This skill reviews a documentation pull request and produces an actionable
review. It is loaded by `scripts/skills/run-skill.ts` alongside `AGENTS.md`
(voice, terminology, frontmatter, AI-invisibility) and
`.claude/skills/keep-docs-in-sync/SKILL.md` (IA conventions, commit + PR
conventions, the single-comment guardrail).

Spec source: `docs/specs/astro-starlight-docs-foundation/TECH.md` §4.3;
`docs/specs/astro-starlight-docs-foundation/PRODUCT.md` Inv-35 + Inv-38.

---

## 1. When this runs

- **Docubot-opened docs PRs (Inv-35 Phase-2 composability).** After docubot
  opens a docs PR, this skill runs a second auto-review pass over it.
- **Human-authored docs PRs.** Any PR whose head branch is `docubot/*`, or
  whose base is `main` and whose title starts with `Docs:`.
- **On demand.** `workflow_dispatch` with an optional `target_pr_number`.

The workflow's job-level `if:` filters to those branches/titles so the review
only runs against documentation PRs.

## 2. What to review

Scope the review to the PR's changed files under `docs/` and
`docs-site/src/content/docs/`. For each changed page, check:

1. **Truth + scope.** Does the prose match the behaviour the source PR
   introduced? Flag invented or unsupported claims.
2. **Frontmatter contract.** `title` present; `kh_last_verified` (when used)
   is `DD/MM/YYYY`; `kh_docubot_owned: true` on docubot-written pages. See
   AGENTS.md §3.
3. **IA + cross-links.** Page lives in the correct space
   (product-functionality / ontology / reference / runbooks / decisions).
   Cross-space links use absolute site paths, never relative (Inv-6).
4. **Voice + UK English.** UK orthography (`colour`, `organisation`,
   `behaviour`), professional-direct tone, no marketing copy (AGENTS.md §1).
5. **AI-invisibility.** No "AI-powered" badges, no Sparkles iconography, no
   model names in user-facing copy (`docs/reference/ai-visibility-policy.md`).
6. **Warm Meridian.** Visual callouts/components follow the design tokens; do
   not introduce raw colours (link the design spec when relevant).
7. **No emoji** in any markdown body (AGENTS.md §1.4).

## 3. Output contract (Inv-38)

Write `.skills/review-docs-pr/output/review.json` with this exact shape:

```json
{
  "summary": "One-paragraph summary of the review outcome.",
  "comments": [
    {
      "path": "docs-site/src/content/docs/reference/example.md",
      "line": 42,
      "severity": "IMPORTANT",
      "body": "What is wrong and the specific fix."
    }
  ]
}
```

- `severity` is one of `CRITICAL`, `IMPORTANT`, `SUGGESTION`, `NIT` — the Warp
  labels ported WITHOUT emoji (KH no-emoji rule). Never use emoji severity
  glyphs.
- `path` is repo-relative; `line` is the line in the changed file.
- `body` states the problem and the concrete fix, not a vague observation.

## 4. Posting the review (single-comment guardrail)

Post the review as exactly ONE comment on the source PR, at the END of the
run, never earlier (per keep-docs-in-sync single-comment guardrail). Build the
comment body from `review.json`:

- Open with the `summary`.
- List each `comments[]` entry as one line prefixed with the bracketed
  severity, e.g. `[CRITICAL] path:line — body`.
- If there are no findings, post a one-paragraph "no changes requested"
  comment explaining why the docs PR reads correctly.

Post with `gh pr comment "$PR_NUMBER" --body "<composed body>"`. Do not open
new PRs and do not push commits — this skill reviews, it does not rewrite.

## 5. Composability

Before finalising, invoke the broken-link walker over the changed pages:
`bun scripts/skills/run-skill.ts --skill check-for-broken-links` (or run its
`check_links.py` directly) and fold any link findings into `review.json` as
`IMPORTANT` severity. This mirrors Warp's review→link-check composition.
