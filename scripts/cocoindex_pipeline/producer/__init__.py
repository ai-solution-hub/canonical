"""OKF concept-producer package (ID-132) — net-new sibling flow entry point to
`scripts/cocoindex_pipeline/flow.py`.

Hosts the L-records Source adapter, the Anthropic tool-use agent loop, and
the two-pass `enrich_concept` / `run_web_pass` components that draft and
enrich the client-owned OKF concept bundle. See
`docs/specs/id-132-okf-concept-producer/TECH.md` for the architecture.
"""
