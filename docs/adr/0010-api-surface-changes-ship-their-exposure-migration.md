# Every api-surface change ships its companion exposure migration in the same batch

Crosswalk: DR-032

## Context

Client code reaches the database through the `api` schema — generated views over base tables,
and thin wrappers over RPCs. A base-table `ADD COLUMN` leaves the view's fixed SELECT list
missing the new column, so the view keeps returning rows while omitting data; a new `public`
RPC is simply unreachable from the client until an `api` wrapper exists.

## Decision

Any migration that adds columns to a surfaced table, or creates a client-called RPC, ships its
companion view-regeneration or wrapper migration in the same push batch, sorted after it.

## Alternatives considered

- **Regenerate the api surface on a separate cadence** — rejected: it leaves a window in which
  the surface is silently wrong, and the omission class raises no error to notice.
- **Rely on the coverage invariant alone** — rejected: it catches missing view columns after
  the fact, which makes it a backstop rather than a control.

## Consequences

- RPC wrappers follow the `LANGUAGE sql SECURITY INVOKER` passthrough convention that the
  api-view generator emits.
- The same-batch rule is authoring discipline: the generator's `--check` mode exists but is
  wired into no workflow, and the coverage invariant fires only after the change has landed.
- The silent-failure class is the one to watch. A missing RPC wrapper fails loudly, but a view
  that works while omitting columns reads as healthy in every test that does not assert on the
  new column.
