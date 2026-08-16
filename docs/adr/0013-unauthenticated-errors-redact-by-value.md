# Unauthenticated error surfaces redact by value, not by shape

Crosswalk: DR-107

## Context

An unauthenticated endpoint that returns an exception message serves whatever the exception
carries. Shape-based redaction — patterns for URL userinfo and key prefixes — passed straight
through a fail-closed configuration error whose message embedded a deployment-identifying
environment value, because that value matched no credential pattern. Each round of
pattern-widening then introduced a new gap: a length floor that waved short values through, a
word-boundary anchor that failed on values ending in punctuation, and an extraction path that
bypassed the floor entirely.

## Decision

An endpoint reachable without authentication that returns an exception message redacts **by
value**: it substitutes the live values of a named set of sensitive environment variables before
serving. Shape patterns are a backstop for credentials that never came from our own
environment, never the control. Identity is sensitive, not merely secret — a value that
deanonymises the deployment is redacted even though it is not a credential, and is exempt from
the length floor that applies to secrets, because real trading names are routinely two or three
characters.

## Alternatives considered

- **Extend the shape patterns to more credential formats** — rejected: it guesses what a
  library will print, and the leak that prompted this was not a credential format at all.
- **Serve only the exception type name** — genuinely strong, and retained as the fallback if
  by-value redaction proves leaky again; rejected here because the message text carries real
  diagnostic value (which gate, which table) that by-value redaction preserves.
- **Authenticate the endpoint** — rejected: it is a liveness probe pinned public by a
  compose-parity gate, and the reverse proxy needs it unauthenticated.

## Consequences

- A new sensitive environment variable must be added to the redaction set. A name omitted there
  is a value served in clear.
- Redaction is a backstop, not a licence. The value must not be in the message in the first
  place: raise sites log identifying values through the private logger, and the message says
  only that the variable is set.
- Non-secrets stay legible — container paths and browser-published keys are not redacted, since
  removing them is pure diagnostic loss and costs a whole crash class.
- Byte-exact matching does not catch a differently-cased or differently-spaced spelling, which
  is acceptable only because the raise sites are kept clean.
