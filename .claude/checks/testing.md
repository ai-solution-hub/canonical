# Testing

**Purpose:** Ensure test coverage grows with the codebase. New utility functions must have
tests, and test files must follow the established Vitest patterns.

**Severity:** warning

## Rules

1. **New utility functions in `lib/` should have corresponding tests in `__tests__/`.**
   When adding or modifying a function in `lib/*.ts` or `lib/**/*.ts`, add or update tests
   in `__tests__/`. Current test suite: 101 test files (~1916 tests) organised by type:
   - `__tests__/*.test.ts` — lib/utility/domain tests (31 files: schemas, freshness,
     validation, entity-dedup, MCP tools/formatters, bid logic, etc.)
   - `__tests__/api/` — API route handler tests (30 files)
   - `__tests__/components/` — React component tests (21 files)
   - `__tests__/hooks/` — React hook tests (13 files)
   - `__tests__/lib/` — deeper lib module tests (6 files: roles, error, highlight,
     browse-helpers, dashboard-helpers, reorient)
   - `__tests__/helpers/` — shared test utilities (mock-supabase.ts, mock-next.ts,
     mock-auth.ts, mock-contexts.ts, render-with-providers.tsx)

   If you add a new file `lib/foo.ts`, create `__tests__/foo.test.ts`.

2. **Test files must use the Vitest import pattern.** All test files import from `vitest`:

   ```typescript
   import { describe, it, expect } from 'vitest';
   // or with mocks:
   import { describe, it, expect, vi } from 'vitest';
   ```

   Do not use Jest globals (`test`, `jest.fn()`) — the project uses Vitest exclusively.
   Run tests with `bun run test` (NOT `bun test`).

   **`vi.mock()` hoisting:** In Vitest v4, `vi.mock()` factories are hoisted above `const`
   declarations. Variables referenced inside factories must use
   `vi.hoisted(() => { return { mock }; })`. Arrow functions in `mockImplementation()`
   cannot be used with `new` — use `function` keyword.

   **Context mocks for component tests:** Use shared factories from
   `__tests__/helpers/mock-contexts.ts`:

   ```typescript
   import {
     mockTaxonomyContext,
     mockReadMarksContext,
     mockClientFeaturesContext,
   } from '../helpers/mock-contexts';
   ```

   **E2E tests:** Playwright E2E tests live in `e2e/tests/` (4 spec files). Config:
   `playwright.config.ts`. Uses setup project pattern for auth. Run with
   `npx playwright test`.

3. **No `test.skip` or `test.todo` without an explanatory comment.** If a test is skipped
   or marked as todo, it must have a comment on the preceding line (or inline) explaining
   why.

4. **Test descriptions must be meaningful.** Use `describe` for the function/module name
   and `it`/`test` with a description starting with "should" that describes the expected
   behaviour:

   ```typescript
   describe('formatDate', () => {
     it('should return empty string for null input', () => { ... });
     it('should format ISO date as DD MMM YYYY', () => { ... });
   });
   ```

5. **Tests must not depend on external services.** Unit tests in `__tests__/` must not
   make real API calls to Supabase, OpenAI, Anthropic, or any external service. Use mocks
   (`vi.fn()`, `vi.mock()`) for external dependencies.

6. **Python tests follow the same principles.** Python tests live in `scripts/tests/` and
   use `pytest`. New pipeline functions in `scripts/cocoindex_pipeline/` should have
   corresponding tests.

## Examples

### Violation

```typescript
// Bad: New utility function with no tests
// lib/new-helper.ts
export function calculateScore(items: Item[]): number { ... }
// No corresponding __tests__/new-helper.test.ts

// Bad: Using Jest patterns
const mockFn = jest.fn();  // Should be vi.fn()

// Bad: Skipped test without explanation
it.skip('should handle edge case', () => { ... });
```

### Correct

```typescript
// Good: Test file for new utility
// __tests__/new-helper.test.ts
import { describe, it, expect } from 'vitest';
import { calculateScore } from '@/lib/new-helper';

describe('calculateScore', () => {
  it('should return 0 for empty array', () => {
    expect(calculateScore([])).toBe(0);
  });

  it('should calculate weighted score for items', () => {
    const items = [{ weight: 2, value: 5 }];
    expect(calculateScore(items)).toBe(10);
  });
});

// Good: Vitest mocks
import { vi } from 'vitest';
const mockFetch = vi.fn();

// Good: Skipped test with explanation
// Skip: Requires Supabase connection — integration test run separately
it.skip('should insert into content_items', () => { ... });
```
