"""Concept-frontmatter emitter — BI-12 (ID-132 {132.6} G-PASS1a), upgraded
to the OKF v0.2 emission contract (id-426, S546 rulings F1-A/F2-B).

Assembles and renders the YAML frontmatter block every OKF concept `.md`
file carries. Per PRODUCT.md §C invariant 12 (as amended by the S436/DR-019
decision board) and the OKF v0.2 spec (vendored at
`lib/okf/.claude/skills/okf/reference/SPEC.md`, pin 3fcbb9f):

- **Required keys:** `type`, `title`, `description`, `generated` (§5.2 —
  `{ by, at }`, replacing the retired v0.1 `timestamp`), plus `tags:`
  (always present, may be empty).
- **`generated.at` is ISO-8601** (DR-019, carried over from `timestamp`) —
  NOT UK `DD/MM/YYYY`. The UK `DD/MM/YYYY` house rule applies to BUNDLE
  BODY PROSE only. `generated.by` is a §7 actor
  (`<producer>/<version>`, `human:<id>` or `process:<id>`).
- **Provenance is the `sources:` list (§5.1)** — one `{ id, resource,
  title? }` entry per source, with a deterministic, stable, human-short
  `id` derived from the resource URI (`derive_source_id`). The v0.1
  `# Citations` body trailer is retired outright (S546 F1-A — no
  one-release carry); per-claim attribution uses markdown footnotes
  `[^id]` keyed to `sources[].id` (`render_source_footnotes`).
- **Top-level `resource:` is never a `canonical://` pointer (S546 F2-B).**
  DB-backed concepts omit it entirely — their record anchor lives in
  `sources[]`; a Pass-2 reference concept sets it to the real fetched web
  URL (followable, §4.1-conformant).
- **UK English** governs prose content (title/description text) supplied by
  the caller — this module does not author prose, only assembles/validates
  the structural frontmatter block.
- **BI-10 guard:** `type`/`title`/`description`/`tags` (and the routing
  hints) MUST NOT embed a Canonical record uuid or `canonical://` uri —
  `sources[].resource` is the ONLY ingress of a record pointer into the
  bundle under v0.2, and every entry must satisfy
  `is_valid_source_resource`.

Deliberately hand-rolled (no `pyyaml` dependency): PyYAML is not pinned in
`requirements.txt` (only resolves transitively in this environment), and the
frontmatter shape here is a small, fully-controlled subset — a general YAML
writer is not warranted. `render_concept_frontmatter` is a plain-scalar /
double-quoted-scalar emitter sufficient for agent-authored title/description
strings and our own uri/tag values; it is not a general-purpose YAML encoder.

`_needs_quoting` additionally double-quotes any plain scalar that a YAML-1.1
loader (e.g. PyYAML) would re-parse as bool/null/number/timestamp instead of
`str` (a title of `"NO"` or `"99.9"`) — and `generated.at` is ALWAYS
double-quoted unconditionally, regardless of `_needs_quoting`'s verdict
(the {132.7} S451 rider rule for the retired `timestamp` field, carried to
its v0.2 successor).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence
from urllib.parse import urlsplit

from scripts.cocoindex_pipeline.producer.resource_uri import (
    contains_record_pointer,
    is_canonical_resource_uri,
)

# Leading characters that force YAML double-quoting on a plain scalar.
_YAML_SPECIAL_LEADING_CHARS = set("-?:,[]{}#&*!|>'\"%@`")

# {132.7} S451 rider fold-in 1 — YAML-1.1 type-ambiguity patterns (TECH-
# ADDENDUM-reference-agents.md retro-check on {132.6}, fix option (a)). A
# plain (unquoted) scalar matching any of these re-parses as bool/null/
# number/timestamp — not `str` — under a YAML-1.1 core-schema loader
# (PyYAML's default resolver; `yaml.safe_dump` quotes these for exactly this
# reason). Deliberately hand-rolled/regex-based (no `pyyaml` dependency —
# see module docstring); the patterns approximate PyYAML's own
# `resolver.py` implicit-resolver regexes closely enough to catch the
# concrete hazards named in the retro-check (`"NO"`, `"99.9"`, an unquoted
# ISO timestamp) plus the wider bool/null/int/float/date/timestamp classes.
_YAML_BOOL_RE = re.compile(
    r"^(?:y|Y|yes|Yes|YES|n|N|no|No|NO"
    r"|true|True|TRUE|false|False|FALSE"
    r"|on|On|ON|off|Off|OFF)$"
)
_YAML_NULL_RE = re.compile(r"^(?:~|null|Null|NULL)$")
_YAML_INT_RE = re.compile(
    r"^[-+]?(?:0b[0-1_]+|0x[0-9a-fA-F_]+|0o?[0-7_]+|[0-9][0-9_]*)$"
)
_YAML_FLOAT_RE = re.compile(
    r"^[-+]?\.(?:inf|Inf|INF)$"
    r"|^\.(?:nan|NaN|NAN)$"
    r"|^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*(?:[eE][-+]?[0-9]+)?$"
    r"|^[-+]?[0-9][0-9_]*[eE][-+]?[0-9]+$"
)
_YAML_TIMESTAMP_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}"
    r"(?:[Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*)?"
    r"(?:[Zz]|[-+][0-9]{2}:?[0-9]{2})?)?$"
)
_YAML_AMBIGUOUS_SCALAR_PATTERNS = (
    _YAML_BOOL_RE,
    _YAML_NULL_RE,
    _YAML_INT_RE,
    _YAML_FLOAT_RE,
    _YAML_TIMESTAMP_RE,
)


@dataclass(frozen=True)
class ConceptSource:
    """One §5.1 `sources:` entry — the v0.2 provenance record that replaces
    a v0.1 `# Citations` trailer line (S546 F1-A).

    `id` is the deterministic, stable, human-short join key
    (`derive_source_id`) footnote labels (`[^id]`) attribute claims
    through; `resource` names the concrete artifact (a `canonical://`
    record anchor, an absolute web URL, or a bundle-absolute `.md` path);
    `title` is an optional human-readable label."""

    id: str
    resource: str
    title: "str | None" = None


@dataclass(frozen=True)
class ConceptFrontmatter:
    """The validated, ready-to-render frontmatter for one concept (OKF
    v0.2 emission contract, id-426).

    `generated_by`/`generated_at` render as the single §5.2
    `generated: { by, at }` mapping (they replace the retired v0.1
    `timestamp` — removed, not shadowed). `sources` is the §5.1 provenance
    list. `purpose`/`task`/`audience` (bl-456 routing hints) and
    `confidence` (bl-477 A19 vocabulary) are OPTIONAL fields carried
    unchanged from the ID-132 FRONTMATTER-WAVE shared-contract extension
    (id-318, S546 — fully conformant §4.1 extension keys; upstream PR #189
    remains open/unmerged). All four default to `None` (absent from the
    emitted frontmatter — `render_concept_frontmatter`)."""

    type: str
    title: str
    description: str
    generated_by: str
    generated_at: str  # ISO-8601 (DR-019)
    tags: "tuple[str, ...]" = ()
    resource: "str | None" = None
    purpose: "str | None" = None
    task: "str | None" = None
    audience: "str | None" = None
    confidence: "str | None" = None
    sources: "tuple[ConceptSource, ...]" = ()


# ──────────────────────────────────────────
# BI-6: the two `canonical://` resource forms `producer/resource_uri.py`
# actually emits. Under v0.2 these are the accepted grammar for a
# `sources[].resource` record anchor (never the top-level `resource:` —
# S546 F2-B); `derive_concept_confidence` below classifies a concept's
# primary anchor as PER-ROW with `_PER_ROW_RESOURCE_RE`. (`validator.py`
# imports `is_valid_concept_resource_uri` FROM here — the other direction
# would be a circular import.)
# ──────────────────────────────────────────
_PER_ROW_RESOURCE_RE = re.compile(
    r"^canonical://(?:source_documents|reference_items)/"
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
# The ?domain=&subtopic= form retired S531 with the fallback topic grain
# (DR-125 expiry ruled) — scope_tag is the only accepted query form.
_QA_PAIRS_QUERY_RESOURCE_RE = re.compile(
    r"^canonical://q_a_pairs\?scope_tag=[^&]+$"
)


def is_valid_concept_resource_uri(value: object) -> bool:
    """BI-6: True iff `value` is one of the two `canonical://` forms
    `producer/resource_uri.py` actually emits (the per-row anchor form, or
    the BI-8 `q_a_pairs` table/query form)."""
    if not isinstance(value, str):
        return False
    return bool(
        _PER_ROW_RESOURCE_RE.match(value) or _QA_PAIRS_QUERY_RESOURCE_RE.match(value)
    )


def is_valid_source_resource(value: object) -> bool:
    """The v0.2 `sources[].resource` grammar (id-426 emission contract):
    a `canonical://` record anchor (BI-6/BI-8 forms), an absolute
    http(s) URL (Pass-2 gated-web / PC-5 git-blob / DR-087 docs-site), or
    a bundle `.md` concept path (the BI-9 cross-link form, stored
    bundle-absolute — a leading `/` is accepted but not required)."""
    if not isinstance(value, str) or not value.strip():
        return False
    if is_canonical_resource_uri(value):
        return is_valid_concept_resource_uri(value)
    if value.startswith("http://") or value.startswith("https://"):
        return True
    return "://" not in value and value.lstrip("/") != "" and value.endswith(".md")


# ──────────────────────────────────────────
# §5.1 sources[].id derivation — deterministic, stable, human-short.
# ──────────────────────────────────────────

_SLUG_RUN_RE = re.compile(r"[^a-z0-9]+")


def _slug(text: str) -> str:
    slug = _SLUG_RUN_RE.sub("-", text.lower()).strip("-")
    return slug or "src"


def derive_source_id(resource: str) -> str:
    """The deterministic §5.1 `sources[].id` for `resource` — a pure
    function of the resource URI alone, so it is stable across runs AND
    across list reordering (the whole point of a keyed, non-positional
    label per §5.1: agents constantly rewrite these documents, and a
    positional index misattributes silently the moment the list is
    reordered).

    Forms:
      - `canonical://source_documents/<uuid>`  -> `sd-<uuid[:8]>`
      - `canonical://reference_items/<uuid>`   -> `ref-<uuid[:8]>`
      - `canonical://q_a_pairs?scope_tag=<t>`  -> `qa-<slug(t)>`
      - an http(s) URL -> `web-<slug(last path segment or host)>-<sha256[:6]>`
        (the short content hash keeps distinct URLs whose slugs coincide
        from colliding — a colliding id would misattribute footnotes);
      - a bundle `.md` path -> `<slug(path minus .md)>`.

    `build_concept_frontmatter` additionally asserts ids are unique within
    one concept's `sources` list, so the astronomically-unlikely residual
    collision (e.g. two uuids sharing their first 8 hex chars) fails loud
    rather than silently misattributing."""
    if not resource or not resource.strip():
        raise ValueError("derive_source_id: resource must be non-empty")
    match = re.match(
        r"^canonical://(source_documents|reference_items)/([0-9a-fA-F-]+)$", resource
    )
    if match:
        prefix = "sd" if match.group(1) == "source_documents" else "ref"
        return f"{prefix}-{match.group(2)[:8].lower()}"
    match = re.match(r"^canonical://q_a_pairs\?scope_tag=(.+)$", resource)
    if match:
        return f"qa-{_slug(match.group(1))}"
    if resource.startswith("http://") or resource.startswith("https://"):
        parsed = urlsplit(resource)
        segments = [s for s in parsed.path.split("/") if s]
        stem = segments[-1] if segments else (parsed.hostname or "web")
        stem = re.sub(r"\.[A-Za-z0-9]{1,8}$", "", stem) or (parsed.hostname or "web")
        digest = hashlib.sha256(resource.encode("utf-8")).hexdigest()[:6]
        return f"web-{_slug(stem)}-{digest}"
    path = resource.lstrip("/")
    if path.endswith(".md"):
        path = path[: -len(".md")]
    return _slug(path)


def _stored_source_resource(target: str) -> str:
    """The on-disk `sources[].resource` form for a normalised citation
    TARGET: absolute anchors/URLs verbatim; a bundle concept path stored
    bundle-ABSOLUTE (leading `/`, §6.2) — this is how the id-439 consumer
    derives `cites` edges under v0.2."""
    if is_canonical_resource_uri(target) or "://" in target:
        return target
    return f"/{target.lstrip('/')}"


def sources_from_citations(
    citations: "Sequence[str]",
    *,
    primary_anchor: "str | None" = None,
    titles: "dict[str, str] | None" = None,
) -> "tuple[ConceptSource, ...]":
    """Build the §5.1 `sources` list from validated citation TARGETS (the
    exact set the v0.1 trailer used to carry — every pointer becomes an
    entry). `primary_anchor` (the concept's record anchor, formerly the
    top-level `resource:` — S546 F2-B moved the pointer here) is listed
    FIRST when supplied; duplicates de-duplicate by resource, first
    occurrence wins, so ordering is deterministic. `titles` (optional) maps
    a stored resource to a human label."""
    ordered: "dict[str, ConceptSource]" = {}
    candidates = [] if primary_anchor is None else [primary_anchor]
    candidates.extend(citations)
    for candidate in candidates:
        stored = _stored_source_resource(candidate)
        if stored in ordered:
            continue
        ordered[stored] = ConceptSource(
            id=derive_source_id(stored),
            resource=stored,
            title=(titles or {}).get(stored),
        )
    return tuple(ordered.values())


def source_citation_targets(sources: "Sequence[ConceptSource]") -> "tuple[str, ...]":
    """The normalised citation-TARGET view of a `sources` list — the
    inverse of `_stored_source_resource` (bundle-absolute paths lose their
    leading `/` so they compare against identity rel_paths; anchors/URLs
    pass through verbatim). Pass-2 (`web_pass.py`) uses this to trust
    carried-forward Pass-1 provenance without re-proving it."""
    targets = []
    for source in sources:
        resource = source.resource
        if is_canonical_resource_uri(resource) or "://" in resource:
            targets.append(resource)
        else:
            targets.append(resource.lstrip("/"))
    return tuple(targets)


def render_source_footnotes(sources: "Sequence[ConceptSource]") -> str:
    """Render the §5.1 per-claim-attribution footnote DEFINITIONS for
    `sources` — one `[^id]: <label>` line per entry, replacing the retired
    `# Citations` trailer (S546 F1-A) as the body's provenance surface.
    The footnote label is the join key into `sources`; consumers resolve
    attribution through the matching entry, not by parsing the footnote
    prose. The prose is the entry's `title` when present, else the
    resource for a followable URL/bundle path, else the id itself (a
    `canonical://` anchor is never repeated in the body — BI-10 keeps
    record pointers out of body prose under v0.2)."""
    lines = []
    for source in sources:
        if source.title:
            label = source.title
        elif contains_record_pointer(source.resource):
            label = source.id
        else:
            label = source.resource
        lines.append(f"[^{source.id}]: {label}")
    return "\n".join(lines) + "\n" if lines else ""


# A19 (bl-477): the ratified confidence vocabulary — duplicated (not
# imported) in `producer/validator.py`'s own `_CONFIDENCE_VALUES` by design:
# "confidence, when supplied, is asserted to be in the A19 set (defence in
# depth alongside the validator)" (FRONTMATTER-WAVE.md). The two constants
# must be changed together if the vocabulary is ever amended.
_CONFIDENCE_VALUES = frozenset({"strong", "partial", "no-content", "needs-SME"})

# OQ-1 (FRONTMATTER-WAVE.md): the `strong` corroboration bar — a per-row
# record anchor AND at least this many distinct record-anchor citations.
# Named module constant so a later ratification change is one line.
_STRONG_CONFIDENCE_MIN_RECORD_ANCHORS = 2


def derive_concept_confidence(
    *, resource: "str | None", citations: "Sequence[str]"
) -> str:
    """A19 (bl-477) — the deterministic, NEVER model-authored
    confidence-setting rule (FRONTMATTER-WAVE.md §"Design — A19
    producer-drafted confidence-setting rule"). Computed by the producer at
    frontmatter-assembly time from draft-time grounding signals already
    resolved at the call site (`enrich_concept`, `_parse_reference_concept`,
    `run_web_pass`).

    Under the v0.2 emission contract (id-426) the SAME information feeds
    this rule from its new locations: `resource` is the concept's primary
    record anchor — no longer emitted as the top-level `resource:` (S546
    F2-B) but carried as `ConceptDraft.primary_anchor` / the leading
    `sources[]` entry — and `citations` are the validated citation targets
    the `sources[]` list is built from. Inputs and outputs are preserved
    bit-for-bit on equivalent inputs (id-428 owns any future change).

    `strong` iff `resource` is a PER-ROW anchor (`source_documents` or
    `reference_items` — never the BI-8 `q_a_pairs` query form) AND at least
    `_STRONG_CONFIDENCE_MIN_RECORD_ANCHORS` distinct `citations` are
    themselves record anchors (a concept cross-link citation does not
    corroborate — only fresh record grounding does). `partial` otherwise —
    the honest default for every other Path-1 shape: a single record
    anchor, a q_a_pairs-query-only anchor, `resource=None`, or a
    web-enriched reference concept.
    """
    record_anchors = {c for c in citations if is_valid_concept_resource_uri(c)}
    is_per_row_anchor = (
        resource is not None and _PER_ROW_RESOURCE_RE.match(resource) is not None
    )
    if is_per_row_anchor and len(record_anchors) >= _STRONG_CONFIDENCE_MIN_RECORD_ANCHORS:
        return "strong"
    return "partial"


def _normalise_generated_at(value: "str | datetime") -> str:
    """Validate/normalise `generated.at` to ISO-8601 (§5.2; DR-019 carried
    over from the retired v0.1 `timestamp`).

    A timezone-aware `datetime` is converted to UTC and rendered with a `Z`
    suffix. A `str` is validated as parseable ISO-8601 (accepting a `Z`
    suffix) and returned unchanged — callers that already hold an
    ISO-formatted string (e.g. from a Postgres timestamp column) pass it
    straight through without a lossy re-format round-trip.
    """
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError(
                "generated.at datetime must be timezone-aware (§5.2/DR-019 "
                "ISO-8601)"
            )
        iso = value.astimezone(timezone.utc).isoformat()
        return iso.replace("+00:00", "Z")
    if isinstance(value, str):
        candidate = value.replace("Z", "+00:00")
        try:
            datetime.fromisoformat(candidate)
        except ValueError as exc:
            raise ValueError(
                "generated.at must be ISO-8601 (§5.2, DR-019 amendment — UK "
                "DD/MM/YYYY is body-prose only, never a frontmatter "
                f"datetime field); got {value!r}"
            ) from exc
        return value
    raise TypeError("generated.at must be a str or a timezone-aware datetime")


# §7 actor convention: `<producer>/<version>` for agents/tools,
# `human:<id>` for a person, `process:<id>` for an automated process.
_ACTOR_PREFIXED_RE = re.compile(r"^(?:human|process):\S+$")


def _validate_generated_by(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("generated.by is required (§5.2)")
    if contains_record_pointer(value):
        raise ValueError(
            "generated.by must not embed a Canonical record uuid/"
            "canonical:// uri — sources[].resource is the only ingress "
            "(BI-10)"
        )
    if _ACTOR_PREFIXED_RE.match(value):
        return value
    producer, sep, version = value.partition("/")
    if not sep or not producer.strip() or not version.strip():
        raise ValueError(
            "generated.by must use the §7 actor convention — "
            "<producer>/<version>, human:<id> or process:<id>; got "
            f"{value!r}"
        )
    return value


def build_concept_frontmatter(
    *,
    type: str,
    title: str,
    description: str,
    generated_by: str,
    generated_at: "str | datetime",
    tags: "Sequence[str]" = (),
    resource: "str | None" = None,
    purpose: "str | None" = None,
    task: "str | None" = None,
    audience: "str | None" = None,
    confidence: "str | None" = None,
    sources: "Sequence[ConceptSource]" = (),
) -> ConceptFrontmatter:
    """Validate inputs and assemble the v0.2 frontmatter record.

    Raises `ValueError` on any missing required field, a non-ISO-8601
    `generated_at`, a `generated_by` outside the §7 actor convention, a
    top-level `resource` that IS a `canonical://` pointer (S546 F2-B — the
    pointer lives only in `sources[]`; only a Pass-2 reference concept's
    real fetched URL belongs here), a malformed/duplicate `sources` entry,
    any field embedding a Canonical record uuid outside `sources[].resource`
    (BI-10 — including the bl-456 `purpose`/`task`/`audience` routing
    hints), or a `confidence` outside the A19 vocabulary (bl-477; defence
    in depth alongside `producer/validator.py`'s own membership check).
    """
    if not type or not type.strip():
        raise ValueError("type is required (BI-12)")
    if not title or not title.strip():
        raise ValueError("title is required (BI-12)")
    if not description or not description.strip():
        raise ValueError("description is required (BI-12)")

    by = _validate_generated_by(generated_by)
    at = _normalise_generated_at(generated_at)

    fields = (("type", type), ("title", title), ("description", description))
    for label, value in fields:
        if contains_record_pointer(value):
            raise ValueError(
                f"{label} must not embed a Canonical record uuid/canonical:// "
                "uri — sources[].resource is the only ingress (BI-10)"
            )

    tag_tuple = tuple(tags)
    for tag in tag_tuple:
        if not tag or not tag.strip():
            raise ValueError("tags entries must be non-empty (BI-12)")
        if contains_record_pointer(tag):
            raise ValueError(
                "tags must not embed a Canonical record uuid/canonical:// uri "
                "(BI-10)"
            )

    if resource is not None:
        if not isinstance(resource, str) or not resource.strip():
            raise ValueError("resource, when present, must be a non-empty string")
        if is_canonical_resource_uri(resource):
            raise ValueError(
                "top-level resource: must not be a canonical:// pointer under "
                "OKF v0.2 (S546 F2-B) — a record anchor belongs in sources[]; "
                f"got {resource!r}"
            )

    # bl-456 routing hints — free strings, no positive shape check, but the
    # same BI-10 stray-pointer guard the existing string fields get.
    for hint_label, hint_value in (
        ("purpose", purpose),
        ("task", task),
        ("audience", audience),
    ):
        if hint_value is not None and contains_record_pointer(hint_value):
            raise ValueError(
                f"{hint_label} must not embed a Canonical record uuid/"
                "canonical:// uri — sources[].resource is the only ingress "
                "(BI-10)"
            )

    # bl-477 A19 confidence — defence in depth alongside the validator's own
    # `_CONFIDENCE_VALUES` membership check (`producer/validator.py`).
    if confidence is not None and confidence not in _CONFIDENCE_VALUES:
        raise ValueError(
            f"confidence must be one of {sorted(_CONFIDENCE_VALUES)} (A19); "
            f"got {confidence!r}"
        )

    source_tuple = tuple(sources)
    seen_ids: "set[str]" = set()
    for entry in source_tuple:
        if not isinstance(entry, ConceptSource):
            raise ValueError(
                f"sources entries must be ConceptSource records; got {entry!r}"
            )
        if not entry.id or not entry.id.strip():
            raise ValueError("sources[].id must be non-empty (§5.1)")
        if contains_record_pointer(entry.id):
            raise ValueError(
                "sources[].id must not embed a Canonical record uuid/"
                "canonical:// uri (BI-10) — use derive_source_id"
            )
        if entry.id in seen_ids:
            raise ValueError(
                f"sources[].id {entry.id!r} is duplicated — footnote labels "
                "must join to exactly one entry (§5.1)"
            )
        seen_ids.add(entry.id)
        if not is_valid_source_resource(entry.resource):
            raise ValueError(
                f"sources[].resource {entry.resource!r} is not a valid v0.2 "
                "source resource — expected a canonical:// record anchor, an "
                "http(s) URL, or a bundle .md path (id-426 emission contract)"
            )
        if entry.title is not None:
            if not entry.title.strip():
                raise ValueError("sources[].title, when present, must be non-empty")
            if contains_record_pointer(entry.title):
                raise ValueError(
                    "sources[].title must not embed a Canonical record uuid/"
                    "canonical:// uri (BI-10)"
                )

    return ConceptFrontmatter(
        type=type,
        title=title,
        description=description,
        generated_by=by,
        generated_at=at,
        tags=tag_tuple,
        resource=resource,
        purpose=purpose,
        task=task,
        audience=audience,
        confidence=confidence,
        sources=source_tuple,
    )


def _needs_quoting(value: str) -> bool:
    if value == "":
        return True
    if value != value.strip():
        return True
    if value[0] in _YAML_SPECIAL_LEADING_CHARS:
        return True
    if ": " in value or value.endswith(":"):
        return True
    if " #" in value:
        return True
    if any(pattern.match(value) for pattern in _YAML_AMBIGUOUS_SCALAR_PATTERNS):
        return True
    return False


def _yaml_escape(value: str) -> str:
    """Escape `value` for embedding inside a YAML double-quoted scalar."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _yaml_scalar(value: str) -> str:
    if not _needs_quoting(value):
        return value
    return f'"{_yaml_escape(value)}"'


def _flow_scalar(value: str) -> str:
    """A scalar embedded in a YAML FLOW mapping (`{ by: ..., at: ... }`) —
    flow context additionally forbids `,`/`{`/`}`/`[`/`]` in plain
    scalars, so quote on those too."""
    if _needs_quoting(value) or any(ch in value for ch in ",{}[]"):
        return f'"{_yaml_escape(value)}"'
    return value


def render_concept_frontmatter(fm: ConceptFrontmatter) -> str:
    """Render `fm` to a `---`-delimited YAML frontmatter block, newline-
    terminated, ready to prepend to a concept's markdown body.

    Fixed emission order (BI-18 memo/diff stability, id-426 golden shape):
    `type`, `title`, `description`, `generated`, then the optional
    `purpose`/`task`/`audience`/`confidence` (each only when set),
    `resource` (only when set — never canonical://, S546 F2-B), `tags`,
    and `sources` last (only when non-empty)."""
    lines = ["---"]
    lines.append(f"type: {_yaml_scalar(fm.type)}")
    lines.append(f"title: {_yaml_scalar(fm.title)}")
    lines.append(f"description: {_yaml_scalar(fm.description)}")
    # §5.2 generated — `at` is ALWAYS double-quoted (the {132.7} S451 rider
    # rule for the retired `timestamp`, carried to its v0.2 successor: the
    # one field DR-019 requires strict machine-parseability for must never
    # depend on the ambiguity-pattern heuristic staying exhaustive).
    lines.append(
        f'generated: {{ by: {_flow_scalar(fm.generated_by)}, '
        f'at: "{_yaml_escape(fm.generated_at)}" }}'
    )
    # bl-456/bl-477 (FRONTMATTER-WAVE.md): fixed emission order for
    # deterministic output — purpose, task, audience, confidence — each
    # only when not `None`.
    if fm.purpose is not None:
        lines.append(f"purpose: {_yaml_scalar(fm.purpose)}")
    if fm.task is not None:
        lines.append(f"task: {_yaml_scalar(fm.task)}")
    if fm.audience is not None:
        lines.append(f"audience: {_yaml_scalar(fm.audience)}")
    if fm.confidence is not None:
        lines.append(f"confidence: {_yaml_scalar(fm.confidence)}")
    if fm.resource is not None:
        lines.append(f"resource: {_yaml_scalar(fm.resource)}")
    if fm.tags:
        lines.append("tags:")
        for tag in fm.tags:
            lines.append(f"  - {_yaml_scalar(tag)}")
    else:
        lines.append("tags: []")
    if fm.sources:
        lines.append("sources:")
        for source in fm.sources:
            lines.append(f"  - id: {_yaml_scalar(source.id)}")
            lines.append(f"    resource: {_yaml_scalar(source.resource)}")
            if source.title is not None:
                lines.append(f"    title: {_yaml_scalar(source.title)}")
    lines.append("---")
    return "\n".join(lines) + "\n"


def emit_concept_frontmatter(
    *,
    type: str,
    title: str,
    description: str,
    generated_by: str,
    generated_at: "str | datetime",
    tags: "Sequence[str]" = (),
    resource: "str | None" = None,
    purpose: "str | None" = None,
    task: "str | None" = None,
    audience: "str | None" = None,
    confidence: "str | None" = None,
    sources: "Sequence[ConceptSource]" = (),
) -> str:
    """Convenience: `build_concept_frontmatter` + `render_concept_frontmatter`
    in one call."""
    fm = build_concept_frontmatter(
        type=type,
        title=title,
        description=description,
        generated_by=generated_by,
        generated_at=generated_at,
        tags=tags,
        resource=resource,
        purpose=purpose,
        task=task,
        audience=audience,
        confidence=confidence,
        sources=sources,
    )
    return render_concept_frontmatter(fm)
