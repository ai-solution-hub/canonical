"""Bundle path scheme — concept-id <-> filesystem-path mapping.

Grain-agnostic path infra, styled directly on the OKF `reference_agent`
bundle package's `paths.py` (the size/style baseline for this package): a
concept id is a tuple of path segments; the last segment is the filename stem
(the `.md` suffix is added/removed at the boundary, never carried in the id).
"""

from __future__ import annotations

import re
from pathlib import Path

_SEGMENT_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.\-]*")

ConceptId = tuple[str, ...]


def _validate_segment(seg: str) -> None:
    if not _SEGMENT_RE.fullmatch(seg):
        raise ValueError(f"Invalid concept id segment: {seg!r}")


def concept_id_to_path(bundle_root: Path, concept_id: ConceptId) -> Path:
    """`("topics", "data-protection")` -> `<bundle_root>/topics/data-protection.md`."""
    if not concept_id:
        raise ValueError("concept_id must have at least one segment")
    for seg in concept_id:
        _validate_segment(seg)
    *dirs, name = concept_id
    return bundle_root.joinpath(*dirs, f"{name}.md")


def concept_id_to_rel_path(concept_id: ConceptId) -> str:
    """`("topics", "data-protection")` -> `"topics/data-protection.md"` (posix, bundle-relative)."""
    if not concept_id:
        raise ValueError("concept_id must have at least one segment")
    for seg in concept_id:
        _validate_segment(seg)
    return "/".join(concept_id[:-1] + (f"{concept_id[-1]}.md",))


def path_to_concept_id(bundle_root: Path, path: Path) -> ConceptId:
    rel = path.relative_to(bundle_root).with_suffix("")
    return tuple(rel.parts)


def parse_concept_id(s: str) -> ConceptId:
    parts = tuple(p for p in s.split("/") if p)
    if not parts:
        raise ValueError(f"Empty concept id: {s!r}")
    for p in parts:
        _validate_segment(p)
    return parts
