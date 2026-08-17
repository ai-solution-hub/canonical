# The anon role holds no function or table privilege; every policy names its roles

Crosswalk: DR-035, DR-091

## Context

The `anon` role is what the public Data API reaches the database as, and both Postgres and the
project baseline default toward granting it: Postgres compiles in a PUBLIC EXECUTE default on
every new function, and the squash baseline granted `anon` table privileges by default, leaving
70 public tables born readable over the public API. SECURITY DEFINER functions are reachable
transitively, and per-migration REVOKE discipline alone regressed within days of being adopted.

## Decision

The `anon` role holds no function EXECUTE and no table privilege on either `public` or `api`,
and every row-level policy names its roles explicitly (`TO authenticated, service_role`).

## Alternatives considered

- **`ALTER DEFAULT PRIVILEGES … REVOKE FROM PUBLIC` as the function-side mechanism** —
  rejected on measurement: it is a no-op against the compiled-in PUBLIC EXECUTE default, and is
  kept only as defence in depth.
- **Per-migration REVOKE discipline alone** — rejected: it demonstrably regressed.
- **Treating `anon` SELECT as harmless** — rejected: reads are exactly what the public Data API
  exposes, and the sharpest measured exposure was policies written with no `TO` clause, which
  therefore targeted PUBLIC with `USING (true)`.

## Consequences

- The function half is enforced by a born-locked `ddl_command_end` event trigger with a
  signature-exact exemption for `set_config`, so a new function is locked at creation rather
  than audited afterwards.
- The table half has **no** event trigger and no CI gate. It is authoring discipline — which is
  why this ruling has to stay written: a migration that re-adds a default GRANT, or a policy
  written without a `TO` clause, re-opens the surface silently.
- The api-view coverage check asserts only that `anon` holds no *write* on api views; anon
  SELECT is explicitly permitted by that invariant, so it does not cover this.
- Mechanism detail lives in `supabase/CLAUDE.md`.
