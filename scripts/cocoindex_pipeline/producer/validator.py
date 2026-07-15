"""Concept-frontmatter validator — BI-13 (ID-132 {132.7} G-VALIDATE).

The gate every OKF concept write passes through before `declare_file` lands
it on disk (caller wired in `{132.10}`; this Subtask builds the gate + its
API). Per PRODUCT.md §C invariant 13 + TECH.md §"Concept-frontmatter
validator (BI-13)":

- **BI-12 required keys** — `type`/`title`/`description`/`timestamp`/`tags`
  MUST be present. `resource:` is deliberately NOT in the hard-required set
  — PRODUCT.md BI-12 states it is required only "where one exists", and the
  landed `{132.6}` emitter (`producer/frontmatter.py`) treats it as
  optional (`resource: str | None = None`). This diverges from TECH.md's
  terser BI-table row ("Required frontmatter (type/title/description/
  timestamp/resource:/tags:)") and from `lib/ontology/concept-schema.ts`
  (`ConceptFrontmatterSchema.resource` has no `.optional()`), both of which
  treat it as unconditionally required. Flagged as a genuine spec-tension
  finding in the `{132.7}` report — NOT resolved here by editing the TS
  schema (out of this Subtask's file-ownership scope); this module matches
  what the landed Python emitter actually produces.
- **BI-4 type set** — `type` MUST be one of the five ratified concept
  types. Mirrors `CONCEPT_TYPE_VALUES` in `lib/ontology/concept-schema.ts`
  (TS source of truth for the concept-frontmatter contract; not imported —
  cross-language). `metric`/`playbook` are TAGS, not types.
- **BI-6 resource scheme** — `resource:`, when present, MUST be a
  `canonical://` pointer in one of the TWO forms `producer/resource_uri.py`
  actually emits: the per-row anchor `canonical://{source_documents,
  reference_items}/<uuid>` (`build_per_row_uri`) OR the BI-8 `q_a_pairs`
  table/query form `canonical://q_a_pairs?scope_tag=<tag>` /
  `?domain=<domain>&subtopic=<subtopic>` (`build_q_a_pairs_query_uri`).
  `lib/ontology/concept-schema.ts`'s `CANONICAL_RESOURCE_URI_PATTERN`
  matches ONLY the per-row form — the query form would fail that regex.
  This is a genuine RESOURCE-FORM NUANCE (not a bug to silently paper
  over): flagged in the `{132.7}` report, not fixed here (TS file out of
  scope).
- **BI-10 assertion** — no Canonical uuid/`canonical://` uri may appear in
  ANY frontmatter field other than `resource:`, nor anywhere in the concept
  body OUTSIDE its `# Citations` section. Reuses
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
record-grounded `# Schema`/`# Citations` — "augment, not replace". KH's
`declare_file` write path has no equivalent yet. This module owns the
DETECTION half only: given a concept's PRIOR committed body and a NEW
draft body, `detect_citation_shrink` returns the `# Citations` entries the
new draft DROPS relative to the prior state (empty = no shrink). It does
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

from scripts.cocoindex_pipeline.producer.frontmatter import ConceptFrontmatter
from scripts.cocoindex_pipeline.producer.resource_uri import contains_record_pointer

# ──────────────────────────────────────────
# BI-4: the closed concept type set.
# Mirrors `CONCEPT_TYPE_VALUES` — `lib/ontology/concept-schema.ts:36-42`.
# `metric`/`playbook` are TAGS, never types.
# ──────────────────────────────────────────

ALLOWED_CONCEPT_TYPES = frozenset(
    {"topic", "product", "company", "certification", "case_study"}
)

# ──────────────────────────────────────────
# BI-4 facet TAGS (S443 Amendment / DR-029). Facets are carried in the OPEN
# `tags:` list (BI-12), NEVER as enumerated `type:` values — so this registry
# is the RECOGNISED facet vocabulary, not a rejection allowlist. `check_
# concept` does not reject a tag for being absent here (a concept may still
# carry arbitrary short domain tags); the registry names the facets the
# producer treats as first-class, for downstream consumers ({132.21}) and to
# keep the enumerated type set (`ALLOWED_CONCEPT_TYPES`) and the facet
# vocabulary from silently diverging.
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
# `check_concept`/`validate_concept` -> `check_type_membership`/
# `lint_entity_relation_mentions` so a run that composed a client overlay
# (`bundle_writer.read_client_overlay`) lints against base+overlay, not the
# bare base frozensets above. `effective_ontology=None` (the default at
# EVERY pre-overlay call site) is exactly `base_only()` — zero behaviour
# change for a bundle with no overlay.
# ──────────────────────────────────────────


@dataclass(frozen=True)
class EffectiveOntology:
    """OV-7: the deterministic sorted-union effective ontology for one
    producer run. Each field is `base ∪ overlay` for that dimension — a
    de-duplicated frozenset; a caller needing a stable rendering order
    calls `sorted(...)` on it (mirrors the base snapshot's own
    `sorted(...)` convention)."""

    concept_types: "frozenset[str]"
    entity_types: "frozenset[str]"
    relationship_types: "frozenset[str]"

    @classmethod
    def base_only(cls) -> "EffectiveOntology":
        """The default effective ontology when no overlay is composed —
        gating against this is identical to gating against the bare base
        frozensets directly (pre-overlay behaviour, unchanged)."""
        return cls(
            concept_types=ALLOWED_CONCEPT_TYPES,
            entity_types=ALLOWED_ENTITY_TYPES,
            relationship_types=ALLOWED_RELATIONSHIP_TYPES,
        )

    @classmethod
    def compose(cls, overlay: "Mapping[str, object] | None") -> "EffectiveOntology":
        """OV-4/OV-7: base ∪ overlay per dimension. `overlay` is the OV-6
        provenance-wrapped mapping `bundle_writer.read_client_overlay`
        returns (or any equivalent `{dimension: [terms, ...]}` mapping,
        e.g. the raw dict an explicit `client_ontology_overlay` kwarg
        supplies) — any of the three OV-2 dimension keys it omits
        contributes no extension for that dimension. `overlay=None` (OV-4:
        no overlay file present) is exactly `base_only()`. Restating a base
        term is an idempotent union no-op (OV-3)."""
        if overlay is None:
            return cls.base_only()
        return cls(
            concept_types=frozenset(
                ALLOWED_CONCEPT_TYPES | set(overlay.get("concept_types") or ())
            ),
            entity_types=frozenset(
                ALLOWED_ENTITY_TYPES | set(overlay.get("entity_types") or ())
            ),
            relationship_types=frozenset(
                ALLOWED_RELATIONSHIP_TYPES
                | set(overlay.get("relationship_types") or ())
            ),
        )


# BI-12: hard-required frontmatter keys. `resource` is intentionally
# excluded — see module docstring.
_REQUIRED_STRING_KEYS = ("type", "title", "description", "timestamp")
_REQUIRED_KEYS = _REQUIRED_STRING_KEYS + ("tags",)

# BI-6: the two resource forms `producer/resource_uri.py` actually emits.
_PER_ROW_RESOURCE_RE = re.compile(
    r"^canonical://(?:source_documents|reference_items)/"
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_QA_PAIRS_QUERY_RESOURCE_RE = re.compile(
    r"^canonical://q_a_pairs\?(?:scope_tag=[^&]+|domain=[^&]+&subtopic=[^&]+)$"
)

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
            "timestamp": frontmatter.timestamp,
            "tags": list(frontmatter.tags),
            "resource": frontmatter.resource,
        }
    return frontmatter


def check_required_keys(frontmatter: "Mapping[str, object]") -> "list[str]":
    """BI-12: `type`/`title`/`description`/`timestamp`/`tags` MUST be
    present keys; the four string fields must additionally be non-empty.
    `resource:` is NOT checked here — see module docstring."""
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
    return errors


def check_type_membership(
    type_value: object, *, effective_ontology: "EffectiveOntology | None" = None
) -> "list[str]":
    """BI-4: `type` must be one of the ratified concept types — the base
    five, or base ∪ client-overlay when `effective_ontology` is supplied
    (OV-8, ID-132 {132.34}). Defaults to base-only, so every pre-overlay
    call site is unchanged."""
    allowed = (effective_ontology or EffectiveOntology.base_only()).concept_types
    if type_value not in allowed:
        return [
            f"type {type_value!r} is outside the closed BI-4 type set "
            f"{sorted(allowed)} (metric/playbook are tags, "
            "not types)"
        ]
    return []


def is_valid_concept_resource_uri(value: object) -> bool:
    """BI-6: True iff `value` is one of the two `canonical://` forms
    `producer/resource_uri.py` actually emits (the per-row anchor form, or
    the BI-8 `q_a_pairs` table/query form)."""
    if not isinstance(value, str):
        return False
    return bool(
        _PER_ROW_RESOURCE_RE.match(value) or _QA_PAIRS_QUERY_RESOURCE_RE.match(value)
    )


def check_resource_scheme(resource: object) -> "list[str]":
    """BI-6: `resource`, when present, must satisfy
    `is_valid_concept_resource_uri`. Absence is not an error here — see
    `check_required_keys` docstring."""
    if resource is None:
        return []
    if not is_valid_concept_resource_uri(resource):
        return [
            f"resource {resource!r} is not a valid canonical:// pointer "
            "(BI-6) — expected canonical://{source_documents,reference_"
            "items}/<uuid> or canonical://q_a_pairs?scope_tag=<tag>|"
            "domain=<domain>&subtopic=<subtopic>"
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
    """BI-10: no field other than `resource` may embed a Canonical uuid/
    `canonical://` uri, and the body may not embed one outside
    `# Citations`."""
    errors: "list[str]" = []
    for key, value in frontmatter.items():
        if key == "resource":
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
    base ∪ client-overlay set — threaded into `check_type_membership`
    (concept `type`) and `lint_entity_relation_mentions` (entity/
    relationship mentions). `None` (every pre-overlay call site) gates
    against the bare base frozensets, unchanged."""
    fm = _as_mapping(frontmatter)
    errors: "list[str]" = []
    errors += check_required_keys(fm)
    if "type" in fm:
        errors += check_type_membership(fm["type"], effective_ontology=effective_ontology)
    if "resource" in fm:
        errors += check_resource_scheme(fm["resource"])
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


def _citation_entries(body: str) -> "set[str]":
    """Parse the `- <entry>` / `* <entry>` bullet lines out of `body`'s
    `# Citations` section into a comparable set."""
    section = _section_body(body, _CITATIONS_HEADING)
    entries: "set[str]" = set()
    for line in section.splitlines():
        stripped = line.strip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            entries.add(stripped[2:].strip())
    return entries


def detect_citation_shrink(*, previous_body: str, new_body: str) -> "list[str]":
    """S451 rider fold-in 2 — augmentation-guard DETECTION half
    (BI-17/BI-22/DR-016).

    Compares the `# Citations` section of `previous_body` (the prior
    committed concept state) against `new_body` (a new draft) and returns
    the sorted list of citation entries present in the previous state but
    ABSENT from the new draft — i.e. a shrink. An empty list means no
    shrink (the new draft is a superset, unchanged, or `previous_body` had
    no prior citations at all — e.g. a first-write concept).

    This is the SINGLE shared detection implementation — `{132.9}` (Pass-2
    write gate) and `{132.12}` (git-sync 3-way reconcile) must both call
    this rather than re-implementing divergent shrink-detection logic. It
    does NOT itself refuse a write; the caller decides the enforcement
    action (mirrors the reference `write_concept_doc`,
    `bundle_tools.py:110-155`, "augment, not replace" guard — ported here
    as detection-only)."""
    previous_entries = _citation_entries(previous_body)
    new_entries = _citation_entries(new_body)
    missing = previous_entries - new_entries
    return sorted(missing)
