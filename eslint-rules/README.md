# Knowledge Hub local ESLint rules

Custom rules enforcing the silent-failure prevention spec
(`docs/specs/silent-failure-prevention-spec.md`). The `no-unchecked-supabase-error`
rule flags any `await` on a Supabase query (`supabase.from(...)`, `.rpc(...)`
or its `sb` / `client` / `db` / `auth.supabase` aliases) where the response
`error` field is dropped — either by destructuring `{ data }` without `error`,
or by assigning the whole result to a variable that is never read as
`<name>.error`. The sanctioned alternative is `sb()` from `@/lib/supabase/safe`,
which throws on error, or `tryQuery()` which returns a discriminated
`Result<T>`. The rule ships pattern-based (no type information), report-only
(no autofix), at `error` level from day one.
