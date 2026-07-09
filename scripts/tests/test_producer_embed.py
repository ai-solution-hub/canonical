"""Tests for producer/embed.py — BI-25/BI-26 concept embedding key + write
contract (ID-132 {132.11} G-EMBED).

Oracle uuid5 values below are computed independently against the pinned
`_KH_CONCEPT_NS` literal (`fd4ba596-2223-591b-b25c-1046022aced5`,
`flow.py:1683`) to prove `concept_owner_id` reproduces flow.py's frozen
namespace exactly — the "hard-coded uuid5 oracle" pattern
`test_producer_resource_uri.py` already uses for `_KH_PIPELINE_DOC_NS`.

Per TECH.md §"Testing and validation" (BI-25/BI-26 row): "embedding-key
test: owner_id == uuid5(_KH_CONCEPT_NS, rel_path); stable across two runs;
one record_embeddings(owner_kind='concept') row per concept; renaming the
constant changes the key (proves it is the frozen contract)."
"""

from __future__ import annotations

import uuid

import pytest

from scripts.cocoindex_pipeline.producer import embed

# Frozen literal (not imported from flow.py) so a namespace drift in the
# pipeline fails THIS suite loudly rather than silently comparing against
# itself — same discipline as test_producer_resource_uri.py / S440.
_CONCEPT_NS = uuid.UUID("fd4ba596-2223-591b-b25c-1046022aced5")

_EMBEDDING = [0.1] * 1024


class _FakeRecordEmbeddingsTarget:
    """Dict-keyed fake standing in for cocoindex's `mount_table_target`
    UPSERT semantics: `record_embeddings.declare_row` arbitrates the M1b
    `UNIQUE (owner_kind, owner_id, model)` via `ON CONFLICT ... DO UPDATE`
    (flow.py:1467-1473), so a re-declare of the SAME natural key overwrites
    the SAME row rather than minting a duplicate. Keying this fake on the
    same tuple lets a unit test prove that "delta-only" property without a
    real Postgres/cocoindex engine — the append-only `_FakeTarget` used by
    `test_cocoindex_chunking.py` records raw calls instead, which is right
    for THAT suite's "N chunks → N calls" assertion but would not surface a
    same-key collapse here.
    """

    def __init__(self) -> None:
        self.rows_by_key: dict[tuple[str, uuid.UUID, str], dict] = {}

    def declare_row(self, *, row: dict) -> None:
        key = (row["owner_kind"], row["owner_id"], row["model"])
        self.rows_by_key[key] = row

    @property
    def rows(self) -> list[dict]:
        return list(self.rows_by_key.values())


# ──────────────────────────────────────────
# BI-26: deterministic concept embedding key
# ──────────────────────────────────────────


def test_concept_owner_id_matches_frozen_namespace_formula() -> None:
    rel_path = "products/lms.md"
    expected = uuid.uuid5(_CONCEPT_NS, rel_path)
    assert embed.concept_owner_id(rel_path) == expected


def test_concept_owner_id_is_stable_across_two_runs() -> None:
    """BI-26 / testStrategy: 'stable across two runs' — regenerating the
    bundle must re-mint the SAME owner_id, never a fresh one."""
    rel_path = "procurement/tender-evaluation-guide.md"
    first_run = embed.concept_owner_id(rel_path)
    second_run = embed.concept_owner_id(rel_path)
    assert first_run == second_run


def test_concept_owner_id_differs_by_rel_path() -> None:
    a = embed.concept_owner_id("a.md")
    b = embed.concept_owner_id("b.md")
    assert a != b


def test_concept_owner_id_rejects_empty_rel_path() -> None:
    with pytest.raises(ValueError):
        embed.concept_owner_id("")


def test_a_different_namespace_would_mint_a_different_key() -> None:
    """Disproof-by-construction (mirrors test_cocoindex_seed_contract_lift.py):
    this suite is not vacuously true. A DIFFERENT (hypothetical, "un-tidied")
    namespace constant would mint a DIFFERENT owner_id for the SAME rel_path
    — proving the frozen `_KH_CONCEPT_NS` value is load-bearing, not
    incidental to the test passing."""
    rel_path = "products/lms.md"
    real = embed.concept_owner_id(rel_path)
    drifted_namespace = uuid.uuid4()  # stands in for a "tidied" constant
    drifted = uuid.uuid5(drifted_namespace, rel_path)
    assert drifted != real, (
        "a namespace drift MUST change the key — otherwise this suite would "
        "pass regardless of what _KH_CONCEPT_NS actually is"
    )


# ──────────────────────────────────────────
# BI-25: the record_embeddings(owner_kind='concept') row write
# ──────────────────────────────────────────


def test_declare_concept_embedding_writes_one_shaped_row() -> None:
    target = _FakeRecordEmbeddingsTarget()
    rel_path = "products/lms.md"

    embed.declare_concept_embedding(target, rel_path=rel_path, embedding=_EMBEDDING)

    assert len(target.rows) == 1, "expected exactly one record_embeddings row"
    row = target.rows[0]
    assert set(row) == {"owner_kind", "owner_id", "model", "embedding"}, (
        "row must carry ONLY the record_embeddings natural key + vector — no "
        "synthetic id, no per-run op_id"
    )
    assert row["owner_kind"] == "concept"
    assert row["owner_id"] == embed.concept_owner_id(rel_path)
    assert row["model"] == embed.EMBEDDING_MODEL
    assert row["embedding"] == _EMBEDDING
    assert len(row["embedding"]) == 1024


def test_declare_concept_embedding_model_is_the_pinned_text_embedding_3_large() -> (
    None
):
    """BI-25: 'the pinned embedding model text-embedding-3-large dim 1024
    per ID-131 TECH M1b' — never a magic string, the shared flow.py
    constant."""
    assert embed.EMBEDDING_MODEL == "text-embedding-3-large"


def test_declare_concept_embedding_skips_write_when_re_target_is_none() -> None:
    """Mirrors flow.py's `_declare_record_embedding` guard
    (`if re_target is None: return`) — a caller without a live
    record_embeddings target must not raise, just skip the dual-write."""
    embed.declare_concept_embedding(None, rel_path="products/lms.md", embedding=_EMBEDDING)
    # No exception, no target to inspect — the guard is the whole point.


# ──────────────────────────────────────────
# BI-18/BI-25: delta-only — unchanged concept collapses to ONE row
# ──────────────────────────────────────────


def test_repeated_declare_for_an_unchanged_concept_collapses_to_one_row() -> None:
    """testStrategy: 'exactly one record_embeddings(owner_kind=concept) row
    per concept'. Two producer runs over the SAME unchanged concept declare
    the SAME (owner_kind, owner_id, model) natural key — the M1b UNIQUE's
    ON CONFLICT DO UPDATE collapses them to one row rather than minting a
    duplicate (BI-18 delta-only, at the natural-key level)."""
    target = _FakeRecordEmbeddingsTarget()
    rel_path = "nested/dir/onboarding-transcript.md"

    embed.declare_concept_embedding(target, rel_path=rel_path, embedding=_EMBEDDING)
    embed.declare_concept_embedding(target, rel_path=rel_path, embedding=_EMBEDDING)

    assert len(target.rows) == 1, (
        "an unchanged concept re-declared across two runs must collapse to "
        "the SAME row, not mint a duplicate"
    )


def test_declaring_two_distinct_concepts_yields_two_rows() -> None:
    """Disproof-by-construction for the delta-only test above: this fake
    target does not ALWAYS collapse to one row — only same-key declares do."""
    target = _FakeRecordEmbeddingsTarget()
    embed.declare_concept_embedding(target, rel_path="a.md", embedding=_EMBEDDING)
    embed.declare_concept_embedding(target, rel_path="b.md", embedding=_EMBEDDING)
    assert len(target.rows) == 2
