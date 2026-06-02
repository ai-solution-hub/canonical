"""Private cocoindex-API façade — single insulation layer for the pipeline.

cocoindex 1.0.3 exposes the symbols this pipeline depends on OUTSIDE its
documented top-level surface: ``'ops' not in dir(cocoindex)``, and connectors /
connectorkits / resources live in sub-packages that the top-level package does
not re-export. A version bump that reshuffles ``ops.*`` / ``connectors.*`` would
otherwise be a scatter-edit across five pipeline modules. This module
concentrates every off-surface import into ONE place so a future bump is a
one-file fix.

Pinned version: ``cocoindex==1.0.3`` (see ``requirements.txt`` and the
version-pin assertion in ``scripts/tests/test_coco_api_facade.py``, which gates
upgrades). The eleven re-exported symbols and their real 1.0.3 sources are
listed in ``_SYMBOL_SOURCES`` below.

WHY LAZY (PEP 562 module ``__getattr__``)
-----------------------------------------
The pipeline's unit tests stub a BARE ``cocoindex`` MagicMock WITHOUT
registering the ``cocoindex.ops`` subtree. That is exactly why
``cocoindex.ops.litellm`` / ``cocoindex.ops.text`` /
``cocoindex.ops.entity_resolution`` are imported FUNCTION-LOCALLY by the
consumers today. An EAGER top-level ``from cocoindex.ops.* import ...`` anywhere
on a module-import path would break those tests' collection.

Therefore importing this module triggers NO cocoindex import. Each symbol
resolves its real source only on first attribute access, via PEP 562
``__getattr__`` (``importlib.import_module(path)`` then ``getattr(module,
attr)``). The ``TYPE_CHECKING`` block below carries the real ``from cocoindex...
import ...`` lines so static type-checkers and IDEs still see the symbols
without paying the runtime import cost.

USAGE
-----
Consumers import the symbols they need from this module instead of reaching into
the cocoindex sub-packages directly::

    from scripts.cocoindex_pipeline._coco_api import localfs, ManagedBy
    from scripts.cocoindex_pipeline._coco_api import LiteLLMEmbedder  # function-local

Function-local imports in the consumers STAY function-local — the façade does
not hoist them; it only relocates the source from ``cocoindex.ops.*`` to here so
the collection-safety property (no eager cocoindex import) is preserved end to
end.
"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING

# name -> (module_path, attr). ``attr is None`` means the symbol IS the module
# itself (e.g. ``localfs`` is the submodule ``cocoindex.connectors.localfs``,
# accessed by consumers as ``localfs.walk_dir(...)``), so __getattr__ returns
# the imported module rather than an attribute off it.
_SYMBOL_SOURCES: dict[str, tuple[str, str | None]] = {
    # cocoindex.connectors — localfs is a submodule, not an attribute
    "localfs": ("cocoindex.connectors.localfs", None),
    # cocoindex.connectors.postgres
    "ColumnDef": ("cocoindex.connectors.postgres", "ColumnDef"),
    "TableSchema": ("cocoindex.connectors.postgres", "TableSchema"),
    "mount_table_target": ("cocoindex.connectors.postgres", "mount_table_target"),
    # cocoindex.connectorkits.target
    "ManagedBy": ("cocoindex.connectorkits.target", "ManagedBy"),
    # cocoindex.resources.file
    "FileLike": ("cocoindex.resources.file", "FileLike"),
    # cocoindex.ops.litellm
    "LiteLLMEmbedder": ("cocoindex.ops.litellm", "LiteLLMEmbedder"),
    # cocoindex.ops.text
    "RecursiveSplitter": ("cocoindex.ops.text", "RecursiveSplitter"),
    # cocoindex.ops.entity_resolution
    "resolve_entities": ("cocoindex.ops.entity_resolution", "resolve_entities"),
    "ResolvedEntities": ("cocoindex.ops.entity_resolution", "ResolvedEntities"),
    "PairDecision": ("cocoindex.ops.entity_resolution", "PairDecision"),
}

__all__ = [
    "ColumnDef",
    "FileLike",
    "LiteLLMEmbedder",
    "ManagedBy",
    "PairDecision",
    "RecursiveSplitter",
    "ResolvedEntities",
    "TableSchema",
    "localfs",
    "mount_table_target",
    "resolve_entities",
]


def __getattr__(name: str) -> object:
    """PEP 562 lazy re-export — resolve a façade symbol on first access.

    Importing this module imports NO cocoindex; resolution is deferred to the
    first attribute access so module-import-time stays free of the
    ``cocoindex.ops`` subtree (collection-safety for the bare-MagicMock unit
    tests). Unknown names raise ``AttributeError`` per the protocol.
    """
    source = _SYMBOL_SOURCES.get(name)
    if source is None:
        raise AttributeError(
            f"module {__name__!r} has no attribute {name!r}"
        )
    module_path, attr = source
    module = import_module(module_path)
    if attr is None:
        return module
    return getattr(module, attr)


def __dir__() -> list[str]:
    """Expose the façade surface to ``dir()`` / autocompletion."""
    return sorted(set(__all__) | set(globals()))


if TYPE_CHECKING:  # pragma: no cover — static-analysis-only real imports
    from cocoindex.connectors import localfs
    from cocoindex.connectors.postgres import (
        ColumnDef,
        TableSchema,
        mount_table_target,
    )
    from cocoindex.connectorkits.target import ManagedBy
    from cocoindex.ops.entity_resolution import (
        PairDecision,
        ResolvedEntities,
        resolve_entities,
    )
    from cocoindex.ops.litellm import LiteLLMEmbedder
    from cocoindex.ops.text import RecursiveSplitter
    from cocoindex.resources.file import FileLike
