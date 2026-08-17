# Feed endpoints authenticate by workspace-scoped URL-borne token

Crosswalk: DR-134

## Context

Feed endpoints are polled by readers that cannot perform a cookie login, so session auth would
return 401 to every real consumer. These routes emit a shared-CDN `s-maxage` cache directive,
so the edge can serve a response without invoking the handler at all — and a credential in a
header is not part of the CDN cache key. Meanwhile the workspace identifier alone is already an
unrotatable bearer credential, visible in page URLs, browser history and referrer headers, and
the filtered feed discloses the evaluation criteria behind rejected items.

## Decision

Feed endpoints authenticate by a workspace-scoped token carried in the URL. A URL-borne secret
is part of the cache key, so a cached response cannot be served to a caller that did not
present it.

## Alternatives considered

- **Session or cookie auth** — rejected: feed readers cannot log in, so the feature becomes
  unusable by its only consumers. That does not make the endpoint public; this codebase already
  authenticates without cookies elsewhere.
- **Header bearer auth** — rejected here specifically because of the shared-CDN directive: a
  cached feed could be served to an unauthenticated caller, a bypass no handler-side code can
  catch.
- **Signed URLs with an expiry** — rejected: expiry is the whole security model and it fights
  the use case, since a reader polling for months needs a long-lived URL; it also offers no
  revocation.
- **Public plus rate limiting** — rejected on measurement: the limiter is in-memory and
  per-instance, every call site keys on a user id an unauthenticated route lacks, and the CDN
  absorbs the traffic it would police. It also does not address disclosure.

## Consequences

- Tokens are stored hashed alongside a label and created / revoked / last-used timestamps,
  issued display-once, and the feed UI gains an issue-and-revoke surface rather than building
  URLs client-side.
- Route placement confers no authentication by itself: the API namespace is exempt from the
  auth redirect, so every route there gates itself in its own handler.
- Whether mainstream feed readers and intranet embed widgets accept a long-lived credential in
  the URL path versus the query is settled by test before the carrier is fixed.
