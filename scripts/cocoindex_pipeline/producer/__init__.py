"""OKF concept-producer package (ID-132) — net-new sibling flow entry point to
`scripts/cocoindex_pipeline/flow.py`.

Hosts the L-records Source adapter, the Anthropic tool-use agent loop, and
the two-pass `enrich_concept` / `run_web_pass` components that draft and
enrich the client-owned OKF concept bundle. See
`docs/specs/id-132-okf-concept-producer/TECH.md` for the architecture.

Modules: `resource_uri` (BI-6/7/8/9/10 `canonical://` builder), `frontmatter`
(BI-12 frontmatter emitter), `validator` (BI-13 concept-frontmatter
validator gate — `{132.7}` G-VALIDATE), `agent_loop` (Anthropic tool-use
loop port + Pass-1/Pass-2 tool schemas — `{132.5}` G-LOOP + `{132.9}`
G-PASS2's `WEB_FETCH_TOOL`), `prompts` (Pass-1/Pass-2 instruction prompts —
`{132.8}` G-PASS1 + `{132.9}` G-PASS2), `enrich` (`enrich_concept` —
Pass-1 concept drafting from L-records ONLY, `{132.8}` G-PASS1), `web_pass`
(`run_web_pass` — Pass-2 gated enrichment from the client's own
authoritative sources ONLY via a net-new host-allowlist/depth-limit/
path-filter gate, `{132.9}` G-PASS2), `bundle_writer` (`declare_concept` —
the BI-13-gated `declare_file` write call site — plus `regenerate_indexes`
(`index.md` progressive-disclosure nav), the `log.md` append-only run
appender, and the DR-027 ontology artefact writer, `{132.10}` G-BUNDLE). No
barrel re-exports here — import each module directly (project convention,
`CLAUDE.md` §Conventions).
"""
