---
name: missing-docs
description:
  Two-phase docs-gap auditor for Knowledge Hub. Phase 1 runs audit_docs.py
  (four sub-audits: env vars, CLI commands, MCP/route surfaces, terminology
  staleness) to list documentation gaps. Phase 2 drafts the fills from
  kh_surface_map.md and opens a docs PR per gap cluster. workflow_dispatch-only
  at foundation. Driven by scripts/skills/run-skill.ts.
allowed-tools: Read, Bash, Grep, Glob, Write, Edit
---

# missing-docs — KH documentation-gap auditor

Loaded by `scripts/skills/run-skill.ts` alongside `AGENTS.md` and
`.claude/skills/keep-docs-in-sync/SKILL.md`.

Spec source: `docs/specs/id-9-astro-starlight-docs-foundation/TECH.md` §4.5;
`docs/specs/id-9-astro-starlight-docs-foundation/PRODUCT.md` Inv-40.

---

## 1. Phase 1 — audit (four sub-audits)

Run `.claude/skills/missing-docs/scripts/audit_docs.py` once per sub-audit:

```bash
python3 .claude/skills/missing-docs/scripts/audit_docs.py --audit env-vars     --root .
python3 .claude/skills/missing-docs/scripts/audit_docs.py --audit cli-commands --root .
python3 .claude/skills/missing-docs/scripts/audit_docs.py --audit mcp-routes   --root .
python3 .claude/skills/missing-docs/scripts/audit_docs.py --audit terminology  --root .
```

Each emits `{"audit": <name>, "missing": [ ... ]}` to stdout:

1. **env-vars** — names in `.env.example` or `process.env.X` (across `lib/`,
   `app/`, `scripts/`) not mentioned in `runbooks/` docs.
2. **cli-commands** — `package.json` `scripts` keys not mentioned in
   `runbooks/` docs.
3. **mcp-routes** — MCP tool names (`lib/mcp/tools/*.ts`) + API route paths
   (`app/api/**/route.ts`) absent from `reference/{mcp-inventory,api-routes}.md`.
4. **terminology** — stale terms (per `references/stale_terms.md`) occurring in
   the docs corpus, with the canonical replacement.

By default `--docs-root` is `docs-site/src/content/docs`; override it (and
`--terms`) to scope the audit, e.g. against a fixture tree.

## 2. Phase 2 — draft

For each gap cluster, read `references/kh_surface_map.md` to find the target
space + page, read 2-3 strong existing examples in that space, then draft the
fill. Do not invent behaviour — cite the source surface that proves the gap.
Open one docs PR per gap cluster, following KH commit + PR conventions and the
single-comment guardrail.

## 3. Phase independence

The two phases are independently triggerable via the `workflow_dispatch`
`prompt_override` (`phase: audit` vs `phase: draft`). At foundation the
workflow is `workflow_dispatch`-only (OQ-T2); a monthly schedule may be added
in Phase 2.

## 4. Output

Write the audit JSON + any draft notes under `.skills/missing-docs/output/`.
