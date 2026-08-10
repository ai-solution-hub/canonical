"""IRI mint module — deterministic base/overlay IRI projection (ID-132
{132.43} bl-457, G-IRI-PROJECTION).

Pure, I/O-free. Given a term and a scope, mints an absolute IRI; given a
run's composed `EffectiveOntology` (`producer.validator.EffectiveOntology`,
OV-7/OV-8) and an optional client-id, projects EVERY ontology term (across
`entity_types`/`relationship_types` — ID-427 {427.5} dropped the
`concept_types` dimension with its base register) into a flat `@context`
term->IRI mapping for the reserved `context.jsonld` bundle artefact —
{132.44} serialises the `"@context"` key to disk via
`json.dumps(..., sort_keys=True)`; that is NOT this module's concern, and
this module performs zero I/O of its own.

Spec: IRI-PROJECTION.md §Projection mechanics + §Design decisions 1-4 +
invariants IRI-1/2/3/7/8 (this Subtask's slice; IRI-4/5/6/9/10/12 land in
`bundle_writer.py`/`flow_def.py` at {132.44}).

- **IRI-1 (deterministic mint).** `mint_iri(term, scope=...)` is a pure
  function of `(term, scope)` — identical inputs produce a byte-identical
  IRI on every call, with no clock/UUID/ordering nondeterminism.
- **IRI-2 (base/overlay namespace split).** Base terms mint under
  `{IRI_BASE_NAMESPACE}/base`; overlay terms under
  `{IRI_BASE_NAMESPACE}/client/{slug(client_id)}`. `project_context`
  classifies base-vs-overlay by importing `ALLOWED_ENTITY_TYPES`/
  `ALLOWED_RELATIONSHIP_TYPES` from `producer.validator` — the SAME
  closed-vocabulary registers the BI-13 gate lints against, so a term is
  never independently reclassified here.
- **IRI-3 (versionless / stable base IRIs).** `mint_iri` carries no
  version segment and never mutates an existing base IRI's meaning — an
  incompatible meaning change is a governance act producing a NEW IRI,
  out of this pure module's runtime scope.
- **IRI-7 (slug determinism + collision posture).** `slug()` is
  deterministic and idempotent on the existing snake_case base terms
  (`case_study` -> `case_study`, ...). A within-(scope,dimension) slug
  collision between two distinct source terms never raises — sorted-order
  first-wins, the loser recorded in `project_context`'s returned
  diagnostics and logged at WARNING.
- **IRI-8 (promotion alias affordance).** `mint_iri`/`project_context` do
  NOT populate a `sameAs`/alias this wave (no term is promoted
  overlay->base yet) — see `ALIAS_SHAPE_EXAMPLE` below, a documented hook
  only.

**DR-082 (namespace authority, RATIFIED S481).** `IRI_BASE_NAMESPACE`'s
concrete value — `https://w3id.org/canonical/ontology` — is owner-ratified
(bl-457 OQ-1 -> DR-082); see the constant's inline comment. A one-time w3id
GitHub PR to register `/canonical/` remains owner-side before the FIRST
published client-bundle mint (IRI-10); this module's determinism/collision/
split behaviour was already unaffected by whichever literal value would be
ratified, and stays unaffected now that one has been.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import Iterable

from scripts.cocoindex_pipeline.producer.validator import (
    ALLOWED_ENTITY_TYPES,
    ALLOWED_RELATIONSHIP_TYPES,
    EffectiveOntology,
)

logger = logging.getLogger(__name__)

# DR-082 (S481, owner-ratified 2026-07-16): namespace authority = w3id.org/canonical
# (bl-457 OQ-1 -> DR-082; a one-time w3id GitHub PR to register /canonical/ remains
# owner-side before the first published client-bundle mint, IRI-10). The VALUE below
# is UNCHANGED from the {132.43} placeholder — only this comment's status changes,
# unratified -> ratified.
IRI_BASE_NAMESPACE: str = "https://w3id.org/canonical/ontology"

# The EffectiveOntology dimensions, paired with the base-vocabulary
# register that classifies a term as base (member) vs overlay (non-member)
# for that dimension. Iterated in this FIXED order so `project_context`'s
# flat `@context` dict is built deterministically (IRI-1/IRI-12).
#
# **TWO dimensions since ID-427 {427.5}** (DR-141, TECH §2.10). The
# `concept_types` row went with `ALLOWED_CONCEPT_TYPES`: base-vs-overlay
# classification needs a base register to test membership against, and a
# concept `type` no longer has one — it is a shape-validated label, so
# there is nothing to classify and no term to mint. `context.jsonld` now
# carries entity and relationship terms only.
_DIMENSIONS: tuple[tuple[str, frozenset[str]], ...] = (
    ("entity_types", ALLOWED_ENTITY_TYPES),
    ("relationship_types", ALLOWED_RELATIONSHIP_TYPES),
)

# IRI-8: the alias-affordance shape a promoted (overlay->base) term COULD
# carry in a future wave — reserved, NOT populated this wave (no term is
# promoted overlay->base yet). A promotion wave would emit this shape for
# the promoted term instead of a bare IRI string:
#     {"@id": "<new base IRI>", "sameAs": "<superseded client IRI>"}
ALIAS_SHAPE_EXAMPLE: dict[str, str] = {"@id": "...", "sameAs": "..."}

# IRI-7 slug rule: replace RUNS of characters outside [a-z0-9_-] with a
# single '-', then collapse any repeated '-' left over from adjacent runs
# separated only by an already-valid '-' character.
_INVALID_RUN_RE = re.compile(r"[^a-z0-9_-]+")
_DASH_COLLAPSE_RE = re.compile(r"-{2,}")

# {132.44} rider A ({132.43} checker-nit): `project_context`'s returned
# `@context` dict carries these two RESERVED namespace-prefix keys
# (`"base"` always; `"client"` when a client-id is set) alongside every
# minted term entry. A term whose `slug()` collides with one of these
# reserved keys would otherwise silently `dict`-overwrite the namespace
# prefix itself (`context.update(_mint_bucket(...))` runs AFTER the prefix
# keys are seeded) — `_mint_bucket` below treats that as a collision
# (logged + `diagnostics.collisions`), never a silent overwrite. Currently
# unreachable via the ratified base vocabulary (no base term is named
# `base`/`client`); reachable only via an arbitrary client-authored overlay
# term.
_RESERVED_PREFIX_SLUGS: frozenset[str] = frozenset({"base", "client"})


def _base_namespace() -> str:
    """The base namespace — every ratified (non-overlay) term mints here."""
    return f"{IRI_BASE_NAMESPACE}/base"


def _client_namespace(client_id: str) -> str:
    """The client-overlay namespace for `client_id` (IRI-2). `client_id`
    itself is sluggified — an arbitrary runtime client identifier is folded
    to the same `[a-z0-9_-]` alphabet as any other minted term."""
    return f"{IRI_BASE_NAMESPACE}/client/{slug(client_id)}"


def namespace(scope: str | None) -> str:
    """Resolve a mint `scope` to its absolute namespace: `None` = the base
    scope (IRI-2); any string = the client-overlay scope for that
    client-id. `mint_iri` calls this so a given `(term, scope)` pair always
    resolves to the same namespace."""
    if scope is None:
        return _base_namespace()
    return _client_namespace(scope)


def slug(term: str) -> str:
    """IRI-7: deterministic slug — NFKD-normalise -> lowercase -> replace
    every run of characters outside `[a-z0-9_-]` with a single `-` ->
    collapse repeated `-` -> strip leading/trailing `-`.

    Identity on the existing snake_case base terms (`complies_with` ->
    `complies_with`, ... every one of the 12 entity / 10 relationship
    ratified types) since they already contain only `[a-z_]`. The counts
    read `5 concept / 12 entity / 10 relationship` until ID-427: {427.5}
    dropped the concept-type dimension with `ALLOWED_CONCEPT_TYPES`, and
    the worked example named here was `case_study` — itself a retired
    concept type, and a member of NEITHER surviving base register, so it
    is replaced by a term that is actually in one.
    Folds accents (NFKD decomposes a combining diacritic onto its
    own codepoint, which the invalid-run substitution then strips) and
    normalises arbitrary runtime overlay strings (`"Product Line"` ->
    `"product-line"`)."""
    normalised = unicodedata.normalize("NFKD", term).lower()
    normalised = _INVALID_RUN_RE.sub("-", normalised)
    normalised = _DASH_COLLAPSE_RE.sub("-", normalised)
    return normalised.strip("-")


def mint_iri(term: str, *, scope: str | None) -> str:
    """IRI-1: deterministic mint — `namespace(scope) + "#" + slug(term)`. A
    pure function of `(term, scope)`: identical inputs produce a
    byte-identical IRI on every call."""
    return f"{namespace(scope)}#{slug(term)}"


def _mint_bucket(
    terms: Iterable[str],
    *,
    scope: str | None,
    scope_label: str,
    dimension: str,
    collisions: list[dict[str, str]],
) -> dict[str, str]:
    """Mint IRIs for `terms` — a single (scope, dimension) bucket, already
    in sorted order — into a `{term: iri}` mapping. IRI-7 collision guard:
    when two distinct terms in this SAME bucket slug to the same fragment,
    the first (sorted) is kept and minted; the second is DROPPED from the
    returned mapping and appended to `collisions` (logged at WARNING) —
    never raises. A term whose slug equals a RESERVED prefix key
    (`_RESERVED_PREFIX_SLUGS` — `"base"`/`"client"`) is likewise dropped +
    recorded as a collision, rather than silently overwriting that
    reserved `@context` entry once `project_context` merges this bucket's
    mapping in (rider A, {132.43} checker-nit)."""
    minted: dict[str, str] = {}
    winners_by_slug: dict[str, str] = {}
    for term in terms:
        fragment = slug(term)
        if fragment in _RESERVED_PREFIX_SLUGS:
            collisions.append(
                {
                    "scope": scope_label,
                    "dimension": dimension,
                    "slug": fragment,
                    "kept": f"<reserved @context prefix key {fragment!r}>",
                    "dropped": term,
                }
            )
            logger.warning(
                "iri_projection: term %r in scope=%s dimension=%s slugs to "
                "the RESERVED @context prefix key %r — dropped rather than "
                "silently overwriting the reserved namespace-prefix entry",
                term,
                scope_label,
                dimension,
                fragment,
            )
            continue
        winner = winners_by_slug.get(fragment)
        if winner is not None:
            collisions.append(
                {
                    "scope": scope_label,
                    "dimension": dimension,
                    "slug": fragment,
                    "kept": winner,
                    "dropped": term,
                }
            )
            logger.warning(
                "iri_projection: slug collision in scope=%s dimension=%s — "
                "%r and %r both slug to %r; keeping %r (sorted first-wins, "
                "IRI-7)",
                scope_label,
                dimension,
                winner,
                term,
                fragment,
                winner,
            )
            continue
        winners_by_slug[fragment] = term
        minted[term] = mint_iri(term, scope=scope)
    return minted


def project_context(
    effective_ontology: EffectiveOntology, *, client_id: str | None
) -> dict[str, object]:
    """Project every term of `effective_ontology` (base union overlay
    across `entity_types`/`relationship_types`) into the `context.jsonld`
    `@context` term->IRI mapping. Performs no I/O — the `"@context"` key is
    what {132.44}'s `write_context_artefact` serialises to disk.

    Base-vs-overlay classification imports `ALLOWED_ENTITY_TYPES`/
    `ALLOWED_RELATIONSHIP_TYPES` from `producer.validator` — the SAME
    closed-vocabulary registers the BI-13 gate lints against. ID-427
    {427.5} dropped the `concept_types` dimension: concept `type` is a
    shape-validated label with no base register, so no concept-type term
    mints an IRI.

    `client_id=None` (IRI-6, no `OKF_CLIENT_ID` set at the {132.44} call
    site): the `"client"` prefix and every overlay-term entry are OMITTED
    from `"@context"` (base-only); each un-projected overlay term is
    recorded in the returned `"diagnostics"` and logged at WARNING. Never
    raises — a run with no client-id, or with a slug collision, still
    produces a valid `"@context"`.

    Returns `{"@context": {...}, "diagnostics": {"collisions": [...],
    "unprojected_overlay": [...]}}`. `"diagnostics"` is advisory only —
    it is not part of the on-disk `context.jsonld` shape."""
    context: dict[str, str] = {"base": f"{_base_namespace()}#"}
    if client_id is not None:
        context["client"] = f"{_client_namespace(client_id)}#"

    collisions: list[dict[str, str]] = []
    unprojected_overlay: list[dict[str, str]] = []

    for dimension, allowed in _DIMENSIONS:
        terms: frozenset[str] = getattr(effective_ontology, dimension)
        base_terms = sorted(terms & allowed)
        overlay_terms = sorted(terms - allowed)

        context.update(
            _mint_bucket(
                base_terms,
                scope=None,
                scope_label="base",
                dimension=dimension,
                collisions=collisions,
            )
        )

        if client_id is not None:
            context.update(
                _mint_bucket(
                    overlay_terms,
                    scope=client_id,
                    scope_label=f"client/{client_id}",
                    dimension=dimension,
                    collisions=collisions,
                )
            )
        elif overlay_terms:
            for term in overlay_terms:
                unprojected_overlay.append({"term": term, "dimension": dimension})
            logger.warning(
                "iri_projection: client_id is None — %d overlay term(s) in "
                "dimension=%s left un-projected (IRI-6): %s",
                len(overlay_terms),
                dimension,
                overlay_terms,
            )

    return {
        "@context": context,
        "diagnostics": {
            "collisions": collisions,
            "unprojected_overlay": unprojected_overlay,
        },
    }
