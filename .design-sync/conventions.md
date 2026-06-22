## Canonical (Warm Meridian) — building with this library

Canonical's design system is **Warm Meridian**: warm stone neutrals with an amber signal
accent, in OKLCH. Components are React, styled with **Tailwind v4 utility classes backed
by semantic CSS-variable tokens**. Light and dark are automatic — the same tokens redefine
under `.dark`, so **never write `dark:` variants** and never use raw colours (no
`bg-orange-500`).

### Styling idiom — semantic utility classes

| Role                   | Utilities                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Surfaces               | `bg-background`, `bg-card`, `bg-muted`, `bg-popover`, `bg-accent`                    |
| Text                   | `text-foreground`, `text-muted-foreground`, `text-secondary-foreground`              |
| Brand / primary action | `bg-primary` + `text-primary-foreground` (amber)                                     |
| Secondary              | `bg-secondary` + `text-secondary-foreground`                                         |
| Status                 | `bg-success`, `bg-destructive` (further status families are defined in `styles.css`) |
| Lines / focus          | `border`, `border-input`, `ring-ring`                                                |

Spacing, radius, and type use the standard Tailwind scale (`gap-4`, `p-6`, `rounded-lg`,
`text-sm`, `font-medium`). The brand font (`Instrument Sans`) is the default sans — no
setup needed.

### Wrapping / setup

The primitives need **no global provider** — render them directly. Exceptions:

- `Tooltip` must be wrapped once in `TooltipProvider` near the app root.
- Ensure `styles.css` is loaded; it carries the tokens + every utility class.

### Component APIs with variants

- **Button** — `variant`: `default` | `secondary` | `outline` | `destructive` | `ghost` |
  `link`; `size`: `default` | `xs` | `sm` | `lg` | `icon` (+
  `icon-xs`/`icon-sm`/`icon-lg`). Put `lucide-react` icons as children.
- **Badge** — `variant`: `default` | `secondary` | `destructive` | `outline` | `ghost` |
  `link`.
- **Card** — compose `CardHeader` (with `CardTitle`, `CardDescription`, `CardAction`),
  `CardContent`, `CardFooter`.
- **Tabs** — `Tabs` › `TabsList` (`variant`: `default` | `line`) › `TabsTrigger`; with
  `TabsContent`.

Most other exports are Radix-based primitives (Dialog, DropdownMenu, Select, Sheet,
Popover, Accordion, RadioGroup, Switch, Tooltip) composed from their named sub-parts —
read each component's `.d.ts` and `.prompt.md` for its parts.

### Where the truth lives

- Tokens + the full utility set: `styles.css` (it `@import`s `_ds_bundle.css`).
- Per-component API + usage: each component's `.d.ts` and `.prompt.md`.

### Idiomatic snippet

```tsx
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from 'canonical';

<Card className="w-80">
  <CardHeader>
    <CardTitle>Bid coverage</CardTitle>
  </CardHeader>
  <CardContent className="flex items-center gap-2">
    <Badge variant="secondary">82%</Badge>
    <Button size="sm">Open</Button>
  </CardContent>
</Card>;
```
