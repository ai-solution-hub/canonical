# Audit: `scripts/` (area = scripts)

Branch `jscpd-dupe-audit`. READ-ONLY findings. 94 top-level script files + subdirs
(cocoindex_pipeline, codemods, config, fixtures, lib, mcp-eval, ontology-sync, output,
propagation, spikes, tests). ~108k LOC — largest non-test area.

Wiring proof method (all UNSANDBOXED greps + ast-dataflow + git creation-commit dates):
- `pkg` = referenced in `package.json` "scripts"
- `ci` = referenced in `.github/workflows/**`
- `vercel` = referenced in `vercel.json` crons (NB: scripts are never vercel crons — those are `app/api/cron/*` routes)
- `src` = imported by `app/ | lib/ | components/ | hooks/`
- `test` = imported/spawned by `__tests__/ | e2e/ | scripts/tests/`
- `coco-deploy` = packaged into the onprem image (`onprem-deploy.yml` packages ONLY `scripts/cocoindex_pipeline/*.py`, entrypoint `python3 -m scripts.cocoindex_pipeline.server`)

## Headline

`scripts/cocoindex_pipeline/` is the LIVE declarative pipeline (deployed via onprem-deploy.yml,
imported by app/lib) — NOT a retire target. The retire surface is the **one-shot backfill/migration
family** (Mar–Apr 2026 creation, zero refs anywhere, migrations already executed, none on the
forward-looking roadmap) and a handful of **stranded research/triage one-shots**. The dominant
DUPLICATION is NOT the Supabase client (already shared: `scripts/lib/supabase-script-client.ts`,
51 importers) but the **`loadEnv()` worktree-walker (38 copies) + `assertEnvFlag()` (34 copies) +
per-script `parseArgs` batch boilerplate** that should move into `scripts/lib/`.

---

## A. RETIRE batch — one-shot backfills/migrations (already executed, 0 refs, off-roadmap)

Pre-pivot check performed: none of these task IDs (S192/WP3, Plan-D, WP-B, ID-102.8, Phase-6A) appear
in the live `product-roadmap.json` — all are completed/superseded work. All have 0 non-self references
across `.ts/.py/.md/.json/.yml/.sh` (excluding their own test). Each is a "find rows missing X, write X"
or "migrate column" driver whose migration has run.

| Script | LOC~ | Created | Evidence | Disposition |
|---|---|---|---|---|
| `backfill-canonicalise-ai-keywords.ts` | 190 | 2026-04-23 (S192 WP3) | 0 refs; idempotent ai_keywords canonicalise, run once | RETIRE (archive) |
| `backfill-classify-content-items.ts` | ~ | 2026-03 | 0 non-test refs; `@ts-nocheck`; targeted feed→content classify backfill, cocoindex now classifies incrementally | RETIRE |
| `backfill-content-history-v1.ts` | ~ | 2026-03 | 0 refs; v1 content_history seed | RETIRE |
| `backfill-context-snippets.ts` | ~ | 2026-03-30 | 0 refs; entity context-snippet seed | RETIRE |
| `backfill-layers.ts` | ~ | 2026-03-31 | 0 refs; layer-inference one-shot (Py inference is the live path) | RETIRE |
| `backfill-source-documents.ts` | ~ | 2026-03-20 | collapse-list §222 `[CONDITIONAL-RETIRE]` (Option β); 0 refs | RETIRE (or keep-noted if Option α retained) |
| `backfill-temporal-bridge.ts` | ~ | 2026-04-01 | 0 refs; "backfill for Python-ingested content" — pre-cocoindex | RETIRE |
| `backfill-temporal-entity-matches.ts` | ~ | 2026-04 | 0 refs; temporal entity-match seed | RETIRE |
| `batch-rescore-articles.ts` | ~ | 2026-03 | 0 refs; header says re-runs scoring on rows with a bug "already fixed in lib/intelligence/relevance-scorer.ts" — textbook one-shot | RETIRE |
| `batch-populate-topics.ts` | ~ | 2026-03 | 0 refs; "populate topic_id for items missing it" ad-hoc | RETIRE |
| `batch-generate-summaries.ts` | ~ | 2026-03-27 | 0 refs; "generate summaries for items that don't have them yet" ad-hoc (hot jscpd node, 13 pairs) | RETIRE |
| `normalise-entities.ts` | ~ | — | 0 refs; one-shot entity normalise | RETIRE |
| `reembed-missing-embeddings.ts` | ~ | — | 0 refs; "re-embed rows missing embeddings" ad-hoc | RETIRE |
| `migrate-ledger-ids-to-string.ts` | ~ | 2026-06-11 | 0 refs; ID-102.8 atomic flag-day string-id migration — explicitly a one-time flag-day, already flipped | RETIRE |
| `restore-eval-corrupted-items.ts` | ~ | 2026-06-18 | 0 refs; eval-corruption recovery one-shot | RETIRE |
| `wipe-procurement-responses.ts` | ~ | — | 0 refs; destructive test-data wipe (hot jscpd node w/ propagate-cert-metadata) — dev convenience, candidate fold into seed harness | RETIRE-or-CONSOLIDATE |
| `wp-b-triage-report.ts` | ~ | — | `@ts-nocheck`; Phase-0a CSV emitter whose consumer `scripts/wp-b-apply-triage.ts` was NEVER built (GONE) → stranded one-shot | RETIRE |
| `seed-platform-from-staging.ts` | ~ | — | 0 pkg/ci/src refs; one-shot platform reseed (distinct from CI-wired seeds) | RETIRE-or-keep-noted (operator tool) |

All RETIRE rows: `needs_caller_verify=true` (confirm migration ran in prod / archive rather than hard-delete).

---

## B. RETIRE/keep-noted — stranded research one-shots (Plan-D, spikes)

| Script | Evidence | Disposition |
|---|---|---|
| `snapshot-content-state.ts` | Plan-D D4 snapshot; not in CI/pkg; hot jscpd node (clones propagate-cert-metadata) | keep-noted (research; numbers captured) |
| `compare-quality.ts` | Plan-D D4 compare; HAS `__tests__/scripts/compare-quality.test.ts` → test-covered, do NOT hard-delete | keep-noted |
| `embedding-smoke-test.ts` | Plan-D D3; HAS `__tests__/scripts/embedding-smoke-test.test.ts`; hot jscpd node (11 pairs) | keep-noted |
| `calibrate-coverage-thresholds.ts` | coverage-threshold calibration helper; biggest crossdir clone (59 lines w/ mcp-eval/fixtures.ts + 64 w/ kb-search.ts) | keep-noted / CONSOLIDATE harness |
| `spikes/ast-heading-population-eval.py` | header: "NON-PRODUCTION. One-shot spike harness", numbers in id-56 doc | RETIRE (archive) |
| `spikes/recursive-splitter-eval.py` | id-56 {56.5} research spike, ratification numbers already captured | RETIRE (archive) |
| `spikes/id75-executor-verify-1-memo-probe.py` | one-off probe | RETIRE (archive) |

---

## C. RETIRE — orphan python analysis/debug tooling (not in deploy image, 0 refs)

The onprem image packages ONLY `cocoindex_pipeline/*.py`; these standalone py tools are not deployed,
not in CI, not imported by the pipeline:

| Script | Evidence | Disposition |
|---|---|---|
| `keyword_classifier.py` | Phase-2 (2026-03-04) "bid library Q&A keyword classify"; pre-procurement-rename, pre-cocoindex; only self/1-test ref; cocoindex `holder_rule.py`/classification supersedes | RETIRE (verify no pipeline import) |
| `extract_pdf_images.py` | "Initial fork from IMS codebase" (2026-03-03); 0 refs; cocoindex `form_extractors/pdf.py` is the live PDF path | RETIRE |
| `analyze_claude_session_tokens.py` | personal token-economics analyser (Headroom research); 0 refs | keep-noted (dev tool) |
| `audit-cross-arm-contamination.py` | orchestration QA audit tool (kh-s199b); 0 refs | keep-noted (dev/orchestration tool) |
| `extract-agent-usage.py` | per-agent token extractor; 0 refs | keep-noted (dev/orchestration tool) |
| `compute-bertscore.py` | eval metric helper; 1 ref | keep-noted |

NB on the `bid_worker.py` chain — KEEP, with dead branches: `bid_worker.py` is the LIVE
template-ops worker (`template_fill` job still enqueued by `app/api/procurement/[id]/templates/[templateId]/fill/route.ts:191`; documented as active in id-52 ACCEPTANCE §6 which surgically removed only the `template_analyse` branch). Its `tender_extract_docx`/`tender_extract_pdf_text` branches are NOW DEAD (no TS enqueues them — superseded by `cocoindex_pipeline/form_extractors/{docx,pdf}.py`). Companions KEEP: `fill_template.py`, `analyse_template.py` (reused by {52.11} DOCX reader), `extract_tender_questions.py`, `extract_pdf_text.py`, `docx_cell_to_markdown.py`, `docx_utils.py`. Recommendation: prune the two dead `tender_extract_*` branches inside `bid_worker.py` (RESTRUCTURE, not file-retire).

---

## D. CONSOLIDATE — the duplication story (the real jscpd signal)

`scripts/lib/supabase-script-client.ts` (ID-115, `createScriptClient`) is ALREADY shared (51 importers),
so client creation is not the dup. The copied boilerplate is everything AROUND it:

| Copied unit | Count (UNSANDBOXED grep) | Proof |
|---|---|---|
| `function loadEnv()` worktree-walking env loader | **38 files** | `grep -rl "function loadEnv" scripts/` = 38 |
| `function assertEnvFlag()` (`--env=prod` guard) | **34 files** | `grep -rl "function assertEnvFlag"` = 34 |
| `while (dir !== '/')` env-walk inline | 19 files | grep = 19 |
| eval harness scaffold | 7 legacy eval-*.ts | jscpd: eval-procurement-drafting↔eval-search/summarisation/classification (17/8/12 pairs) — BUT already share `lib/eval/{baseline,fixtures,metrics,reporter,types}` so residual dup is the main()/CLI shell only |

jscpd "biggest" clones confirming the loadEnv/assertEnvFlag block (lines ~18–92):
- `backfill-canonicalise-ai-keywords.ts` ↔ `backfill-temporal-bridge.ts` (61 lines), ↔ `propagate-cert-metadata.ts` (61), ↔ `backfill-layers.ts` (35), ↔ `cleanup-tags.ts` (35)
- `backfill-content-history-v1.ts` ↔ `backfill-source-documents.ts` (59), ↔ `backfill-context-snippets.ts` (33)
- `calibrate-coverage-thresholds.ts` ↔ `kb-search.ts` (64) ↔ `mcp-eval/fixtures.ts` (59)
- `propagate-cert-metadata.ts` (HOT) ↔ `seed-procurement-test-data.ts` (42), ↔ `snapshot-content-state.ts` (35), ↔ `wipe-procurement-responses.ts` (38)
- `catalogue-from-instance.ts` ↔ `verify-user-profiles-parity.ts` (43), ↔ `seed-e2e-users.ts` (40)
- `generate-purge-path-inventory.ts` ↔ `sweep-identity-relocation.ts` (45)
- python: `spikes/ast-heading-population-eval.py` ↔ `recursive-splitter-eval.py`

### Proposed shared harness — `scripts/lib/`
Add four modules and have all live scripts import them (eliminates ~38× duplicated env/arg/setup):
1. `scripts/lib/load-env.ts` — the single worktree-walking `loadEnv()` (delete the 38 copies).
2. `scripts/lib/script-env.ts` — `assertEnvFlag(env,url)` + `resolveSupabaseEnv()` returning `{url,key,env}` (replaces 34 copies + the SUPABASE_URL/KEY resolution stanza).
3. `scripts/lib/batch-args.ts` — standard `parseBatchArgs()` → `{ apply, limit, env }` (the `--apply`/`--limit`/`--env=prod` dry-run trio).
4. `scripts/lib/batch-runner.ts` — a `runBatch({ select, transform, write, dryRun })` loop (the read-page→diff→write-changed-rows loop copied across every backfill/propagate script).
For evals, the residual `main()→saveBaseline` shell already collapses into `eval-runner.ts` + `eval-register-suites.ts` (the central dispatcher); the 7 legacy `eval-*.ts` keep their suite fn but should shed their standalone CLI `main()` once `eval-runner --suite X` covers single-suite runs.

---

## E. KEEP — wired (proof in parens)

- Build/generate (predev/prebuild): `generate-skills-inline` (pkg), `generate-content-type-values` (pkg+src×2), `generate-client-branding-map` (pkg+src×2), `fetch-client-branding` (pkg), `bundle-mcp-apps` (pkg), `bundle-plugin` (pkg+src), `sync-plugin-taxonomy` (pkg), `generate-classification-prompt-taxonomy` (pkg+src), `generate-taxonomy-snapshot` (pkg), `generate-entity-aliases-snapshot` (CONSUMED by `cocoindex_pipeline/canonicalisation.py:286`)
- CI guards: `check-knip-baseline` (pkg+ci), `audit-opaque-json-rpcs` (ci), `check-api-view-coverage` (ci), `generate-api-views` (ci), `check-token-parity` (ci), `run-supabase-advisors` (ci), `eval-holder-rule-ts` (ci), `eval-runner` (eval-nightly.yml `--all`), `db-row-count-diff` (pkg), `cleanup-orphaned-content-history` (pkg+ci), `cleanup-stale-test-artifacts` (pkg), `staging-reference-refresh.sh` (ci), `propagate-cert-metadata` (ci)
- Eval suites (registered into eval-runner via `eval-register-suites.ts`, 10 suites): `eval-classification`, `eval-search`, `eval-summarisation`, `eval-procurement-drafting`, `eval-entity-classification`, `eval-tag-morphology-adoption`, `eval-holder-rule-ts` + mcp-eval/{protocol-compliance,response-quality,functional-correctness}. KEEP all.
- Ledger toolchain: `ledger-cli` (56 refs), `ledger-server-client`+`ledger-server-lifecycle` (imported by ledger-cli), `ledger-compact-done` (WS-B3 driver — 0 refs but a live operator tool, keep-noted), `ledger-differential-parity`, `regen-mirrors.sh` (14 refs). KEEP.
- Seeds wired in test/CI: `seed-e2e-users` (pkg+ci+e2e), `seed-integration-fixtures`, `seed-admin-dedup-fixtures`, `seed-procurement-test-data` (e2e fixtures), `mcp-eval/seed-fixtures` (pkg). KEEP.
- Operator/governance tools (0-caller but built-not-wired or live-ops): `set-data-api-exposure` (ID-115 client-provisioning, runbook step), `seed-tenant-from-bundle`+`reseed-tenant-instance` ({95.14} operator seam), `export-user-data` (GDPR Art.15/20 — legally required), `kh-output-budget` (ID-92 result-size wrapper), `detect-roadmap-shipped-framings` (roadmap guard), `catalogue-standard-sq`/`catalogue-from-instance` (collapse-list §260: retire ONLY after AI-cataloguer skill — NOT yet → keep-noted), `gitnexus-analyze` (pkg), `kb-search` (pkg), `ast-dataflow-cli` (pkg), `quality-gate` (config-driven). KEEP/keep-noted.
- `codemods/` — RECOVERED for ID-50 route rollout (recent commit `539d861e revert(codemods): restore ID-50 wrap-define-route codemod`); README says "run by hand". KEEP (built-not-wired cluster A).
- `cocoindex_pipeline/` (entire dir) — LIVE pipeline, deployed. KEEP.

---

## F. Proposed target `scripts/` structure (by lifecycle)

```
scripts/
  lib/                      # shared harness (ADD load-env, script-env, batch-args, batch-runner)
  pipeline/                 # = current cocoindex_pipeline/ (live, deployed)   [rename for clarity]
  live-ops/                 # operator/governance tools run on demand:
                            #   set-data-api-exposure, seed-tenant-from-bundle, reseed-tenant-instance,
                            #   export-user-data, db-row-count-diff, run-supabase-advisors, kh-output-budget
  ci/                       # CI-only guards: check-*, audit-*, generate-api-views, propagate-cert-metadata,
                            #   staging-reference-refresh.sh, cleanup-orphaned-content-history
  generate/                 # build-time codegen: generate-* + bundle-* + sync-plugin-taxonomy + fetch-client-branding
  eval/                     # eval-runner, eval-register-suites, eval-*.ts suites, mcp-eval/, config/quality-gate/
  ledger/                   # ledger-*, regen-mirrors.sh
  seed/                     # seed-* (test/CI fixtures)
  codemods/                 # one-by-hand ts-morph migrations (keep)
  one-shot-archive/         # RETIRE here (or git-rm): backfill-*, batch-*, migrate-*, normalise-entities,
                            #   reembed-missing-embeddings, wp-b-triage-report, restore-eval-corrupted-items,
                            #   keyword_classifier.py, extract_pdf_images.py, spikes/
  tests/                    # (unchanged) python pipeline tests
```

Net retire/consolidate estimate: ~18 one-shot files removed/archived (~3–4k LOC) + ~38× `loadEnv`/34× `assertEnvFlag`/batch-loop dedup folded into 4 shared modules (~1.5–2k LOC saved, the bulk of the jscpd scripts/ clone count).
