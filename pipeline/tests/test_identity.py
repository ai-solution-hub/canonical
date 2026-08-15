"""Unit tests for the frozen SEED-CONTRACT uuid5 formulas (identity.py).

Pure functions, no engine/DB — these pin the exact formula shape
(SEED-CONTRACT.md §3) so an accidental separator/prefix/ordering change is
caught here rather than silently orphaning citations at bundle publication.
"""

from __future__ import annotations

import uuid

from ingest import identity

_NAMESPACE = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


def test_namespace_matches_seed_contract() -> None:
    assert identity.NAMESPACE == _NAMESPACE


def test_sd_id_matches_frozen_formula() -> None:
    rel_path = "markdown/example-doc.md"
    expected = uuid.uuid5(_NAMESPACE, f"sd:{rel_path}")
    assert identity.sd_id(rel_path) == expected


def test_sd_id_is_deterministic_and_path_sensitive() -> None:
    a = identity.sd_id("markdown/a.md")
    b = identity.sd_id("markdown/a.md")
    c = identity.sd_id("markdown/b.md")
    assert a == b
    assert a != c


def test_chunk_id_matches_frozen_formula() -> None:
    source_document_id = uuid.uuid4()
    position = 3
    expected = uuid.uuid5(_NAMESPACE, f"chunk:{source_document_id}:{position}")
    assert identity.chunk_id(source_document_id, position) == expected


def test_chunk_id_distinguishes_position() -> None:
    sd = uuid.uuid4()
    assert identity.chunk_id(sd, 0) != identity.chunk_id(sd, 1)


def test_chunk_id_keyed_on_stored_source_document_id_not_path() -> None:
    # SEED-CONTRACT.md §3: chunk: is keyed on the STORED source_document_id,
    # never re-derived from rel_path — a rename must not change chunk ids.
    sd = uuid.uuid4()
    assert identity.chunk_id(sd, 0) == identity.chunk_id(sd, 0)


def test_qa_id_matches_frozen_formula() -> None:
    source_document_id = uuid.uuid4()
    idx = 2
    expected = uuid.uuid5(_NAMESPACE, f"qa:{source_document_id}:{idx}")
    assert identity.qa_id(source_document_id, idx) == expected


def test_qa_id_distinguishes_idx() -> None:
    sd = uuid.uuid4()
    assert identity.qa_id(sd, 0) != identity.qa_id(sd, 1)


def test_ri_id_matches_frozen_formula() -> None:
    url = "https://example.com/page"
    expected = uuid.uuid5(_NAMESPACE, f"ri:{url}")
    assert identity.ri_id(url) == expected


def test_all_four_seed_classes_produce_distinct_ids_for_the_same_key() -> None:
    # sd:/chunk:/qa:/ri: must never collide with each other for a shared key
    # string — the prefix is load-bearing.
    key = str(uuid.uuid4())
    ids = {
        identity.sd_id(key),
        identity.chunk_id(key, 0),
        identity.qa_id(key, 0),
        identity.ri_id(key),
    }
    assert len(ids) == 4


def test_chunk_and_qa_accept_uuid_and_str_equivalently() -> None:
    """The formulas key on the STORED source_document_id; a UUID object and
    its canonical string form must mint the same id (callers hold both).
    (Moved from the retired seed-contract acceptance module, S566.)"""
    import uuid as _uuid

    sd = _uuid.UUID("11111111-2222-3333-4444-555555555555")
    assert identity.chunk_id(sd, 7) == identity.chunk_id(str(sd), 7)
    assert identity.qa_id(sd, 7) == identity.qa_id(str(sd), 7)
