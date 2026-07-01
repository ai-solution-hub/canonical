# design-sync NOTES — Canonical → claude.ai/design

Project: **Canonical** — https://claude.ai/design/p/a9316af8-0dca-4282-914a-d298d6e840ba
First sync: S397 (2026-06-22). Shape: **package / synth-entry** (this repo is a Next.js
APP, not a published component library — there is no `dist/`).

## Load-bearing setup (the converter's stock path does NOT cover an app repo)

Two out-of-band steps must run BEFORE `package-build.mjs` / the resync driver, because the
driver doesn't know about them:

1. **Scratch node_modules** (`.design-sync/.cache/nm/`). The converter resolves
   `PKG_DIR = <node-modules>/<pkg>` and vendors React from `--node-modules`. This repo's
   `node_modules` is a symlink to `../canonical/node_modules` and has no self-`canonical`
   package. Recreate the scratch dir each clone:

   ```sh
   REAL=/Users/liamj/Documents/development/canonical/node_modules   # real deps
   NM=.design-sync/.cache/nm
   mkdir -p "$NM"
   for d in "$REAL"/*; do b=$(basename "$d"); [ "$b" = canonical ] || ln -sfn "$d" "$NM/$b"; done
   ln -sfn "$(pwd)" "$NM/canonical"   # canonical -> repo root  => PKG_DIR = repo root, synth mode
   ```

   Then always pass `--node-modules .design-sync/.cache/nm`. `.cache/` is gitignored, so
   this is a per-clone step.

2. **Tailwind compile** (`.design-sync/compile-tw.mjs`). `cssEntry` points at
   `.design-sync/.cache/compiled.css`, which is `app/globals.css` (a Tailwind v4 SOURCE —
   `@import 'tailwindcss'` + `@theme`) compiled to browser CSS, with a Google-Fonts
   `@import` for the brand font prepended. Run before every build:
   ```sh
   node .design-sync/compile-tw.mjs   # writes .design-sync/.cache/compiled.css
   ```
   Uses the app's installed `postcss` + `@tailwindcss/postcss` (resolved from the repo
   node_modules — run from repo root).

Build (after 1 + 2):

```sh
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules .design-sync/.cache/nm --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle    # render check needs playwright chromium (cached)
```

## Upload — DesignSync MCP (the productized path, S406)

The upload is the **agent's** half (resync.mjs only emits the plan; it never pushes).
Since S406 the upload goes through the **`DesignSync` MCP tool** (claude.ai/design, login
scoped `user:design:read/write`). Project **Canonical** =
`a9316af8-0dca-4282-914a-d298d6e840ba`.

Full re-push flow (used S406 — simplest, guarantees the remote mirrors a freshly-built
bundle; the bundle is <1 MB, well under the 5 MB cap):

```sh
node .ds-sync/gen-upload-list.mjs ./ds-bundle   # → ds-bundle/.upload-list.json (400 files)
node .ds-sync/emit-batches.mjs                  # → ds-bundle/.batch-N.json (≤180 each)
```

Then, via the MCP tool (`{path, localPath}` from the batch files maps 1:1 onto
`write_files.files` — `localPath` is read from disk, contents never enter agent context):

1. `finalize_plan({projectId, localDir:<abs ds-bundle>, writes:[globs], deletes:[]})` —
   `writes` is capped at **256 entries**, so pass globs, not the 400 paths:
   `components/general/**/*.{d.ts,html,jsx,prompt.md}`, `_preview/*.js`, `_vendor/*.js`,
   `README.md`, `styles.css`, `_ds_bundle.{css,js}`, `_ds_sync.json`.
2. `write_files({planId, files:<batch>})` per batch (≤256 files/call). Add `_ds_sync.json`
   (the verification anchor — gen-upload-list excludes it, push it so the remote anchor
   matches and future delta-resyncs stay correct).
3. `delete_files` the stale `_ds_needs_recompile` sentinel — a LOCAL build artifact
   gen-upload-list excludes; the app detects change via the bundle/anchor, not this file,
   so it's junk on the remote. (S406: it had been stuck since S397; deleted.)
4. `list_files` + spot-check a `get_file` (e.g. a variant `.d.ts`) to verify the push.

`gen-upload-list.mjs` no longer excludes DropdownMenuLabel (S406 — it's live + previewed).

**Delta path (future incremental syncs):** `DesignSync get_file _ds_sync.json` → local
sidecar → `node .ds-sync/resync.mjs … --remote <sidecar>` emits `.resync-verdict.json`
with `upload:{components,bundle,styling,aux,deletePaths}` — push only that delta. Use this
once the project is large/stable; the full re-push is fine while the bundle is small.

## Scope decision — bundle is `components/ui` ONLY (92 primitives). DO NOT widen.

The full app surface (410 components) bundles to **12.8 MB**; the DesignSync upload
**hard-caps at 5 MB**. App components transitively pull `@supabase/supabase-js`,
`@tanstack/react-query`, and the `@/lib` graph (proven: excluding 209 data components did
NOT shrink the bundle — the weight is in what the kept ones import). Only
`components/ui/*` is pure (radix + lucide + `cn`) → 605 KB. So `srcDir` is pinned to
`components/ui`. Widening it will blow the 5 MB cap.

## Brand font

`Instrument Sans` (app uses `next/font/google`). Shipped via a Google-Fonts remote
`@import` prepended in `compile-tw.mjs` → validate reports `[FONT_REMOTE]` (loads at
runtime, the real font, not a substitute). Recorded as accepted.

## `.d.ts` fidelity (synth mode)

Synth mode flattens props to `[key: string]: unknown` (no real variant props).
`cfg.dtsPropsFor` hand-writes accurate contracts. **S406: expanded 2 → 45 contracts**
across 20 source components (extract → adversarial verify per component; the verify pass
caught 4 drift bugs — phantom `children` on Checkbox/Separator, a missed `modal` on
Popover, the Textarea children convention). Variant unions are transcribed verbatim from
each `cva()` (e.g. `TabsList variant: 'default' | 'line'`, `SheetContent side`, `Switch`/
`SelectTrigger size: 'sm' | 'default'`). The design agent now codes against real APIs for
every primitive that carries a meaningful prop contract; the remaining ~50 symbols are
pure structural sub-parts (className/children only) and intentionally stay synth.
FOLLOW-UP: re-verify a contract against `components/ui/<x>.tsx` if that component's
variants change (the strings are hand-derived from the cva at S406 HEAD).

## Authored previews so far (26) — graded good

Wave 1 (8): Button, Badge, Card, CardHeader, Checkbox, Progress, SheetHeader, SheetFooter.
Wave 2 (9): Input, Label, Switch, Textarea, Separator, Skeleton, RadioGroup, Accordion,
Tabs. Wave 3 (7, overlays — open-state via
`cfg.overrides.<Name>={cardMode:'single',viewport:'WxH'}`

- `defaultOpen`): Dialog, Select, Sheet, Popover, Tooltip, DropdownMenu,
  DropdownMenuLabel. **Wave 4 (S406, 2): AlertDialog** (overlay, `defaultOpen` recipe —
  destructive-confirm; Action/Cancel ARE the footer buttons) **+ ConceptHelp** (custom
  `?`-affordance helper rendered beside metric labels inside `TooltipProvider`; tooltip is
  hover/focus-revealed so the static card shows the affordance in context). That clears
  the last 2 unauthored **top-level** components — the remaining **66** floor cards are
  all structural sub-parts (DialogContent, SelectItem, CardFooter…) covered by their
  parent's composition preview; authoring them solo is noise, not coverage. Overlay
  authoring recipe is proven: Radix overlays render fully open (with backdrop) in headless
  chromium when given `defaultOpen` + `cardMode:single` + a fixed viewport.

GRID_OVERFLOW: Card, Tabs, Textarea are set to `cfg.overrides.<Name>={cardMode:'column'}`
(their multi-cell stories cropped in the product grid; column = one cell per row, full
width).

## Wave 5 (S407) — composite product-surface RECIPES (not new components)

The remaining 66 floor cards are structural sub-parts (deliberately unauthored — see
above). To "build out the design system" without filling noise, Wave 5 added **composite
recipes**: realistic Canonical product surfaces assembled from the primitives, authored as
extra named-export stories on the container components. **KEY CONSTRAINT** (verified in
`.ds-sync/lib/previews.mjs` + `package-build.mjs`): a preview MUST be named after an
exported `components/ui` component — `writePreviewFiles`/`buildPreviews` iterate the
component list; a `previews/<X>.tsx` where X isn't exported is logged "stale" and dropped.
So recipes can't be standalone arbitrarily-named cards; they attach to a container and
render as additional `.ds-cell` cells inside that component's card (column-mode stacks all
PascalCase exports; the `900x700` marker is just the thumbnail crop — content scrolls).

Recipes added (grounded in real surfaces via a codebase sweep — authentic domain copy +
the real bid/freshness/priority-tier/template semantic tokens, used inline as
`var(--<token>)` / `var(--<token>-bg)` since utility classes aren't all compiled):

- **Card.tsx** (now 7 cells): kept Default + WithAction; added `BidCoverageSummary`
  (workflow Pill + buyer/deadline + question Progress +
  strong/partial/needs-SME/no-content posture dots), `CoverageStats` (4-up stat-tile grid:
  total/fresh%/gaps/expired), `PriorityGap` (critical Pill + Taxonomy badge + close-gap
  action), `FeedSource` (status dot + RSS/cadence/last-polled + Active/Archive),
  `TemplateCompletion` (confirmed/skipped/failed 3-stat grid + Download/Refill).
- **Tabs.tsx** (now 3 cells): kept Default + LineVariant; added `BidWorkspace`
  (Overview/Coverage/Sources/Activity; Coverage tab carries dual Progress + posture
  badges).

Local file-level helpers (`Pill`, `Dot`, `StatTile`) live INSIDE the preview .tsx — they
are not exported PascalCase, so they don't become cells. Build → validate (92/92 render
clean) → DELTA push (11 files: both component dirs + `_preview/{Card,Tabs}.js` +
`_ds_sync.json` anchor — `_ds_bundle.*` unchanged, components/ui untouched). Render
screenshots in `ds-bundle/_screenshots/general__{Card,Tabs}.png`.

FUTURE: same recipe pattern fits the overlay containers (`Dialog`/`Sheet`/`Popover` — but
they're `cardMode:single` + fixed viewport, so each holds ONE rich cell, and the
open-state recipe `defaultOpen`+single must be preserved) and `Accordion` (sectioned bid
content).

## DropdownMenuLabel — now INCLUDED (wave 3)

Was excluded on the first upload (rendered blank standalone — Radix menu sub-part). Wave 3
authored it as the full open-menu composition (`cfg.overrides.DropdownMenuLabel`), so it
now renders in context and is uploaded. All 92 components are now in the project.

## Known render warns (check re-sync against these)

- `[FONT_REMOTE] Instrument Sans` — expected (remote font @import).
- 68 floor cards are reported as "render cleanly" (typographic floor, not failures).

## Re-sync risks

- The scratch-nm + Tailwind-compile steps are MANUAL and gitignored — a bare `resync.mjs`
  run without them fails (`PKG_DIR` missing / unstyled previews).
- The scratch-nm hard-codes the sibling `canonical` worktree path — fix if the repo layout
  changes.
- `dtsPropsFor` props are hand-written — re-verify against `components/ui/*.tsx` if those
  components change variants.
- Anchor `_ds_sync.json` now covers all 92 components, all uploaded. A clean re-sync that
  changes nothing should compute `upload.any === false`.
