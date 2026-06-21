# lib/ audit — duplication, retire, structure/naming (branch jscpd-dupe-audit)

Read-only audit. Caller counts proven via `bun scripts/ast-dataflow-cli.ts importers/callers`.
Greps run unsandboxed. jscpd data from docs/reports/jscpd-report/{analysis,jscpd-report}.json.

## 1. Display-name "three surfaces" — NOT duplication, it's a NAMING split (rename/relocate)

Three files, three distinct layers, each with real distinct live callers:

- `lib/user/display-name.ts` (`getUserDisplayName`) — SINGLE signed-in user's first-name
  greeting from auth `user_metadata`. Importers (ast-dataflow): `lib/dashboard.ts`,
  `lib/reorient.ts`, + test. 2 prod callers.
- `lib/users/display-names.ts` (`resolveUserDisplayNames`) — BATCH resolve arbitrary UUIDs
  -> public names via `get_user_display_names` RPC (S156/S34 OPS-60). Importers:
  `lib/provenance/item-provenance.ts`, `app/api/content-owners/stats/route.ts`,
  `app/api/users/display-names/route.ts`, `app/api/admin/provenance/export/verification-history/route.ts`, + tests. 4 prod callers.
- `hooks/use-display-names.ts` (`useDisplayNames`) — CLIENT hook wrapping POST
  `/api/users/display-names` with a module TTL cache. 10 component importers.

VERDICT: each is canonical for its layer. The smell is the singular-vs-plural directory
split `lib/user/` vs `lib/users/` (each holds exactly one file) which reads as a
duplicate at a glance. Recommend: merge into ONE dir `lib/users/` and rename for clarity:
`display-name.ts` -> `lib/users/self-display-name.ts` (or `auth-display-name.ts`);
keep `lib/users/display-names.ts`. The hook stays under `hooks/` (correct home). Low risk:
mechanical import-path update of 6 prod files + 3 tests; use gitnexus_rename.

## 2. lib/dashboard.ts <-> lib/reorient.ts — REAL heavy duplication (consolidate)

Both LIVE: `fetchUnifiedDashboardData` -> `app/api/dashboard/route.ts` + `app/page.tsx`;
`fetchReorientData` -> `app/api/reorient/route.ts`. Both already share types from
`@/types/reorient` and reorient already imports `getDeadlineUrgency`/`getDaysUntilDeadline`
from dashboard. jscpd reports 11 cloned fragments between them (~10k tokens), incl. the
ENTIRE activity-aggregation core duplicated verbatim:
- `mapChangeTypeToAction` (identical switch)
- `dedupeRecentWorkByEntity`
- `content_history` team-changes query + row->TeamChange mapping (clones at 311-350 / 472-561)
- `form_response_history` bid-response query + mapping (526-615)
- bid_summary building + urgencyOrder sort (661-692)
- last-write/last-read/cert Promise.all block (236-293)

These are two parallel "what happened recently" aggregators emitting the same shared
TeamChange/RecentWorkItem/ProcurementBriefing shapes. Recommend: extract a shared
`lib/activity/` (or `lib/dashboard/activity-aggregation.ts`) module holding the mappers +
the content_history/form_response_history fetch+map helpers; have both call it. Saves
~300-400 LOC and removes a Wikipedia-Principle violation (two homes for one fact: how a
change_type maps to an action, what the recent-work query is). Medium risk: both are hot,
test-covered (`__tests__/lib/dashboard*.test.ts`, `__tests__/lib/reorient.test.ts`) — land
behind those gates.

## 3. lib/intelligence/health.ts <-> hooks/intelligence/use-workspace-health.ts — TYPE dup

jscpd clone (health.ts 13-58 | hook 11-50): the response-shape interfaces
`PipelineHealth`/`PipelineHealthSummary`, `SourceHealthEntry`, `SourceHealthSummary` are
redefined in the client hook instead of imported from the server module. Recommend: hook
imports the type from `lib/intelligence/health.ts` (or a shared `types/intelligence.ts`).
Low risk, type-only.

## 4. MCP type-copy boundary (lib/mcp/formatters/* <-> mcp-apps/*/src/types.ts) — ACCEPTABLE isolation, harden the guard

mcp-apps are isolated Vite single-file builds: their tsconfigs have NO `@/` path alias and
`grep` finds ZERO `@/` imports in `mcp-apps/*/src/`. They CANNOT import the main tree by
design. 5 jscpd clone pairs (hand-copied response shapes):
- `lib/mcp/formatters/apps.ts` <-> `mcp-apps/coverage-matrix/src/types.ts`
- `lib/mcp/formatters/intelligence.ts` <-> `mcp-apps/intelligence-feed/src/types.ts`
- `lib/mcp/formatters/procurements.ts` <-> `mcp-apps/form-dashboard/src/types.ts`
- `types/reorient.ts` <-> `mcp-apps/reorient-me/src/types.ts` (x2 fragments)

This is intentional isolation, NOT accidental dup — and it is already partially governed:
`mcp-apps/intelligence-feed/src/types.ts` header says "These MUST exactly mirror the
server-side interfaces ... Verified by contract tests in
`__tests__/mcp/mcp-app-contracts.test.ts`". VERDICT: keep the isolation (a shared package /
codegen step is heavier than the problem warrants for 4 small apps), but (a) ensure ALL
four apps carry the same mirror-header + are covered by the contract test (coverage-matrix
& form-dashboard headers do not state the mirror contract), and (b) consider a small
codegen script that emits `mcp-apps/*/src/types.ts` from the formatter types if the count
of apps grows past ~6 (the 6-domain model implies one app per domain eventually). Low risk;
keep-noted.

## 5. dir/file collisions — RENAME (not dup)

- `lib/dedup.ts` (298 LOC, content-dedup at upload: MD5 + embedding cosine) vs
  `lib/dedup/pair-id.ts` (2.5KB, admin near-dup merge-dashboard pair-id encoding §1.9).
  Different concerns sharing the `dedup` name. Recommend: fold the file into the dir —
  `lib/dedup/content-dedup.ts` + `lib/dedup/pair-id.ts`, delete the `lib/dedup.ts` file.
- `lib/auth.ts` (172 LOC, `getAuthenticatedClient`/`getAuthorisedClient` — THE auth helper,
  high fan-in) vs `lib/auth/owner-default.ts` (1KB, `resolveContentOwnerId`). Recommend:
  fold file into dir — `lib/auth/client.ts` (or `authorised-client.ts`) +
  `lib/auth/owner-default.ts`, delete `lib/auth.ts`. NB `lib/auth.ts` has very high fan-in;
  use gitnexus_rename, verify with ast-dataflow rename-sweep. Low-medium risk (import churn).

## 6. RETIRE candidates from collapse-list — RE-VERIFIED against current code

- `lib/dedup-normalise.ts` — ALREADY GONE (file does not exist). Collapse-list item shipped.
- `scripts/dedup.py`, `scripts/dedup_normalise.py`, `scripts/kb_pipeline/` — ALREADY GONE.
- `lib/procurement-library-ingest/extract-qa-pairs.ts` — ALREADY GONE; dir now holds only
  `extract-answer.ts` + `resolve-question.ts`.
- `lib/intelligence/content-extractor.ts` (306 LOC) — **NOT dead, KEEP**. `extractContent`
  imported by LIVE `lib/intelligence/pipeline.ts`, which is wired to
  `app/api/cron/intelligence-poll/route.ts` + `app/api/intelligence/trigger-poll/route.ts`.
  The cocoindex pullmd path is Python (`scripts/cocoindex_pipeline/adapters.py`) and has
  NOT yet superseded this TS path. Retiring now would break the intelligence poll. keep-noted.
- `lib/extraction/` (10 files, ~811 LOC) — **NOT wholesale-retireable, KEEP**. Reached by
  LIVE routes: `app/api/ingest/url/route.ts` dynamically imports `url-validation`,
  `url-normalise`, `url` (`fetchForExtraction`), `pdf`, `clean-via-worker`;
  `app/api/upload/route.ts` imports `pdf` + `turndown`. The collapse-list "pullmd replaces
  lib/extraction" supersession is DIRECTION, not yet landed — pullmd is the Python cocoindex
  cleaner; the TS SSRF-gated fetch + B1 worker cleaner still serve the Next.js ingest/upload
  routes. Recommend: keep, but flag for the ID-112/cocoindex cutover that the TS extraction
  path is the remaining consumer to retire WHEN ingest routes move to cocoindex. Several
  inner files (`content-type-detect`, `extraction-result`, `clean-via-worker` non-test) have
  0 prod importers TODAY but are part of the in-flight {112.10} ingest work — keep-noted,
  needs_caller_verify.

## 7. Backfill scripts duplicate lib logic — one-shot, leave (note)

- `lib/date-extraction.ts` (LIVE: `components/item-detail/temporal-references-section.tsx`,
  `lib/entities/{entity-metadata-bridge,temporal-reconciliation}.ts`) cloned by
  `scripts/backfill-context-snippets.ts`.
- `lib/entities/entity-metadata-bridge.ts` (LIVE) cloned by `scripts/backfill-temporal-bridge.ts`.
Both scripts are explicitly one-shot historical migrations ("All 289 entity mentions
currently have NULL context_snippet", "runs that bridge retroactively on all
Python-ingested content"). Recommend: the scripts SHOULD import the lib helpers rather than
re-implement (small dup), but since they're already-run one-shots, lowest priority — either
delete the scripts post-run (scripts/ is the 108k bloat signal) or have them import lib.
keep-noted.

## 8. Root-file sprawl (43 .ts) + hooks-in-lib — RESTRUCTURE toward 6-domain model

Domain mapping of lib/ subdirs (platform-core vs application-domain):
- PLATFORM-CORE (keep at lib/ top, cross-cutting): `ai/`, `mcp/`, `supabase/`,
  `validation/`, `query/`, `queue/`, `logger/`, `auth/`, `api/`, `ast-dataflow/`, `eval/`,
  `ontology/`, `taxonomy/`, `provenance/`, `governance/`, `branding/`, `integrations/`.
- APPLICATION-DOMAIN: procurement -> `procurement/`, `coverage/`, `catalogue/`, `templates/`,
  `procurement-library-ingest/`, `q-a-pairs/`; intelligence -> `intelligence/`,
  `pipeline/`, `entities/`, `extraction/`, `content/`, `content-browsing/`. The other 4
  domains (sales_proposal, product_guide, competitor_research, training_onboarding) are
  mostly NOT yet present in lib/ — confirms early-stage; structure should leave room.

Root .ts files that belong in a subdir (relocate):
- `dashboard.ts`, `dashboard-signals.ts`, `reorient.ts`, `attention.ts` -> `lib/dashboard/`
  (with the §2 shared `activity/` extraction).
- `anthropic.ts`, `anthropic-files.ts`, `ai-parse.ts`, `claude-prompts.ts` -> `lib/ai/`.
- `browse-cold-start.ts`, `browse-helpers.ts`, `search-history.ts` -> `lib/content-browsing/`.
- `citations.ts`, `change-summary.ts`, `freshness.ts`, `certification-status.ts`,
  `topic-inference.ts`, `layer-inference.ts`, `guide-section-mapping.ts`,
  `date-extraction.ts` -> content/intelligence domain subdirs.
- `user-helpers.ts` (2 callers), `user-focus-constants.ts` (5), `roles.ts` (4),
  `user/display-name.ts` -> consolidate the user cluster under `lib/users/`.
- `docx-utils.ts`, `editor-utils.ts`, `drawer-insert.ts`, `pdf-worker.ts` -> `lib/editor/`
  or `lib/upload/` (both dirs already exist).
- GENUINELY cross-cutting, KEEP at root: `utils.ts` (cn), `format.ts`, `error.ts`,
  `routes.ts` (proxy publicRoutes), `env-client.ts`/`env-server.ts`,
  `client-config.ts`/`client-telemetry.ts`, `cron-auth.ts`, `rate-limit.ts`,
  `private-docs.ts`, `notifications.ts`, `tablist-keyboard.ts`, `workspace-types.ts`,
  `organisation-profile.ts`.
- HOOKS-IN-LIB smell: `lib/content-browsing/use-content-selection.ts`,
  `use-url-filters.ts`, `use-content-bulk-runner.ts` are React hooks living under lib/.
  Convention (CLAUDE.md) puts hooks in `hooks/`. Recommend relocate to
  `hooks/content-browsing/` (or accept as co-located feature module — note only).

Risk for §8 is mostly LOW (import-path churn, gitnexus_rename) but VOLUME is high — stage by
cluster, not big-bang.
