"""Naming stability — a re-run may GROW a group, never RENAME it.

Contracts: DR-140 (one key space, produced by resolution), DR-147 (the
resolved canonical is a function of the accumulated decision record — prior
canonicals seeded via `is_existing_canonical`), DR-105 (admin pins honoured
by every walk-side consumer).

Behaviour-first: these tests drive the REAL upstream `resolve_entities`
(cocoindex 1.0.18) exactly as `ingest.resolve` invokes it — the contract is
met by upstream's `ExistingCanonicalPolicy.PINNED` semantics plus our seed
construction, not by ported machinery. The fakes stub only the two network
surfaces (embedding, pair-resolution LLM).
"""

from __future__ import annotations

import asyncio

import numpy as np
from cocoindex.ops.entity_resolution import (
    ExistingCanonicalPolicy,
    PairDecision,
    resolve_entities,
)
from numpy.typing import NDArray


class _UniformEmbedder:
    """Identical vector for every name — every name is every other name's
    nearest candidate, so grouping is decided purely by resolver + policy."""

    async def embed(self, text: str) -> NDArray[np.float32]:
        return np.array([1.0, 0.0], dtype=np.float32)


class _MatchFirstCandidateResolver:
    """Always matches the first offered candidate — the most aggressive
    merger the LLM seat could express, which is exactly what the PINNED
    policy must contain."""

    async def __call__(self, entity: str, candidates: list[str]) -> PairDecision:
        return PairDecision(matched=candidates[0] if candidates else None)


def _resolve(entities: set[str], seed: set[str]):
    return asyncio.run(
        resolve_entities(
            entities=entities,
            embedder=_UniformEmbedder(),
            resolve_pair=_MatchFirstCandidateResolver(),
            is_existing_canonical=lambda name: name in seed,
            existing_policy=ExistingCanonicalPolicy.PINNED,
        )
    )


def test_rerun_grows_group_without_renaming() -> None:
    """Run 1 establishes a canonical; run 2 (grown corpus, run-1 canonicals
    seeded) must keep every run-1 name under its run-1 canonical, and may
    only ADD the new surface form to the group."""
    run1 = _resolve({"Sarah Chen", "S. Chen"}, seed=set())
    established = {name: run1.canonical_of(name) for name in ("Sarah Chen", "S. Chen")}
    # Both run-1 names resolved into one group under one canonical.
    assert len(set(established.values())) == 1
    canonical = next(iter(established.values()))

    run2 = _resolve(
        {"Sarah Chen", "S. Chen", "Sarah C."},
        seed=set(run1.canonicals()),
    )
    for name, prior in established.items():
        assert run2.canonical_of(name) == prior, (
            f"re-run RENAMED {name!r}: {prior!r} -> {run2.canonical_of(name)!r}"
        )
    # The new surface form may join the existing group (growth is allowed).
    assert run2.canonical_of("Sarah C.") == canonical


def test_two_seeded_existing_canonicals_never_merge() -> None:
    """DR-105/DR-147: two canonicals that both exist in the accumulated
    decision record (e.g. an admin split two similar names deliberately)
    must survive a re-run as separate groups even under an aggressively
    merging resolver — PINNED policy: two existings never merge."""
    seed = {"Sarah Chen", "Sara Chen"}
    result = _resolve({"Sarah Chen", "Sara Chen"}, seed=seed)
    assert result.canonical_of("Sarah Chen") == "Sarah Chen"
    assert result.canonical_of("Sara Chen") == "Sara Chen"
    assert len(set(result.canonicals())) == 2


def test_new_name_attaches_to_seeded_canonical_not_vice_versa() -> None:
    """A raw name matching an existing canonical joins THAT canonical —
    the existing name never gets re-keyed under the newcomer."""
    result = _resolve({"Sarah Chen", "Sarah C."}, seed={"Sarah Chen"})
    assert result.canonical_of("Sarah Chen") == "Sarah Chen"
    assert result.canonical_of("Sarah C.") == "Sarah Chen"
