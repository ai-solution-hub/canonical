"""Folder→workspace manifest schema + resolver (PRODUCT Inv-4 / Inv-5).

The cocoindex form-extraction flow (TECH §2.1) reads a single JSON manifest
at the root of the ingest source folder
(`<COCOINDEX_SOURCE_PATH>/.kh-workspace-map.json`) once at flow start. This
module owns the manifest's Pydantic schema and the deterministic
folder→workspace resolution function used by Path B / Path C.

Public API:

- `WorkspaceMapping` — one `{path_prefix, workspace_id}` pair.
- `WorkspaceManifest` — versioned container of mappings.
- `ManifestLoadError` — raised on missing / unparseable / schema-invalid
  manifest; the flow aborts at start (TECH §2.1).
- `ResolutionFailure` — raised on unmapped or ambiguous `rel_path`; the
  form is recorded as a surfaced failure with zero `form_template_fields`
  rows (Inv-5: never silent default / sentinel).
- `load_workspace_manifest(path)` — parse + validate manifest file.
- `resolve_workspace(manifest, rel_path)` — longest-prefix-wins resolution.

Workspace UUIDs are NOT verified against the live `workspaces` table at
load time — FK enforcement at INSERT time surfaces stale UUIDs canonically
(TECH §2.1).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


# ──────────────────────────────────────────────────────────────────────────
# Exceptions
# ──────────────────────────────────────────────────────────────────────────


class ManifestLoadError(Exception):
    """Manifest missing, unparseable, or schema-invalid (TECH §2.1).

    Raised by `load_workspace_manifest`. The cocoindex flow translates
    this into a `manifest_missing` / `manifest_invalid` structured error
    via the existing flow-end webhook + `_emit_stage_error_log`.
    """


class ResolutionFailure(Exception):
    """A `rel_path` does not resolve to exactly one workspace (Inv-5).

    Raised by `resolve_workspace` when:
      - no manifest mapping prefixes the `rel_path` (unmapped), or
      - two or more equal-length manifest prefixes both match the
        `rel_path` (ambiguous).

    Per Inv-5, the form is recorded as a surfaced failure and produces
    zero `form_template_fields` rows. There is no sentinel workspace and
    no silent skip.
    """


# ──────────────────────────────────────────────────────────────────────────
# Pydantic models (Pydantic v2 — pinned via requirements.txt)
# ──────────────────────────────────────────────────────────────────────────


class WorkspaceMapping(BaseModel):
    """One `{path_prefix, workspace_id}` entry in the manifest."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path_prefix: str = Field(..., description="POSIX path prefix relative to ingest source root.")
    workspace_id: UUID = Field(..., description="Workspace UUID this prefix resolves to.")


class WorkspaceManifest(BaseModel):
    """Folder→workspace manifest, version-tagged (TECH §2.1).

    Validation rules (enforced at load time):
      - `schema_version` is required.
      - `mappings` is required (may be empty list — degenerate but legal;
        every path will then resolve to `ResolutionFailure`).
      - Duplicate identical `path_prefix` values across mappings are
        rejected — the canonical "ambiguous prefixes" trap (TECH §2.1).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: int = Field(..., description="Manifest schema version; currently 1.")
    mappings: list[WorkspaceMapping] = Field(..., description="Ordered list of prefix → workspace mappings.")

    @model_validator(mode="after")
    def _reject_duplicate_path_prefix(self) -> "WorkspaceManifest":
        seen: set[str] = set()
        duplicates: list[str] = []
        for mapping in self.mappings:
            if mapping.path_prefix in seen:
                duplicates.append(mapping.path_prefix)
            seen.add(mapping.path_prefix)
        if duplicates:
            raise ValueError(
                f"Duplicate path_prefix values in manifest: {sorted(set(duplicates))!r}"
            )
        return self


# ──────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────


def load_workspace_manifest(path: Path) -> WorkspaceManifest:
    """Load + validate a manifest JSON file at `path`.

    Raises `ManifestLoadError` on:
      - missing file,
      - unparseable JSON,
      - schema-validation failure (missing required field, duplicate
        `path_prefix`, malformed UUID, …).

    UUIDs are NOT verified against the live `workspaces` table — FK at
    INSERT time gives the canonical error (TECH §2.1).
    """
    if not path.exists():
        raise ManifestLoadError(f"Workspace manifest not found at {path!s}")

    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ManifestLoadError(f"Failed to read workspace manifest at {path!s}: {exc}") from exc

    try:
        payload: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ManifestLoadError(f"Workspace manifest at {path!s} is not valid JSON: {exc}") from exc

    try:
        return WorkspaceManifest.model_validate(payload)
    except ValidationError as exc:
        raise ManifestLoadError(f"Workspace manifest at {path!s} failed schema validation: {exc}") from exc


def resolve_workspace(manifest: WorkspaceManifest, rel_path: str) -> UUID:
    """Resolve `rel_path` to its owning workspace via longest-prefix match.

    Inputs:
      - `manifest`: a loaded `WorkspaceManifest`.
      - `rel_path`: the ingested file's path relative to
        `COCOINDEX_SOURCE_PATH`, already POSIX-normalised by
        `file.file_path.path.as_posix()` (TECH §2.1).

    Resolution rule (Inv-4 deterministic):
      - Select the manifest mapping whose `path_prefix` is the longest
        literal string that is a prefix of `rel_path`.
      - If two or more matching prefixes share that maximal length →
        `ResolutionFailure` (ambiguous).
      - If no mapping prefixes `rel_path` → `ResolutionFailure` (unmapped).

    Determinism is guaranteed by: input-only computation, no I/O, no
    mutation. Same `(manifest, rel_path)` yields the same `UUID` across
    calls and processes.
    """
    # Find every mapping whose `path_prefix` is a literal prefix of `rel_path`.
    matches: list[WorkspaceMapping] = [
        mapping for mapping in manifest.mappings if rel_path.startswith(mapping.path_prefix)
    ]

    if not matches:
        raise ResolutionFailure(
            f"No manifest mapping prefixes rel_path={rel_path!r} (Inv-5: unmapped path)"
        )

    # Longest-prefix wins; ties are ambiguous (Inv-5).
    max_length = max(len(m.path_prefix) for m in matches)
    longest = [m for m in matches if len(m.path_prefix) == max_length]

    if len(longest) > 1:
        prefixes = sorted({m.path_prefix for m in longest})
        raise ResolutionFailure(
            f"Ambiguous resolution for rel_path={rel_path!r}: "
            f"{len(longest)} mappings tie at length {max_length} ({prefixes!r})"
        )

    return longest[0].workspace_id


__all__ = [
    "ManifestLoadError",
    "ResolutionFailure",
    "WorkspaceManifest",
    "WorkspaceMapping",
    "load_workspace_manifest",
    "resolve_workspace",
]
