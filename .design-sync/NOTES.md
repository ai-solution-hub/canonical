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
`cfg.dtsPropsFor` hand-writes accurate contracts — done for **Button, Badge** only.
FOLLOW-UP: add `dtsPropsFor` for the other variant-bearing primitives (Tabs/TabsList
`variant`, Badge done, Select, Switch, etc.) so the design agent codes against real APIs.

## Authored previews so far (8) — graded good

Button, Badge, Card, CardHeader, Checkbox, Progress, SheetHeader, SheetFooter. The other
83 ship the honest **floor card** ("preview not yet authored"). This is the standing
incremental-authoring backlog (re-sync carries authored work forward).

## DropdownMenuLabel — EXCLUDED from upload (the one component not shipped)

It renders blank standalone (Radix menu-context sub-part). Not pushed (its card would be
blank). The component IS still importable via the bundle for the agent. FOLLOW-UP: author
the **DropdownMenu family** (and other overlays — Dialog, Select, Sheet, Popover, Tooltip
OPEN states) as `cfg.overrides.<Name> = {cardMode:'single', viewport:'WxH'}` previews with
`defaultOpen`, then re-include.

## Known render warns (check re-sync against these)

- `[RENDER_BLANK] DropdownMenuLabel` — expected (excluded; see above).
- `thin: 1` in `.render-check.json` — DropdownMenuLabel.
- `[FONT_REMOTE] Instrument Sans` — expected (remote font @import).

## Re-sync risks

- The scratch-nm + Tailwind-compile steps are MANUAL and gitignored — a bare `resync.mjs`
  run without them fails (`PKG_DIR` missing / unstyled previews).
- The scratch-nm hard-codes the sibling `canonical` worktree path — fix if the repo layout
  changes.
- `dtsPropsFor` props are hand-written — re-verify against `components/ui/*.tsx` if those
  components change variants.
- Anchor `_ds_sync.json` lists 92 components but only 91 were uploaded (DropdownMenuLabel)
  — the next sync will see it as "to upload"; that's expected until its overlay preview is
  authored.
