# Warm Meridian — design-system audit & Canonical rebrand notes

_Review-only pass. Grounded in `app/globals.css` (952 lines), `components/ui/*`,
`app/layout.tsx`, and the branding layer (`lib/client-config.ts`,
`lib/branding/clients/default.json`). No code changed._

---

## Verdict in one line

The **foundations are genuinely good** — OKLCH, a real two-layer intent, thorough dark
mode, above-average accessibility infrastructure — but the **semantic layer has sprawled
into ~150 hand-maintained colour literals with no shared ramp**, and **application-domain
concepts (bid/governance/entity/domain) are baked into the core token file**. Those two
things are the main drag on quality *and* the main friction for a rebrand. The brand-swap
mechanics themselves are clean and centralised.

---

## What's strong (keep / showcase)

- **OKLCH throughout**, perceptually-uniform, with a coherent warm story: stone neutrals
  at hue 48, amber signal at hue 55. Consistent and modern.
- **Build-time brand injection is excellent.** `--primary` / `--ring` are overridden from
  a Zod-validated JSON (`brandPrimaryColour`), with the foreground and dark variant
  *auto-derived* (`derivePrimaryForeground`, `deriveDarkVariant` in `lib/client-config.ts`).
  Changing the brand colour is a **one-value change** that ripples correctly. This is the
  best-engineered part of the system.
- **Primitives are clean shadcn.** `button.tsx` / `badge.tsx` consume only semantic tokens
  (`bg-primary`, `text-secondary-foreground`…), good variant/size APIs, `data-slot`
  hooks. Reskinning via tokens works as intended — no hardcoded colour in component code.
- **Accessibility infra is above average:** skip link, `prefers-reduced-motion`, print
  styles, `data-a11y-mode` variants (dyslexia / high-contrast / large-text), a11y CSS vars
  for letter/word/line-height/weight/font-scale, `lang="en-GB"`. Most design systems don't
  ship this. Keep it front-and-centre in the Canonical story.

---

## Findings & recommendations (highest leverage first)

### 1. Collapse ~150 status literals onto functional colour ramps  — *biggest win*

There is exactly **one** primitive ladder: `--stone-50…900`. Every *coloured* semantic
token hardcodes a raw OKLCH literal instead of referencing a primitive. The same "success
green" `oklch(0.55 0.15 160)` is independently re-typed across `--color-freshness-fresh`,
`--color-confidence-strong`, `--color-governance-approved`, `--color-bid-won`,
`--color-quality-good`, `--color-verified`, `--color-tag-core`,
`--color-template-confirmed`… and then **again for dark mode**. Multiply across green /
amber / red / blue / violet families and you get the ~150-literal, light-+-dark wall that
dominates the file.

**Cost today:** to reskin or tune one status colour you hand-edit ~8 places × 2 modes, by
eye, with nothing keeping them in sync.

**Fix:** add a functional ramp primitive layer — `--green-{...}`, `--amber-{...}`,
`--red-{...}`, `--blue-{...}`, `--violet-{...}` at a small set of L/C steps — and make every
status token *reference* a ramp step (`--color-bid-won: var(--green-600)`). Hundreds of
literals collapse to ~5 ramps; **dark mode becomes "swap 5 ramps," not "redefine 150
values."** This single change both raises quality and makes the whole rebrand a
config-level operation instead of a literal-hunt.

### 2. Separate core design tokens from application-domain tokens

The core file currently carries product taxonomy: `--color-bid-*` (8 statuses ×4
sub-tokens), `--color-governance-*`, `--domain-security/compliance/methodology/…`,
`--color-entity-*` (10 entity types), `--color-relevance-*`, `--color-template-*`,
`--color-phase-*`. These are **Knowledge-Hub / procurement application semantics**, not
design-system primitives.

**Fix:** keep the core token file to neutrals + brand + functional status
(success/warning/danger/info) + chart + radius/spacing/type. Move the domain tokens to a
feature stylesheet (`@import`ed). A reusable "Canonical design system" should not know what
a *bid* or an *entity type* is — and a rebrand shouldn't have to wade through them.

### 3. Normalise token naming

Two conventions coexist: the base shadcn tokens are bare (`--background`, `--primary`,
`--border`) while everything added later is prefixed `--color-*`. A rebrand is the natural
moment to pick one (recommend keeping bare semantic names, scoping ramps under a clear
prefix).

### 4. Typography is the least-developed axis — and the biggest identity opportunity

- One family: **Instrument Sans** (Google, loaded in `app/layout.tsx`). Primitives use only
  `font-medium` (500) and `font-semibold` (600); body is 400.
- No type-scale tokens beyond two ad-hoc fluid sizes (`--text-fluid-2xl/xl`). No heading
  font, no editorial scale, no weight/tracking tokens.

For a product literally named **Canonical** (authority, the definitive record), typography
is where identity is currently thinnest. A distinctive heading face (or a deliberate serif
for editorial/"canonical document" feel) plus a real type-scale token set would add more
brand character than any colour tweak. **Recommend treating type as a primary rebrand
lever, not an afterthought.**

### 5. Verify primary-on-foreground contrast (AA)

`--primary` is amber `oklch(0.65 0.16 55)` and `--primary-foreground` is near-white
`oklch(0.99 …)`. White text on a 0.65-lightness amber is the classic borderline case for
WCAG AA on small text (often lands ~3:1, under the 4.5:1 bar). Default buttons/badges use
exactly this pair. **Action:** measure it; if it fails, either darken primary for text
contexts or switch primary-foreground to a dark ink. (Easy to get right now that the
foreground is auto-derived.)

### 6. Minor

- **Elevation:** only one custom shadow token (`--shadow-review-bar`); everything else is
  Tailwind defaults. Fine, but there's no elevation scale if the rebrand wants a
  distinctive depth language.
- **Radius:** `--radius: 0.5rem` (soft) with sm/md/lg/xl derived; `rounded-md` dominates.
  Conventional and pleasant. A sharper radius would read more "editorial/authoritative" if
  that's the Canonical direction — strategic, not a defect.
- **Spacing:** 4pt-grid tokens 1–16, but sparse (no 5/7/9/10/11). Harmless; primitives mostly
  use Tailwind scale directly.

---

## Rebrand mechanics: Knowledge Hub → Canonical

The swap is **well-centralised** — most of it is one file:

1. **`lib/branding/clients/default.json`** — the single brand record. Today every field is
   literally "Knowledge Hub": `productName`, `productShortName`, `organisationName`,
   `tagline` ("Knowledge base platform for bid management"), `supportEmail`, `logoAlt`, plus
   `brandPrimaryColour: oklch(0.65 0.16 55)` (mirrors `--primary`) and `logoUrl/faviconSvgUrl`.
   Change these → product name, tagline, brand colour, and favicon all update.
2. **`lib/client-config.ts`** — `client_name: 'Knowledge Hub'` (and feature labels).
3. **~55 hardcoded "Knowledge Hub" strings** across `app/ components/ lib/`. Two clusters
   matter most because they're **user-facing output**: the AI skill prompts
   (`lib/ai/skills/*.md` — classification, governance) and the procurement **export**
   files (`lib/procurement/procurement-export-{xlsx,docx,types}.ts`). The rest are incidental.
4. **Logo asset** — current `logoUrl` is `/favicon.svg`, 32px square: a placeholder mark,
   not a wordmark. A real Canonical logo/wordmark is the one genuinely *new* asset needed.

So the *mechanical* rebrand is small. The *meaningful* rebrand is the design decisions below.

---

## Two brand directions to choose between

The current identity is **warm + approachable** (amber on warm stone). "Canonical" connotes
**authority, truth, the definitive source** — worth deciding whether the visual language
should reflect that.

- **A. Evolve the warmth.** Keep amber equity; refine it (fix the contrast, tighten the
  status ramps, develop typography). Lowest risk, keeps continuity. Good if Canonical should
  feel *human and inviting*.
- **B. Shift to authoritative.** Move the brand hue toward ink/indigo or deep teal, sharpen
  radius, introduce an editorial/serif heading face. Higher effort, stronger
  "system-of-record" gravitas. Good if Canonical should feel *definitive and serious*.

Because brand colour is a single derived value and typography is one `next/font` import, you
can **prototype either direction cheaply** — exactly the kind of exploration the Claude
Design sync (when you're ready) is built to make interactive.

---

## Suggested order of work

1. **Pick a direction (A/B)** — colour + type intent. Everything else follows.
2. **Refactor colour to functional ramps** (finding 1) — do this *before* reskinning; it's
   what makes reskinning a config change.
3. **Split core vs domain tokens** (finding 2).
4. **Develop the typography axis** (finding 4) — the highest-identity, lowest-touched lever.
5. **Execute the brand swap** (default.json + string sweep + new logo).
6. **Verify contrast & a11y** (finding 5) on the new palette.

When you want to see directions rendered live and iterate on real components, that's the
point to run `/design-sync` (UI primitives + tokens) and explore in Claude Design.
