# Supabase Patterns

**Purpose:** Enforce correct Supabase usage patterns across the Knowledge Hub codebase,
preventing common mistakes with auto-generated types, authentication, role-based access,
request validation, error handling, and migrations.

**Severity:** error

## Rules

1. **Never manually edit `supabase/types/database.types.ts`.** This file is auto-generated
   by the Supabase CLI. Any manual edits will be overwritten. If the schema changes,
   regenerate types with:
   `/opt/homebrew/bin/supabase gen types typescript --project-id <prod-project-ref> --schema public > supabase/types/database.types.ts`

2. **Always use `getAuthenticatedClient()` from `lib/auth.ts` for API route
   authentication.** This function returns both the authenticated `user` and a typed
   `supabase` client in a single operation. The pattern is:

   ```typescript
   const auth = await getAuthenticatedClient();
   if (!auth) return unauthorisedResponse();
   const { user, supabase } = auth;
   ```

   Never create a Supabase client directly in an API route and then separately call
   `supabase.auth.getUser()`. The `getAuthenticatedClient()` function handles both in one
   step.

3. **Use `getAuthorisedClient()` for routes requiring editor or admin role.** For routes
   that need write access, use the role-aware variant:

   ```typescript
   const auth = await getAuthorisedClient('editor');
   if (!auth) return unauthorisedResponse();
   const { user, supabase, role } = auth;
   ```

4. **Use `parseBody()` from `lib/validation` with Zod schemas for all request body
   parsing.** Every POST/PATCH/PUT route must validate its request body through
   `parseBody()` with a schema from `lib/validation/schemas.ts`. Never use
   `request.json()` without validation.

5. **Use `parseSearchParams()` from `lib/validation` for GET route query parameter
   validation** when the route accepts structured query parameters.

6. **Always use `safeErrorMessage()` from `lib/error.ts` in outer catch blocks.** The
   outer `try/catch` of every API route must use
   `safeErrorMessage(err, 'Descriptive fallback')` to prevent raw error objects from
   leaking to clients.

7. **Use `unauthorisedResponse()` from `lib/auth.ts` for 401 responses.** Do not manually
   construct 401 responses. The helper ensures consistent spelling ("Unauthorised") and
   response shape.

8. **Never use `apply_migration` MCP tool when Supabase CLI is available.** The CLI
   command is `/opt/homebrew/bin/supabase migration new <name>` followed by
   `/opt/homebrew/bin/supabase db push`. The `apply_migration` MCP tool creates
   remote-only migrations without local files.

9. **Always use `toJson()` from `lib/validation/jsonb.ts` when writing JSONB data to
   Supabase.** This helper handles serialisation correctly. Do not use `JSON.stringify()`
   for JSONB columns.

10. **Embedding vectors must be serialised with `JSON.stringify()` for RPC calls.** When
    passing embedding vectors to Supabase RPC functions (like `hybrid_search`), the vector
    must be `JSON.stringify(embedding)`, not a raw array.

11. **RLS requires a `user_roles` entry for write access.** New users cannot write until
    they have a `user_roles` row. First admin must be seeded via service_role key. Always
    account for this in new features.

12. **Never `INSERT INTO auth.users` directly via SQL — always use
    `auth.admin.createUser()` (or the equivalent CLI/dashboard).** Direct SQL inserts skip
    GoTrue's required field initialisation: the 8 token columns (`confirmation_token`,
    `recovery_token`, `email_change_token_new`, `email_change_token_current`,
    `email_change`, `phone_change`, `phone_change_token`, `reauthentication_token`)
    default to NULL but GoTrue's admin API scans them into Go strings and 500s on NULL —
    this 500's `auth.admin.listUsers()` for EVERY caller, not just the broken row. Direct
    inserts also skip the matching `auth.identities` row that every real user gets.

    **If a migration MUST insert into `auth.users`** (e.g. provisioning a deterministic
    service account UUID that other tables FK to), it MUST: (a) explicitly set all 8 token
    columns to `''`, (b) include a corresponding `INSERT INTO auth.identities` with a
    `provider_id, provider` `ON CONFLICT` guard, and (c) follow the canonical shape in
    `supabase/migrations/20260406180000_create_pipeline_service_account.sql`. There is a
    vitest guard at `__tests__/migrations/auth-users-insert-guard.test.ts` that fails CI
    if any migration violates this. The S156 incident
    (`knowledge-hub-archive (sibling checkout) audits/s156-auth-admin-sweep.md`) is the
    cautionary tale.

    **For E2E test users**, use `bun run seed:e2e-users` (which calls
    `auth.admin.createUser()` internally) — never raw SQL.

## Examples

### Violation

```typescript
// Bad: Manual auth check instead of getAuthenticatedClient()
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

// Bad: No request body validation
const body = await request.json();
const { query, limit } = body;  // Unvalidated!

// Bad: Raw error in response
} catch (err) {
  return NextResponse.json({ error: err.message }, { status: 500 });
}

// Bad: Manual 401 with wrong spelling
return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
```

### Correct

```typescript
// Good: Standard auth pattern
const auth = await getAuthenticatedClient();
if (!auth) return unauthorisedResponse();
const { user, supabase } = auth;

// Good: Role-aware auth for write routes
const auth = await getAuthorisedClient('editor');
if (!auth) return unauthorisedResponse();
const { user, supabase, role } = auth;

// Good: Validated request body
const raw = await request.json();
const parsed = parseBody(MySchema, raw);
if (!parsed.success) return parsed.response;
const { query, limit } = parsed.data;

// Good: Safe error message
} catch (err) {
  return NextResponse.json(
    { error: safeErrorMessage(err, 'Failed to process request') },
    { status: 500 },
  );
}

// Good: Standard 401 helper
return unauthorisedResponse();
```
