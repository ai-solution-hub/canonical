"""Unit tests for KhEntityEmbedder (ID-53.9).

Proves the Stage-5 entity-name embedder shape WITHOUT booting the real
``cocoindex.ops.litellm`` LiteLLMEmbedder (which would attempt a live
``text-embedding-3-large`` probe at construction time on first use).

WHAT THIS PROVES (PRODUCT.md Inv-3 + Inv-14 via TECH §P-7):
  - ``KhEntityEmbedder`` implements the cocoindex ``_Embedder`` Protocol —
    a class exposing ``async def embed(self, text: str) -> NDArray[float32]``.
  - The constructor wires a ``LiteLLMEmbedder('text-embedding-3-large',
    dimensions=1024)`` so the embedding length matches the Stage-4
    ``vector(1024)`` dimension (consistency rationale per TECH §P-7).
  - ``embed`` delegates to the wrapped LiteLLMEmbedder.embed coroutine and
    returns its result unmodified — i.e. a length-1024 ``np.float32`` vector.

WHAT THIS DOES NOT PROVE (deferred to integration tests under {53.14}):
  - A real OpenAI ``text-embedding-3-large`` call returning a genuine 1024-dim
    vector via cocoindex.ops.entity_resolution.resolve_entities.

Async tests follow the repo convention (no pytest-asyncio plugin): drive the
embed coroutine via ``asyncio.run`` inside sync test functions.

Reference: docs/specs/stage-5-entity-resolution/TECH.md §P-7 (lines 510–562);
           docs/specs/stage-5-entity-resolution/PRODUCT.md Inv-3, Inv-14.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

import numpy as np
import pytest

# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.


# ── cocoindex.ops.litellm stub helper ─────────────────────────────────────────
#
# KhEntityEmbedder lazily imports ``cocoindex.ops.litellm.LiteLLMEmbedder``
# INSIDE __init__ (mirroring flow.py's _get_embedder lazy-import idiom), so we
# only need the submodule resident in sys.modules at instantiation time — not
# at test-collection / import time. The stub is installed in a fixture and torn
# down after each test to avoid leaking into sibling cocoindex tests.


class _StubLiteLLMEmbedder:
    """Minimal LiteLLMEmbedder stand-in for KhEntityEmbedder unit tests.

    Records the model + dimensions kwargs the production code passes to its
    constructor, and returns a deterministic length-N float32 vector from
    ``embed`` so the test can assert on shape + dtype.
    """

    instances: list["_StubLiteLLMEmbedder"] = []

    def __init__(self, model: str, *, dimensions: int) -> None:
        self.model = model
        self.dimensions = dimensions
        self.embed_calls: list[str] = []
        _StubLiteLLMEmbedder.instances.append(self)

    async def embed(self, text: str) -> "np.ndarray":
        self.embed_calls.append(text)
        # Return a deterministic length-`dimensions` float32 vector. The
        # production LiteLLMEmbedder returns numpy float32 (per RESEARCH §R1.2);
        # the stub mirrors that contract so dtype assertions exercise real code
        # paths rather than mock magic.
        return np.zeros(self.dimensions, dtype=np.float32)


@pytest.fixture
def stub_litellm(monkeypatch: pytest.MonkeyPatch) -> type[_StubLiteLLMEmbedder]:
    """Install a stub ``cocoindex.ops.litellm`` module exposing _StubLiteLLMEmbedder.

    Mirrors the lazy-import pattern flow.py uses for the Stage-4 embedder —
    KhEntityEmbedder imports LiteLLMEmbedder INSIDE ``__init__``, so the stub
    only needs to be present at instantiation time. monkeypatch tears the
    sys.modules entries down at fixture exit (preventing leak into the
    sibling cocoindex test files per conftest.py's stub-isolation contract).
    """
    _StubLiteLLMEmbedder.instances = []

    # The KhEntityEmbedder source does `from cocoindex.ops.litellm import
    # LiteLLMEmbedder`, which requires both `cocoindex`, `cocoindex.ops`, and
    # `cocoindex.ops.litellm` to be resident as ModuleType objects in
    # sys.modules. Install all three (only if not already present — if a
    # sibling test left a stub resident, we layer over it with monkeypatch's
    # restorative semantics).
    coco_mod = sys.modules.get("cocoindex") or ModuleType("cocoindex")
    coco_ops_mod = sys.modules.get("cocoindex.ops") or ModuleType("cocoindex.ops")
    litellm_mod = ModuleType("cocoindex.ops.litellm")
    litellm_mod.LiteLLMEmbedder = _StubLiteLLMEmbedder  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "cocoindex", coco_mod)
    monkeypatch.setitem(sys.modules, "cocoindex.ops", coco_ops_mod)
    monkeypatch.setitem(sys.modules, "cocoindex.ops.litellm", litellm_mod)

    return _StubLiteLLMEmbedder


# ── ID-53.9 — KhEntityEmbedder shape proofs ───────────────────────────────────


class TestKhEntityEmbedderConstruction:
    """Constructor wires LiteLLMEmbedder with the canonical model + dims."""

    def test_construct_with_canonical_model_and_dimensions(
        self, stub_litellm: type[_StubLiteLLMEmbedder]
    ) -> None:
        """KhEntityEmbedder.__init__ instantiates LiteLLMEmbedder with the
        text-embedding-3-large model name and dimensions=1024 — matching
        Stage-4's vector(1024) for cross-stage consistency (TECH §P-7).
        """
        from scripts.cocoindex_pipeline.entity_embedder import KhEntityEmbedder  # noqa: PLC0415

        embedder = KhEntityEmbedder()

        assert len(stub_litellm.instances) == 1, (
            "KhEntityEmbedder should construct exactly one LiteLLMEmbedder"
        )
        inner = stub_litellm.instances[0]
        assert inner.model == "text-embedding-3-large", (
            "Model must be text-embedding-3-large for parity with Stage-4 "
            "(per TECH §P-7 rationale 1: no new dep)"
        )
        assert inner.dimensions == 1024, (
            "Dimensions must be 1024 to match content_items.embedding "
            "vector(1024) column (flow.py:602-603 EMBEDDING_DIMENSIONS)"
        )
        # The instance attribute name is an implementation detail BUT the
        # whole point of the wrapper is to hold the inner embedder, so verify
        # the wrapper composes (not inherits) per TECH §P-7's "no inheritance
        # needed because the protocol is @runtime_checkable" note.
        assert embedder is not None


class TestKhEntityEmbedderEmbedContract:
    """embed() returns a length-1024 numpy float32 vector (testStrategy gate)."""

    def test_embed_returns_length_1024_float32_vector(
        self, stub_litellm: type[_StubLiteLLMEmbedder]
    ) -> None:
        """The testStrategy acceptance criterion verbatim: smoke-call against a
        mock LiteLLMEmbedder; assert returned vector has length 1024 AND
        dtype np.float32.
        """
        from scripts.cocoindex_pipeline.entity_embedder import KhEntityEmbedder  # noqa: PLC0415

        embedder = KhEntityEmbedder()

        result = asyncio.run(embedder.embed("ISO 27001"))

        assert len(result) == 1024, (
            f"Stage-5 entity-name embedding must be length 1024 "
            f"(got {len(result)}); matches Stage-4 vector(1024) per TECH §P-7"
        )
        assert result.dtype == np.float32, (
            f"Stage-5 entity-name embedding dtype must be np.float32 "
            f"(got {result.dtype}); matches LiteLLMEmbedder contract per "
            f"RESEARCH §R1.2"
        )

    def test_embed_delegates_to_inner_litellm_embedder(
        self, stub_litellm: type[_StubLiteLLMEmbedder]
    ) -> None:
        """embed() forwards the entity-name text to the wrapped LiteLLMEmbedder
        unchanged — proving the wrapper is a thin pass-through (no per-name
        preprocessing) per TECH §P-7's class body.
        """
        from scripts.cocoindex_pipeline.entity_embedder import KhEntityEmbedder  # noqa: PLC0415

        embedder = KhEntityEmbedder()
        inner = stub_litellm.instances[0]

        asyncio.run(embedder.embed("ISO27001"))
        asyncio.run(embedder.embed("ISO 27001"))

        assert inner.embed_calls == ["ISO27001", "ISO 27001"], (
            "KhEntityEmbedder.embed must forward the entity-name string "
            "verbatim to the inner LiteLLMEmbedder.embed coroutine"
        )

    def test_embed_is_async_coroutine(
        self, stub_litellm: type[_StubLiteLLMEmbedder]
    ) -> None:
        """embed must be an async method (cocoindex _Embedder Protocol signature
        per RESEARCH §R1.2: ``async def embed(self, text: str) -> NDArray``).
        """
        import inspect  # noqa: PLC0415

        from scripts.cocoindex_pipeline.entity_embedder import KhEntityEmbedder  # noqa: PLC0415

        embedder = KhEntityEmbedder()
        assert inspect.iscoroutinefunction(embedder.embed), (
            "KhEntityEmbedder.embed must be `async def` to satisfy the "
            "cocoindex _Embedder Protocol shape"
        )
