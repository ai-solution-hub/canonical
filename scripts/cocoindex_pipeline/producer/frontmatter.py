"""Concept-frontmatter emitter — BI-12 (ID-132 {132.6} G-PASS1a).

Assembles and renders the YAML frontmatter block every OKF concept `.md`
file carries. Per PRODUCT.md §C invariant 12 (as amended by the S436/DR-019
decision board, `PRODUCT.md` §"S436 Amendments" item 1):

- **Required keys:** `type`, `title`, `description`, `timestamp`, plus
  `resource:` ("its primary record anchor where one exists" — optional) and
  `tags:` (always present, may be empty).
- **`timestamp` is ISO-8601** (DR-019) — NOT UK `DD/MM/YYYY`. The UK
  `DD/MM/YYYY` house rule applies to BUNDLE BODY PROSE only (the concept's
  markdown body, written by the Pass-1/Pass-2 agent loop — out of this
  emitter's scope, which covers the frontmatter block only). This module
  therefore validates/normalises `timestamp` as ISO-8601 and does NOT accept
  a `DD/MM/YYYY` form for it.
- **UK English** governs prose content (title/description text) supplied by
  the caller — this module does not author prose, only assembles/validates
  the structural frontmatter block.
- **BI-10 guard:** `type`/`title`/`description`/`tags` MUST NOT embed a
  Canonical record uuid or `canonical://` uri — `resource:` is the only
  frontmatter field permitted to carry one, and it must itself be a valid
  `canonical://` pointer built via `producer/resource_uri.py`.

Deliberately hand-rolled (no `pyyaml` dependency): PyYAML is not pinned in
`requirements.txt` (only resolves transitively in this environment), and the
frontmatter shape here is a small, fully-controlled subset — a general YAML
writer is not warranted. `render_concept_frontmatter` is a plain-scalar /
double-quoted-scalar emitter sufficient for agent-authored title/description
strings and our own uri/tag values; it is not a general-purpose YAML encoder.

`_needs_quoting` additionally double-quotes any plain scalar that a YAML-1.1
loader (e.g. PyYAML) would re-parse as bool/null/number/timestamp instead of
`str` (a title of `"NO"` or `"99.9"`) — and `timestamp` is ALWAYS
double-quoted unconditionally, regardless of `_needs_quoting`'s verdict
({132.7} S451 rider fold-in 1, fix option (a); TECH-ADDENDUM-reference-
agents.md retro-check on this module).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

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
class ConceptFrontmatter:
    """The validated, ready-to-render BI-12 frontmatter for one concept.

    `purpose`/`task`/`audience` (bl-456 routing hints) and `confidence`
    (bl-477 A19 vocabulary) are OPTIONAL fields added by the ID-132
    FRONTMATTER-WAVE shared-contract extension — see module docstring
    addendum below `derive_concept_confidence`. All four default to `None`
    (absent from the emitted frontmatter — `render_concept_frontmatter`)."""

    type: str
    title: str
    description: str
    timestamp: str  # ISO-8601 (DR-019)
    tags: "tuple[str, ...]" = ()
    resource: "str | None" = None
    purpose: "str | None" = None
    task: "str | None" = None
    audience: "str | None" = None
    confidence: "str | None" = None


# ──────────────────────────────────────────
# BI-6: the two `canonical://` resource forms `producer/resource_uri.py`
# actually emits. MOVED here from `producer/validator.py` (ID-132
# FRONTMATTER-WAVE, bl-477): `derive_concept_confidence` below needs to
# classify a concept's `resource` as a PER-ROW anchor, and `validator.py`
# already imports `ConceptFrontmatter` FROM this module — importing
# `is_valid_concept_resource_uri` the other way round would be a circular
# import. `validator.py` now imports it FROM here instead of defining it
# locally; `producer/enrich.py` and `producer/web_pass.py` ({132.42}'s
# files, out of this Subtask's scope) continue to import it from
# `producer.validator` unchanged (re-exported), so neither needs touching.
# ──────────────────────────────────────────
_PER_ROW_RESOURCE_RE = re.compile(
    r"^canonical://(?:source_documents|reference_items)/"
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_QA_PAIRS_QUERY_RESOURCE_RE = re.compile(
    r"^canonical://q_a_pairs\?(?:scope_tag=[^&]+|domain=[^&]+&subtopic=[^&]+)$"
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


# A19 (bl-477): the ratified confidence vocabulary — duplicated (not
# imported) in `producer/validator.py`'s own `_CONFIDENCE_VALUES` by design:
# "confidence, when supplied, is asserted to be in the A19 set (defence in
# depth alongside the validator)" (FRONTMATTER-WAVE.md). The two constants
# must be changed together if the vocabulary is ever amended.
_CONFIDENCE_VALUES = frozenset({"strong", "partial", "no-content", "needs-SME"})

# OQ-1 (FRONTMATTER-WAVE.md): the `strong` corroboration bar — a per-row
# `resource:` anchor AND at least this many distinct record-anchor
# citations. Named module constant so a later ratification change is
# one line.
_STRONG_CONFIDENCE_MIN_RECORD_ANCHORS = 2


def derive_concept_confidence(
    *, resource: "str | None", citations: "Sequence[str]"
) -> str:
    """A19 (bl-477) — the deterministic, NEVER model-authored
    confidence-setting rule (FRONTMATTER-WAVE.md §"Design — A19
    producer-drafted confidence-setting rule"). Computed by the producer at
    frontmatter-assembly time from draft-time grounding signals already
    resolved at the call site (`enrich_concept`, `_parse_reference_concept`,
    `run_web_pass`) — mirrors the existing discipline that `resource:` is
    builder-only, never model-authored (BI-6/BI-10).

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


def _normalise_timestamp(value: "str | datetime") -> str:
    """Validate/normalise `timestamp` to ISO-8601 (BI-12, DR-019).

    A timezone-aware `datetime` is converted to UTC and rendered with a `Z`
    suffix. A `str` is validated as parseable ISO-8601 (accepting a `Z`
    suffix) and returned unchanged — callers that already hold an
    ISO-formatted string (e.g. from a Postgres timestamp column) pass it
    straight through without a lossy re-format round-trip.
    """
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError(
                "timestamp datetime must be timezone-aware (BI-12/DR-019 "
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
                "timestamp must be ISO-8601 (BI-12, DR-019 amendment — UK "
                "DD/MM/YYYY is body-prose only, never the frontmatter "
                f"timestamp field); got {value!r}"
            ) from exc
        return value
    raise TypeError("timestamp must be a str or a timezone-aware datetime")


def build_concept_frontmatter(
    *,
    type: str,
    title: str,
    description: str,
    timestamp: "str | datetime",
    tags: "Sequence[str]" = (),
    resource: "str | None" = None,
    purpose: "str | None" = None,
    task: "str | None" = None,
    audience: "str | None" = None,
    confidence: "str | None" = None,
) -> ConceptFrontmatter:
    """Validate inputs and assemble the BI-12 frontmatter record.

    Raises `ValueError` on any missing required field, a non-ISO-8601
    `timestamp`, a `resource` that is not a `canonical://` pointer, any
    field embedding a Canonical record uuid outside `resource:` (BI-10 —
    including the bl-456 `purpose`/`task`/`audience` routing hints), or a
    `confidence` outside the A19 vocabulary (bl-477; defence in depth
    alongside `producer/validator.py`'s own membership check).
    """
    if not type or not type.strip():
        raise ValueError("type is required (BI-12)")
    if not title or not title.strip():
        raise ValueError("title is required (BI-12)")
    if not description or not description.strip():
        raise ValueError("description is required (BI-12)")

    ts = _normalise_timestamp(timestamp)

    fields = (("type", type), ("title", title), ("description", description))
    for label, value in fields:
        if contains_record_pointer(value):
            raise ValueError(
                f"{label} must not embed a Canonical record uuid/canonical:// "
                "uri — resource: and # Citations are the only ingress (BI-10)"
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
        if not is_canonical_resource_uri(resource):
            raise ValueError(
                "resource must be a canonical:// uri built via "
                f"producer/resource_uri.py (BI-6); got {resource!r}"
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
                "canonical:// uri — resource: and # Citations are the only "
                "ingress (BI-10)"
            )

    # bl-477 A19 confidence — defence in depth alongside the validator's own
    # `_CONFIDENCE_VALUES` membership check (`producer/validator.py`).
    if confidence is not None and confidence not in _CONFIDENCE_VALUES:
        raise ValueError(
            f"confidence must be one of {sorted(_CONFIDENCE_VALUES)} (A19); "
            f"got {confidence!r}"
        )

    return ConceptFrontmatter(
        type=type,
        title=title,
        description=description,
        timestamp=ts,
        tags=tag_tuple,
        resource=resource,
        purpose=purpose,
        task=task,
        audience=audience,
        confidence=confidence,
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


def render_concept_frontmatter(fm: ConceptFrontmatter) -> str:
    """Render `fm` to a `---`-delimited YAML frontmatter block, newline-
    terminated, ready to prepend to a concept's markdown body."""
    lines = ["---"]
    lines.append(f"type: {_yaml_scalar(fm.type)}")
    lines.append(f"title: {_yaml_scalar(fm.title)}")
    lines.append(f"description: {_yaml_scalar(fm.description)}")
    # {132.7} S451 rider fold-in 1, fix option (a): ALWAYS double-quote
    # timestamp (not merely when `_needs_quoting` fires) — the field is the
    # one place DR-019 requires strict machine-parseability, so it must
    # never depend on the ambiguity-pattern heuristic staying exhaustive.
    lines.append(f'timestamp: "{_yaml_escape(fm.timestamp)}"')
    # bl-456/bl-477 (FRONTMATTER-WAVE.md): fixed emission order for
    # deterministic output (BI-18 memo/diff stability) — purpose, task,
    # audience, confidence — each only when not `None`.
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
    lines.append("---")
    return "\n".join(lines) + "\n"


def emit_concept_frontmatter(
    *,
    type: str,
    title: str,
    description: str,
    timestamp: "str | datetime",
    tags: "Sequence[str]" = (),
    resource: "str | None" = None,
    purpose: "str | None" = None,
    task: "str | None" = None,
    audience: "str | None" = None,
    confidence: "str | None" = None,
) -> str:
    """Convenience: `build_concept_frontmatter` + `render_concept_frontmatter`
    in one call."""
    fm = build_concept_frontmatter(
        type=type,
        title=title,
        description=description,
        timestamp=timestamp,
        tags=tags,
        resource=resource,
        purpose=purpose,
        task=task,
        audience=audience,
        confidence=confidence,
    )
    return render_concept_frontmatter(fm)
