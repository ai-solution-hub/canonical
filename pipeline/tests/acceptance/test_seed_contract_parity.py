"""SEED-CONTRACT id parity — the frozen uuid5 formulas mint byte-identical ids.

Golden vectors below are triple-grounded (S565):

1. Computed from the FROZEN formulas in
   `specs/id-138-corpus-durable-home/SEED-CONTRACT.md` §2–§3.
2. Cross-checked against SQL `extensions.uuid_generate_v5` on platform
   staging — byte-identical for both the ASCII and unicode `sd:` keys.
3. Proven against the LIVE register: all 33 `source_documents` rows on
   platform staging satisfy `id = sd_id(storage_path)` exactly (the stored
   ids ARE this formula's outputs; old-tree/new-tree parity by construction).

A failure here means published citations orphan. There is no legitimate
reason for this module's expectations to change post-freeze (2026-07-11).
"""

from __future__ import annotations

import uuid

from ingest import identity

_GOLDEN = [
    # (formula, args, frozen expected id)
    (
        identity.sd_id,
        ("markdown/Phew-Bid-Library-2026-v4_4.md",),
        "c6d7839f-ad8a-5c34-860a-8e2c62e43197",
    ),
    (
        # Non-ASCII path: uuid5 hashes UTF-8 bytes; parity with SQL
        # uuid_generate_v5 verified live (staging, S565).
        identity.sd_id,
        ("markdown/Ätna—notes.md",),
        "0ab97149-27c7-5f38-b236-2a7b4a30f358",
    ),
    (
        identity.chunk_id,
        ("11111111-2222-3333-4444-555555555555", 0),
        "eba4162c-bf53-527b-b068-be49301cb4e1",
    ),
    (
        identity.qa_id,
        ("11111111-2222-3333-4444-555555555555", 3),
        "c52914dd-cedc-5a0f-b321-ca3711c07fa0",
    ),
    (
        identity.ri_id,
        ("https://example.com/page",),
        "09ce027a-424f-56e7-914e-05fc078bd868",
    ),
]


def test_namespace_is_frozen() -> None:
    assert identity.NAMESPACE == uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


def test_golden_vectors() -> None:
    for fn, args, expected in _GOLDEN:
        assert fn(*args) == uuid.UUID(expected), (fn.__name__, args)


def test_chunk_and_qa_accept_uuid_and_str_equivalently() -> None:
    """The formulas key on the STORED source_document_id; a UUID object and
    its canonical string form must mint the same id (callers hold both)."""
    sd = uuid.UUID("11111111-2222-3333-4444-555555555555")
    assert identity.chunk_id(sd, 7) == identity.chunk_id(str(sd), 7)
    assert identity.qa_id(sd, 7) == identity.qa_id(str(sd), 7)
