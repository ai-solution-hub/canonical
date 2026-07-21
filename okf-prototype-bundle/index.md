---
okf_version: "0.1"
---
# canonical-okf-system baseline bundle — PROTOTYPE (ID-163 {163.10})

**Status: UNSIGNED PROTOTYPE — pending per-concept owner sign-off ({163.9} interim gate).**

First-authoring-wave output: 5 KA3-prototype concepts (4 `tool` E1 + 1 `navigation` E2)
drafted on GLM-5.2 via OpenRouter (zero Anthropic spend), grounded in the public
`canonical` repo, each carrying a public git-blob citation (DR-086). Every `tool` concept
carries a machine-extractable `expected_behaviour` assertion for the {163.11} eval.

This directory is a PROTOTYPE landing for owner review — it is NOT the real mint/promote
into the OKF bundle repository (that is {163.14}). Drafted 21/07/2026.

## tool (E1 — code-symbol grain)
- [Classify Content](tool/classify_content.md) — `classify_content` (`lib/mcp/tools/ai.ts`)
- [Find Knowledge](tool/find.md) — `find` (`lib/mcp/tools/search.ts`)
- [Get Content](tool/get.md) — `get` (`lib/mcp/tools/content.ts`)
- [Get Procurement Detail](tool/get_procurement_detail.md) — `get_procurement_detail` (`lib/mcp/tools/procurement.ts`)

## navigation (E2 — markdown-page grain)
- [Extend Registry Vendor-In Provenance](navigation/extend-registry-provenance.md) — `docs/extend-registry-provenance.md`
