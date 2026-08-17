# A memoized extraction is keyed by the LLM identity that produced it

Crosswalk: DR-150

## Context

Extraction is memoized on the function fingerprint and the input content. The same extractors
run against more than one answerer — different providers, different models — so a key that
omits the answerer lets one identity's cached output be served to another identity's run. That
failure is silent: the run reports success and returns someone else's answer.

## Decision

The effective LLM identity — resolved base URL (or the direct-provider marker) plus model name
— is an input of every memoized extraction function, so it participates in the memo key. A
model or provider switch always re-extracts.

## Alternatives considered

- **Manual version bump per model change** — rejected: it burns the whole corpus on every
  swap, depends on an operator remembering, and cannot repair cross-identity poisoning that
  has already landed in one database.
- **Sweep the memo store on each switch** — rejected: operational, unenforced, and it destroys
  valid entries for the identity being switched away from.

## Consequences

- This is cocoindex memoization configuration — the model identity is a memoized-function
  input — not bespoke machinery.
- Switching identities back and forth is correct and cheap after the first walk per identity.
- Any outer memo that short-circuits before reaching the keyed function must carry the identity
  too; otherwise an environment-only switch over unchanged bytes still serves stale output.
- Sibling caches keyed model-agnostically — entity pair resolution is the known one — come
  under the same rule when they are next touched.
