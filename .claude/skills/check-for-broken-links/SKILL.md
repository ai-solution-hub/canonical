---
name: check-for-broken-links
description:
  Walks the Knowledge Hub docs-site content tree and reports broken internal
  links across five error types (file-not-found, case-mismatch, missing
  .md/.mdx target, cross-space relative path, external 4xx/timeout). Runs daily
  plus on demand, and is invoked from inside review-docs-pr. Posts findings via
  --gh-pr-comment (replaces Warp --slack-notify). Driven by
  scripts/skills/run-skill.ts.
allowed-tools: Read, Bash, Grep, Glob
---

# check-for-broken-links — KH docs link walker

Loaded by `scripts/skills/run-skill.ts` alongside `AGENTS.md` and
`.claude/skills/keep-docs-in-sync/SKILL.md`.

Spec source: `docs/specs/id-9-astro-starlight-docs-foundation/TECH.md` §4.6;
`docs/specs/id-9-astro-starlight-docs-foundation/PRODUCT.md` Inv-41 + Inv-12.

---

## 1. The walker

`.claude/skills/check-for-broken-links/scripts/check_links.py` walks
`docs-site/src/content/docs/**/*.md` and classifies every internal link:

```bash
python3 .claude/skills/check-for-broken-links/scripts/check_links.py \
  --root docs-site/src/content/docs
# add --check-external to also probe http(s) links (default timeout 10s)
# add --gh-pr-comment to have the caller post findings on the PR
```

Five error types (Inv-41):

1. **file-not-found** — the target path does not exist.
2. **case-mismatch** — the target exists only under a different case (Astro is
   case-sensitive in production even when the dev host's filesystem is not).
3. **missing-mdx-ext** — a directory-style or extensionless link with no
   `.md`/`.mdx` (or `index.md`) target.
4. **cross-space-relative** — a relative link that climbs into another IA space
   (`../runbooks/x`); cross-space links MUST be absolute (Inv-6).
5. **external-error** — an external URL that returns HTTP 4xx or times out
   (only when `--check-external` is set).

Output is JSON (`{error_types, findings[]}`); exit code 1 when findings exist.

## 2. When this runs

- **Daily** at 05:00 UTC (`0 5 * * *`, OQ-T2 ratified default).
- **On demand** via `workflow_dispatch`.
- **From inside `review-docs-pr`** — the reviewer invokes this walker over the
  changed pages and folds link findings into its review (Warp's composition).

## 3. Reporting

With `--gh-pr-comment`, post findings as a single PR comment (one line per
finding: `path:line — error_type — href`), honouring the single-comment
guardrail. Without it, findings go to stdout + the run artefact. This skill
reports; it does not auto-rewrite links.

## 4. Relationship to the build-time guard

`docs-site/scripts/check-broken-links.ts` is the build-time guard that fails
`bun run build` on broken internal links (Inv-12). This skill is the scheduled
+ on-demand walker with the richer five-type taxonomy and external-link
probing; the two are complementary.
