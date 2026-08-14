"""The frozen SEED-CONTRACT uuid5 identity formulas.

This module holds ONLY the four uuid5 seed formulas frozen by
`specs/id-138-corpus-durable-home/SEED-CONTRACT.md` §3 (FROZEN at first
bundle publication, id-132 BI-20/21). They port as CONTRACT, not machinery
(DESIGN.md §4): a post-freeze change to any formula below silently orphans
the citation graph.

`sd:` — the register-identity mint — is deliberately NOT exercised by this
module for the localfs admission path: minting is SQL-side
(`public.resolve_or_mint_source_identity`, content-hash FIRST), called by
`ingest.main`. `sd_id()` below exists only for the URL/reference-route branch
(`_ingest_url_body` in the old tree; out of phase-1 localfs scope) and for
the id-parity acceptance proof (old tree vs new tree, same formula).

Everything outside this frozen citable set (e.g. `entity_mentions`/
`entity_relationships` row ids, which are engine-declared and orphan-cleaned
rather than permanently citable) is deliberately NOT here — see
`ingest.main` for those, with their own citations.
"""

from __future__ import annotations

import uuid

# Byte-identical to the SQL-side `extensions.uuid_generate_v5` precedent
# (`public.reference_ingest`, `public.resolve_or_mint_source_identity`).
# SEED-CONTRACT.md §2.
NAMESPACE = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


def sd_id(rel_path: str) -> uuid.UUID:
    """`sd:` — register identity, keyed on the admission-time `rel_path`.

    SEED-CONTRACT.md §3 row 1/2. The localfs admission path does NOT call
    this: it calls the SQL resolver, which applies this exact formula
    SQL-side (content-hash first) and is the sole source of truth for a
    minted `source_document_id`. This function is for the URL/reference
    route and for proving id parity against the SQL mint.
    """
    return uuid.uuid5(NAMESPACE, f"sd:{rel_path}")


def chunk_id(source_document_id: uuid.UUID | str, position: int) -> uuid.UUID:
    """`chunk:` — content_chunks PK, keyed on the STORED source_document_id.

    SEED-CONTRACT.md §3 row 4. `position` is the chunk's 0-based ordinal
    within the document (the same value stored in `content_chunks.position`)
    — a re-walk of unchanged content mints the same id, upserting rather
    than duplicating.
    """
    return uuid.uuid5(NAMESPACE, f"chunk:{source_document_id}:{position}")


def qa_id(source_document_id: uuid.UUID | str, idx: int) -> uuid.UUID:
    """`qa:` — q_a_extractions PK, keyed on the STORED source_document_id.

    SEED-CONTRACT.md §3 row 5. `idx` is a monotonic per-document ordinal
    over extraction candidates (preserved positionally even when a
    candidate is skipped — e.g. an unanswered pair mints no row but does
    not shift later idx values), so a re-walk upserts rather than re-keys.
    """
    return uuid.uuid5(NAMESPACE, f"qa:{source_document_id}:{idx}")


def ri_id(normalised_url: str) -> uuid.UUID:
    """`ri:` — reference_items PK, keyed on the normalised URL.

    SEED-CONTRACT.md §3 row 6. Not exercised by phase-1 localfs; present for
    the URL/reference-route connector follow-on and contract completeness.
    """
    return uuid.uuid5(NAMESPACE, f"ri:{normalised_url}")
