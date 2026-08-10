"""Concept-frontmatter validator — BI-13 (ID-132 {132.7} G-VALIDATE),
upgraded to the OKF v0.2 emission contract (id-426, S546 F1-A/F2-B).

The gate every OKF concept write passes through before `declare_file` lands
it on disk (caller wired in `{132.10}`; this Subtask builds the gate + its
API). Per PRODUCT.md §C invariant 13 + TECH.md §"Concept-frontmatter
validator (BI-13)", as amended by the v0.2 wave:

- **Required keys (v0.2)** — `type`/`title`/`description`/`generated`/
  `tags` MUST be present; `generated` is the §5.2 `{ by, at }` mapping that
  REPLACES the retired v0.1 `timestamp` (removed, not shadowed — S546).
  `resource:` is deliberately NOT in the hard-required set — under v0.2 a
  DB-backed concept omits it entirely (F2-B); only a Pass-2 reference
  concept carries one (its real fetched web URL). `sources:` (§5.1) is the
  provenance list; the landed emitter treats it as optional at the SHAPE
  level (a concept's citation non-emptiness is BI-17's draft-time gate,
  `producer/enrich.py`), and `check_sources` validates every entry when
  present.
- **`type` is a shape-validated LABEL, not a membership** (ID-427
  {427.5}, DR-141). `type` MUST be a lowercase snake_case ASCII label of
  3–40 characters and at most 4 underscore-separated words, and must not
  be the reserved `q_a_pair` (BI-3). It is checked against **no
  vocabulary**: OKF §1 lists "defining a fixed taxonomy of concept types"
  under Non-goals, consumers MUST tolerate unknown types, and producers
  pick values that are descriptive and self-explanatory. The former
  closed five-type register (`ALLOWED_CONCEPT_TYPES`), its per-bundle-class
  variants (`_CLASS_CONCEPT_TYPES`) and the Source-side mirror
  (`sources/base.py:CONCEPT_TYPES`) are all DELETED — a producer that
  enumerates its own permitted types is the inversion DR-141 withdraws.
  See `check_type_shape`.
- **Resource scheme (v0.2, F2-B inversion)** — the `canonical://` grammar
  (per-row anchor `canonical://{source_documents,reference_items}/<uuid>`
  or the BI-8 `q_a_pairs?scope_tag=<tag>` query form) now belongs to
  `sources[].resource` ONLY (`check_sources`, which also accepts http(s)
  URLs and bundle `.md` paths — `frontmatter.is_valid_source_resource`).
  The top-level `resource:`, when present, must NOT be a `canonical://`
  pointer (`check_resource_scheme`, inverted from its v0.1 reading).
- **BI-10 assertion** — no Canonical uuid/`canonical://` uri may appear in
  ANY frontmatter field other than `sources[].resource`, nor anywhere in
  the concept body OUTSIDE a legacy `# Citations` section (v0.2 bodies
  carry none — footnote definitions never repeat a record pointer). Reuses
  `producer.resource_uri.contains_record_pointer` — the same shared guard
  `{132.6}`'s emitter uses — so the two modules cannot silently diverge on
  what counts as a "stray pointer".
- **Closed 12-entity/10-relation ontology (semantic lint)** — `ALLOWED_
  ENTITY_TYPES`/`ALLOWED_RELATIONSHIP_TYPES` mirror the ratified closed
  vocabulary already live in `scripts/cocoindex_pipeline/extraction.py`
  (`EntityMentionExtraction.entity_type` / `RelationshipExtraction.
  relationship` `Literal`s), itself parity-guarded against
  `lib/validation/schemas.ts:VALID_ENTITY_TYPES` and the TS
  `ExtractedRelationship` union (`lib/ai/classify.ts`). This is the SAME
  register TECH.md §"Concept-frontmatter validator" says gates both ID-131
  extraction writes AND ID-132 concept writes — NOT an invented placeholder
  value set. It is NOT imported directly from `extraction.py`, which
  eagerly imports `cocoindex` at module scope (collection-safety —
  `_coco_api.py` insulation discipline this module must not break).
  ID-133 ("Task D") is expected to promote this into a first-class
  `allowed_types`/`allowed_relations` register with a Python-consumable
  export (no such export exists in-repo yet, per `{132.7}` brief); when it
  lands, swap the two constants below for a load from that export — no
  call-site contract change (both `check_concept`/`lint_entity_relation_
  mentions` keep their signatures). No concept body-section format is
  spec'd yet for entity/relationship mentions (ID-132 TECH.md only spec's
  `# Citations`), so `lint_entity_relation_mentions` is deliberately
  format-agnostic: it lints whatever structured `{"entity_type": ...}` /
  `{"relationship": ...}` mention dicts a caller supplies (the natural
  shape once `{132.8}`/`{132.9}` start passing extracted mentions to this
  gate), and is a no-op when none are supplied.

**Augmentation-guard DETECTION half (`detect_citation_shrink`, S451 rider
fold-in 2, BI-17/BI-22/DR-016).** The reference agent's `write_concept_doc`
(`bundle_tools.py:110-155`) refuses a Pass-2 write that shrinks a doc's
record-grounded provenance — "augment, not replace". KH's
`declare_file` write path has no equivalent yet. This module owns the
DETECTION half only: given a concept's PRIOR committed state and a NEW
draft, `detect_citation_shrink` returns the provenance targets the
new draft DROPS relative to the prior state (empty = no shrink),
harvesting BOTH the legacy v0.1 `# Citations` trailer and the v0.2
`sources:` frontmatter (§5.1) on each side, so the v0.1→v0.2 migration
itself is never a false shrink. It does
NOT itself refuse a write — `{132.9}` (Pass-2 write gate) and `{132.12}`
(git-sync 3-way reconcile) are the two ENFORCEMENT call sites, and both
must call this SAME function rather than re-implementing divergent
shrink-detection logic (the brief's explicit "single shared implementation"
requirement).

**Not fail-fast.** `check_concept`/`lint_entity_relation_mentions`/
`detect_citation_shrink` return a list of violations (empty = valid) rather
than raising on the first one — `validate_concept` wraps `check_concept`
and raises `ConceptValidationError` (carrying the full list) only at the
gate boundary. Aggregating violations lets a caller (the Pass-1/Pass-2
agent loop) surface every problem in one soft-error `tool_result` turn for
model self-correction, mirroring the reference's `write_concept_doc`
validation-failure posture (TECH-ADDENDUM-reference-agents.md retro-check,
`agent_loop.py:188-229`).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from scripts.cocoindex_pipeline.producer.frontmatter import (
    ConceptFrontmatter,
    ConceptSource,
    is_valid_concept_resource_uri,
    is_valid_source_resource,
)
from scripts.cocoindex_pipeline.producer.resource_uri import (
    citation_target,
    contains_record_pointer,
    is_canonical_resource_uri,
    parse_citation_entry,
)

# ──────────────────────────────────────────
# ID-427 {427.5} / DR-141 — the `type` SHAPE rule (TECH §2.8). There is no
# permitted-value register here and no `ALLOWED_CONCEPT_TYPES` any more:
# `type` is a label the producer picks, and the only thing the gate asserts
# is that the label is well-formed enough to be self-explanatory and to
# survive projection unchanged.
#
# Why this shape:
#   * `iri_projection.slug()` is IDENTITY on it, so no term is silently
#     rewritten downstream;
#   * every type the platform emits today (`topic`, `product`, `company`,
#     `certification`, `case_study`, `schema`, `tool`, `api`, `navigation`,
#     `playbook`) already matches — the rule ratifies existing output rather
#     than forcing a migration;
#   * `api` is 3 characters, which sets the floor and excludes the
#     uninformative 1–2 character token;
#   * the word cap keeps a type a LABEL rather than a sentence, which is
#     what "descriptive and self-explanatory" buys.
#
# Deliberately NOT checked: singular-vs-plural (not objectively decidable,
# and it would reject nothing a human would call wrong); collision with a
# `content_type` value (DR-050 forbids MERGING the two vocabularies, not
# string coincidence — checking it would be the overreach DR-050 warns
# against).
# ──────────────────────────────────────────

_TYPE_SHAPE_RE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
_TYPE_MIN_LEN, _TYPE_MAX_LEN, _TYPE_MAX_WORDS = 3, 40, 4

# BI-3, unconditional and permanent: a Q&A pair is never a concept. This is
# a RESERVED NAME, not a permitted-value register — it says what `type` may
# never be, never what it must be.
_RESERVED_TYPES = frozenset({"q_a_pair"})

# ──────────────────────────────────────────
# BI-4 facet TAGS (S443 Amendment / DR-029). Facets are carried in the OPEN
# `tags:` list (BI-12), NEVER as enumerated `type:` values — so this registry
# is the RECOGNISED facet vocabulary, not a rejection allowlist. `check_
# concept` does not reject a tag for being absent here (a concept may still
# carry arbitrary short domain tags); the registry names the facets the
# producer treats as first-class, for downstream consumers ({132.21}) and to
# keep the enumerated type set and the facet vocabulary from silently
# diverging. **The second of those two stated requirements died with the
# enumerated type set in {427.5}** — there is nothing left for the facet
# vocabulary to diverge FROM. This whole block retires in {427.6}, which
# resolves the three bends as types.
#
# - `metric`/`dataset`/`playbook` — the BI-4 tag-carried facets already
#   ratified (PRODUCT.md §BI-4 "genuine discretion" — a metric is a citeable
#   number, a playbook a "how we do X" narrative, a dataset a structured
#   reference).
# - `reference` — the facet `producer/web_pass.py` tags onto the
#   `references/<slug>.md` concepts it mints (`_REFERENCE_CONCEPT_TAG`); a
#   reference concept is a `topic` + this tag, never a sixth type.
# - `policy`/`capability` — the two NEW facets S443/DR-029 admits for
#   bid-outcome re-entry: a policy IS a citeable answer-cluster, a capability
#   a "we can do X" answer-cluster — both `topic`-concept facets, no new type,
#   no new G-SOURCE join.
#
# `methodology` (a retired won-bid content_type) is deliberately NOT its own
# facet: S443 folds it onto the existing `playbook` facet — see
# `FACET_TAG_ALIASES` / `canonical_facet_tag`.
# ──────────────────────────────────────────

RECOGNISED_FACET_TAGS = frozenset(
    {"metric", "dataset", "playbook", "reference", "policy", "capability"}
)

# S443 / DR-029: retired won-bid content_types that re-enter as an ALIAS onto
# an existing recognised facet rather than as a new tag. `methodology` ≡ the
# `playbook` facet (the same "how we do X" narrative shape BI-4 already names
# for the Secure Development Lifecycle / incident procedures) — so a
# `methodology`-tagged concept is treated as the `playbook` facet, and no
# separate `methodology` tag is ever registered.
FACET_TAG_ALIASES = {"methodology": "playbook"}


def canonical_facet_tag(tag: str) -> str:
    """Fold a facet-tag alias onto its canonical facet (S443/DR-029:
    `methodology` → `playbook`). A tag that is not an alias — whether a
    recognised facet or an arbitrary open domain tag (BI-12) — passes through
    unchanged."""
    return FACET_TAG_ALIASES.get(tag, tag)


def normalise_facet_tags(tags: "Iterable[str]") -> "tuple[str, ...]":
    """Apply `canonical_facet_tag` across `tags`, de-duplicating while
    preserving first-seen order. Folding `methodology` onto `playbook`
    collapses it onto an existing `playbook` entry rather than emitting a
    duplicate — the shared normalisation downstream writers ({132.21}) call so
    a bid-outcome `methodology` facet lands on disk as the `playbook` facet,
    never both."""
    return tuple(dict.fromkeys(canonical_facet_tag(tag) for tag in tags))


# ──────────────────────────────────────────
# BI-13 semantic lint: the closed 12-entity/10-relation ontology. Mirrors
# `EntityMentionExtraction.entity_type` / `RelationshipExtraction.
# relationship` Literals — `scripts/cocoindex_pipeline/extraction.py:378-391
# /423-434` — itself parity-guarded against `lib/validation/schemas.ts:
# VALID_ENTITY_TYPES` and the TS `ExtractedRelationship` union
# (`lib/ai/classify.ts:684-694`). See module docstring for the ID-133
# swap-in note.
# ──────────────────────────────────────────

ALLOWED_ENTITY_TYPES = frozenset(
    {
        "organisation",
        "certification",
        "regulation",
        "framework",
        "capability",
        "person",
        "technology",
        "project",
        "sector",
        "product",
        "standard",
        "methodology",
    }
)

ALLOWED_RELATIONSHIP_TYPES = frozenset(
    {
        "holds",
        "complies_with",
        "delivers_to",
        "uses",
        "demonstrated_by",
        "requires",
        "part_of",
        "supersedes",
        "references",
        "evidences",
    }
)

# ──────────────────────────────────────────
# OV-7/OV-8 (ID-132 {132.34} G-OVERLAY-CV, DR-054): the run's EFFECTIVE
# ontology — base ∪ client-overlay per dimension. Threaded through
# `check_concept`/`validate_concept` -> `lint_entity_relation_mentions` so a
# run that composed a client overlay (`bundle_writer.read_client_overlay`)
# lints against base+overlay, not the bare base frozensets above.
# `effective_ontology=None` (the default at EVERY pre-overlay call site) is
# exactly `base_only()` — zero behaviour change for a bundle with no overlay.
#
# **TWO dimensions, not three** (ID-427 {427.5}, DR-141). `concept_types`
# is gone: entity and relationship types are genuinely closed platform
# controlled vocabularies (they mirror `extraction.py`'s Pydantic
# `Literal`s, which the extractor really does enforce), whereas concept
# `type` is an open label validated by SHAPE (`check_type_shape`). A
# dimension that gates nothing has no business being composed.
# `_CLASS_CONCEPT_TYPES`/`base_for_class` deleted with it — the owner's S546
# uniformity ruling: bundle classes are conformant and uniform, so
# `system_baseline` is no longer gated against its own five-type set either.
# ──────────────────────────────────────────


@dataclass(frozen=True)
class EffectiveOntology:
    """OV-7: the deterministic sorted-union effective ontology for one
    producer run. Each field is `base ∪ overlay` for that dimension — a
    de-duplicated frozenset; a caller needing a stable rendering order
    calls `sorted(...)` on it (mirrors the base snapshot's own
    `sorted(...)` convention)."""

    entity_types: "frozenset[str]"
    relationship_types: "frozenset[str]"

    @classmethod
    def base_only(cls) -> "EffectiveOntology":
        """The default effective ontology when no overlay is composed —
        gating against this is identical to gating against the bare base
        frozensets directly. Identical for EVERY bundle class since {427.5}
        withdrew the per-class concept-type scoping (DR-141 + the S546
        uniformity ruling); there is no `base_for_class` any more, and no
        class fails loud for want of a ratified type set."""
        return cls(
            entity_types=ALLOWED_ENTITY_TYPES,
            relationship_types=ALLOWED_RELATIONSHIP_TYPES,
        )

    @classmethod
    def compose(cls, overlay: "Mapping[str, object] | None") -> "EffectiveOntology":
        """OV-4/OV-7: base ∪ overlay per dimension. `overlay` is the OV-6
        provenance-wrapped mapping `bundle_writer.read_client_overlay`
        returns (or any equivalent `{dimension: [terms, ...]}` mapping,
        e.g. the raw dict an explicit `client_ontology_overlay` kwarg
        supplies) — any dimension key it omits contributes no extension for
        that dimension. `overlay=None` (OV-4: no overlay file present) is
        exactly `base_only()`. Restating a base term is an idempotent union
        no-op (OV-3).

        An overlay's `concept_types` key stays SCHEMA-VALID
        (`bundle_writer._OVERLAY_DIMENSIONS` keeps all three keys, and the
        artefact still echoes the client's declared terms) but composes
        nothing and gates nothing — under DR-141 a concept type needs no
        permission to be emitted, so there is no set for it to widen."""
        if overlay is None:
            return cls.base_only()
        return cls(
            entity_types=frozenset(
                ALLOWED_ENTITY_TYPES | set(overlay.get("entity_types") or ())
            ),
            relationship_types=frozenset(
                ALLOWED_RELATIONSHIP_TYPES
                | set(overlay.get("relationship_types") or ())
            ),
        )


# BI-12 (v0.2): hard-required frontmatter keys. `resource`/`sources` are
# intentionally excluded — see module docstring. `generated` (§5.2) is the
# `{ by, at }` mapping that replaced the retired v0.1 `timestamp`.
_REQUIRED_STRING_KEYS = ("type", "title", "description")
_REQUIRED_KEYS = _REQUIRED_STRING_KEYS + ("generated", "tags")

# A19 (bl-477): the ratified confidence vocabulary — duplicated (not
# imported) from `producer/frontmatter.py`'s own `_CONFIDENCE_VALUES` by
# design (defence in depth: the producer asserts membership at draft time,
# this gate re-asserts it at validate time — the two must be changed
# together, never silently diverge).
_CONFIDENCE_VALUES = frozenset({"strong", "partial", "no-content", "needs-SME"})

# BI-9/BI-10: the only body section a Canonical uuid may appear in.
_CITATIONS_HEADING = "Citations"
_TOP_HEADING_RE = re.compile(r"^#[ \t]+\S", re.MULTILINE)


class ConceptValidationError(ValueError):
    """Raised by `validate_concept` when one or more BI-13 checks fail.

    Carries the FULL list of violations (`.errors`) — not fail-fast — so a
    caller can surface every problem in one soft-error `tool_result` turn.
    """

    def __init__(self, errors: Sequence[str]) -> None:
        self.errors = list(errors)
        super().__init__("; ".join(self.errors))


def _as_mapping(frontmatter: "Mapping[str, object] | ConceptFrontmatter") -> "Mapping[str, object]":
    """Normalise a `ConceptFrontmatter` dataclass instance (the shape
    `{132.6}`'s `build_concept_frontmatter` returns) into a plain mapping so
    every check below can use uniform `Mapping` access/membership
    semantics."""
    if isinstance(frontmatter, ConceptFrontmatter):
        return {
            "type": frontmatter.type,
            "title": frontmatter.title,
            "description": frontmatter.description,
            "generated": {
                "by": frontmatter.generated_by,
                "at": frontmatter.generated_at,
            },
            "tags": list(frontmatter.tags),
            "resource": frontmatter.resource,
            # bl-456/bl-477 (FRONTMATTER-WAVE.md): load-bearing — omitting
            # these would silently drop them from every downstream check
            # (BI-10 stray-pointer scan, A19 confidence membership).
            "purpose": frontmatter.purpose,
            "task": frontmatter.task,
            "audience": frontmatter.audience,
            "confidence": frontmatter.confidence,
            "sources": [
                {"id": s.id, "resource": s.resource, "title": s.title}
                for s in frontmatter.sources
            ],
        }
    return frontmatter


def check_required_keys(frontmatter: "Mapping[str, object]") -> "list[str]":
    """BI-12 (v0.2): `type`/`title`/`description`/`generated`/`tags` MUST
    be present keys; the three string fields must additionally be
    non-empty, and `generated` must be the §5.2 `{ by, at }` mapping of
    non-empty strings. `resource:`/`sources:` are NOT checked here — see
    module docstring."""
    errors: "list[str]" = []
    for key in _REQUIRED_KEYS:
        if key not in frontmatter:
            errors.append(f"missing required frontmatter key: {key!r} (BI-12)")
    for key in _REQUIRED_STRING_KEYS:
        if key in frontmatter:
            value = frontmatter[key]
            if not isinstance(value, str) or not value.strip():
                errors.append(
                    f"required frontmatter key {key!r} must be a non-empty "
                    f"string (BI-12); got {value!r}"
                )
    if "generated" in frontmatter:
        generated = frontmatter["generated"]
        by = generated.get("by") if isinstance(generated, Mapping) else None
        at = generated.get("at") if isinstance(generated, Mapping) else None
        if (
            not isinstance(generated, Mapping)
            or not isinstance(by, str)
            or not by.strip()
            or not isinstance(at, str)
            or not at.strip()
        ):
            errors.append(
                "frontmatter key 'generated' must be a { by, at } mapping "
                f"of non-empty strings (§5.2); got {generated!r}"
            )
    return errors


def check_type_shape(type_value: object) -> "list[str]":
    """ID-427 {427.5} / DR-141 (TECH §2.8): `type` is a LABEL, validated by
    SHAPE. It is valid iff it is a `str`; it is lowercase ASCII snake_case
    with a leading letter; its length is 3–40; it has at most 4
    underscore-separated words; and it is not a reserved name (`q_a_pair`,
    BI-3 — unconditional).

    **No permitted set exists, and no error message here may name one.**
    The name of this function is load-bearing: an identifier that says
    "membership" *is* the inversion DR-141 withdrew. Every message below
    says what is wrong with the LABEL — never what the label should have
    been chosen from.

    Takes no `effective_ontology`: there is no set to compose against.
    `check_concept`/`validate_concept` still thread one through for
    `lint_entity_relation_mentions`, whose closed 12-entity/10-relation
    vocabulary is unchanged."""
    if not isinstance(type_value, str):
        return [f"type must be a string; got {type_value!r}"]
    if not type_value:
        return ["type must not be empty"]
    if type_value in _RESERVED_TYPES:
        return [
            f"type {type_value!r} is reserved and may never be a concept "
            "type (BI-3: a Q&A pair is never a concept)"
        ]
    errors: "list[str]" = []
    if not _TYPE_SHAPE_RE.fullmatch(type_value):
        errors.append(
            f"type {type_value!r} must be lowercase ASCII snake_case "
            "starting with a letter (a-z, 0-9 and single underscores only) "
            "— it is a label, so it must survive IRI projection unchanged"
        )
    if not _TYPE_MIN_LEN <= len(type_value) <= _TYPE_MAX_LEN:
        errors.append(
            f"type {type_value!r} must be {_TYPE_MIN_LEN}-{_TYPE_MAX_LEN} "
            f"characters long; got {len(type_value)}"
        )
    words = type_value.split("_")
    if len(words) > _TYPE_MAX_WORDS:
        errors.append(
            f"type {type_value!r} must be at most {_TYPE_MAX_WORDS} "
            f"underscore-separated words; got {len(words)} — a type is a "
            "label, not a sentence"
        )
    return errors


def check_resource_scheme(resource: object) -> "list[str]":
    """v0.2 (S546 F2-B, inverted from the v0.1 reading): the top-level
    `resource:`, when present, must NOT be a `canonical://` pointer — a
    record anchor belongs in `sources[]` (`check_sources`); only a Pass-2
    reference concept's real fetched web URL is a legitimate top-level
    `resource:`. Absence is not an error here (a DB-backed concept omits
    it entirely) — see `check_required_keys` docstring."""
    if resource is None:
        return []
    if not isinstance(resource, str) or not resource.strip():
        return [f"resource, when present, must be a non-empty string; got {resource!r}"]
    if is_canonical_resource_uri(resource):
        return [
            f"top-level resource {resource!r} must not be a canonical:// "
            "pointer under OKF v0.2 (S546 F2-B) — record anchors belong in "
            "sources[]"
        ]
    return []


def check_sources(value: object) -> "list[str]":
    """§5.1 (v0.2): `sources`, when present, must be a list of
    `{ id, resource, title? }` entries — `id` a non-empty, unique,
    pointer-free string; `resource` in the accepted grammar
    (`frontmatter.is_valid_source_resource`: a canonical:// record anchor,
    an http(s) URL, or a bundle `.md` path); `title` optional, non-empty,
    pointer-free. Additional §5.1 credibility-signal keys (`author`,
    `usage_count`, `last_modified`) are tolerated, per the spec's
    unknown-key posture. Absence is not an error at this shape gate —
    citation non-emptiness is BI-17's draft-time contract
    (`producer/enrich.py`)."""
    if value is None:
        return []
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        return [
            f"sources must be a list of {{ id, resource, title? }} entries "
            f"(§5.1); got {value!r}"
        ]
    errors: "list[str]" = []
    seen_ids: "set[str]" = set()
    for entry in value:
        if isinstance(entry, ConceptSource):
            entry = {"id": entry.id, "resource": entry.resource, "title": entry.title}
        if not isinstance(entry, Mapping):
            errors.append(
                f"sources entries must be {{ id, resource, title? }} "
                f"mappings (§5.1); got {entry!r}"
            )
            continue
        entry_id = entry.get("id")
        if not isinstance(entry_id, str) or not entry_id.strip():
            errors.append(f"sources[].id must be a non-empty string (§5.1); got {entry_id!r}")
        elif contains_record_pointer(entry_id):
            errors.append(
                f"sources[].id {entry_id!r} embeds a Canonical uuid/"
                "canonical:// uri (BI-10)"
            )
        elif entry_id in seen_ids:
            errors.append(
                f"sources[].id {entry_id!r} is duplicated — footnote labels "
                "must join to exactly one entry (§5.1)"
            )
        else:
            seen_ids.add(entry_id)
        resource = entry.get("resource")
        if not is_valid_source_resource(resource):
            errors.append(
                f"sources[].resource {resource!r} is not a valid v0.2 source "
                "resource — expected a canonical:// record anchor, an http(s) "
                "URL, or a bundle .md path (id-426 emission contract)"
            )
        title = entry.get("title")
        if title is not None:
            if not isinstance(title, str) or not title.strip():
                errors.append(
                    f"sources[].title, when present, must be a non-empty "
                    f"string; got {title!r}"
                )
            elif contains_record_pointer(title):
                errors.append(
                    f"sources[].title {title!r} embeds a Canonical uuid/"
                    "canonical:// uri (BI-10)"
                )
    return errors


def check_confidence(value: object) -> "list[str]":
    """A19 (bl-477): `confidence`, when present, must be one of the
    ratified vocabulary (`strong`/`partial`/`no-content`/`needs-SME`).
    Absence — including an explicit `None`, the `ConceptFrontmatter`
    dataclass default for a field never populated — is not an error; the
    OKF SPEC optional-tolerant posture (module docstring) applies here
    exactly as it does to `resource:`."""
    if value is None:
        return []
    if value not in _CONFIDENCE_VALUES:
        return [
            f"confidence {value!r} is outside the ratified A19 vocabulary "
            f"{sorted(_CONFIDENCE_VALUES)}"
        ]
    return []


def _find_heading_span(body: str, heading: str) -> "tuple[int, int] | None":
    """Return the `(start, end)` character span of the `# {heading}`
    section, INCLUDING its heading line, up to (but excluding) the next
    top-level `# ` heading or EOF. `None` if the heading is absent."""
    pattern = re.compile(rf"^#[ \t]+{re.escape(heading)}[ \t]*$", re.MULTILINE)
    match = pattern.search(body)
    if match is None:
        return None
    start = match.start()
    nxt = _TOP_HEADING_RE.search(body, match.end())
    end = nxt.start() if nxt else len(body)
    return start, end


def _section_body(body: str, heading: str) -> str:
    """Content of the `# {heading}` section, EXCLUDING the heading line
    itself. Empty string if the heading is absent."""
    span = _find_heading_span(body, heading)
    if span is None:
        return ""
    start, end = span
    heading_line_end = body.find("\n", start)
    if heading_line_end == -1 or heading_line_end >= end:
        return ""
    return body[heading_line_end + 1 : end]


def find_body_pointer_leak(body: str) -> bool:
    """BI-10: True if `body`, MINUS its `# Citations` section, embeds a
    Canonical uuid or `canonical://` uri."""
    span = _find_heading_span(body, _CITATIONS_HEADING)
    if span is None:
        remainder = body
    else:
        start, end = span
        remainder = body[:start] + body[end:]
    return contains_record_pointer(remainder)


def check_no_stray_pointer(
    frontmatter: "Mapping[str, object]", body: str
) -> "list[str]":
    """BI-10 (v0.2): no field other than `sources` (whose entries'
    `resource` values are the sanctioned pointer ingress — shape-gated by
    `check_sources`) may embed a Canonical uuid/`canonical://` uri, and
    the body may not embed one outside a legacy `# Citations` section
    (v0.2 bodies carry none). `resource` is also skipped here — its own
    `check_resource_scheme` gate already rejects a canonical:// pointer
    outright, and a real fetched web URL may legitimately contain a uuid
    path segment."""
    errors: "list[str]" = []
    for key, value in frontmatter.items():
        if key in ("resource", "sources"):
            continue
        if isinstance(value, str):
            if contains_record_pointer(value):
                errors.append(
                    f"{key} embeds a Canonical uuid/canonical:// uri "
                    "outside resource:/# Citations (BI-10)"
                )
        elif isinstance(value, (list, tuple)):
            for item in value:
                if isinstance(item, str) and contains_record_pointer(item):
                    errors.append(
                        f"{key} entry {item!r} embeds a Canonical uuid/"
                        "canonical:// uri outside resource:/# Citations "
                        "(BI-10)"
                    )
    if find_body_pointer_leak(body):
        errors.append(
            "concept body embeds a Canonical uuid/canonical:// uri outside "
            "# Citations (BI-10)"
        )
    return errors


def lint_entity_relation_mentions(
    *,
    entities: "Sequence[Mapping[str, object]] | None" = None,
    relationships: "Sequence[Mapping[str, object]] | None" = None,
    effective_ontology: "EffectiveOntology | None" = None,
) -> "list[str]":
    """BI-13 semantic lint: the closed 12-entity/10-relation ontology — base
    ∪ client-overlay when `effective_ontology` is supplied (OV-8, ID-132
    {132.34}); base-only otherwise (default, every pre-overlay call site
    unchanged).

    Accepts pre-extracted entity/relationship mention dicts in the SAME
    shape the extraction Pydantic models use (`entity_type`/`relationship`
    keys). A no-op (returns `[]`) when neither is supplied — a concept with
    no entity/relationship mentions is not penalised for it."""
    eo = effective_ontology or EffectiveOntology.base_only()
    errors: "list[str]" = []
    for entity in entities or ():
        value = entity.get("entity_type") if isinstance(entity, Mapping) else None
        if value not in eo.entity_types:
            errors.append(
                f"entity_type {value!r} is outside the closed 12-entity "
                f"ontology {sorted(eo.entity_types)}"
            )
    for relationship in relationships or ():
        value = (
            relationship.get("relationship")
            if isinstance(relationship, Mapping)
            else None
        )
        if value not in eo.relationship_types:
            errors.append(
                f"relationship {value!r} is outside the closed 10-relation "
                f"ontology {sorted(eo.relationship_types)}"
            )
    return errors


def check_concept(
    frontmatter: "Mapping[str, object] | ConceptFrontmatter",
    *,
    body: str = "",
    entities: "Sequence[Mapping[str, object]] | None" = None,
    relationships: "Sequence[Mapping[str, object]] | None" = None,
    effective_ontology: "EffectiveOntology | None" = None,
) -> "list[str]":
    """BI-13 gate: run every check, return the list of violations (empty =
    valid). Non-raising — `validate_concept` wraps this and raises.

    `effective_ontology` (OV-8, ID-132 {132.34}) is the run's composed
    base ∪ client-overlay set — threaded into `lint_entity_relation_
    mentions` (entity/relationship mentions) ONLY. Since {427.5} it is NOT
    threaded into the concept-`type` check: `check_type_shape` validates a
    label's shape and has no vocabulary to compose against (DR-141).
    `None` (every pre-overlay call site) lints against the bare base
    frozensets, unchanged."""
    fm = _as_mapping(frontmatter)
    errors: "list[str]" = []
    errors += check_required_keys(fm)
    if "type" in fm:
        errors += check_type_shape(fm["type"])
    if "resource" in fm:
        errors += check_resource_scheme(fm["resource"])
    if "sources" in fm:
        errors += check_sources(fm["sources"])
    if "confidence" in fm:
        errors += check_confidence(fm["confidence"])
    errors += check_no_stray_pointer(fm, body)
    errors += lint_entity_relation_mentions(
        entities=entities, relationships=relationships, effective_ontology=effective_ontology
    )
    return errors


def validate_concept(
    frontmatter: "Mapping[str, object] | ConceptFrontmatter",
    *,
    body: str = "",
    entities: "Sequence[Mapping[str, object]] | None" = None,
    relationships: "Sequence[Mapping[str, object]] | None" = None,
    effective_ontology: "EffectiveOntology | None" = None,
) -> None:
    """BI-13 gate: raises `ConceptValidationError` (ALL violations, not
    fail-fast) unless `frontmatter`/`body` pass every check. No concept is
    written/published unless it passes this gate — the `declare_file` call
    site (wired in `{132.10}`) must call this before every write.
    `effective_ontology` — see `check_concept`."""
    errors = check_concept(
        frontmatter,
        body=body,
        entities=entities,
        relationships=relationships,
        effective_ontology=effective_ontology,
    )
    if errors:
        raise ConceptValidationError(errors)


# A `[n] [label](target)` numbered-link trailer line (the v0.1 SPEC §8
# citation form — legacy parse only under v0.2; the trailer is retired,
# S546 F1-A) — recognised alongside the older `- <entry>` / `* <entry>`
# bullets.
_CITATION_NUMBERED_LINE_RE = re.compile(r"^\[\d+\]\s+\S")


def _ordered_citation_entries(body: str) -> "list[tuple[str | None, str]]":
    """Parse `body`'s LEGACY v0.1 `# Citations` section into an ORDERED,
    de-duplicated (by target, first occurrence wins) list of
    `(label, target)` pairs. Under v0.2 the producer emits no trailer
    (provenance lives in the `sources:` frontmatter, §5.1) — this parser
    survives solely so prior committed v0.1 bundles remain readable to the
    shrink guard (`detect_citation_shrink`).

    Accepts BOTH trailer forms — the legacy bare-path `- <entry>` / `*
    <entry>` bullets (prior committed bundles) and the v0.1 §8
    numbered-link `[n] [label](target)` lines — normalising every entry to
    its canonical TARGET via `resource_uri.parse_citation_entry` (leading
    `/` stripped, so targets compare against identity rel_paths)."""
    section = _section_body(body, _CITATIONS_HEADING)
    entries: "dict[str, str | None]" = {}
    for line in section.splitlines():
        stripped = line.strip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            candidate = stripped[2:].strip()
        elif _CITATION_NUMBERED_LINE_RE.match(stripped):
            candidate = stripped
        else:
            continue
        label, target = parse_citation_entry(candidate)
        if target and target not in entries:
            entries[target] = label
    return [(label, target) for target, label in entries.items()]


def _citation_entries(body: str) -> "set[str]":
    """The comparable TARGET set of `body`'s legacy `# Citations` section —
    both the bare-path bullet form and the v0.1 §8 numbered-link form
    normalise to the same targets (see `_ordered_citation_entries`), so a
    format migration alone is never a citation "shrink"."""
    return {target for _label, target in _ordered_citation_entries(body)}


def _frontmatter_source_targets(document: str) -> "set[str]":
    """The comparable TARGET set of `document`'s v0.2 `sources:`
    frontmatter block (§5.1) — the provenance surface that replaced the
    `# Citations` trailer (S546 F1-A). Hand-rolled line parse of the
    emitter's own fully-controlled shape (no `pyyaml` — the same posture
    as `producer/frontmatter.py`): entries' `resource:` values, unquoted
    if double-quoted, normalised via `resource_uri.citation_target` so
    bundle-absolute paths compare against identity rel_paths. Returns the
    empty set for a document with no frontmatter or no `sources:` key
    (e.g. a bare body, or a legacy v0.1 document)."""
    lines = document.split("\n")
    if not lines or lines[0].strip() != "---":
        return set()
    close = next(
        (i for i in range(1, len(lines)) if lines[i].strip() == "---"), None
    )
    if close is None:
        return set()
    targets: "set[str]" = set()
    in_sources = False
    for line in lines[1:close]:
        if line and not line[0].isspace():
            in_sources = line.rstrip() == "sources:"
            continue
        if not in_sources:
            continue
        stripped = line.strip()
        if stripped.startswith("- "):
            stripped = stripped[2:].strip()
        key, sep, value = stripped.partition(":")
        if not sep or key.strip() != "resource":
            continue
        value = value.strip()
        if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
            value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        if value:
            targets.add(citation_target(value))
    return targets


def _provenance_targets(document: str) -> "set[str]":
    """A document's FULL comparable provenance-target set — the union of
    its legacy v0.1 `# Citations` trailer targets and its v0.2
    `sources:` frontmatter targets, so the v0.1→v0.2 format migration
    (trailer retired, provenance moved to frontmatter — §13.1) is never
    itself a "shrink"."""
    return _citation_entries(document) | _frontmatter_source_targets(document)


def detect_citation_shrink(*, previous_body: str, new_body: str) -> "list[str]":
    """S451 rider fold-in 2 — augmentation-guard DETECTION half
    (BI-17/BI-22/DR-016), v0.2-aware (id-426).

    Compares the provenance-target set of `previous_body` (the prior
    committed concept state — its legacy `# Citations` section AND/OR its
    v0.2 `sources:` frontmatter, `_provenance_targets`) against
    `new_body` (a new draft, same harvesting) and returns the sorted list
    of targets present in the previous state but ABSENT from the new
    draft — i.e. a shrink. An empty list means no shrink (the new draft
    is a superset, unchanged, a pure v0.1→v0.2 format migration of the
    same targets, or `previous_body` had no prior provenance at all —
    e.g. a first-write concept). Callers may pass full documents
    (frontmatter + body) or bare bodies — a bare body simply has no
    frontmatter half to harvest.

    This is the SINGLE shared detection implementation — `{132.9}` (Pass-2
    write gate) and `{132.12}` (git-sync 3-way reconcile) must both call
    this rather than re-implementing divergent shrink-detection logic. It
    does NOT itself refuse a write; the caller decides the enforcement
    action (mirrors the reference `write_concept_doc`,
    `bundle_tools.py:110-155`, "augment, not replace" guard — ported here
    as detection-only)."""
    previous_entries = _provenance_targets(previous_body)
    new_entries = _provenance_targets(new_body)
    missing = previous_entries - new_entries
    return sorted(missing)
