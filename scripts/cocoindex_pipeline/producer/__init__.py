"""OKF concept-producer package (ID-132) — net-new sibling flow entry point to
`scripts/cocoindex_pipeline/flow.py`.

Hosts the L-records Source adapter, the Anthropic tool-use agent loop, and
the two-pass `enrich_concept` / `run_web_pass` components that draft and
enrich the client-owned OKF concept bundle. See
`docs/specs/id-132-okf-concept-producer/TECH.md` for the architecture.

Modules: `resource_uri` (BI-6/7/8/9/10 `canonical://` builder), `frontmatter`
(BI-12 frontmatter emitter), `validator` (BI-13 concept-frontmatter
validator gate — `{132.7}` G-VALIDATE), `agent_loop` (Anthropic tool-use
loop port), `prompts` (Pass-1 instruction prompt — `{132.8}` G-PASS1),
`enrich` (`enrich_concept` — Pass-1 concept drafting from L-records ONLY,
`{132.8}` G-PASS1). No barrel re-exports here — import each module directly
(project convention, `CLAUDE.md` §Conventions).
"""
