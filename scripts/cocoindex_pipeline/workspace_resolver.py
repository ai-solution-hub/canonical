"""Folder→workspace manifest schema + resolver (PRODUCT Inv-4 / Inv-5).

The cocoindex form-extraction flow (TECH §2.1) reads a single JSON manifest
at the root of the ingest source folder
(`<COCOINDEX_SOURCE_PATH>/.kh-workspace-map.json`) once at flow start. This
module owns the manifest's Pydantic schema and the deterministic
folder→workspace resolution function used by Path B / Path C.

Public API:

- `RouteKind` — `Literal["content", "forms", "qa_sidecar"]` route
  discriminator (ID-80.6, 80.2 §B.2: the manifest per-prefix route tag IS the
  Path-A/Path-B fork point — RATIFIED OQ-80.2-B; ID-59 {59.26} adds the
  `"qa_sidecar"` route for the frozen `__qa__/` reserved prefix).
- `WorkspaceMapping` — one `{path_prefix, workspace_id, route}` entry
  (`route` defaults to `"content"` — existing manifests parse unchanged).
- `WorkspaceManifest` — versioned container of mappings.
- `Resolution` — frozen `{workspace_id, route}` pair returned by
  `resolve_route`.
- `ManifestLoadError` — raised on missing / unparseable / schema-invalid
  manifest; the flow aborts at start (TECH §2.1).
- `ResolutionFailure` — base class for unmapped / ambiguous `rel_path`.
- `UnmappedPath` — `ResolutionFailure` subclass: no manifest prefix
  matches `rel_path`. OBSERVABILITY-ONLY for localfs file content — the
  workspace-agnostic canonical content already wrote (ID-69 BI-1), so the
  flow soft-warns and continues (bl-219). Not a `cocoindex.stage_error`.
- `AmbiguousResolution` — `ResolutionFailure` subclass: two or more
  equal-length manifest prefixes tie. A genuine manifest mis-wire — the
  flow surfaces it as a loud structured stage error (Inv-5: never silent
  default / sentinel).
- `load_workspace_manifest(path)` — parse + validate manifest file.
- `resolve_route(manifest, rel_path)` — longest-prefix-wins resolution
  returning BOTH the owning workspace and its route (the fork entry point).
- `resolve_workspace(manifest, rel_path)` — thin shim over `resolve_route`
  returning only the workspace UUID (kept for existing callers).

Workspace UUIDs are NOT verified against the live `workspaces` table at
load time — FK enforcement at INSERT time surfaces stale UUIDs canonically
(TECH §2.1).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

# Route discriminator (ID-80.6, 80.2 §B.2 — RATIFIED OQ-80.2-B): the manifest
# per-prefix `route` tag is the Path-A (content) / Path-B (forms) / Q&A-sidecar
# fork point. `Literal` + `extra="forbid"` make any typo a load-time
# `ValidationError` → `ManifestLoadError` at the manifest-load gate (loud abort
# at flow start).
#
# ID-59 {59.26} (TECH-qa-sidecar P1): `"qa_sidecar"` is the third route — a
# manifest mapping `{path_prefix: "__qa__/", route: "qa_sidecar"}` routes a
# reserved-prefix Q&A sidecar to the sidecar branch (source_documents + the
# q_a_extractions tier ONLY; ZERO content rows — PRODUCT INV-5). The `__qa__/`
# prefix string is FROZEN against this route (ID-45 {45.3} freezes it).
# `resolve_route` needs NO change: it returns `winner.route` verbatim, so a
# `"qa_sidecar"` mapping forks by longest-prefix exactly like `"forms"`.
RouteKind = Literal["content", "forms", "qa_sidecar"]


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
    """Base class: a `rel_path` does not resolve to exactly one workspace.

    Raised (via its two subclasses) by `resolve_route` (and its
    `resolve_workspace` shim) when:
      - no manifest mapping prefixes the `rel_path` (`UnmappedPath`), or
      - two or more equal-length manifest prefixes both match the
        `rel_path` (`AmbiguousResolution`).

    Kept as the catchable base so existing `except ResolutionFailure`
    handlers and `pytest.raises(ResolutionFailure)` callers continue to
    work. In all cases the form produces zero `form_template_fields`
    rows: there is no sentinel workspace and no silent skip (Inv-5).
    """


class UnmappedPath(ResolutionFailure):
    """No manifest prefix matches `rel_path` (benign for file content).

    For localfs file content (md/pdf/docx) this is OBSERVABILITY-ONLY:
    the workspace-agnostic canonical layer (content_items / source_documents
    / chunks / q_a / entity_mentions) already wrote ABOVE the form-resolution
    block (ID-69 BI-1), and the pipeline invocation does NOT fail. The flow
    soft-warns and continues — it does NOT emit a `cocoindex.stage_error`
    (Inv-26: that event is the companion to a *failed* invocation). bl-219.
    """


class AmbiguousResolution(ResolutionFailure):
    """Two or more equal-length manifest prefixes tie on `rel_path`.

    Unlike `UnmappedPath`, this is a genuine manifest mis-wire — the
    folder→workspace map cannot deterministically assign an owner. The
    flow surfaces it as a loud structured `cocoindex.stage_error`
    (Inv-5: never silent default / sentinel).
    """


# ──────────────────────────────────────────────────────────────────────────
# Pydantic models (Pydantic v2 — pinned via requirements.txt)
# ──────────────────────────────────────────────────────────────────────────


class WorkspaceMapping(BaseModel):
    """One `{path_prefix, workspace_id, route}` entry in the manifest.

    `route` defaults to `"content"` (80.2 §B.2): existing manifests — and the
    id-52 fixtures — parse unchanged and every current prefix stays on Path-A.
    Zero behaviour change until an operator opts a prefix into `"forms"`.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    path_prefix: str = Field(..., description="POSIX path prefix relative to ingest source root.")
    workspace_id: UUID = Field(..., description="Workspace UUID this prefix resolves to.")
    route: RouteKind = Field(
        default="content",
        description="Fork discriminator: 'content' (Path-A, default), 'forms' (Path-B blank form instruments), or 'qa_sidecar' (ID-59 {59.26} reserved __qa__/ Q&A sidecars).",
    )


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
# Resolution result
# ──────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Resolution:
    """Result of `resolve_route`: the owning workspace AND its route.

    The `route` carries the Path-A/Path-B fork decision (80.2 §B.2) so the
    flow computes the fork ONCE, BEFORE either write path runs.
    """

    workspace_id: UUID
    route: RouteKind


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


def resolve_route(manifest: WorkspaceManifest, rel_path: str) -> Resolution:
    """Resolve `rel_path` to its owning workspace AND route (longest-prefix).

    The single fork entry point (ID-80.6, 80.2 §B.2): returns the winning
    mapping's `workspace_id` and its `route` tag so the flow computes the
    Path-A/Path-B fork once, before either write path runs.

    Inputs:
      - `manifest`: a loaded `WorkspaceManifest`.
      - `rel_path`: the ingested file's path relative to
        `COCOINDEX_SOURCE_PATH`, already POSIX-normalised by
        `file.file_path.path.as_posix()` (TECH §2.1).

    Resolution rule (Inv-4 deterministic):
      - Select the manifest mapping whose `path_prefix` is the longest
        literal string that is a prefix of `rel_path`.
      - If two or more matching prefixes share that maximal length →
        `AmbiguousResolution` (a `ResolutionFailure` subclass).
      - If no mapping prefixes `rel_path` → `UnmappedPath` (a
        `ResolutionFailure` subclass).

    The exception contract is identical to the historical
    `resolve_workspace` — same `UnmappedPath` / `AmbiguousResolution`
    subclasses of `ResolutionFailure` (unchanged contract, 80.2 §B.2).

    Determinism is guaranteed by: input-only computation, no I/O, no
    mutation. Same `(manifest, rel_path)` yields the same `Resolution`
    across calls and processes.
    """
    # Find every mapping whose `path_prefix` is a literal prefix of `rel_path`.
    matches: list[WorkspaceMapping] = [
        mapping for mapping in manifest.mappings if rel_path.startswith(mapping.path_prefix)
    ]

    if not matches:
        raise UnmappedPath(
            f"No manifest mapping prefixes rel_path={rel_path!r} (Inv-5: unmapped path)"
        )

    # Longest-prefix wins; ties are ambiguous (Inv-5).
    max_length = max(len(m.path_prefix) for m in matches)
    longest = [m for m in matches if len(m.path_prefix) == max_length]

    if len(longest) > 1:
        prefixes = sorted({m.path_prefix for m in longest})
        raise AmbiguousResolution(
            f"Ambiguous resolution for rel_path={rel_path!r}: "
            f"{len(longest)} mappings tie at length {max_length} ({prefixes!r})"
        )

    winner = longest[0]
    return Resolution(workspace_id=winner.workspace_id, route=winner.route)


def resolve_workspace(manifest: WorkspaceManifest, rel_path: str) -> UUID:
    """Resolve `rel_path` to its owning workspace via longest-prefix match.

    Thin shim over `resolve_route` (80.2 §B.2): returns only the workspace
    UUID so existing callers keep working unchanged. Raises the same
    `UnmappedPath` / `AmbiguousResolution` subclasses — see `resolve_route`
    for the full resolution contract.
    """
    return resolve_route(manifest, rel_path).workspace_id


__all__ = [
    "AmbiguousResolution",
    "ManifestLoadError",
    "Resolution",
    "ResolutionFailure",
    "RouteKind",
    "UnmappedPath",
    "WorkspaceManifest",
    "WorkspaceMapping",
    "load_workspace_manifest",
    "resolve_route",
    "resolve_workspace",
]
