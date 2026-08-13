"""KH-owned entity-name embedder for phase-2a entity resolution (id-434 D10).

Implements the cocoindex ``_Embedder`` Protocol
(``async def embed(self, text: str) -> NDArray[float32]``) so the embedder can
be supplied as the ``embedder`` collaborator to
``cocoindex.ops.entity_resolution.resolve_entities`` from the phase-2a
per-type resolve subcomponents in ``flow.py`` (id-434 TECH §2.3).

Distinct from the Stage-4 ``LiteLLMEmbedder`` wired in ``flow.py`` (which
embeds long-form ``content_text``): this embedder operates on entity-NAME
strings — typically short (1–4 tokens) and domain-specific (organisation
names, certification labels, regulation IDs). cocoindex's ``resolve_entities``
collection-level mechanic deduplicates inputs via ``sorted(set(entities))``
before embedding, so the per-run embedding budget is proportional to DISTINCT
entity names, not total mentions.

id-434 TECH §2.6 (ruling D10-revised, DR-036): the embedder is a
**read-through cache over ``record_embeddings``** — the single embeddings
home. Row shape:

- ``owner_kind = 'entity_name'`` (CHECK widened by the id-434 migration);
- ``owner_id = uuid5(_KH_PIPELINE_DOC_NS, f"entity_name:{name}")`` — the
  no-FK owner-kind precedent (``concept`` already has no DB row);
- ``model = ENTITY_EMBEDDING_MODEL``; ``embedding`` fits the existing
  ``vector(1024)`` column exactly.

Semantics: **cache, not engine target state.** ``SELECT`` on hit; on miss
embed then ``INSERT … ON CONFLICT (owner_kind, owner_id, model) DO NOTHING``
— the ``entity_pair_resolutions`` write pattern (``pair_resolver.py``), chosen
for the same reason: the substrate must survive corpus changes and LMDB
resets, which an engine-declared row would not (a name leaving the corpus
would reconcile its vector away and defeat "only new names embed"). A
cache-read (or cache-write) fault degrades to a live embed + log, never a run
failure. No per-``entity_name`` partial HNSW index is added now — the ranking
term is id-452's decision, gated on a real-tier run; this is plumbing + cost
+ substrate only.

Implementation rationale (carried from the id-53 original):
  1. **No new dependency** — reuse the same OpenAI ``text-embedding-3-large``
     model and LiteLLM config the Stage-4 embedder already pulls in.
  2. **Dimension parity** — ``dimensions=1024`` matches the existing
     ``vector(1024)`` embedding columns.
  3. **Composition, not inheritance** — the cocoindex ``_Embedder`` Protocol
     is ``@runtime_checkable``; a duck-typed ``async def embed(text)``
     satisfies it.

Lazy import discipline: ``cocoindex.ops.litellm`` is imported INSIDE
``__init__`` (not at module top level), mirroring ``flow.py``'s
``_get_embedder`` idiom. This keeps the module importable in unit tests that
stub a bare ``cocoindex`` without registering the ``cocoindex.ops`` subtree.
``numpy`` is likewise imported lazily inside the decode helper.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray


_logger = logging.getLogger(__name__)


# Canonical entity-embedding configuration. Held as module-level constants so
# they remain visible to readers without having to crack the constructor open,
# and so tests can assert on them without instantiating the embedder (which
# would trigger the lazy LiteLLMEmbedder import).
ENTITY_EMBEDDING_MODEL = "text-embedding-3-large"
ENTITY_EMBEDDING_DIMENSIONS = 1024

# The pipeline's stable uuid5 namespace — the SAME value as
# `flow._KH_PIPELINE_DOC_NS` (uuid5(NAMESPACE_DNS,
# "kh-pipeline.cocoindex.document-identity.v1")), duplicated here as a pinned
# literal rather than imported: importing `flow` would drag the whole flow
# module (and its cocoindex import) into unit tests that stub `cocoindex` at
# the bare-module level. The value is frozen by contract on both sides — it
# MUST NOT change after first use (drift orphans every cached vector), and
# `scripts/tests` asserts the two constants agree.
_KH_PIPELINE_DOC_NS = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


def entity_name_owner_id(name: str) -> uuid.UUID:
    """The deterministic `record_embeddings.owner_id` for one entity name."""
    return uuid.uuid5(_KH_PIPELINE_DOC_NS, f"entity_name:{name}")


def _encode_pgvector(value: Any) -> str:
    """Encode a float sequence into the pgvector text literal `[v1,v2,...]`.

    asyncpg has no native pgvector codec; pgvector's input function accepts
    the bracketed text form (the `flow._encode_pgvector` idiom, duplicated for
    the same no-flow-import reason as the namespace constant above).
    """
    return "[" + ",".join(repr(float(v)) for v in value) + "]"


def _decode_pgvector(text: str) -> "NDArray[np.float32]":
    """Decode pgvector's text form `[v1,v2,...]` to a float32 NDArray."""
    import numpy as np  # noqa: PLC0415 — lazy, mirrors the module discipline

    return np.asarray(json.loads(text), dtype=np.float32)


class KhEntityEmbedder:
    """Entity-name embedder for phase-2a `cocoindex.resolve_entities` (id-434).

    A read-through cache over the DR-036 `record_embeddings` single home
    (TECH §2.6): SELECT on hit; on miss embed live then INSERT with
    ON CONFLICT DO NOTHING. Any cache fault (read or write) degrades to the
    live embed with a structured warning — the cache accelerates, it never
    gates.

    ``db_pool`` is the same env-scope `DB_CTX` asyncpg pool the retired
    Stage-5 used, passed by the phase-2a resolve subcomponent. When ``None``
    (unit-test callers constructing the embedder bare) every call is a live
    embed and the cache is bypassed entirely.
    """

    def __init__(self, db_pool: Any = None) -> None:
        # Lazy import: ``cocoindex.ops.litellm`` is an optional submodule that
        # several pipeline unit tests stub out at the bare-``cocoindex``
        # level. Importing inside __init__ keeps the module body importable in
        # those test contexts; the LiteLLM dependency is only resolved when an
        # embedder is actually instantiated, which only happens inside the
        # phase-2a resolve subcomponents.
        from scripts.cocoindex_pipeline._coco_api import (  # noqa: PLC0415
            LiteLLMEmbedder,
        )

        self._embedder = LiteLLMEmbedder(
            ENTITY_EMBEDDING_MODEL,
            dimensions=ENTITY_EMBEDDING_DIMENSIONS,
        )
        self._db_pool = db_pool

    async def embed(self, text: str) -> "NDArray[np.float32]":
        """Embed a single entity-name string (cocoindex _Embedder protocol).

        Read-through: cached vector when `record_embeddings` holds one for
        this (name, model); live embed + best-effort cache write otherwise.
        No per-name preprocessing happens here — the resolver passes the
        entity name verbatim, and the cache key is that verbatim name.
        """
        if self._db_pool is None:
            return await self._embedder.embed(text)

        owner_id = entity_name_owner_id(text)
        try:
            row = await self._db_pool.fetchrow(
                "SELECT embedding::text AS embedding "
                "FROM public.record_embeddings "
                "WHERE owner_kind = 'entity_name' AND owner_id = $1 "
                "AND model = $2",
                owner_id,
                ENTITY_EMBEDDING_MODEL,
            )
            if row is not None and row["embedding"] is not None:
                return _decode_pgvector(row["embedding"])
        except Exception as exc:  # noqa: BLE001 — cache faults degrade, never gate
            _logger.warning(
                json.dumps(
                    {
                        "event": "cocoindex.entity_embedding.cache_read_failed",
                        "error": str(exc)[:200],
                    }
                )
            )

        vector = await self._embedder.embed(text)
        try:
            await self._db_pool.execute(
                "INSERT INTO public.record_embeddings "
                "(owner_kind, owner_id, model, embedding) "
                "VALUES ('entity_name', $1, $2, $3::vector) "
                "ON CONFLICT (owner_kind, owner_id, model) DO NOTHING",
                owner_id,
                ENTITY_EMBEDDING_MODEL,
                _encode_pgvector(vector),
            )
        except Exception as exc:  # noqa: BLE001 — cache faults degrade, never gate
            _logger.warning(
                json.dumps(
                    {
                        "event": "cocoindex.entity_embedding.cache_write_failed",
                        "error": str(exc)[:200],
                    }
                )
            )
        return vector
