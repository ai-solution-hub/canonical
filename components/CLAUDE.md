# UI / Frontend — directory context

Design system: **Warm Meridian** — spec
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/design/warm-meridian-implementation-spec.md`
(§Semantic Tokens), philosophy + identity PDF alongside it. Quality checks:
`.claude/checks/`.

- **New components go in their domain subdir, never at components/ root.**
- **No raw Tailwind colours:** always semantic tokens; define new ones in
  `app/globals.css` per the spec.
- **React compiler memoisation:** destructure nested properties before using in
  `useCallback` deps (`const { fn } = data;` not `data.fn`).
- **Stable empty array/object defaults in hook returns:** inline `data?.foo ?? []`
  creates a new reference every render. Hoist a module-level `const EMPTY_X: T[] = [];`
  and wrap with `useMemo(() => data?.foo ?? EMPTY_X, [data?.foo])`.
- **Reset local state via `key` prop:** add `key={propId}` at the call site to force a
  clean remount — don't write a `useEffect` that calls `setState` on prop change.
- **Data fetching:** TanStack Query exclusively — keys in `lib/query/query-keys.ts`,
  fetchers in `lib/query/fetchers.ts`. No SWR, no raw fetch in hooks.
