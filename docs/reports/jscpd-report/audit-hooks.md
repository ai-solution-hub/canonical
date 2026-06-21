# Audit — `hooks/` area

Branch `jscpd-dupe-audit`. READ-ONLY findings. Tooling: ast-dataflow (caller/importer
counts), unsandboxed grep (reference sweeps), jscpd-report.json (clone line-ranges),
analysis.json crossdir/module_pairs.

83 files, ~15,028 LOC. Subfolders: browse(8) intelligence(15) procurement(5)
provenance(1) reference(1) review(9) streaming(3) ui(7) workspaces(1) + 34 ROOT hooks.
No `index.ts` barrels exist (good — matches no-barrel convention). No `hooks/CLAUDE.md`.

---

## H1 — NAMING VIOLATION: the one camelCase file

`hooks/useContentIngestPolling.ts` is the ONLY camelCase filename; all 82 other hooks are
kebab-case `use-x.ts`. Rename target: `hooks/use-content-ingest-polling.ts`.

Blast radius (ast-dataflow `importers --module '@/hooks/useContentIngestPolling'` +
unsandboxed grep) — small and fully enumerable:
- `components/create-content/upload-tab-content.tsx:29` — real `import { useContentIngestPolling }`
- `__tests__/hooks/useContentIngestPolling.test.tsx:21` — test import (+ the test FILENAME also renames)
- `hooks/use-file-upload-pipeline.ts:33` — doc-comment path reference
- `lib/upload/folder-drop.ts:15` — doc-comment path reference

The exported SYMBOL `useContentIngestPolling` stays (camelCase is correct for the function);
only the FILE renames. 2 real import sites + 1 test file rename + 2 comment fixups. Low risk.
Use `gitnexus_rename` / git mv, not find-replace.

---

## H2 — Mirrored type definitions (Wikipedia-principle violation, hand-synced copies)

Two intelligence hooks re-declare, byte-for-byte, type shapes that already have a canonical
home — the hooks' own doc-comments admit it ("Mirrors X in ...").

### H2a — `WorkspaceFlag` (hook) ⇄ `WorkspaceFlagRow` (route)
jscpd crossdir clone: `app/api/intelligence/workspaces/[id]/flags/route.ts:33-62` ⇄
`hooks/intelligence/use-workspace-flags.ts:19-41` (30 lines / 93 tokens). 18-field shape
copied. Hook comment line 13: "Mirrors the `WorkspaceFlagRow` interface defined inside the
API route". Route's `WorkspaceFlagRow` is `export`ed but loosely typed (`flag_type: string`),
hook's `WorkspaceFlag` is the tighter union. FIX: lift ONE canonical
`WorkspaceFlag` type (with the tight unions) into e.g. `types/intelligence.ts` or
`lib/intelligence/flags.ts`; both route + hook import it.

### H2b — `PipelineHealth`/`SourceHealthEntry`/`SourceHealthSummary`
jscpd crossdir clone: `hooks/intelligence/use-workspace-health.ts:13-58` ⇄
`lib/intelligence/health.ts:11-50` (46 lines / 108 tokens). `lib/intelligence/health.ts`
already exports `PipelineHealthSummary` / `SourceHealthEntry` / `SourceHealthSummary` as
`@public` (knip-tracked canonical home). The hook re-types all three (renaming
`PipelineHealthSummary`→`PipelineHealth`) instead of importing. `SourceHealthEntry` /
`SourceHealthSummary` are byte-identical. FIX: hook imports the three types from
`lib/intelligence/health.ts`; drop the local copies. Keep the hook-only
`WorkspaceHealthResponse` composite (legit — combines the two).

Both H2a/H2b are pure type-dedup: zero behaviour change, both sides already wired.

---

## H3 — `applyWithTransition` duplicated verbatim across two ui hooks

`hooks/ui/use-theme-mode.ts:5-19` and `hooks/ui/use-accessibility.ts:10-24` each define an
IDENTICAL `applyWithTransition(callback)` helper (jscpd clone 17 lines / `use-accessibility.ts:8-24`
⇄ `use-theme-mode.ts:3-19`). It is the view-transition guard (SSR guard +
prefers-reduced-motion + startViewTransition fallback). grep confirms exactly these 2 defs,
no other copies. FIX: extract to `lib/ui/view-transition.ts` (or `hooks/ui/view-transition.ts`
non-hook util); both hooks import. ~14 LOC removed. Low risk (pure function, no state).

---

## H4 — Selection-state primitive duplicated; AND a `use-*` hook living under `lib/`

jscpd crossdir clone (13 lines): `hooks/review/use-publication-review-selection.ts:52-64` ⇄
`lib/content-browsing/use-content-selection.ts:22-34` — the immutable `Set<string>` toggle
core (`new Set(prev)` → add/delete → return) plus clear/selectAll.

Two issues here:
1. **PLACEMENT**: `lib/content-browsing/` holds THREE React hooks —
   `use-content-selection.ts`, `use-content-bulk-runner.ts`, `use-url-filters.ts` — all
   `'use client'` `use*` hooks living under `lib/`, not `hooks/`. This is the clearest
   placement smell in the area: hooks belong in `hooks/`. `useContentSelection` has 14
   callers (incl. `hooks/use-library-bulk-actions.ts:80`, `app/browse/browse-content.tsx:136`);
   moving it is a multi-import relocation (use gitnexus_rename / verify importers first).
2. **DUP**: both hooks implement the same Set-toggle core. They differ at the edges
   (`useContentSelection` adds `resetDeps` auto-reset + `isAllSelected`; publication-review
   does page-only `selectAll` replace, 1 caller). A shared `useSelectionSet()` primitive
   (toggle/clear/isSelected + replace-set) would back both; each keeps its thin policy layer.
   Lower priority than the placement fix.

NB cross-area: `lib/content-browsing` belongs to the lib audit; flagged here because the
hook-under-lib placement is a hooks-structure concern.

---

## H5 — Review filter→URLSearchParams serialization duplicated

jscpd clone (12 lines): `hooks/review/use-review-queue-data.ts:74-85` ⇄
`hooks/review/use-review-session.ts:127-138`. Both serialize the same review-queue filter
object (`domain[]` append, `content_type[]` append, `source_file`, `source_document_id`,
`assigned_to_me`) into URLSearchParams. FIX: one `buildReviewQueueParams(filters)` helper in
a review util consumed by both. Both live in `hooks/review/` so this is intra-folder. ~12 LOC.

---

## H6 — `UseBidResponseActionsReturn` handler shape duplicated into stream-coordination

jscpd clone (11 lines): `hooks/procurement/use-procurement-response-actions.ts:36-46` ⇄
`hooks/streaming/use-stream-coordination.ts:152-163`. The
`handleAction`/`handleLibraryInsert`/`handleCitationClick`/`actionLoading`/`loadingAction`
block of `UseBidResponseActionsReturn` is re-typed inline inside
`use-stream-coordination.ts`'s return interface. FIX: `use-stream-coordination` should
extend/embed the exported `UseBidResponseActionsReturn` rather than re-listing its members.
Type-only; low risk.

---

## H7 — Self-duplication inside use-review-actions.ts

jscpd clone (24 lines, INTRA-FILE): `hooks/review/use-review-actions.ts:216-239` ⇄
`:273-296`. Two near-identical mutation-handler blocks. Worth a local extract; smallest /
lowest-priority of the clones. Noted, not separately scored as a structural finding.

---

## H8 — Placement / over-foldering / root-vs-subfolder splits

### Single-file subfolders (over-foldering)
- `provenance/` (1 file: `use-item-provenance.ts`) — but `hooks/use-qa-provenance.ts`
  (214 LOC, queryKeys.qaProvenance) sits at ROOT. These are the same domain split across
  root+folder. Either move `use-qa-provenance.ts` INTO `provenance/` (giving the folder 2
  siblings, justifying it) or flatten both to root. Recommend: move qa-provenance into
  `provenance/`.
- `reference/` (1 file: `use-reference-data.ts`, 370 LOC) — no obvious sibling at root;
  candidate to promote to root `hooks/use-reference-data.ts` UNLESS more reference hooks are
  imminent. Decide.
- `workspaces/` (1 file: `use-application-types.ts`) — `use-quick-assign.ts` (root,
  queryKeys.workspaces) and `intelligence/use-intelligence-workspaces.ts` are workspace-ish.
  Recommend promote `use-application-types.ts` to root OR consolidate workspace hooks.

### Root hooks that belong in EXISTING subfolders (by queryKeys namespace + 1 non-test caller each)
- `use-qa-provenance.ts` → `provenance/` (queryKeys.qaProvenance; 1 non-test caller)
- `use-citation-orphans.ts` → `review/` (review-context; queryKeys.citations; 1 non-test caller)
- `use-diff-review.ts` → `review/` (queryKeys.sourceDocuments, "review state for diff review component")
- `use-change-reports-data.ts` → new `change-reports/` or keep general (queryKeys.changeReports;
  1 non-test caller). NB digest→change-reports rename already done here.

### Root hooks that form an item-detail cluster (candidate `detail/` or `item/` subfolder)
`use-item-detail-data.ts` (557 LOC), `use-item-detail-shortcuts.ts`, `use-entity-detail.ts`,
`use-inline-field-edit.ts` — all queryKeys.contentItems/entities, item-detail surface. Currently
scattered at root. Candidate `hooks/item-detail/` folder (4 siblings).

### Root hooks that form a library/content cluster (candidate `library/` or fold into `browse/`)
`use-library-data.ts`, `use-library-bulk-actions.ts`, `use-batch-create.ts`,
`use-content-templates.ts`, `use-content-library-drawer.ts` — content-library surface,
queryKeys.contentItems/sourceDocuments. Candidate `hooks/library/`.

### Genuinely-general (belong at root or a new `general/`)
`use-hydrated.ts` (SSR hydration), `use-modifier-key.ts`(in ui), `use-display-names.ts`
(cross-cutting user util), `use-user-role.ts`, `use-primary-focus.ts`, `use-claude-connected.ts`,
`use-account-age.ts`, `use-notifications.ts`, `use-progress.ts`, `use-search.ts`,
`use-organisation-profile.ts`, `use-transcript.ts`, `use-vision-analysis.ts`,
`use-coverage-targets.ts`, `use-topic-layer-content.ts`, `use-layer-admin.ts`,
`use-taxonomy-admin.ts`, `use-tags-data.ts`. These are user/account/admin/general utilities.

### Cross-area NOTE: duplicate display-name lib modules
`lib/user/display-name.ts` AND `lib/users/display-names.ts` both exist (singular vs plural
dir). `hooks/use-display-names.ts` calls `/api/users/display-names`. The lib duplication is
the lib audit's call, but flagged because the hook's naming/placement ties to it. `useDisplayNames`
has 10 callers (all in tests currently — verify a live consumer before any relocation).

---

## Proposed target `hooks/` structure (aligned to 6-domain model + general/ + ui/)

```
hooks/
  general/        # SSR, auth/user/account, notifications, search, display-names, transcript, vision
  ui/             # keyboard-shortcuts, theme, a11y, view-mode, detail-mode, modifier-key, reader-prefs
                  #   + extracted view-transition util (H3)
  browse/         # (exists) + url-filters/content-selection MOVED from lib/content-browsing (H4)
  library/        # use-library-data, library-bulk-actions, batch-create, content-templates, drawer
  item-detail/    # item-detail-data, item-detail-shortcuts, entity-detail, inline-field-edit
  review/         # (exists, 9) + citation-orphans, diff-review; + shared review-params helper (H5)
  provenance/     # item-provenance + qa-provenance (root MOVED in)
  intelligence/   # (exists, 15) — flags/health type dedup to lib/types (H2)
  procurement/    # (exists, 5)
  streaming/      # (exists, 3)
  reference/      # promote single file to root OR keep if siblings coming
  workspaces/     # promote OR consolidate with quick-assign + intelligence workspaces
  taxonomy/admin/ # layer-admin, taxonomy-admin, topic-layer-content, coverage-targets, tags  (optional)
```
Domains map: procurement·intelligence·review/browse/library/item-detail (web-curation UI for
the corpus)·provenance·streaming. The 6 application-types live mostly server-side; the hooks
tree is the web-curation surface, so a strict 6-folder mapping does NOT fit — `ui/` + a
small `general/` + the surface-named folders (browse/library/review/item-detail) is the
honest structure.

## Priority order
1. H1 camelCase rename (trivial, 2 import sites) — quick win.
2. H2a/H2b mirrored types — pure dedup, both sides wired, removes ~70 LOC of hand-synced copies.
3. H4 placement (3 hooks under lib/ → hooks/) — clearest structural debt.
4. H3 applyWithTransition extract.
5. H5/H6/H7 smaller clone extracts.
6. H8 folder reshuffle — larger, do as one deliberate restructure PR.

## Retire check
NO retire candidates in hooks/. Every hook examined has ≥1 non-test caller (ast-dataflow
`callers`) OR is a wired query hook. None sit in a DEAD cluster (cluster I is lib/quality,
not hooks). All findings are consolidate/relocate/rename/restructure — zero deletions.
