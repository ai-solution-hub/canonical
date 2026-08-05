"""Python-side accessor for the corpus-manifest fixture register.

The register of record is ``docs/reference/testing/corpus-manifest.json``
(DR-118); the TS accessor is ``lib/corpus/fixture-manifest.ts`` /
``__tests__/integration/cocoindex/_helpers/fixtures.ts``. This module is the
Python accessor for the SAME file — resolve fixtures by manifest id, never by
a hand-built path (id-412 AC-11: the manifest is the register, accessors read
it, there is no third list).

Resolution is by ``id`` and returns the manifest's own ``path`` joined to the
repo root, so a future tree relocation is a manifest edit, not a per-test
segment hunt. Existence is asserted here with the manifest id in the message —
a missing file should name its register entry, not just a filesystem path.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_MANIFEST_PATH = _REPO_ROOT / "docs" / "reference" / "testing" / "corpus-manifest.json"


@lru_cache(maxsize=1)
def _fixture_paths_by_id() -> dict[str, str]:
    manifest = json.loads(_MANIFEST_PATH.read_text())
    return {entry["id"]: entry["path"] for entry in manifest["fixtures"]}


def fixture_path(fixture_id: str) -> Path:
    """Resolve a manifest fixture id to an absolute path, asserting it exists."""
    paths = _fixture_paths_by_id()
    if fixture_id not in paths:
        raise KeyError(
            f"fixture id {fixture_id!r} is not registered in {_MANIFEST_PATH} — "
            "register it there (id-406's artefact) before consuming it"
        )
    resolved = _REPO_ROOT / paths[fixture_id]
    assert resolved.exists(), (
        f"manifest fixture {fixture_id!r} resolves to {resolved}, which does not "
        "exist — the register and the tree have diverged"
    )
    return resolved
