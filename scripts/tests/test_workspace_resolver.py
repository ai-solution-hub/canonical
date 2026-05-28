"""Unit tests for `scripts/cocoindex_pipeline/workspace_resolver`.

Covers the {52.8} acceptance contract (PLAN §Phase 3, TECH §2.1, PRODUCT
Inv-4 / Inv-5):

1. Pydantic schema rejects manifest missing `schema_version`.
2. Pydantic schema rejects manifest missing `mappings`.
3. Pydantic schema rejects manifest with duplicate identical `path_prefix`.
4. `resolve_workspace` returns mapped UUID for known prefix.
5. Same call returns SAME UUID on repeat (deterministic, Inv-4).
6. Unmapped path → `ResolutionFailure` (NOT a default, Inv-5).
7. Ambiguous (equal-length matching prefixes) → `ResolutionFailure`.
8. Longest-prefix wins (`acme-bids/2026/` beats `acme-bids/` for
   `acme-bids/2026/foo.pdf`).
9. Missing manifest file → `ManifestLoadError`.
10. Unparseable JSON → `ManifestLoadError`.
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

import pytest

from scripts.cocoindex_pipeline.workspace_resolver import (
    ManifestLoadError,
    ResolutionFailure,
    WorkspaceManifest,
    WorkspaceMapping,
    load_workspace_manifest,
    resolve_workspace,
)

# ──────────────────────────────────────────────────────────────────────────
# Canonical UUIDs (v4-compliant) used across the suite.
# ──────────────────────────────────────────────────────────────────────────

example-client_UUID = UUID("11111111-1111-4111-8111-111111111111")
ACME_UUID = UUID("22222222-2222-4222-8222-222222222222")
ACME_2026_UUID = UUID("33333333-3333-4333-8333-333333333333")
OTHER_UUID = UUID("44444444-4444-4444-8444-444444444444")


def _write_manifest(tmp_path: Path, payload: dict | str) -> Path:
    """Write a manifest JSON file at `tmp_path/.kh-workspace-map.json`."""
    manifest_path = tmp_path / ".kh-workspace-map.json"
    if isinstance(payload, str):
        manifest_path.write_text(payload, encoding="utf-8")
    else:
        manifest_path.write_text(json.dumps(payload), encoding="utf-8")
    return manifest_path


# ──────────────────────────────────────────────────────────────────────────
# (1)-(3) Pydantic schema validation
# ──────────────────────────────────────────────────────────────────────────


def test_schema_rejects_missing_schema_version(tmp_path: Path) -> None:
    """Inv-4: manifest without `schema_version` must fail at load time."""
    manifest_path = _write_manifest(
        tmp_path,
        {
            "mappings": [
                {"path_prefix": "example-client-procurement/", "workspace_id": str(example-client_UUID)},
            ],
        },
    )
    with pytest.raises(ManifestLoadError):
        load_workspace_manifest(manifest_path)


def test_schema_rejects_missing_mappings(tmp_path: Path) -> None:
    """Manifest without `mappings` key must fail at load time."""
    manifest_path = _write_manifest(tmp_path, {"schema_version": 1})
    with pytest.raises(ManifestLoadError):
        load_workspace_manifest(manifest_path)


def test_schema_rejects_duplicate_path_prefix(tmp_path: Path) -> None:
    """Duplicate identical `path_prefix` values → ManifestLoadError."""
    manifest_path = _write_manifest(
        tmp_path,
        {
            "schema_version": 1,
            "mappings": [
                {"path_prefix": "acme-bids/", "workspace_id": str(ACME_UUID)},
                {"path_prefix": "acme-bids/", "workspace_id": str(OTHER_UUID)},
            ],
        },
    )
    with pytest.raises(ManifestLoadError):
        load_workspace_manifest(manifest_path)


# ──────────────────────────────────────────────────────────────────────────
# (4)-(5) Mapped resolution + determinism
# ──────────────────────────────────────────────────────────────────────────


def _build_manifest(mappings: list[tuple[str, UUID]]) -> WorkspaceManifest:
    """Construct a WorkspaceManifest from `[(prefix, uuid), …]`."""
    return WorkspaceManifest.model_validate(
        {
            "schema_version": 1,
            "mappings": [
                {"path_prefix": prefix, "workspace_id": str(uuid)}
                for prefix, uuid in mappings
            ],
        }
    )


def test_resolve_returns_mapped_uuid_for_known_prefix() -> None:
    """Inv-4: known prefix → mapped workspace UUID."""
    manifest = _build_manifest(
        [
            ("example-client-procurement/", example-client_UUID),
            ("acme-bids/", ACME_UUID),
        ]
    )
    result = resolve_workspace(manifest, "example-client-procurement/SQ.pdf")
    assert result == example-client_UUID


def test_resolve_is_deterministic_on_repeat() -> None:
    """Inv-4: same `(manifest, rel_path)` yields same UUID across calls."""
    manifest = _build_manifest(
        [
            ("example-client-procurement/", example-client_UUID),
            ("acme-bids/", ACME_UUID),
        ]
    )
    rel_path = "example-client-procurement/sub/dir/SQ.pdf"
    first = resolve_workspace(manifest, rel_path)
    second = resolve_workspace(manifest, rel_path)
    third = resolve_workspace(manifest, rel_path)
    assert first == second == third == example-client_UUID


# ──────────────────────────────────────────────────────────────────────────
# (6) Unmapped path → ResolutionFailure (NOT default; Inv-5)
# ──────────────────────────────────────────────────────────────────────────


def test_resolve_unmapped_path_raises_resolution_failure() -> None:
    """Inv-5: unmapped path raises ResolutionFailure — never silent default."""
    manifest = _build_manifest([("example-client-procurement/", example-client_UUID)])
    with pytest.raises(ResolutionFailure):
        resolve_workspace(manifest, "unmapped/X.pdf")


# ──────────────────────────────────────────────────────────────────────────
# (7) Ambiguous resolution → ResolutionFailure
# ──────────────────────────────────────────────────────────────────────────


def test_resolve_ambiguous_equal_length_prefixes_raises_resolution_failure() -> None:
    """Two equal-length prefixes both matching the rel_path → ResolutionFailure.

    TECH §2.1: "Ambiguous prefixes (two mappings of equal length) → resolution
    failure (Inv-5: never silent default)."

    Geometric note: for two DISTINCT prefixes of equal length to both literally
    prefix the same `rel_path`, they would have to be identical — which the
    load validator rejects (see test 3). The defensive resolver contract still
    rejects equal-length ties if they ever reach the resolver. We exercise the
    branch by constructing a manifest whose two longest matching prefixes are
    equal-length — achievable via the only escape hatch: two distinct prefixes
    that happen to alias when normalised. Since the spec does not require
    normalisation, we construct the test using sibling root-segment prefixes
    that BOTH select different mappings, but rely on the resolver's internal
    tie-detection. The simplest direct cover: empty-string prefix collides
    with any other prefix on a `rel_path` that the other prefix also matches.
    The resolver MUST treat the empty-prefix collision as ambiguous regardless
    of whether the load validator permits empty prefixes.
    """
    # If the load validator permits empty prefixes, the resolver must surface
    # the empty-prefix collision as ambiguous on any matching rel_path. Use
    # `model_construct` to bypass validators and exercise the defensive
    # resolver branch directly.
    manifest = WorkspaceManifest.model_construct(
        schema_version=1,
        mappings=[
            WorkspaceMapping.model_construct(
                path_prefix="x/", workspace_id=ACME_UUID
            ),
            WorkspaceMapping.model_construct(
                path_prefix="x/", workspace_id=OTHER_UUID
            ),
        ],
    )
    with pytest.raises(ResolutionFailure):
        resolve_workspace(manifest, "x/foo.pdf")


# ──────────────────────────────────────────────────────────────────────────
# (8) Longest-prefix wins
# ──────────────────────────────────────────────────────────────────────────


def test_longest_prefix_wins() -> None:
    """`acme-bids/2026/` beats `acme-bids/` for `acme-bids/2026/foo.pdf`."""
    manifest = _build_manifest(
        [
            ("acme-bids/", ACME_UUID),
            ("acme-bids/2026/", ACME_2026_UUID),
        ]
    )
    result = resolve_workspace(manifest, "acme-bids/2026/foo.pdf")
    assert result == ACME_2026_UUID


def test_longest_prefix_wins_regardless_of_mapping_order() -> None:
    """Ordering of manifest mappings must not affect longest-prefix outcome."""
    manifest_forward = _build_manifest(
        [
            ("acme-bids/", ACME_UUID),
            ("acme-bids/2026/", ACME_2026_UUID),
        ]
    )
    manifest_reverse = _build_manifest(
        [
            ("acme-bids/2026/", ACME_2026_UUID),
            ("acme-bids/", ACME_UUID),
        ]
    )
    rel_path = "acme-bids/2026/foo.pdf"
    assert (
        resolve_workspace(manifest_forward, rel_path)
        == resolve_workspace(manifest_reverse, rel_path)
        == ACME_2026_UUID
    )


def test_shorter_prefix_resolves_when_longer_does_not_match() -> None:
    """`acme-bids/` resolves for `acme-bids/2025/foo.pdf` when no 2025 entry."""
    manifest = _build_manifest(
        [
            ("acme-bids/", ACME_UUID),
            ("acme-bids/2026/", ACME_2026_UUID),
        ]
    )
    result = resolve_workspace(manifest, "acme-bids/2025/foo.pdf")
    assert result == ACME_UUID


# ──────────────────────────────────────────────────────────────────────────
# (9)-(10) Manifest load errors
# ──────────────────────────────────────────────────────────────────────────


def test_missing_manifest_file_raises_manifest_load_error(tmp_path: Path) -> None:
    """Missing file → ManifestLoadError (flow aborts at start, TECH §2.1)."""
    missing_path = tmp_path / ".kh-workspace-map.json"
    assert not missing_path.exists()
    with pytest.raises(ManifestLoadError):
        load_workspace_manifest(missing_path)


def test_unparseable_json_raises_manifest_load_error(tmp_path: Path) -> None:
    """Unparseable JSON → ManifestLoadError."""
    manifest_path = _write_manifest(tmp_path, "{ this is not json")
    with pytest.raises(ManifestLoadError):
        load_workspace_manifest(manifest_path)


# ──────────────────────────────────────────────────────────────────────────
# Round-trip: write a manifest, load it, resolve through it.
# ──────────────────────────────────────────────────────────────────────────


def test_load_and_resolve_round_trip(tmp_path: Path) -> None:
    """End-to-end: a well-formed manifest loads + resolves correctly."""
    manifest_path = _write_manifest(
        tmp_path,
        {
            "schema_version": 1,
            "mappings": [
                {"path_prefix": "example-client-procurement/", "workspace_id": str(example-client_UUID)},
                {"path_prefix": "acme-bids/", "workspace_id": str(ACME_UUID)},
                {
                    "path_prefix": "acme-bids/2026/",
                    "workspace_id": str(ACME_2026_UUID),
                },
            ],
        },
    )
    manifest = load_workspace_manifest(manifest_path)
    assert resolve_workspace(manifest, "example-client-procurement/SQ.pdf") == example-client_UUID
    assert resolve_workspace(manifest, "acme-bids/foo.pdf") == ACME_UUID
    assert resolve_workspace(manifest, "acme-bids/2026/foo.pdf") == ACME_2026_UUID
    with pytest.raises(ResolutionFailure):
        resolve_workspace(manifest, "unmapped/X.pdf")
