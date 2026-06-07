# Error Handling

**Purpose:** Enforce consistent error handling patterns across API routes and client code.
Prevents information leakage, ensures debuggability, and maintains a consistent error
response shape.

**Severity:** error (rules 1, 2, 3) / warning (rules 4, 5)

## Rules

1. **All API routes must use `safeErrorMessage()` in their outer catch block.** [error]
   Every `export async function GET/POST/PATCH/DELETE` in `app/api/` must have a
   `try/catch` at the top level, and the catch block must use
   `safeErrorMessage(err, 'Descriptive fallback')` from `lib/error.ts`. This function:
   - In development: returns `"fallback: actual error message"` for debugging
   - In production: returns only the fallback string, hiding internal details The pattern:

   ```typescript
   } catch (err) {
     return NextResponse.json(
       { error: safeErrorMessage(err, 'Failed to process request') },
       { status: 500 },
     );
   }
   ```

2. **No raw error objects exposed to clients.** [error] Never send `err.message`,
   `err.stack`, `error.details`, or the raw `error` object in an API response. Use
   `safeErrorMessage()` for the outer catch, and use generic error strings for known error
   cases within the route body:

   ```typescript
   // Good: Generic error for known failure
   if (rpcError) {
     console.error('Search RPC error:', rpcError);
     return NextResponse.json({ error: 'Search query failed' }, { status: 500 });
   }
   ```

3. **All async API route handlers must have try/catch.** [error] Every exported async
   function in `app/api/**/route.ts` must be wrapped in a try/catch. This catches
   unexpected errors (JSON parse failures, network issues, type errors) and returns a
   proper 500 response instead of crashing.

4. **No `console.log` in production API code — use `console.error` for genuine errors.**
   [warning] In `app/api/` routes:
   - `console.log()` is not appropriate — it pollutes logs in production
   - `console.error()` is correct for genuine error conditions before returning error
     responses
   - `console.warn()` is acceptable for non-critical warnings

5. **Error responses must include an `error` field.** [warning] All error JSON responses
   should follow the shape `{ error: string }` or `{ error: string, details?: ... }`. This
   allows the frontend to consistently access `response.error` for display. Do not use
   `{ message: string }` or `{ msg: string }`.

## Silent-failure prevention

For every `await supabase.` call in a route handler or `lib/**` helper, the reviewer must
be able to point to where the `error` is handled. One of the following MUST be true:

1. The call is wrapped in `sb()` from `@/lib/supabase/safe`. `sb()` throws a
   `SupabaseError` on any PostgREST error; the thrown error propagates to the route's
   outer catch (rule 1) or up to Next.js's default 500 handler.
2. The call uses `tryQuery()` from `@/lib/supabase/safe` and the returned `Result<T>` is
   either checked with `isOk()` before reading `.data`, or passed to a
   `WarningsCollector.addFromResult()` so the failure surfaces in the response envelope.
3. The call destructures `{ data, error }` and the next statement explicitly checks
   `if (error) { ... }`. A bare `throw error` or a
   `NextResponse.json({ error: error.message }, { status: 500 })` both count. This shape
   passes the `local/no-unchecked-supabase-error` ESLint rule.

For every `await supabase.` **mutation** (`update`, `insert`, `upsert`, `delete`), the
return value must not be discarded. The mutation's `error` field must be destructured or
checked via `sb()` / `tryQuery()`.

For **composite-response routes** (≥ 2 sub-queries where partial failure is valid), the
response must be either fail-fast (the first sub-query failure returns 5xx) or returned
via `warningsEnvelope()` from `@/lib/supabase/warnings`. The envelope adds a
`warnings: string[]` sibling field to the response object only when non-empty — matching
the canonical reference at `app/api/items/[id]/route.ts:419-423`. A route that silently
returns empty fields on partial failure is a bug.

For any `console.warn` or "best-effort" swallow in a route or helper, replace with
`logBestEffortWarn(category, message, { err })` from `@/lib/supabase/telemetry` so the
swallow is observable in Sentry. Category naming convention is `/^[a-z]+(\.[a-z]+)+$/`,
e.g. `items.owner.notify`.

Silent `.catch(() => ...)` handlers (zero-parameter arrow or function expression) are
rejected by the `local/no-silent-promise-catch` ESLint rule. If the swallow is genuinely
intentional, use `(_err) => ...` to make the intent explicit.

**Full architecture:**
`${KH_PRIVATE_DOCS_DIR}/src/content/docs/specs/silent-failure-prevention-spec.md`.
**ESLint rules:** `eslint-rules/no-unchecked-supabase-error.js`,
`eslint-rules/no-silent-promise-catch.js`.

## Examples

### Violation

```typescript
// Bad: Raw error exposed
} catch (err) {
  return NextResponse.json({ error: err.message }, { status: 500 });
}

// Bad: No try/catch
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient();
  if (!auth) return unauthorisedResponse();
  const body = await request.json();  // Could throw!
  // ... no catch
}

// Bad: console.log in API route
console.log('Processing item:', itemId);

// Bad: Inconsistent error shape
return NextResponse.json({ message: 'Not found' }, { status: 404 });
```

### Correct

```typescript
// Good: safeErrorMessage in outer catch
} catch (err) {
  return NextResponse.json(
    { error: safeErrorMessage(err, 'Failed to generate digest') },
    { status: 500 },
  );
}

// Good: Full try/catch wrapper
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    // ...
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to process request') },
      { status: 500 },
    );
  }
}

// Good: Consistent error shape
return NextResponse.json({ error: 'Item not found' }, { status: 404 });
```
