"""Unit tests for ingest/resolve.py.

No engine, no DB, no live LLM — `_resolve_type_group` is called directly
(bypassing `coco.mount`/an engine component context) with fakes for
`embedder`/`resolve_pair`. Calling a `memo=True` `coco.fn` directly outside
an engine context always executes its body (confirmed empirically against
the installed cocoindex 1.0.18 — there is no component to check a memo
cache against), so this exercises `resolve_entities`' real computation, not
cocoindex's own memo-skip behaviour, which needs a live engine and is out
of unit-test reach here (HARD LIMITS).
"""

from __future__ import annotations

import asyncio

import numpy as np
from cocoindex.ops.entity_resolution import PairDecision
from ingest.resolve import _clamp01, _resolve_type_group
from numpy.typing import NDArray


def test_clamp01_leaves_in_range_value_untouched() -> None:
    assert _clamp01(0.5) == 0.5


def test_clamp01_clamps_above_one() -> None:
    assert _clamp01(1.7) == 1.0


def test_clamp01_clamps_below_zero() -> None:
    assert _clamp01(-0.2) == 0.0


def test_clamp01_boundary_values_pass_through() -> None:
    assert _clamp01(0.0) == 0.0
    assert _clamp01(1.0) == 1.0


# ---------------------------------------------------------------------------
# F1 regression — Coordinator review of a8db904e4 (DR-105 defect)
# ---------------------------------------------------------------------------


class _FakeEmbedder:
    """Deterministic `Embedder.embed(str) -> NDArray[float32]` stub.

    Always returns the SAME vector, so any two names are cosine-identical
    for FAISS candidate search — this test controls resolver-call-count
    purely via `seed`, not embedding geometry.
    """

    async def embed(self, text: str) -> NDArray[np.float32]:
        return np.array([1.0, 0.0], dtype=np.float32)


class _CountingResolver:
    """Counting fake `PairResolver` — never matches (irrelevant here; only
    whether it gets CALLED, and how many times, is under test)."""

    def __init__(self) -> None:
        self.call_count = 0

    async def __call__(self, entity: str, candidates: list[str]) -> PairDecision:
        self.call_count += 1
        return PairDecision(matched=None)


def test_changed_seed_changes_resolver_call_count() -> None:
    """The bug (Coordinator review): `_resolve_type_group` used to fetch its
    seed from the DB INSIDE the `memo=True` body, invisible to the memo
    key — an unchanged `names` set plus a freshly-added admin pin would
    serve a stale memoized resolution, so the new pin went unhonoured until
    the raw name set itself changed (DR-105).

    The fix makes `seed` an explicit parameter. Proven here at the
    computation level: identical `entity_type`/`names`, only `seed`
    differs, and `resolve_entities`' own PINNED-policy behaviour changes
    correspondingly — two pre-seeded existings never consult the resolver
    at all (`ExistingCanonicalPolicy.PINNED`'s "two existings never merge"),
    while two non-existings that FAISS-match each other do.
    """
    names = {"Acme Ltd", "Acme Limited"}

    pinned_resolver = _CountingResolver()
    both_pinned = asyncio.run(
        _resolve_type_group(
            "organisation",
            names,
            {"Acme Ltd", "Acme Limited"},  # seed: both already existing canonicals
            embedder=_FakeEmbedder(),
            resolve_pair=pinned_resolver,
        )
    )
    assert pinned_resolver.call_count == 0
    assert both_pinned.canonicals() == {"Acme Ltd", "Acme Limited"}

    unpinned_resolver = _CountingResolver()
    asyncio.run(
        _resolve_type_group(
            "organisation",
            names,
            set(),  # seed: nothing existing — a fresh corpus with no prior pin
            embedder=_FakeEmbedder(),
            resolve_pair=unpinned_resolver,
        )
    )
    assert unpinned_resolver.call_count == 1
    assert unpinned_resolver.call_count != pinned_resolver.call_count
