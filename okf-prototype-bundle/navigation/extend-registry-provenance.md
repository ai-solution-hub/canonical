---
type: navigation
title: Extend Registry Vendor-In Provenance
description: Orientation to the checked-in provenance manifest for the Extend shadcn registry install and v1 vendor-in component set, explaining how to read and use it as a navigational reference.
timestamp: "2026-07-21T10:29:31.844252Z"
tags:
  - extend
  - vendor-in
  - provenance
  - registry
  - shadcn
  - navigation
---
## What this page is for

This is a **provenance manifest** — a single checked-in record that documents a completed shadcn registry install and the vendoring-in of a set of Extend UI components. It exists so that both humans and agents can answer, at any later time, three questions without re-deriving them from the codebase: *what was installed, where did it come from, and what local adaptations were applied?*

Read it as a navigational anchor. It does not teach you how to build components; it tells you what landed, where each file lives, which upstream commit it was pinned to, and which policy decisions govern the vendored source.

## How to use it to navigate the system

**Finding a vendored component.** The component-set table maps each Extend registry item to its landed file path. Domain viewers, editors, upload surfaces, and citation panels live under a `components/procurement/extend/**` subtree — never the `components/` root — while genuinely generic shadcn primitives (scroll-area, spinner, toggle) sit in the shared `components/ui/` directory alongside existing primitives. If you need to locate a specific viewer or editor, start from that table.

**Understanding upstream provenance.** The page records the upstream anchor commit for the Extend registry source and notes that the live registry endpoint was cross-checked against the served content at verification time. Because the copy-in registry has no npm version to diff against, the commit hash is the authoritative upstream pin. Use this when you need to audit whether a local file matches upstream or to reason about drift.

**Understanding the dependency surface.** A separate table lists every real npm package pulled in by the vendor-in, with declared ranges and resolved versions. This distinguishes genuine third-party runtime dependencies (PDF engines, icon data, data grids, etc.) from the Extend-owned runtime packages. Consult this table before adding or removing a dependency that a vendored component relies on.

## Policy decisions to keep in mind

The manifest documents several vendor-in policies that a navigator should internalise:

- **Shared chrome is never overwritten.** Seven already-owned shared primitives are untouched by the vendor-in, so application-wide chrome stays lucide-only and Radix-based.
- **Icon swapping is manual and selective.** The registry serves Hugeicons-based source unconditionally regardless of consumer icon-library declarations. Only spinner and a couple of viewer-internal single-icon usages were hand-swapped to lucide; self-contained document viewers retain their Hugeicons internals as-is.
- **Primitive imports resolve to local shared primitives.** Vendored files import button, input, popover, select, separator, tooltip, card, dialog, dropdown-menu, badge, and tabs from the existing Radix-based shared set, not Extend's own. The one exception is a viewer-internal toggle-group file, kept inside the extend subtree rather than retrofitted onto the shared primitive.
- **Theming is install-as-is for v1.** Vendored source is not re-pointed to semantic tokens on day one. A theme-bridge hook and thin wrapper shells bind the dark-mode prop pair required by the DOCX/XLSX viewers to the app theme context.
- **Backend wiring is deferred.** Upload shells expose an `onFilesAccepted` callback for a later subtask to bind to the existing hardened upload path; no new backend was introduced here.
- **Typecheck is clean.** Call-site adaptations and two deliberate primitive extensions (scroll-area and toggle, re-implemented on Radix instead of upstream Base-UI) brought the typecheck from a prior six-error state down to zero.

## Verification status

The manifest declares a verdict of **PRESENT**, verified on 16/07/2026. It supersedes an earlier, narrower checkpoint manifest that was never integrated. The registry is confirmed live, serving real component source, and its declared runtime dependencies are genuinely published and installable.

## Scope boundaries

This manifest covers the registry install, the full v1 vendor-in set, and policy application only. It explicitly marks three areas as out of scope and belonging to later waves: DOCX/Excel editor fork and persistence wiring; viewer and upload state contracts (source resolution, callback binding, citation data wiring); and re-pointing vendored source to bare semantic tokens. When navigating, treat these boundaries as signposts pointing to subsequent work rather than gaps in this document.

## Smoke-test orientation

A set of structural smoke tests is listed, each covering a cluster of vendored components. These are mount-only checks — they confirm that each component imports and renders without an unhandled exception, not that real document data flows correctly. Use them as a quick map to the test files that guard each component cluster.

# Citations

[1] [https://github.com/ai-solution-hub/canonical/blob/0140d583503000a8b06ebc5d085054bba5f306d2/docs/extend-registry-provenance.md](https://github.com/ai-solution-hub/canonical/blob/0140d583503000a8b06ebc5d085054bba5f306d2/docs/extend-registry-provenance.md)

