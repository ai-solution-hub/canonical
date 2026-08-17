# processing_queue consumers declare an explicit job-type scope at claim time

Crosswalk: DR-099

## Context

`processing_queue` runs more than one consumer with disjoint handler coverage. When consumers
claim without a type scope, whichever wins the claim race destroys the other's work: it takes a
job it has no handler for and permanently fails the row. Measured as 24 falsely failed rows on
staging over ten days, and the root cause of a fortnight of integration-lane redness.

## Decision

Every `processing_queue` consumer passes an explicit type scope to `claim_next_job`.
Special-purpose workers pass their include list; the general consumer passes the workers' types
as its exclude scope, so its permanent-failure default stays the queue's loud dead letter for
genuinely unhandled types. An empty include list claims nothing — it fails closed.

## Alternatives considered

- **Include lists on both consumers** — rejected: the general consumer's list would need
  hand-maintenance as job types are added, and a forgotten entry leaves rows invisibly pending
  forever instead of dead-lettering loudly.
- **Worker-side type checks without claim scoping** — rejected: the row is already claimed by
  the time the check runs, so failing it there is the defect, not the fix.
- **A separate queue per consumer** — disproportionate at two consumers; revisit only if the
  consumer count grows.

## Consequences

- A new consumer with an unscoped claim re-opens mutual job destruction and is a defect.
- A worker's include list is mirrored across the Python and TypeScript sides and pinned by a
  parity test, so the two cannot drift apart silently.
- The no-argument call stays valid at the function level (NULL means unscoped) for
  migration-window compatibility. The rule that consumers must not use it lives here,
  deliberately rather than as a hard function-level constraint.
