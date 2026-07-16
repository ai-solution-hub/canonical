# Extend (`extend-hq/ui`) registry — install + vendor-in provenance

Checked-in provenance manifest for the Extend shadcn registry install and the v1
vendor-in component set (ID-147.6 — PLAN.md `147-B`). TECH.md §1 steps 1-4;
PRODUCT.md §A9/§B1-B5/§E1/§J1-J3/§K3.

This manifest supersedes the narrower `147-A` checkpoint manifest (originally landed
on an uninstantiated predecessor commit, never integrated) — it covers both the
registry install (steps 1-2) and the full v1 vendor-in set + policy application
(steps 3-4) in one place.

## Verdict

**PRESENT** — verified 16/07/2026.

The `extend-hq/ui` shadcn registry is live, serves real component source, and its
declared runtime dependencies (`@extend-ai/react-docx`, `@extend-ai/react-xlsx`) are
genuinely published, installable npm packages at the versions the registry declares.

## Registry registration

`components.json` `registries` block:

```json
"registries": {
  "@extend": "https://ui.extend.ai/r/{name}.json"
}
```

Unchanged: `iconLibrary: "lucide"`, `tailwind.baseColor: "neutral"`,
`tailwind.cssVariables: true` (TECH §1 step 1 / PRODUCT §K3).

**Upstream anchor** (copy-in registry has no npm version to diff against — TECH §1
step 3): `github.com/extend-hq/ui` @ commit `bca60b9e204ef0db248466dfa44367ad4c23d404`
(`main`, committed 15/07/2026 — current at verification time; `ui.extend.ai` serves
from this source, confirmed by cross-checking `apps/v4/registry.json` file lists and
dependency declarations against the live registry endpoint's served content).

## Vendor-in policy applied (TECH §1 step 4)

- **File placement.** Domain viewers/editors/upload/citation components land under
  `components/procurement/extend/**` — never `components/` root
  (`components/CLAUDE.md`). Genuinely generic, reusable shadcn primitives
  (`scroll-area`, `spinner`, `toggle`) legitimately stay in `components/ui/`
  alongside our own primitives.
- **Icons — Hugeicons → lucide in shared chrome (§J1).** The 7 shared primitives we
  already own (`button`, `input`, `popover`, `select`, `separator`, `tooltip`,
  `lib/utils`) are **never overwritten** by the vendor-in, so shared chrome never
  carries a Hugeicons import — it stays exactly as it was, lucide-only.
  `scroll-area` and `toggle` are Hugeicons-free trivially — neither primitive
  renders an icon internally, so there was nothing to swap; separately, both are
  Radix reimplementations of the upstream Base-UI components (see "Primitive
  extension" below), not registry-served Radix source with icons stripped out.
  `spinner` is the one primitive of the three that does carry an icon: the live
  registry endpoint (`https://ui.extend.ai/r/spinner.json`, upstream
  `apps/v4/registry/.../ui/spinner.tsx`) serves a Hugeicons-based source
  (`Loading03Icon` via `HugeiconsIcon`) **unconditionally** — it does not vary by
  the consuming project's `components.json` `iconLibrary` declaration. Our
  vendored `components/ui/spinner.tsx` swaps that for lucide's `Loader2Icon` by
  hand — a manual, one-file substitution performed during vendor-in, not
  automatic consumer-aware registry behaviour. Two viewer-internal single-icon
  usages were additionally swapped by hand as a cheap, low-risk improvement:
  `resizable.tsx`'s drag handle (`DragDropVerticalIcon` → lucide `GripVertical`).
  Everything else vendored (the PDF/DOCX/XLSX/CSV viewers, citations panel,
  upload surface, editor shells) is a **self-contained document viewer** per §J2
  and retains its Hugeicons internals as-is — copy-in fidelity, not a re-theme.
- **Primitives — re-wire shared chrome to `components/ui` (Radix-shadcn) (§J2).**
  Every vendored file's `@/components/ui/button|input|popover|select|separator|
  tooltip|card|dialog|dropdown-menu|badge|tabs` imports are **untouched** — they
  resolve to our own existing Radix-based primitives, never Extend's own. One
  documented exception: `docx-editor.tsx`/`xlsx-editor.tsx` call a `ToggleGroup`/
  `ToggleGroupItem` pair with a `multiple` boolean + `spacing` prop surface that only
  Extend's own Base-UI `ToggleGroup` understands — no Radix equivalent surface
  exists on our shared `components/ui/toggle.tsx` (which only ever exposed the
  simpler `Toggle`). Rather than force a Radix retrofit onto the shared primitive
  (an app-wide primitive layer change out of this Subtask's scope) or duplicate a
  second `Toggle` implementation into the shared file, the Base-UI `ToggleGroup`/
  `ToggleGroupItem` pair lives in a new **viewer-internal** file,
  `components/procurement/extend/toggle-group.tsx` — consistent with §J2's
  "self-contained… may retain internal primitives" allowance, since the DOCX/Excel
  editor shells are self-contained, not app-wide shared chrome. `color-picker.tsx`
  similarly keeps its Hugeicons-typed `icon` prop (a public prop consumed by the
  editor shells) rather than a partial, call-site-breaking swap.
- **Theming — install as-is (§B5/§J3).** White document backgrounds are the
  accepted v1 state; vendored source is not re-pointed to semantic tokens on day
  one. The DOCX/XLSX viewers' **required** `isDark`/`onIsDarkChange` props (§B4) are
  bound to the app theme context via a new hook,
  `components/procurement/extend/use-extend-theme.ts` (`useExtendTheme()`, wrapping
  `hooks/ui/use-theme-mode.ts`'s `useThemeMode()` — `resolvedTheme === 'dark'` →
  `isDark`; `onIsDarkChange` → `setTheme('dark' | 'light')`), consumed by two thin
  wrapper shells, `components/procurement/extend/themed-viewers.tsx`
  (`ThemedDocxViewer`, `ThemedXlsxViewer`). Data-fetching / `src` wiring is
  ID-147.18's state-contract work — these wrappers only bind the theme prop pair.
- **Backend binding (§5).** No new upload backend introduced in this Subtask —
  the vendored `FileUpload`/`PdfDropzoneBlock` shells expose `onFilesAccepted` for
  ID-147.18 to bind to the existing hardened path.
- **`bun run typecheck` clean (0 errors).** Keeping our own primitives (not
  Extend's) surfaces real prop-shape drift — the same class of gap a1956dac's
  narrower checkpoint flagged as 6 known `pdf-viewer.tsx` errors, now resolved
  across the full v1 set (63 → 0). Two kinds of fix, both scoped to files this
  Subtask owns:
  1. **Call-site adaptation** (the majority): drop or rename props our primitive
     doesn't declare — `modal`/`alignItemWithTrigger` on `Select`/`SelectContent`
     (Radix has no equivalent), `label` on `SelectItem` (redundant with visible
     children), `variant="switch"` on `DropdownMenuCheckboxItem`, `nativeInput` on
     `Input` (ours is always native), `size="sm"` string variant on `Input` (ours
     is the native numeric HTML attribute), `loading` on `Button` (→ `disabled`),
     `delay` → `delayDuration` on `TooltipProvider`, `keepMounted` on
     `TabsContent`, `DialogPanel` → a plain wrapper `<div>` (our `DialogContent`
     already provides the full panel surface Extend splits into two pieces), and
     Badge `variant="success"/"error"/"warning"/"info"` (+`size`) remapped to our
     existing `default`/`destructive`/`outline`/`secondary` variants in
     `docx-annotation-card.tsx` (no new Badge variant or CSS token added — out of
     this Subtask's file ownership).
  2. **Primitive extension** (two primitives, one with added props):
     `components/ui/scroll-area.tsx`'s `ScrollArea` and
     `components/ui/toggle.tsx`'s `Toggle` are not literal
     vendored-then-extended copies of an already-Radix upstream. Upstream
     `apps/v4/registry/.../ui/scroll-area.tsx` and `ui/toggle.tsx` are built on
     `@base-ui/react` (Base-UI); our vendored versions import from `'radix-ui'`
     instead — a deliberate underlying-primitive-library swap (Base-UI → Radix)
     for consistency with every other primitive already in `components/ui/`.
     `Toggle` is a straight reimplementation matching Base-UI's `Toggle` prop
     surface/behaviour, no extra props needed. `ScrollArea` — introduced fresh
     by this vendor-in, not a pre-existing app-wide primitive with other
     consumers — additionally gained `orientation` ('vertical'/'horizontal'/
     'both'), `viewportClassName`, `viewportProps` (spread onto the Radix
     `Viewport`), and `viewportRef` (forwarded to the `Viewport` DOM node),
     reimplemented on top of Radix's `Viewport` to match the upstream Base-UI
     `ScrollArea`'s prop surface and preserve the vendored viewers'
     keyboard-accessible listbox navigation and programmatic-scroll behaviour —
     genuinely functional, not cosmetic, so implemented rather than stripped.
     `scrollFade`, `scrollbarGutter`, and `scrollbarOverflowOnly` are accepted
     (typed) but currently no-op cosmetic affordances, consistent with
     install-as-is theming.
- **File System / Finder is NOT installed** (DR-068) — no `file-system` /
  `@extend/file-system` registry item was added; `rg -i "file-system"` over
  `components/procurement/extend/` returns no vendored Finder source.

## v1 component set — provenance table

| Component | Registry item | Landed at | Add date |
| --- | --- | --- | --- |
| PDF Viewer | `@extend/pdf-viewer` | `components/procurement/extend/pdf-viewer.tsx` (+ `pdf-thumbnail-utils.ts`) | 16/07/2026 |
| Document Viewer Sidebar | `@extend/document-viewer-sidebar` | `components/procurement/extend/document-viewer-sidebar.tsx` | 16/07/2026 |
| File Thumbnail | `@extend/file-thumbnail` | `components/procurement/extend/file-thumbnail.tsx` | 16/07/2026 |
| DOCX Viewer | `@extend/docx-viewer` | `components/procurement/extend/docx-viewer.tsx` (+ `docx-annotation-card.tsx`) | 16/07/2026 |
| XLSX Viewer | `@extend/xlsx-viewer` | `components/procurement/extend/xlsx-viewer.tsx` | 16/07/2026 |
| CSV Viewer | `@extend/csv-viewer` | `components/procurement/extend/csv-viewer.tsx` | 16/07/2026 |
| Bounding Box Citations / `HumanReviewPanel` | `@extend/bounding-box-citations` | `components/procurement/extend/bounding-box-citations.tsx` | 16/07/2026 |
| File Upload | `@extend/file-upload` | `components/procurement/extend/file-upload.tsx` | 16/07/2026 |
| PDF Dropzone (block) | `@extend/pdf-dropzone` | `components/procurement/extend/pdf-dropzone.tsx` | 16/07/2026 |
| PDF-block resizable shell | (regdep of `pdf-dropzone`/`e-signature`/`bounding-box-citations-block`) | `components/procurement/extend/pdf-block-resizable-shell.tsx` | 16/07/2026 |
| E-Signature (block) | `@extend/e-signature` | `components/procurement/extend/e-signature.tsx` | 16/07/2026 |
| DOCX Editor | `@extend/docx-editor` | `components/procurement/extend/docx-editor.tsx` | 16/07/2026 |
| Excel (XLSX) Editor | `@extend/xlsx-editor` | `components/procurement/extend/xlsx-editor.tsx` | 16/07/2026 |
| Color Picker (editor-internal regdep) | `@extend/color-picker` | `components/procurement/extend/color-picker.tsx` | 16/07/2026 |
| Group (editor-internal regdep) | `@extend/group` | `components/procurement/extend/group.tsx` | 16/07/2026 |
| Resizable (editor-internal regdep) | (base shadcn `resizable`, extend-hq/ui variant) | `components/procurement/extend/resizable.tsx` | 16/07/2026 |
| Toggle Group (editor-internal, hand-split from `toggle`) | `@extend/toggle` (`ToggleGroup`/`ToggleGroupItem` half) | `components/procurement/extend/toggle-group.tsx` | 16/07/2026 |
| Scroll Area (shared primitive) | `@extend/scroll-area` | `components/ui/scroll-area.tsx` | 16/07/2026 |
| Spinner (shared primitive) | `@extend/spinner` | `components/ui/spinner.tsx` | 16/07/2026 |
| Toggle (shared primitive, `Toggle` half) | `@extend/toggle` | `components/ui/toggle.tsx` | 16/07/2026 |

**registryDependencies skipped (kept our existing shared primitives, unchanged) —
prevents an app-wide shared-chrome blast radius:** `components/ui/button.tsx`,
`input.tsx`, `popover.tsx`, `select.tsx`, `separator.tsx`, `tooltip.tsx`, `card.tsx`,
`dialog.tsx`, `dropdown-menu.tsx`, `badge.tsx`, `tabs.tsx`, `lib/utils.ts`.

## Real npm dependencies pulled (package.json + bun.lock; confirmed present in
`node_modules`)

| Package | Declared range | Resolved version |
| --- | --- | --- |
| `@embedpdf/*` (14 packages) | `^2.14.4` | `2.14.4` |
| `@hugeicons/core-free-icons` | `^4.2.0` | `4.2.2` |
| `@hugeicons/react` | `^1.1.6` | `1.1.9` |
| `pdf-lib` | `^1.17.1` | `1.17.1` |
| `@extend-ai/react-docx` | `^0.8.1` | `0.8.1` |
| `@extend-ai/react-xlsx` | `0.15.0` (exact) | `0.15.0` |
| `@base-ui/react` | `^1.4.1` | `1.6.0` |
| `@glideapps/glide-data-grid` | `6.0.4-alpha24` (exact) | `6.0.4-alpha24` |
| `@pierre/diffs` | `^1.1.22` | `1.2.12` |
| `border-beam` | `^1.0.1` | `1.3.0` |
| `papaparse` (+ `@types/papaparse` dev) | `^5.5.3` | `5.5.4` |
| `react-resizable-panels` | `^4.11.2` | `4.12.2` |
| `signature_pad` | `^5.1.3` | `5.1.3` |

`@extend-ai/react-docx`/`@extend-ai/react-xlsx` are the genuine runtime-dependency
exception (PRODUCT §K3) — every other package above is a real, independently
published npm dependency the vendored source itself requires (embedpdf's PDF
engine, Hugeicons icon data used internally by self-contained viewers, Base UI for
the editor-internal primitives, glide-data-grid for the CSV/citations grid, etc.),
not an Extend-owned runtime.

## Smoke tests (`bun run test`)

- `__tests__/components/procurement/extend/pdf-viewer.smoke.test.tsx`
- `__tests__/components/procurement/extend/viewers.smoke.test.tsx` (DOCX/XLSX/CSV
  viewers, Document-Viewer-Sidebar, File-Thumbnail, docx-annotation-card)
- `__tests__/components/procurement/extend/citations-upload.smoke.test.tsx`
  (`HumanReviewPanel`, File Upload, PDF Dropzone)
- `__tests__/components/procurement/extend/editors-signature.smoke.test.tsx`
  (DOCX/Excel Editor shells, E-Signature shell, PDF-block resizable shell)
- `__tests__/components/procurement/extend/primitives.smoke.test.tsx`
  (color-picker, group, resizable)
- `__tests__/components/procurement/extend/themed-viewers.smoke.test.tsx`
  (`useExtendTheme`, `ThemedDocxViewer`, `ThemedXlsxViewer` — PRODUCT §B4)
- `__tests__/components/ui/extend-shared-primitives.smoke.test.tsx` (scroll-area,
  spinner, toggle)

Each vendored component imports and renders without an unhandled exception (no
real document `src`/data is supplied — these are structural mount checks).

## Scope note

This manifest covers PLAN.md `147-B` (registry install + full v1 vendor-in set +
policy application). Explicitly **out of scope** here (later PLAN.md waves):

- DOCX/Excel Editor **fork + persistence wiring** (Extend ships `file?:string` with
  no callbacks — ID-147.13/ID-147.14 add field-driving + persistence, DR-066).
- Viewer/upload **state contracts** (`src` resolution, `onFilesAccepted` binding to
  the hardened upload backend, spatial fill-slot/citation data wiring) — ID-147.18
  (PRODUCT §B6/§B7/§E1/§E3/§E4).
- Re-pointing vendored source to bare Warm Meridian semantic tokens (§B5/§J3) — an
  incremental follow-up, not a day-one gate.
