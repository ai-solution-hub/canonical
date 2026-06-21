# Domain-Driven Structure Alignment Audit (area: domain)

**Branch:** jscpd-dupe-audit · **Date:** 2026-06-21 · READ-ONLY (recommendations only)
**North-star model:** `platform-direction.md` §v1 + `01-vision.md` §4 — six baseline
application types, "one architectural pattern, not bespoke verticals":
`procurement · intelligence · sales_proposal · product_guide · competitor_research · training_onboarding`.

---

## 1. Per-domain code location map (DOMAIN PRESENCE)

File-path counts (`*.ts`/`*.tsx` under lib/ hooks/ components/ app/ types/):

| Domain | path-matched files | DB satellite table | Code maturity |
|---|---|---|---|
| **procurement** | 82 | `procurement_workspaces` (25 mig refs) | ESTABLISHED — full vertical |
| **intelligence** | 97 | `intelligence_workspaces` (40 mig refs) | ESTABLISHED — full vertical |
| **sales_proposal** | 0 | `sales_proposal_workspaces` (25 mig refs) | FUTURE — schema seat only |
| **product_guide** | 0 | `product_guide_workspaces` (25 mig refs) | FUTURE — schema seat only |
| **competitor_research** | 0 | `competitor_research_workspaces` (25 mig refs) | FUTURE — schema seat only |
| **training_onboarding** | 0 | `training_onboarding_workspaces` (25 mig refs) | FUTURE — schema seat only |

### Registry is correct and complete
`lib/workspace-types.ts` is the canonical sync-source for `application_types.key`,
hardcoding ALL SIX keys (lines 24-29) in lockstep with the DB seed in
`supabase/migrations/20260617130000_squash_baseline.sql`. `hooks/workspaces/use-application-types.ts`
queries the DB rows. The satellite-pattern (Q-OQR1-02) is fully realised AT THE DB LAYER:
all 6 `*_workspaces` satellite tables exist.

### The asymmetry
Schema uniformity (6 satellites) vs code reality (2 verticals). This is EXPECTED per
`01-vision.md` §5.4: product_guide/competitor_research/training_onboarding "have schema
seats in v1 but are not the headline applications." **Do NOT invent code for these — the
slot is reserved; keep them as DB seats until their Task lands.** The only structural
action is to ensure the target lib/components/hooks layout leaves a clean, uniform slot
each future domain drops into (see §5).

### "guide" path hits != product_guide
27 path matches for "guide" are NOT the `product_guide` application type. They are the
sector-intelligence **guide-generator** feature: `lib/intelligence/guide-generator.ts`
(the owning module), `app/guide/`, `components/guide/`, `lib/mcp/tools/guides.ts`,
`app/api/guides/`. This is an intelligence-domain OUTPUT surface whose name collides with
the future `product_guide` domain. NAMING HAZARD — see Finding D-NAME-GUIDE.

---

## 2. Domain logic scattered across the wrong layer (LAYERING)

### 2a. Procurement logic lives in route handlers, not lib/procurement
- `app/api/procurement/**` = **28 route files, 6,201 LOC** (several 300-432 LOC:
  `responses/draft-stream/route.ts` 432, `[id]/route.ts` 393,
  `outcome/integrate/route.ts` 345, `readiness/route.ts` 331, `questions/route.ts` 331).
- `lib/procurement/` = only **7 files** (workflow, queries, helpers, 4 export files).
- Only **11/28** routes import `@/lib/procurement` at all; the dominant lib import is
  `procurement-workflow` (12 hits). Much domain logic (readiness scoring, question
  lifecycle, outcome integration, template fill) is INLINE in the route handler.
- jscpd PROVES the cost: `app/api/procurement/[id]/responses/draft/route.ts` <->
  `lib/queue/handlers/procurement-draft-all.ts` share a **53-line clone**
  (analysis.json crossdir, aStart 163-215 / bStart 243-296). The drafting orchestration
  was copy-pasted between the sync route and the async queue handler because there is no
  single `lib/procurement/draft-response.ts` for both to call.
- module_pairs corroborate: `app/api <-> lib/procurement` (2 pairs), `app/browse <->
  app/procurement` (1 pair).

### 2b. Procurement AI orchestration lives in lib/ai, not lib/procurement
Procurement routes import procurement-SPECIFIC AI functions from the platform-core `lib/ai/`:
`@/lib/ai/draft` (6), `@/lib/ai/match` (2), `@/lib/ai/extract-questions` (2),
`@/lib/ai/quality-check` (2). Domain-coupling proven by ref counts inside those files:
- `lib/ai/draft.ts` — **14** procurement-domain refs (bid_question/tender/response_draft/form_template)
- `lib/ai/extract-questions.ts` — **35** procurement-domain refs
- `lib/ai/match.ts` / `quality-check.ts` — 1 each (mostly generic).

So `lib/ai/` mixes genuine platform-core AI plumbing (`embed`, `classify`, `summarise`,
`vision`, `pricing`, `errors`, `taxonomy/`, `skills/`) with procurement-vertical AI
(`draft`, `extract-questions`). The core/domain boundary is blurred.

### 2c. Procurement form-templating split across 3 modules
- `lib/templates/` (template-auto-map, template-coverage) — procurement form-fill.
- `lib/catalogue/` (1 file, **16** procurement refs) — form-template-requirements catalogue.
- `lib/procurement/procurement-export-*` (4 files) — docx/xlsx export.
These are all procurement-form concerns scattered under 3 different top-level lib dirs.

### 2d. Hooks are CLEAN (counter-evidence — good)
`hooks/procurement/` (5 files) and `hooks/intelligence/` (15 files) are properly
namespaced. Root `hooks/` has NO procurement/intelligence leakage worth flagging
(`use-qa-provenance`, `use-organisation-profile`, `use-quick-assign` are genuinely
cross-domain corpus hooks). Hooks already model the target shape — the other layers should
follow this example.

---

## 3. Platform-core vs domain split (THE UNIFORMITY QUESTION)

### Genuinely cross-cutting CORE (correctly shared, 0 procurement coupling verified)
`lib/ai` (mostly), `lib/mcp`, `lib/supabase`, `lib/validation`, `lib/query`, `lib/auth`,
`lib/logger`, `lib/queue`, `lib/provenance`, `lib/taxonomy`, `lib/ontology`, `lib/eval`,
`lib/coverage` (0 proc refs, 3 files), `lib/q-a-pairs` (0), `lib/edit-intent` (0),
`lib/supersession` (0), `lib/content`, `lib/entities`, `lib/governance`, `lib/change-reports`.
These form the corpus spine the Wikipedia Principle demands — one canonical home, many
domain consumers. Correctly placed.

### Domain-specific modules sitting at lib/ root (should be under a domain namespace)
- `lib/templates/` -> procurement form-fill (procurement)
- `lib/catalogue/` -> procurement form-requirements catalogue (procurement)
- `lib/procurement-library-ingest/` -> procurement (note: collapse-list flags its
  `extract-qa-pairs.ts` as migration-helper retire — that's the retire-area audit's call)
- `lib/ai/draft.ts`, `lib/ai/extract-questions.ts` -> procurement AI

### Verdict on uniformity
The DB layer mirrors the "one pattern, six instances" target perfectly (6 satellites). The
CODE layer does NOT: procurement and intelligence are each bespoke trees with different
internal shapes — procurement is route-heavy (logic in app/api), intelligence is lib-heavy
(`lib/intelligence/` = 17 files: pipeline, feed-poller, summariser, flag-analyser,
relevance-scorer, guide-generator, starter-packs, rss-generator, ...). When the 4 future
domains are built, there is NO established "domain module template" for them to copy. The
two existing verticals diverge in structure, so "one architectural pattern" is true in the
DB and false in the code.

---

## 4. Collapse-list / retire intersections (re-verified against current code)

The collapse-list (07-collapse-list.md, last verified 02/06/2026) names several
domain-area retire targets. RE-VERIFIED — both are STILL WIRED, so NOT retire:

- **`lib/intelligence/content-extractor.ts`** — collapse-list says "retire". ast-dataflow
  importers: 4 — incl. **`lib/intelligence/pipeline.ts`** (live) + 1 integration test + 2
  unit tests. `extractContent`, `isGoogleNewsUrl`, `resolveGoogleNewsUrl` are consumed by
  the live SI pipeline. => **keep-noted, needs_caller_verify**, NOT retire.
- **`lib/intelligence/pipeline.ts`** — LIVE: imported by
  `app/api/cron/intelligence-poll/route.ts` + `app/api/intelligence/trigger-poll/route.ts`
  (2 production routes) + 3 tests. The SI feed pipeline is NOT superseded by cocoindex.
- **`lib/extraction/`** — collapse-list says "retire (~1000 LOC, pullmd replaces)". STILL
  imported by `app/api/ingest/url/route.ts`, `app/api/upload/route.ts`,
  `lib/content/html-to-markdown.ts`, `lib/intelligence/content-extractor.ts`. => NOT a
  clean retire yet; pullmd cutover not complete. Defer to extraction/retire-area audit.

Net: none of these meet the 3-part retire test (all retain live structural callers). They
belong to the owning area audits (extraction / retire), not this cross-cut.

---

## 5. TARGET domain-driven structure (the NORTH STAR for the other 5 audits)

Guiding rule: **platform-core = the corpus spine (shared by all domains); each domain =
one self-contained vertical module mirroring the DB satellite pattern.** Hooks already do
this — generalise it to lib/ and app/api.

```
lib/
  # ---- PLATFORM CORE (cross-cutting corpus spine — shared by every domain) ----
  ai/            AI plumbing ONLY: embed, classify, summarise, vision, pricing,
                 errors, change-reports, taxonomy/, skills/   (move draft.ts +
                 extract-questions.ts OUT to lib/domains/procurement)
  mcp/  supabase/  validation/  query/  auth/  logger/  queue/
  provenance/  taxonomy/  ontology/  eval/
  content/  entities/  governance/  q-a-pairs/  coverage/  edit-intent/
  supersession/  change-reports/
  # ---- DOMAIN VERTICALS (one module per application_type; uniform internal shape) ----
  domains/
    procurement/     <- absorb lib/procurement + lib/templates + lib/catalogue
                       + lib/ai/draft + lib/ai/extract-questions + procurement-library-ingest
                       internal shape: workflow.ts, queries.ts, draft.ts, extract.ts,
                       templates/, export/, ingest/
    intelligence/    <- rename lib/intelligence -> lib/domains/intelligence
                       (pipeline, feed-poller, summariser, flag-analyser, relevance,
                        guide-generator, starter-packs, rss-generator)
    sales_proposal/      (reserved — empty until its Task lands)
    product_guide/       (reserved)
    competitor_research/ (reserved)
    training_onboarding/ (reserved)

components/
  ui/ shared/ shell/        # core
  workspace/ browse/ item-detail/ review/ coverage/ provenance/
  change-reports/ settings/ admin/ entity-management/   # corpus-governance UI
  domains/
    procurement/   intelligence/   (+ reserved slots)
  # NOTE: components/guide/ -> components/domains/intelligence/guide/ (it is SI output)

hooks/
  ui/ streaming/            # core
  workspaces/ browse/ review/ provenance/ reference/   # corpus-governance
  domains/
    procurement/   intelligence/   (+ reserved slots)
  # already 95% there — only the domains/ regrouping is new

app/api/
  procurement/   intelligence/   guides/   # routes stay thin: parse -> authz ->
                                            # call lib/domains/<d> -> respond.
                                            # Target: 0 routes with >120 LOC of inline
                                            # domain logic (28 routes / 6201 LOC today).
```

**Key moves the other audits should align to:**
1. Introduce `lib/domains/` and relocate `lib/procurement` + `lib/intelligence` under it;
   each future application_type gets a reserved sibling slot (mirrors the 6 DB satellites).
2. Pull procurement-coupled code OUT of platform-core: `lib/ai/draft.ts`,
   `lib/ai/extract-questions.ts` -> `lib/domains/procurement/`. Fold `lib/templates` +
   `lib/catalogue` into `lib/domains/procurement/`.
3. Thin the procurement API routes: extract inline orchestration into
   `lib/domains/procurement/` so the route<->queue-handler 53-line clone collapses to one
   shared function (Wikipedia Principle for CODE).
4. Disambiguate "guide": it is intelligence-domain output, not `product_guide`. Either
   nest under intelligence or rename to avoid future collision.
5. Leave the 4 future domains as DB seats + empty reserved slots — do not scaffold them.

This is the structure the duplication, retire, structure, and naming audits should
converge on. Procurement and intelligence are the two reference verticals; making their
internal shapes identical is what turns "two bespoke trees" into "one pattern, N instances".
