# Canonical codebase audit — duplication, retire, structure

**Branch:** `jscpd-dupe-audit` · **Date:** 2026-06-21 · **Status:** READ-ONLY audit + remediation plan.
No source files mutated by this audit. The only landed change this session is the jscpd tooling
(`.jscpd.json`, the `dupe-check` npm script) — everything below is a *proposal* gated on your review.

This is the cross-area synthesis. The six per-area evidence files (`audit-scripts.md`, `audit-lib.md`,
`audit-hooks.md`, `audit-components.md`, `audit-app.md`, `audit-domain.md`) hold the detailed proofs;
this file rolls them up, links the findings that span areas, and sequences the work.

---

## How this was produced (and what it is NOT)

- **Duplication axis** — `jscpd@5.0.11` (a Rust `cpd` rewrite, not classic Node jscpd) over the full
  TS/TSX/JS/Python corpus. **520 clones, 4.0% duplication across 1,150 files** (TS 5.8%, TSX 2.0%,
  Py 0.6%). Reproduce with `bun run dupe-check`. Raw report + ranked `analysis.json` live beside this
  file (gitignored — regenerable).
- **Caller proof** — every retire/merge claim is backed by `ast-dataflow` caller/importer resolution
  **plus** an unsandboxed `grep` sweep (the sandbox silently skips read-denied files —
  `database.types.ts`, `plugin-bundle.ts` — which would produce false-zero caller counts).
- **Hard rules applied throughout:**
  1. **0 callers ≠ retire.** A symbol with no callers may be *built-not-wired*, not dead. Cross-checked
     against the S384 gh-security unused-code triage (124 symbols; 65 classified built-not-wired).
  2. `ast-dataflow` `importers` **misses** `dynamic(() => import(...))` sites — a 0-importer *component*
     is "verify with grep", never auto-dead. (Both PDF viewers returned 0 importers; both are live.)
  3. Every retire row carries a pre-pivot **roadmap check** (is the owning Task still live?) and is
     marked `needs_caller_verify` — **archive, don't hard-delete**, until the migration is confirmed run
     in prod.
- **This audit is additive to S384.** The gh-security triage already covered the **dead-export axis**
  (knip). This audit covers the three axes that triage did *not*: **duplication** (jscpd), **folder /
  naming structure** vs the 6-domain target, and **scripts/ retirement**. No overlap, no redo.

---

## The headline, in one paragraph

The duplication is **broad but shallow** (4.0%) and clusters into a small number of **missing shared
homes**, not hundreds of independent defects. The genuinely *removable* surface is **concentrated almost
entirely in `scripts/`** — confirming your instinct — while `lib/`, `components/`, `hooks/`, and `app/`
have almost **zero dead code** but many **two-live-callers-one-fact** violations (the Wikipedia
Principle applied to code: one canonical home, many consumers). The deepest structural finding is that
the **DB models the 6-domain "one pattern, six instances" target perfectly (6 satellite tables) while
the code does not** — procurement and intelligence are two bespoke trees with different internal shapes,
so a future domain has no template to copy. The single highest-leverage *structural* fix is introducing
`lib/domains/`; the single highest-leverage *duplication* fix is the `app/` route preamble, which is
already someone else's job (ID-50 `defineRoute` — do **not** build a competing helper).

---

## Thread 1 — DUPLICATION (the jscpd signal → missing shared homes)

The 520 clones resolve to **~14 consolidation targets**. Grouped by where the canonical home should live:

### A. Cross-area consolidations (findings that span ≥2 audits — the synthesis-only insight)

| # | One fact, two+ homes | Spans | Canonical home to create | LOC saved | Risk |
|---|---|---|---|---|---|
| C1 | **Activity aggregation** — `dashboard.ts` ⇄ `reorient.ts` (11 fragments, ~10k tok: `mapChangeTypeToAction`, `content_history`/`form_response_history` query+map) **and** `app/api/activity/route.ts` re-maps the same RPC rows | lib §2, app APP-3 | `lib/activity/` (mappers + fetch helpers); route + both aggregators import | ~330–425 | Med (hot, test-covered) |
| C2 | **Procurement drafting loop** — `draft/route.ts` ⇄ `lib/queue/handlers/procurement-draft-all.ts` (**53-line clone**; queue docstring literally says "literal extraction from draft-all") | app APP-2, domain §2a | `lib/domains/procurement/draft-response.ts` `draftQuestions(...)` | ~250 | **Med — see ⚠** |
| C3 | **content-dedup admin route family** — `confirm-duplicate` ⇄ `confirm-unique` (289-tok preamble incl. idempotency-409) ⇄ `supersede`; + `lib/dedup.ts` vs `lib/dedup/` dir name collision | app APP-1, components in-domain, lib §5 | `lib/dedup/review-actions.ts` (`resolveDedupSubject` + `writeDedupHistory`); fold `lib/dedup.ts` → `lib/dedup/content-dedup.ts` | ~150 | Low |
| C4 | **Intelligence response-shape types** re-declared in client hooks instead of imported (`PipelineHealth*`, `SourceHealth*`, `WorkspaceFlag`) | lib §3, hooks H2a/H2b | lift canonical type to `types/intelligence.ts` / `lib/intelligence/{health,flags}.ts`; hooks + routes import | ~70 | Low (type-only) |
| C5 | **Display-name "three surfaces"** — `lib/user/display-name.ts` + `lib/users/display-names.ts` + `hooks/use-display-names.ts` | lib §1, hooks H8 | **NOT duplication** — three distinct layers. Merge singular/plural dirs → one `lib/users/`; rename `self-display-name.ts`. Hook stays. | 0 (rename) | Low |
| C6 | **React hooks living under `lib/`** — `lib/content-browsing/{use-content-selection,use-url-filters,use-content-bulk-runner}.ts`; selection-set toggle core also cloned into `hooks/review/` | lib §8, hooks H4 | relocate the 3 hooks → `hooks/content-browsing/`; optional shared `useSelectionSet()` primitive | ~13 + churn | Low–Med (14 callers on selection) |

> **⚠ C2 scope correction (adversarial verify, `audit-app-APP-2-verify.md`):** the "loop copy-pasted across
> **3** sites" headline is true for **2** (`draft/route` + queue handler), not 3. `draft-stream` is
> single-question SSE with extra ID-58 **citations-table writes** and does NOT use `runDraftingPipeline`;
> `regenerate` is a single-question UPDATE. Extract `draftQuestions()` for the **2 equivalent sites only**;
> **decide separately where the ID-58 citations write lives** before touching draft-stream. → **needs human.**

### B. Single-area consolidations

| # | Clone | Area | Canonical home | LOC | Risk |
|---|---|---|---|---|---|
| S1 | **PDF engine** — `pdf-reader-view.tsx` ⇄ `pdf-viewer.tsx` (489-tok — biggest clone in repo) | components CMP-1 | `components/reader/pdf-document.tsx`; inline + Dialog wrappers | ~250–300 | Low (both tested) |
| S2 | **LCS line-diff engine** — `prompt-diff-view` ⇄ `revision-diff-view` | components CMP-2 | `lib/diff/line-diff.ts` + `components/shared/unified-line-diff.tsx` | ~120 | Low |
| S3 | **Hand-rolled dropzone** — coverage `template-upload` ⇄ procurement `tender-upload` (+ a 3rd `react-dropzone` impl in create-content) | components CMP-4 | `components/shared/file-dropzone.tsx` (on `react-dropzone`) | ~150–200 | Low–Med (3 surfaces) |
| S4 | **Chip/TagInput** — `company-profile-form` ⇄ `organisation-section` ("adapted from SI company-profile-form") | components CMP-3 | `components/shared/string-tag-input.tsx` | ~80–120 | Low |
| S5 | **Tiptap extension stack** re-inlined — `response-editor` ignores `content-editor`'s exported `buildExtensions()` | components CMP-5 | `lib/editor/build-extensions.ts` | ~20–40 | Low (high signal: stops GFM-table drift) |
| S6 | **TOC active-heading observer** — guide ⇄ item-detail | components CMP-6 | `hooks/use-active-heading.ts` + `components/shared/toc-nav.tsx` | ~80 | Low |
| S7 | **error.tsx boundary body** ×22 (Next requires the file per segment; the body can be shared) | app APP-4 | `components/errors/error-boundary-shell.tsx` | ~30 + centralises Sentry wiring | Low |
| S8 | **`applyWithTransition`** verbatim in 2 ui hooks; **review filter→URLSearchParams** in 2 review hooks; revision-history panel chrome; misc intra-file | hooks H3/H5/H6/H7, components CMP-7 | small local extracts | ~100 | Low |
| S9 | **scripts boilerplate** — `loadEnv()` ×38, `assertEnvFlag()` ×34, batch-loop copied across every backfill/seed/propagate (the *bulk* of the scripts clone count) | scripts §D | 4 modules in `scripts/lib/` (below) | ~1.5–2k | Low |

### C. Route preamble — hand to ID-50, do NOT build a competitor

**139 / 205 API routes (68%)** share the same `getAuthorisedClient` + `UUID_RE.test` + `request.json()`
+ `parseBody` + `catch → 500` preamble. This is the **single biggest duplication signal in the repo**,
but it is **already ID-50's target**: `lib/api/define-route.ts` exists (recovered for ID-50). Caveat —
`defineRoute` today wraps *response* validation only; retiring the preamble clones needs a companion
*request-side* guard. **Action: flag this to ID-50 as the in-scope consumer; do not introduce a parallel
`withRoute`/`apiHandler`.** Best pilot: the `review/queue/route.ts` hot file. (app APP-5)

### D. Accepted-as-isolated (NOT a defect)

`mcp-apps/*/src/types.ts` hand-copy `lib/mcp/formatters/*` shapes (5 clones). mcp-apps are isolated Vite
builds with no `@/` alias — they *cannot* import the main tree by design, and the copy is governed by a
contract test (`__tests__/mcp/mcp-app-contracts.test.ts`). **Keep the isolation**; just (a) ensure all 4
apps carry the mirror-header + contract coverage, and (b) consider codegen if the app count grows past ~6.
(lib §4)

---

## Thread 2 — RETIRE (proof-backed; concentrated in `scripts/`)

**The removable surface is almost entirely in `scripts/`.** `hooks/` has **zero** retire candidates;
`components/` has **zero** (all 7 cross-domain dups are two *live* callers each); `lib/` retire targets
from the collapse-list are **either already gone or still wired**.

### 2.1 `scripts/` one-shot retire batch — ~18 files (already-run, 0-ref, off-roadmap)

All verified: 0 non-self refs across `.ts/.py/.md/.json/.yml/.sh`; owning Task (S192/WP3, Plan-D, WP-B,
ID-102.8, Phase-6A) **not** in the live `product-roadmap.json`; each is a "find rows missing X → write X"
or column migration whose migration has run. **Disposition: archive (`git mv` → `scripts/one-shot-archive/`)
or `git rm`, after confirming the migration ran in prod.** Full table in `audit-scripts.md` §A–C; the set:

- **Backfills/migrations:** `backfill-canonicalise-ai-keywords`, `backfill-classify-content-items`,
  `backfill-content-history-v1`, `backfill-context-snippets`, `backfill-layers`, `backfill-source-documents`
  (collapse-list §222 conditional), `backfill-temporal-bridge`, `backfill-temporal-entity-matches`,
  `batch-rescore-articles`, `batch-populate-topics`, `batch-generate-summaries`, `normalise-entities`,
  `reembed-missing-embeddings`, `migrate-ledger-ids-to-string` (ID-102.8 flag-day, flipped),
  `restore-eval-corrupted-items`.
- **Stranded one-shots:** `wp-b-triage-report` (its consumer `wp-b-apply-triage` was never built),
  `wipe-procurement-responses` (destructive dev convenience → fold into seed harness),
  `seed-platform-from-staging` (operator tool — keep-noted).
- **Orphan Python (not in the onprem deploy image, 0 refs):** `keyword_classifier.py` (pre-cocoindex,
  superseded by `holder_rule.py`), `extract_pdf_images.py` (superseded by `form_extractors/pdf.py`).
- **Spikes (numbers already captured in id-56 docs):** `spikes/ast-heading-population-eval.py`,
  `spikes/recursive-splitter-eval.py`, `spikes/id75-executor-verify-1-memo-probe.py`.

**Keep-noted (do NOT delete):** anything test-covered (`compare-quality`, `embedding-smoke-test`),
GDPR-required (`export-user-data`), live operator/governance tools, the entire `cocoindex_pipeline/`
(live, deployed), and `codemods/` (built-not-wired cluster A, just recovered for ID-50).

### 2.2 `scripts/bid_worker.py` — prune dead branches (RESTRUCTURE, not file-retire)

`bid_worker.py` is **live** (`template_fill` still enqueued). But its `tender_extract_docx` /
`tender_extract_pdf_text` branches are now **dead** (no TS enqueues them — superseded by
`cocoindex_pipeline/form_extractors/`). Prune the two dead branches inside the file; keep the worker.

### 2.3 `lib/` collapse-list retire targets — re-verified, mostly NOT retireable

- `lib/dedup-normalise.ts`, `scripts/dedup.py`, `scripts/kb_pipeline/`,
  `lib/procurement-library-ingest/extract-qa-pairs.ts` — **already gone** (collapse-list items shipped). ✔
- `lib/intelligence/content-extractor.ts`, `lib/intelligence/pipeline.ts` — **KEEP, still wired** to the
  live SI intelligence-poll routes; cocoindex has **not** superseded the TS path. (lib §6, domain §4)
- `lib/extraction/` (~811 LOC) — **KEEP**; still the live consumer for `app/api/ingest/url` +
  `app/api/upload`. The "pullmd replaces lib/extraction" supersession is **direction, not landed**.
  Flag for the **ID-112 cocoindex cutover** as the remaining consumer to retire *when* ingest moves over.

---

## Thread 3 — STRUCTURE (align to the 6-domain "one pattern, N instances" north-star)

Target model (`platform-direction.md`): six application types — `procurement`, `intelligence`,
`sales_proposal`, `product_guide`, `competitor_research`, `training_onboarding` — "one architectural
pattern, not bespoke verticals." **DB reality:** all 6 satellite tables exist. **Code reality:** only
procurement (82 files) + intelligence (97 files) are built, and they are **structurally divergent**.

### 3.1 The core/domain boundary is blurred (domain §2)

- **Procurement AI sits in platform-core `lib/ai/`:** `draft.ts` (14 procurement refs), `extract-questions.ts`
  (35 refs) are procurement-vertical code mixed in with genuine plumbing (`embed`/`classify`/`summarise`/
  `vision`/`pricing`). → move out to the procurement domain.
- **Procurement logic lives in route handlers, not `lib/procurement`:** 28 routes / 6,201 LOC, several
  300–432 LOC; only 11/28 import `@/lib/procurement`. The C2 53-line clone is the *symptom* of having no
  shared `lib/domains/procurement/draft-response.ts`.
- **Procurement form-templating is split across 3 lib dirs:** `lib/templates/` + `lib/catalogue/` +
  `lib/procurement/procurement-export-*`.
- **Counter-evidence (good):** `hooks/` is already cleanly namespaced (`hooks/procurement/`,
  `hooks/intelligence/`) — the other layers should follow the hooks example.

### 3.2 The north-star target tree (domain §5 — what the other audits converge on)

```
lib/
  # platform core (the corpus spine — shared by every domain)
  ai/ (plumbing only)  mcp/ supabase/ validation/ query/ auth/ logger/ queue/
  provenance/ taxonomy/ ontology/ eval/ content/ entities/ governance/
  q-a-pairs/ coverage/ supersession/ change-reports/
  domains/                     # one module per application_type; uniform internal shape
    procurement/   <- absorb lib/procurement + lib/templates + lib/catalogue
                      + lib/ai/draft + lib/ai/extract-questions + procurement-library-ingest
    intelligence/  <- rename lib/intelligence -> here
    sales_proposal/ product_guide/ competitor_research/ training_onboarding/   # reserved, empty
components/  …/ domains/{procurement,intelligence}  (+ reserved); guide/ -> domains/intelligence/guide/
hooks/       …/ domains/{procurement,intelligence}  (already 95% there)
app/api/     procurement/ intelligence/ — routes stay THIN (parse -> authz -> call lib/domains/<d> -> respond)
```

**Naming hazards to fix:** the `guide-generator` feature (`lib/intelligence/guide-generator.ts`,
`components/guide/`, `app/guide/`) is **intelligence output**, not the future `product_guide` domain —
disambiguate before the collision lands. Residual `bid` → `procurement`/`form` rename: dirs are done, but
**44 files** still carry stale `bid` in JSDoc `@route` strings (documenting 404 paths), user copy
("Couldn't load this bid"), and identifiers (`bid_response` DB enum is a separate schema-touching item —
note, don't action). (app APP-6, domain §1)

### 3.3 Per-area structure debt (detail in each area file)

- **`scripts/`** — add `scripts/lib/{load-env,script-env,batch-args,batch-runner}.ts`; reorganise by
  *lifecycle* (`pipeline/ live-ops/ ci/ generate/ eval/ ledger/ seed/ codemods/ one-shot-archive/`).
- **`lib/`** — 43 root `.ts` files; relocate clusters into subdirs (dashboard, ai, content-browsing, user);
  fold `dedup.ts`→`dedup/` and `auth.ts`→`auth/` name collisions (auth has high fan-in — `gitnexus_rename`).
- **`hooks/`** — rename the lone camelCase `useContentIngestPolling.ts`; resolve single-file subfolders
  (`provenance/`, `reference/`, `workspaces/`); cluster root hooks (`item-detail/`, `library/`, `general/`).
- **`components/`** — land the 7 missing `shared/`+`lib/` primitives (S1–S6, C3); `coverage/` should sit
  under a procurement namespace, not as a top-level sibling.

---

## Remediation roadmap (sequenced by leverage × independence × risk)

Quick wins first (build confidence, cut noise); self-contained `scripts/` next; independent component
primitives; then `lib`; then `app` (coordinate with ID-50); the big structural move **last** (relocation
is cleanest after everything is deduped). **Nothing here is started — all gated on your go-ahead.**

| Wave | Work | Findings | Effort | Risk | Notes |
|---|---|---|---|---|---|
| **0** | jscpd tooling | — | — | — | **DONE** (`bun run dupe-check`) |
| **1 — quick wins** | hook rename; type-dedups; `buildExtensions` import; activity-mapper export | hooks H1/H2, lib §3, CMP-5, APP-3 | S | Low | Mechanical, both-sides-wired |
| **2 — scripts** | 4 shared `scripts/lib/` modules + migrate ~38 importers; archive ~18 one-shots; prune `bid_worker` dead branches | scripts §A–D | M | Low | Self-contained area; biggest clone-count win + the bulk of the retire |
| **3 — component primitives** | PDF engine, line-diff, dropzone, chip, TOC, revision-panel | CMP-1/2/4/3/6/7 | M | Low | All behind existing tests; independent of each other |
| **4 — lib consolidation** | `lib/activity/` extraction; `dedup.ts`+`auth.ts` collision folds; user/users dir merge | lib §2/§5/§1, C1, C3, C5 | M | Low–Med | `auth.ts` high fan-in → `gitnexus_rename` + ast-dataflow rename-sweep |
| **5 — app routes** | dedup route family; drafting loop (**2 sites**); error-boundary shell; bid→procurement doc sweep; **hand preamble to ID-50** | APP-1/2/4/6/5, C2/C3 | M | Med | Coordinate with ID-50; **C2 needs the citations decision first** |
| **6 — domain restructure** | introduce `lib/domains/`; relocate procurement + intelligence; pull procurement AI out of `lib/ai`; thin routes; disambiguate `guide` | domain §5, §2 | **L** | Med | The north-star; deliberate, do last; big-bang-vs-incremental is your call |

Rough addressable total: **~6–8k LOC** of duplication/dead code removable, plus a large but low-risk
*relocation* volume (import churn via `gitnexus_rename`, staged by cluster — never big-bang).

---

## Decisions for you (genuine forks — I won't pick these unilaterally)

1. **Execute now, or review first?** The conservative default (read-only audit, execution gated) is what
   produced this. Say the word and I start **Wave 1** (the lowest-risk quick wins).
2. **C2 drafting loop — where does the ID-58 citations write live** once `draftQuestions()` is extracted?
   This blocks the app-route wave. (See the `audit-app-APP-2-verify.md` analysis.)
3. **Wave 6 `lib/domains/` — big-bang or incremental?** One deliberate PR per layer, or relocate
   procurement first as the reference vertical and let intelligence follow?
4. **Retire disposition — archive or delete?** `git mv` the ~18 one-shots to `scripts/one-shot-archive/`
   (recoverable) vs `git rm` (clean). Either way, I'll confirm each migration ran in prod first.
5. **`coverage/` and single-file hook subfolders** — fold `coverage/` under procurement? Promote
   `hooks/{reference,workspaces}/` single files to root, or keep the folders pending siblings?

## Not in scope / already owned elsewhere

- **Dead-export axis** — done by S384 gh-security triage (knip). Not redone here.
- **Route preamble standardisation** — owned by **ID-50** (`defineRoute`). Do not build a competitor.
- **`lib/extraction` retire** — owned by the **ID-112** cocoindex ingest cutover.
- **`bid_response` DB enum rename** — schema-touching; noted, not actioned.
