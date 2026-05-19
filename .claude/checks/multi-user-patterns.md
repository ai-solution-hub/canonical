# Multi-User Patterns

**Purpose:** Enforce multi-user and role-based access control patterns specific to
Knowledge Hub. Unlike IMS (single-user), Knowledge Hub is a multi-user system with
admin/editor/viewer roles. These rules prevent accidental single-user assumptions.

**Severity:** error

## Rules

1. **Never assume a single user.** [error] All data queries in API routes must scope to
   the authenticated user where appropriate (e.g. `read_marks` are per-user). Do not
   hardcode user IDs or assume there is only one user. The `user_id` must come from
   `auth.user.id`.

2. **Write operations require role checks.** [error] Any API route that creates, updates,
   or deletes content must verify the user has the appropriate role:
   - **Read (SELECT):** All authenticated users (viewer, editor, admin)
   - **Write (INSERT/UPDATE):** Editor or admin only — use `getAuthorisedClient('editor')`
   - **Admin operations (DELETE, user management, taxonomy config):** Admin only — use
     `getAuthorisedClient('admin')`

3. **Display names must use the `useDisplayNames` hook.** [warning] When displaying user
   information (who created or modified content), use the `hooks/use-display-names.ts`
   hook to resolve UUIDs to display names. Never show raw UUIDs in the UI.

4. **User-scoped data must use `user_id = auth.uid()` in queries.** [error] Tables like
   `read_marks` are user-scoped via RLS. When querying these tables in API routes, always
   include the user_id filter to match the RLS policy expectations.

5. **New tables must have RLS policies.** [error] Every new table added to the schema must
   include appropriate RLS policies matching the role-based model (viewer SELECT, editor
   INSERT/UPDATE, admin DELETE). No tables should have RLS disabled.

## Examples

### Violation

```typescript
// Bad: No role check on write operation
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient();
  if (!auth) return unauthorisedResponse();
  // Missing role check — any viewer could write!
  await auth.supabase.from('content_items').insert({ ... });
}

// Bad: Showing raw UUID
<p>Created by: {item.created_by}</p>

// Bad: No user_id scope on user-specific data
const { data } = await supabase.from('read_marks').select('*');
```

### Correct

```typescript
// Good: Role-checked write operation
export async function POST(request: NextRequest) {
  const auth = await getAuthorisedClient('editor');
  if (!auth) return unauthorisedResponse();
  await auth.supabase.from('content_items').insert({ ... });
}

// Good: Display name resolution
const { displayNames } = useDisplayNames([item.created_by]);
<p>Created by: {displayNames[item.created_by] ?? 'Unknown'}</p>

// Good: User-scoped query
const { data } = await supabase
  .from('read_marks')
  .select('*')
  .eq('user_id', user.id);
```
