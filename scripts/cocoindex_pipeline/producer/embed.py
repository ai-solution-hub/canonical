"""Concept embeddings → `record_embeddings(owner_kind='concept')` — BI-25/BI-26
(ID-132 {132.11} G-EMBED).

Per `docs/specs/id-132-okf-concept-producer/TECH.md` §"The bundle vector
index (BI-25)" + §"BI-26 reconciliation":

- **BI-25** — each concept is embedded into ID-131's polymorphic
  `record_embeddings` store: ONE row per concept, `owner_kind='concept'`,
  the pinned embedding model (`text-embedding-3-large`, dim 1024), written
  via `mount_table_target(record_embeddings)`. ID-131's per-`owner_kind`
  partial HNSW index (`WHERE owner_kind='concept'`) already covers it —
  ONE store serves both L-records `hybrid_search` and L-concept traversal.
  **No ID-131 schema touch** (owner_id already accepts any uuid5; the
  `UNIQUE (owner_kind, owner_id, model)` + partial HNSW already
  accommodate concept rows).
- **BI-26 (the path-vs-uuid duality)** — `record_embeddings.owner_id` is
  typed `uuid` (ID-131 TECH M1b:288) but a concept's identity is a PATH
  (BI-2). `concept_owner_id` derives a deterministic
  `uuid5(_KH_CONCEPT_NS, concept_rel_path)` key so the uuid column stores a
  stable-across-regenerations value, while the CITATION still uses the
  path (BI-9) — the uuid never leaks into the bundle itself.

**Reuses, never redeclares, the ID-131 write idiom.** `declare_concept_embedding`
delegates to `flow.py`'s `_declare_record_embedding` (ID-131 {131.11}) — the
SAME `re_target.declare_row(...)` call site `_ingest_content_branch` /
`_ingest_url_body` already use for `owner_kind='content_chunk'` /
`'reference_item'` — passing `owner_kind='concept'`. This keeps the row
shape (and any future column added to `RECORD_EMBEDDINGS_SCHEMA`) a single
source of truth; this module owns only the concept-specific `owner_kind`
literal and the BI-26 key derivation. `_KH_CONCEPT_NS` (`flow.py:1683`,
frozen for ID-131 `{131.5}` G-SEED) is likewise consumed, never
redeclared — a namespace drift there would orphan the bundle vector index
after first publish (BI-20/BI-21), which is exactly why it lives in the
frozen SEED-CONTRACT family and is asserted by
`test_cocoindex_seed_contract_lift.py`.

**Pure key/write module — no runtime DB dependency of its own.**
`concept_owner_id`/`declare_concept_embedding` take an already-resolved
`re_target` (the cocoindex `mount_table_target` handle — full flow wiring
is `{132.13}`'s job, mirroring `producer/bundle_writer.py`'s identical
deferral) and an already-computed `embedding` vector as plain inputs;
buildable and testable against a fake target alone. `_KH_CONCEPT_NS` /
`EMBEDDING_MODEL` / `_declare_record_embedding` are pulled from `flow.py`
via a LAZY function-local import (mirrors `producer/resource_uri.py`'s
`_seed_contract_namespace` lazy import) because `flow.py` eagerly imports
`cocoindex` + `asyncpg` + `aiohttp` + `httpx` at module scope; a
module-level import here would drag all of that into every caller of this
module at COLLECTION time and break the collection-safety property
`_coco_api.py` documents.
"""

from __future__ import annotations

import uuid
from typing import Any, Sequence


def _concept_namespace() -> uuid.UUID:
    """The frozen ID-131 SEED-CONTRACT namespace for concept embedding keys
    (`flow.py:1683`, `_KH_CONCEPT_NS = uuid5(_KH_PIPELINE_DOC_NS, "concept")`).
    Lazily imported — see module docstring."""
    from scripts.cocoindex_pipeline.flow import _KH_CONCEPT_NS  # noqa: PLC0415

    return _KH_CONCEPT_NS


def _embedding_model() -> str:
    """The shared pinned embedding-model constant (`flow.py:996`,
    `text-embedding-3-large`) — never a literal, so the read side never
    drifts from what the rest of the pipeline writes."""
    from scripts.cocoindex_pipeline.flow import EMBEDDING_MODEL  # noqa: PLC0415

    return EMBEDDING_MODEL


def __getattr__(name: str) -> object:
    """PEP 562 module `__getattr__`: exposes `embed.EMBEDDING_MODEL` as a
    plain-looking attribute for callers/tests, while keeping the `flow.py`
    import (and its transitive `cocoindex`/`asyncpg`/`aiohttp`/`httpx` cost)
    deferred to first ACCESS rather than paid at collection time — a
    module-level `EMBEDDING_MODEL = _embedding_model()` assignment would
    defeat the whole point of the lazy-import discipline above by running
    it eagerly on `import producer.embed`."""
    if name == "EMBEDDING_MODEL":
        return _embedding_model()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


# BI-25: the polymorphic tag this producer ALWAYS writes. Never anything
# else — a concept row is never `'content_chunk'`/`'reference_item'`/
# `'source_document'` etc; those owner_kinds belong to `flow.py`'s own
# dual-write call sites.
OWNER_KIND = "concept"


def concept_owner_id(rel_path: str) -> uuid.UUID:
    """BI-26: the deterministic embedding key for a concept.

    `uuid5(_KH_CONCEPT_NS, rel_path)` — a pure function of the concept's
    bundle-relative path (BI-2 identity), so regenerating the SAME concept
    on a later producer run re-mints the SAME `owner_id` (stable across
    regenerations) and `record_embeddings`'s `UNIQUE (owner_kind, owner_id,
    model)` UPSERTs the existing row instead of minting a duplicate.
    """
    if not rel_path:
        raise ValueError("rel_path must be non-empty (BI-26)")
    return uuid.uuid5(_concept_namespace(), rel_path)


def declare_concept_embedding(
    re_target: Any,
    *,
    rel_path: str,
    embedding: Sequence[float],
) -> None:
    """Declare ONE `record_embeddings(owner_kind='concept')` row (BI-25/26).

    Guarded on `re_target is not None` — a caller without a live
    `mount_table_target(record_embeddings)` handle (e.g. a unit test, or a
    producer run wired without vector indexing) skips the dual-write
    entirely, mirroring `flow.py`'s `_declare_record_embedding` guard for
    the `content_chunk`/`reference_item` grains.

    Delegates the actual row shape to `flow.py:_declare_record_embedding`
    (ID-131 {131.11}) — this module supplies only `owner_kind='concept'`
    and the BI-26 `owner_id` derivation; the natural key
    `(owner_kind, owner_id, model)` is what makes a re-run for an
    unchanged concept an UPSERT of the SAME row, never a duplicate
    (BI-18 delta-only, at the natural-key level).
    """
    if re_target is None:
        return
    from scripts.cocoindex_pipeline.flow import (  # noqa: PLC0415
        _declare_record_embedding,
    )

    _declare_record_embedding(
        re_target,
        owner_kind=OWNER_KIND,
        owner_id=concept_owner_id(rel_path),
        embedding=list(embedding),
    )
