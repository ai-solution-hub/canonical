# Audit — `components/` (336 files, ~70k LOC)

Read-only audit. Branch `jscpd-dupe-audit`. Evidence proven via ast-dataflow (`bun
scripts/ast-dataflow-cli.ts`), unsandboxed `grep`, and the precomputed jscpd reports
(`docs/reports/jscpd-report/{analysis,jscpd-report}.json`). No source files were edited.

## Method notes
- `importers` query MISSES `dynamic(() => import('…'))` call sites — the two PDF viewers
  returned 0 importers but are both live via dynamic import (proven by grep). Treat
  ast-dataflow importer=0 on a *component* as "verify with grep", never auto-dead.
- All seven cross-domain dups below are between TWO LIVE callers — none are retire
  candidates. They are CONSOLIDATE (Wikipedia-Principle: one canonical home, many callers).

---

## CMP-1 — PDF viewer: two near-identical impls in the SAME dir (biggest clone in repo)
Files: `components/reader/pdf-reader-view.tsx` (337 LOC) ·
`components/reader/pdf-viewer.tsx` (381 LOC). jscpd: 489-token clone (lines 73-153 vs
90-170) + a 197-token clone (154-182 vs 173-201) = the single biggest clone in the whole
repo.

Both LIVE (grep, dynamic imports):
- `PdfReaderView` ← `components/reader/reader-panel.tsx` (inline panel reader experience).
- `PdfViewer` ← `components/item-detail/item-action-bar.tsx` +
  `components/item-detail/reader-view.tsx` (a Dialog/modal "View PDF" button).

The shared 489-token fragment is the ENTIRE pdf engine: identical state (`pdfUrl`,
`numPages`, `currentPage`, `scale`, `pageInputValue`, `hasError`, refs), identical signed-
URL `useEffect`, identical handlers (`goToPage`, page-input handlers, `zoomIn/Out`,
`fitWidth`, `onPageLoadSuccess`), identical keyboard-nav `useEffect`, identical toolbar
markup, identical `<Document>`/`<Page>` render. The ONLY divergence: `PdfViewer` wraps the
content in `<Dialog>` + trigger button and gates keyboard nav on `dialogOpen`;
`PdfReaderView` renders inline and has a top-level error/loader path.

NEITHER is dead. Target: extract one `<PdfDocument>` (state + toolbar + Document/Page) into
`components/reader/`, then `PdfReaderView` = inline wrapper, `PdfViewer` = `<Dialog>`
wrapper around it. ~250-300 LOC removed. Low risk (both have tests:
`__tests__/components/reader-panel.test.tsx`, `__tests__/components/item-action-bar.test.tsx`,
`__tests__/components/item-detail/reader-view.test.tsx`).

## CMP-2 — DiffView: LCS line-diff engine duplicated across intelligence + item-detail
Files: `components/intelligence/prompt-refinement/prompt-diff-view.tsx` (175 LOC) ·
`components/item-detail/revision-diff-view.tsx` (284 LOC). jscpd: 290-token (87-127 vs
108-150) + 220-token (23-65 vs 53-94) clones.

Both LIVE:
- `PromptDiffView` ← prompt-refinement flow (tests:
  `__tests__/components/intelligence/prompt-refinement/prompt-diff-view.test.tsx`).
- `RevisionDiffView` ← `components/qa/qa-revision-history.tsx` +
  `components/item-detail/version-history.tsx` (ID-59 {59.12}). NB it is ALREADY shared
  across two callers — the canonical-diff pattern works; prompt-refinement just didn't reuse it.

Byte-identical shared core: `DiffOp`/`DiffLine` types, `buildLcsTable`, `computeLineDiff`
(same tie-break comment, same edge cases), `OP_CLASS`, `OP_PREFIX`, and the
`<pre role="log">` render loop (differs only in aria-label + `[Added]`/`[Removed]` labels).
`RevisionDiffView` adds `RevisionBlob` metadata panels on top.

Target: extract `computeLineDiff` (+ `OP_CLASS`/`OP_PREFIX`) to `lib/` (e.g.
`lib/diff/line-diff.ts`) and a presentational `<UnifiedLineDiff lines={…}>` to
`components/shared/`. Both diff components then consume it. ~120 LOC removed. Low risk.

## CMP-3 — Profile form: TagInput + field block duplicated across intelligence + settings
Files: `components/intelligence/company-profile-form.tsx` (333 LOC) ·
`components/settings/organisation-section.tsx` (367 LOC). jscpd: 214 + 184 + 126-token
clones. organisation-section.tsx:17 carries the smoking-gun comment
`// Tag input (adapted from SI company-profile-form)`.

Both LIVE (different entities): `CompanyProfileForm` edits SI `CompanyProfile` rows;
`OrganisationSection` edits the user's own `OrganisationProfile`. The data models diverge
slightly (nullable handling, `competitors` field) but:
- The inner `TagInput` (controlled string-array, press-Enter-to-add, X-to-remove chip) is
  COPY-PASTED verbatim save for an added `required` prop.
- The field block (name/slug?/description/website/sectors/services/certifications/
  geographic_scope/key_topics/target_customers/value_proposition) is the same shape.

NOTE: `components/shared/user-tag-input.tsx` is a DIFFERENT concern (server-backed,
itemId-scoped item tagging via API + toast) — the profile `TagInput` is a pure controlled
chip editor with no persistence, so it is a genuinely MISSING shared primitive, not a dup
of user-tag-input. Target: extract `<StringTagInput>` (a.k.a. ChipInput) →
`components/shared/`; consider a shared `<ProfileFieldsFieldset>` for the common subset.
~80-120 LOC removed. Low risk (both have tests).

## CMP-4 — File upload: hand-rolled dropzone duplicated across coverage + procurement (+ a 3rd impl)
Files: `components/coverage/template-upload.tsx` (315 LOC) ·
`components/procurement/tender-upload.tsx` (365 LOC). jscpd: 4 clones (92+90+85+84 tok).
Module-pair coverage↔procurement = 4 pairs / 351 tok (top components module pair).

Both LIVE (coverage template upload; procurement tender upload). Shared verbatim: the
drag machinery (`dragCounterRef`, `handleDragEnter/Leave/Over/Drop`), `handleClick`,
`handleKeyDown`, `validateFile` (size + MIME), the `role="button"` dropzone markup with
identical `cn()` state-class logic, and the idle/uploading/complete/error visual states.
Divergence: accepted types (.docx vs .docx/.pdf) and the post-upload action (template
completion vs question extraction).

THIRD upload impl exists: `components/create-content/file-upload.tsx` uses the
`react-dropzone` LIBRARY (does NOT hand-roll drag handlers) and is driven by
`hooks/use-file-upload-pipeline.ts`. So the platform already has a library-based dropzone in
one place and two hand-rolled copies in two others. Target: one
`components/shared/file-dropzone.tsx` (drag + keyboard + validate primitive, ideally on
`react-dropzone` to match create-content), consumed by template-upload + tender-upload (and
optionally create-content). ~150-200 LOC removed. Low-medium risk (3 surfaces, each tested).

## CMP-5 — Editor: Tiptap extension stack re-inlined instead of importing the canonical builder
Files: `components/item-detail/content-editor.tsx` · `components/procurement/response-editor.tsx`.
jscpd: 4 clones incl an IDENTICAL imports block (lines 1-14 vs 1-14).

content-editor.tsx ALREADY exports `buildExtensions()` with a doc comment calling it "the
single source of truth for which nodes/marks the editor supports" — and `buildExtensions`
callers today = content-editor.tsx + its own tests only. response-editor.tsx (LIVE via
`hooks/procurement/use-procurement-response-actions.ts`,
`hooks/streaming/use-stream-coordination.ts`, `app/procurement/[id]/session/page.tsx`)
RE-INLINES the same StarterKit+Markdown+CharacterCount+Placeholder+Link+Table* array
(lines 43-60) and even cross-references `content-editor.tsx:38-40` in a comment — the author
knew the canonical home existed. Both already share `EditorToolbar`. Direct Wikipedia-
Principle violation. Target: response-editor imports `buildExtensions` (or move it to
`lib/editor/build-extensions.ts` so neither component owns the other's schema). ~20-40 LOC,
LOW risk (mechanical), but high signal — fixes future GFM-table drift across the two editors.

## CMP-6 — Table of contents: active-heading observer + collapsible nav duplicated (guide + item-detail)
Files: `components/guide/guide-table-of-contents.tsx` (163 LOC) ·
`components/item-detail/table-of-contents.tsx` (188 LOC). jscpd: 92 + 84-token clones.

Both LIVE: `GuideTableOfContents` ← `app/guide/[slug]/guide-content.tsx`;
`TableOfContents` ← `components/item-detail/reader-view.tsx` + `content-body.tsx`. Shared:
byte-identical `IntersectionObserver` setup (same `rootMargin: '-80px 0px -60% 0px'`,
same visible-sort), `handleScrollTo`, `handleBackToTop`, collapse button + nav shell.
Divergence: GuideTOC consumes pre-built `sections[]` w/ status dots; item-detail TOC parses
markdown headings itself (`parseHeadings`/`slugify`) and uses `level`-based indent. Target:
extract a `useActiveHeading(ids, minCount)` hook + a `<TocNav>` shell to `components/shared/`
(or `hooks/`); the two TOCs supply their own entry-derivation. ~80 LOC removed. Low risk.

## CMP-7 — Revision-history panel shell duplicated (item-detail + qa)
Files: `components/item-detail/version-history.tsx` (510 LOC) ·
`components/qa/qa-revision-history.tsx` (166 LOC). jscpd: 74-token clone (version-history
317-332 vs qa-revision-history 124-139). qa-revision-history.tsx:24 doc comment says it
"Mirrors `components/item-detail/version-history.tsx`'s compare affordance".

Both LIVE; both already consume the shared `RevisionDiffView` (CMP-2). The remaining dup is
the collapsible "Revision History" panel chrome (History icon + total Badge + chevron
toggle + open/loading/error/empty states). Smaller, lower-priority. Target: optional
`<RevisionHistoryPanel>` shell in `components/shared/` taking a render-prop for the diff body.
~40-60 LOC. Low risk, lowest priority of the seven.

---

## In-domain (NOT cross-domain) hot files — refactor locally, do not move
- `components/dashboard/certification-summary-card.tsx` (8 pairs, 542 tok): MOSTLY in-file
  self-duplication (175-188≈289-302, 220-230≈324-334, 247-278≈353-384) + a cross-file pair
  with its sibling `dashboard/framework-summary-card.tsx`. Two dashboard summary cards
  sharing a stat-row/card-section pattern. Extract a local `<SummaryStatRow>` /
  `<SummaryCardSection>` within `dashboard/`. In-domain, low risk.
- `components/entity-management/entity-detail-panel.tsx` (9 pairs, 505 tok): MOSTLY in-file
  (a field/section block repeated 3-4×: 182-193 ≈ 345-355 ≈ 461-472; 264-274 ≈ 390-400 ≈
  477-491) + one pair with `entity-management/entity-list.tsx`. Extract a local repeated-row
  component. In-domain, low risk.
- `components/admin/content-dedup/content-dedup-row-card.tsx` ↔
  `.../near-duplicates/near-duplicates-pair-row-card.tsx` (160 tok): both in `admin/content-dedup`.
  In-domain row-card extraction. NB content-dedup is admin UI over the dedup workflow — NOT
  the legacy `scripts/dedup.py`/`lib/dedup-normalise.ts` retire targets in collapse-list; do
  not conflate.

## Same-dir pairs worth a local extraction (lower priority)
- `components/item-detail/editor-view.tsx` ↔ `reader-view.tsx` (204 + 158-token clones):
  two item-detail surfaces (edit vs read) sharing layout scaffolding. In-domain.

---

## Taxonomy assessment vs the 6-domain model
Six app types: procurement · intelligence · sales_proposal · product_guide ·
competitor_research · training_onboarding. Current `components/` subdirs:

DOMAIN dirs (map to app types):
- `procurement/` (21) → procurement. ✔ aligned.
- `intelligence/` (26) → intelligence / competitor_research (SI company profiles live here). ✔
- `coverage/` (18) → procurement sub-feature (template coverage). Arguably belongs UNDER a
  procurement namespace, not a sibling top-level dir.
- `guide/` (6) → product_guide. ✔ aligned (small).
- `qa/` (6), `create-content/` (13), `content/` (17), `browse/` (20), `item-detail/` (33),
  `review/` (15), `provenance/` (14), `reader/` (9), `source-document/` (5),
  `change-reports/` (3), `entity-management/` (4), `reference/` (2), `reader-cards/` (2) →
  the CORPUS/curation web-UI (cross-domain governance surface). This is the largest cluster
  and is NOT one of the 6 app types — it is the "web UI governs/curates the corpus" layer.
  Reasonable as-is but sprawling; `item-detail` (33) is the single biggest subdir.

PLATFORM dirs (cross-cutting, correct as platform):
- `ui/` (22, shadcn primitives), `shared/` (24, cross-domain widgets), `shell/` (13, app
  chrome), `dashboard/` (15), `empty-state/` (1), `workspace/` (5), `admin/` (13),
  `settings/` (29). ✔ correctly platform-level.

Gaps vs the model: NO `sales-proposal/`, `competitor-research/`, or
`training-onboarding/` dirs yet (those app types are future per platform-direction) — so the
taxonomy is currently procurement+intelligence+corpus-heavy, which matches the stated build
order. The structural debt is NOT missing domains; it is (a) the seven missing SHARED
extractions above (`shared/` exists but the diff/dropzone/chip/toc/pdf primitives never
landed there), and (b) `coverage/` sitting as a top-level sibling rather than under
procurement.

## Proposed target additions to `components/shared/` (+ lib)
- `lib/diff/line-diff.ts` (`computeLineDiff`) + `components/shared/unified-line-diff.tsx` (CMP-2)
- `components/shared/string-tag-input.tsx` (chip input — CMP-3)
- `components/shared/file-dropzone.tsx` (react-dropzone-based — CMP-4)
- `lib/editor/build-extensions.ts` (move from content-editor — CMP-5)
- `hooks/use-active-heading.ts` + `components/shared/toc-nav.tsx` (CMP-6)
- `components/reader/pdf-document.tsx` (engine; reader-local, not shared — CMP-1)
- (optional) `components/shared/revision-history-panel.tsx` (CMP-7)
</content>
