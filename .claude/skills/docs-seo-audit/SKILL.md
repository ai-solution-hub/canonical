---
name: docs-seo-audit
description:
  Audits the Knowledge Hub docs site for SEO issues across three severity tiers
  (error / warning / info) — titles, descriptions, alt text, link text,
  headings, thin content, and more. EMITS findings only and ASKS before
  fixing; never auto-rewrites. Runs monthly once the site is deployed (cron
  committed but commented per OQ-T3) plus on demand. Driven by
  scripts/skills/run-skill.ts.
allowed-tools: Read, Bash, Grep, Glob
---

# docs-seo-audit — KH docs SEO auditor

Loaded by `scripts/skills/run-skill.ts` alongside `AGENTS.md` and
`.claude/skills/keep-docs-in-sync/SKILL.md`.

Spec source: `docs/specs/astro-starlight-docs-foundation/TECH.md` §4.7;
`docs/specs/astro-starlight-docs-foundation/PRODUCT.md` Inv-42.

---

## 1. The audit

`.claude/skills/docs-seo-audit/scripts/audit_seo.py` scans
`docs-site/src/content/docs/**/*.md` and reports the twelve issue types in
`references/seo_issues.md`, across three severity tiers (error / warning /
info):

```bash
python3 .claude/skills/docs-seo-audit/scripts/audit_seo.py \
  --root docs-site/src/content/docs
```

Output is JSON (`{issue_types, findings[]}`); each finding carries `path`,
`issue`, `tier`, and `detail`.

## 2. ASK before fixing (Inv-42 guardrail)

ASK before fixing. This skill EMITS findings; it does NOT auto-rewrite pages.
A mass-rewrite is gated on explicit human approval via a follow-up
`workflow_dispatch` with a `--fix` mode (not implemented at foundation). When
reporting, group findings by tier and propose fixes — but do not apply them
until a human approves. This guardrail is preserved verbatim from Warp's
docs-seo-audit: never bulk-edit the corpus on the strength of an automated SEO
heuristic alone.

## 3. Trigger + deferral (OQ-T3)

Monthly on the 1st at 07:00 UTC (`0 7 1 * *`) plus `workflow_dispatch`. Per
OQ-T3 the `schedule:` block is committed COMMENTED OUT in
`.github/workflows/docs-seo-audit.yml` — the audit needs the deployed site's
sitemap to exist first. A follow-up commit uncomments the cron once the site
is live.

## 4. Output

Write the audit JSON + any proposed-fix notes under
`.skills/docs-seo-audit/output/`.
