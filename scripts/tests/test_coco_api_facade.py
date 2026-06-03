"""Import-smoke for the cocoindex-API façade (``_coco_api``).

Runs under REAL cocoindex 1.0.3 — NO stubbing. This is deliberate: the façade's
whole job is to resolve the eleven off-surface cocoindex symbols, so the smoke
test exercises real lazy resolution against the installed package. Keeping it a
plain pytest module (no ``cocoindex`` MagicMock) is what makes the version-pin
and lazy-resolution assertions meaningful.

The version-pin assertion gates upgrades: bumping cocoindex away from 1.0.3
fails here first, forcing a deliberate review of ``_coco_api._SYMBOL_SOURCES``
against the new surface before the bump can land.
"""

from __future__ import annotations

import pytest

import scripts.cocoindex_pipeline._coco_api as api

# The twelve symbols the pipeline depends on, per the {67.4} brief plus the
# {81.5} addition of ``ExistingCanonicalPolicy`` (Stage-5 cross-run canonical
# stability — TECH §PC-FACADE).
_FACADE_SYMBOLS = (
    "localfs",
    "ColumnDef",
    "TableSchema",
    "mount_table_target",
    "ManagedBy",
    "FileLike",
    "LiteLLMEmbedder",
    "RecursiveSplitter",
    "resolve_entities",
    "ResolvedEntities",
    "PairDecision",
    "ExistingCanonicalPolicy",
)


def test_cocoindex_version_pinned() -> None:
    """Gate upgrades: the façade is verified against cocoindex==1.0.3 only.

    A version bump must fail here first so ``_SYMBOL_SOURCES`` is re-verified
    against the new surface before the bump lands.
    """
    try:
        import cocoindex  # noqa: PLC0415

        version = getattr(cocoindex, "__version__", None)
    except Exception:  # pragma: no cover — import guard
        version = None
    if version is None:
        import importlib.metadata  # noqa: PLC0415

        version = importlib.metadata.version("cocoindex")
    assert version == "1.0.3", (
        f"cocoindex pinned to 1.0.3 for the _coco_api façade; saw {version!r}. "
        "Re-verify _coco_api._SYMBOL_SOURCES against the new surface before bumping."
    )


@pytest.mark.parametrize("name", _FACADE_SYMBOLS)
def test_facade_symbol_resolves(name: str) -> None:
    """Each façade symbol lazily resolves to a non-None real cocoindex object."""
    resolved = getattr(api, name)
    assert resolved is not None, f"_coco_api.{name} resolved to None"


def test_all_lists_every_symbol() -> None:
    """``__all__`` enumerates exactly the twelve façade symbols."""
    assert set(api.__all__) == set(_FACADE_SYMBOLS)
    assert len(api.__all__) == len(_FACADE_SYMBOLS) == 12


def test_unknown_attribute_raises() -> None:
    """An unknown attribute access raises AttributeError per PEP 562."""
    with pytest.raises(AttributeError):
        _ = api.NotAFacadeSymbol
