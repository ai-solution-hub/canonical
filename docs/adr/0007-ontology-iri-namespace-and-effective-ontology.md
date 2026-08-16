# OKF ontology IRIs are minted under w3id.org/canonical; the effective ontology ships in the bundle

Crosswalk: DR-082, DR-027

## Context

OKF concepts, entities and relationships carry IRIs that get pinned into published citations,
so the namespace has to outlive any particular domain registration. Separately, a bundle has to
be self-describing and portable to consumers who hold no platform access.

## Decision

Ontology IRIs are minted under the permanent-identifier namespace
`https://w3id.org/canonical/ontology` — `{authority}/base#` for the base vocabulary and
`{authority}/client/<slug>#` for a per-client overlay. Each bundle ships the materialised
effective ontology (the client overlay) so it is self-describing; the base vocabulary's source
of truth lives in the platform repo, versioned with the linter that enforces it.

## Alternatives considered

- **A namespace under the operating company's own domain** — rejected: IRI permanence would be
  coupled to DNS tenure, and these IRIs are citation-pin class and effectively irreversible.
- **Base vocabularies held in the documentation site** — rejected: platform functionality must
  not couple to the documentation site, and the vocabularies version with the linter.
- **Shipping a pinned snapshot of the base vocabulary in every bundle** — retired: nothing
  consumed it, the shipped copy drifted against the writer, and asserting a closed vocabulary
  is false where the concept vocabulary is open.

## Consequences

- An IRI is an identifier, not a runtime-resolved URL. Registering the namespace prefix with
  the permanent-identifier service is an owner-side prerequisite before the first published
  client-bundle mint.
- A bundle self-describes the OKF-native way — through its concepts and per-directory indexes —
  rather than by shipping a schema registry alongside them.
- The base vocabulary is enforced platform-side and is not asserted to bundle consumers.
- Any rendered channel derived from ontology data is sourced from the overlay declaration; a
  channel that would resolve to nothing is retired rather than left vestigial.
