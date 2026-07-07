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
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

from scripts.cocoindex_pipeline.producer.resource_uri import (
    contains_record_pointer,
    is_canonical_resource_uri,
)

# Leading characters that force YAML double-quoting on a plain scalar.
_YAML_SPECIAL_LEADING_CHARS = set("-?:,[]{}#&*!|>'\"%@`")


@dataclass(frozen=True)
class ConceptFrontmatter:
    """The validated, ready-to-render BI-12 frontmatter for one concept."""

    type: str
    title: str
    description: str
    timestamp: str  # ISO-8601 (DR-019)
    tags: "tuple[str, ...]" = ()
    resource: "str | None" = None


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
) -> ConceptFrontmatter:
    """Validate inputs and assemble the BI-12 frontmatter record.

    Raises `ValueError` on any missing required field, a non-ISO-8601
    `timestamp`, a `resource` that is not a `canonical://` pointer, or any
    field embedding a Canonical record uuid outside `resource:` (BI-10).
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

    return ConceptFrontmatter(
        type=type,
        title=title,
        description=description,
        timestamp=ts,
        tags=tag_tuple,
        resource=resource,
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
    return False


def _yaml_scalar(value: str) -> str:
    if not _needs_quoting(value):
        return value
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def render_concept_frontmatter(fm: ConceptFrontmatter) -> str:
    """Render `fm` to a `---`-delimited YAML frontmatter block, newline-
    terminated, ready to prepend to a concept's markdown body."""
    lines = ["---"]
    lines.append(f"type: {_yaml_scalar(fm.type)}")
    lines.append(f"title: {_yaml_scalar(fm.title)}")
    lines.append(f"description: {_yaml_scalar(fm.description)}")
    lines.append(f"timestamp: {fm.timestamp}")
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
    )
    return render_concept_frontmatter(fm)
