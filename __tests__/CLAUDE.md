# Testing — directory context

Philosophy (read before writing or remediating tests):
`docs/reference/testing/test-philosophy.md` — six audit
criteria, three observed antipatterns, mock discipline.

- **Framework:** Vitest (`bun run test`); coverage `bun run test:coverage`; structure
  mirrors source. Integration suite: `bun run test:integration`
  (`__tests__/integration/**.integration.test.ts`, real Anthropic + Supabase).
- **Mock pattern:** shared `createMockSupabaseClient()` from
  `__tests__/helpers/mock-supabase.ts` — never hand-roll Supabase mocks.
- **Guard tests break on structural changes:** `mcp-fixture-sync.test.ts` runs on every
  test pass — update fixtures when adding MCP tools.
- **Antipattern regression guards (`__tests__/docs/`):**
  `test-classname-token-coupling.test.ts` fails if a component **behaviour** test couples
  to a semantic design-system state token (`text-quality-*`, `bg-freshness-*`, …) — pin
  the state→token mapping in that component's `*.contract.test.tsx` (the sanctioned
  coupling point) instead. `test-impl-shaped-titles.test.ts` is a downward-only RATCHET on
  impl-mechanics `it()`/`test()` titles (first word `passes`/`configures`/`wraps`/
  `forwards`/`sets`/`applies`/`uses`); never raise its baseline — rename the title to the
  user-observable behaviour. Don't weaken either guard to make it pass.
- **`vi.mock()` hoisting:** use `vi.hoisted()` for mock variables. Arrow functions in
  `mockImplementation()` cannot be used with `new` — use the `function` keyword.
- **Zod UUID validation is strict:** `z.string().uuid()` enforces RFC 4122 — use
  v4-compliant values in fixtures.
- **Date-sensitive tests need pinned time:** `vi.spyOn(Date, 'now')` with a fixed
  timestamp.
- **Radix Select in jsdom needs pointer shims:** call `installRadixPointerShims()` from
  `@/__tests__/helpers/radix-pointer-shims` in `beforeEach`.
- **E2E:** Playwright in `e2e/tests/` — worker-scoped fixtures, multi-role auth; config
  `playwright.config.ts`; run `bun run test:e2e`.
