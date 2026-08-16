# canonical is public and is the citation base; bundle repos and the docs-site are private

Crosswalk: DR-086b, DR-087

## Context

Bundle concepts cite their evidence by URL, so repository visibility decides what a citation
can point at. Tool, API and schema concepts need a stable target that any consumer can fetch;
the platform's own working documentation and every bundle carry material that must not be
public.

## Decision

`canonical` is public and is the citation base — concepts cite git-pinned public blob URLs in
it directly. All bundle repositories, platform-owned and client-owned alike, and the private
documentation site are private. The documentation site is citable for authorised consumers via
the additive git-pinned anchor scheme, admitted only into the access-controlled system-baseline
lane and never into a public or client-owned bundle.

## Alternatives considered

- **Treat a private URL as never a citation** — rejected: provenance back to the originating
  page is needed for human curation and for producer re-runs, and access control is the
  safeguard rather than non-citability.
- **Make the documentation site public so it can be cited freely** — rejected: it carries
  client-specific and point-in-time material.

## Consequences

- Access control, not URL opacity, is the confidentiality control on the private citation lane.
- Anything crossing from a private surface into the public repo is authored fresh, with a
  token and secret scrub and owner review — never migrated wholesale.
- Public citation targets are pinned by git ref, so a citation stays resolvable as the repo
  moves.
- Because `canonical` is public, everything written into it — including these ADRs — is
  written for an outside reader.
