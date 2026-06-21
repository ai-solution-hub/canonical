# UI / Frontend — directory context

Design system: **Warm Meridian** — spec
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/design/warm-meridian-implementation-spec.md`
(§Semantic Tokens), philosophy + identity PDF alongside it. Quality checks:
`.claude/checks/`.

- **New components go in their domain subdir, never at components/ root.**
- **No raw Tailwind colours:** always semantic tokens; define new ones in
  `app/globals.css` (core) or `app/styles/domain-tokens.css` (application status/domain)
  per the spec.
- **Token-naming convention (F3, ID-119):**
  - **shadcn semantic tokens are bare** — `--background`, `--foreground`, `--primary`,
    `--success`, `--destructive`, `--border`, … (never `--color-`-prefixed).
  - **Functional ramps are scoped `--<family>-<role>`** — `--green-solid`, `--red-tint`,
    `--amber-border`, … (the F1 primitive layer; tune a colour once, light + dark ripple).
  - **Application status / domain token _definitions_ are bare** — `--bid-won`,
    `--status-success`, `--freshness-fresh`, `--relevance-high`, … The redundant `--color-`
    prefix survives ONLY as the `@theme inline` **LHS** that names the generated utility
    class (`--color-bid-won: var(--bid-won)` → emits `bg-bid-won`/`text-bid-won`). Inline
    consumers reference the bare name: `bg-[var(--status-success)]`, not `var(--color-…)`.
  - **`--domain-*` content-classification tokens keep their name** (`--domain-security-bg`,
    …) — consumed via dynamic inline `var(--domain-${key}-bg|text|surface)`, so they were
    never `--color-`-prefixed and are untouched by F3.
  - Renaming a CSS custom property is a **literal sweep** (GitNexus does not index CSS
    vars): drop the def prefix, repoint the `@theme inline` RHS, and repoint every inline
    `var()` consumer. The full `bg-*`/`text-*` utility-class rename (Option B) is deferred
    to backlog **`bl-349`** (bundled with the rebrand visual pass).
  - **Full reference:** the three-tier token architecture (primitives → semantic/domain →
    consumption), dark-mode ramp-swap mechanics, how to add a status colour or categorical
    hue, and the config-driven product-name / brand-colour path are documented in the
    docs-site design section:
    `${KH_PRIVATE_DOCS_DIR}/src/content/docs/design/token-system.md`.
- **React compiler memoisation:** destructure nested properties before using in
  `useCallback` deps (`const { fn } = data;` not `data.fn`).
- **Stable empty array/object defaults in hook returns:** inline `data?.foo ?? []`
  creates a new reference every render. Hoist a module-level `const EMPTY_X: T[] = [];`
  and wrap with `useMemo(() => data?.foo ?? EMPTY_X, [data?.foo])`.
- **Reset local state via `key` prop:** add `key={propId}` at the call site to force a
  clean remount — don't write a `useEffect` that calls `setState` on prop change.
- **Data fetching:** TanStack Query exclusively — keys in `lib/query/query-keys.ts`,
  fetchers in `lib/query/fetchers.ts`. No SWR, no raw fetch in hooks.
