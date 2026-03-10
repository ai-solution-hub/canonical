# Design System Check — Warm Meridian

## Colour tokens

- [ ] No raw Tailwind colour classes (`text-green-600`, `bg-amber-50`, etc.)
      in component files — always use semantic tokens
- [ ] No `dark:` colour prefixes in components — semantic tokens handle
      light/dark automatically via CSS variables
- [ ] No HSL or RGB fallback values — all colours in OKLCH via CSS variables
- [ ] New status colours use the correct semantic token prefix:
      freshness-*, confidence-*, bid-*, governance-*, phase-*, template-*,
      quality-*, status-*
- [ ] Domain category colours use var(--domain-{name}-bg/text/surface) tokens

## Signal principle

- [ ] Amber (`--primary`) is reserved for actionable elements only: buttons,
      links, focus rings, active states. It never decorates or fills
- [ ] Status indicators use teal (success/fresh), sand (warning/aging),
      rose (error/stale/expired) — never amber for status

## Typography

- [ ] Font stack is Instrument Sans (`--font-sans`) — no other font families
      added without design review
- [ ] Hierarchy through weight and space, not proliferation of faces

## Accessibility

- [ ] Never colour alone for meaning — always icon + text + colour (WCAG 2.1 AA)
- [ ] Dyslexia mode still works (font override to Atkinson Hyperlegible)
- [ ] High contrast mode still works (overrides in a11y.css)
- [ ] All new colour combinations meet 4.5:1 contrast for normal text

## Token registration

- [ ] New CSS variables defined in both `:root` and `.dark` blocks in
      `app/globals.css`
- [ ] New tokens registered in `@theme inline` block for Tailwind utility
      access (e.g., `--color-freshness-fresh: var(--color-freshness-fresh)`)
