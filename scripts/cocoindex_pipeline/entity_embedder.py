"""KH-owned entity-name embedder for Stage-5 entity resolution (ID-53.9).

Implements the cocoindex ``_Embedder`` Protocol (per RESEARCH §R1.2:
``async def embed(self, text: str) -> NDArray[float32]``) so the embedder can
be supplied as the ``embedder`` collaborator to
``cocoindex.ops.entity_resolution.resolve_entities`` from Stage-5
(``_run_stage_5_resolution`` in ``stage_5.py``, landed by {53.13}).

Distinct from the Stage-4 ``LiteLLMEmbedder`` wired in ``flow.py`` (which
embeds long-form ``content_text``): this embedder operates on entity-NAME
strings — typically short (1–4 tokens) and domain-specific (organisation
names, certification labels, regulation IDs). cocoindex's ``resolve_entities``
collection-level mechanic deduplicates inputs via ``sorted(set(entities))``
before embedding (per RESEARCH §R1.2 source-read), so the per-run embedding
budget is proportional to DISTINCT entity names, not total mentions.

Implementation rationale (TECH.md §P-7):
  1. **No new dependency** — reuse the same OpenAI ``text-embedding-3-large``
     model and LiteLLM config the Stage-4 embedder already pulls in via
     ``requirements.txt`` and ``cocoindex.ops.litellm``. Introducing a second
     embedder model (e.g. a sentence-transformer) would add a model-download
     cost at sidecar cold-start that PRODUCT does not motivate.
  2. **Dimension parity** — ``dimensions=1024`` matches the existing
     ``content_items.embedding`` ``vector(1024)`` column (see ``flow.py``
     ``EMBEDDING_DIMENSIONS = 1024``) so future code paths that may compare
     entity-name embeddings against content embeddings remain dimensionally
     coherent.
  3. **Composition, not inheritance** — the cocoindex ``_Embedder`` Protocol
     is ``@runtime_checkable``, so a duck-typed class with the matching
     ``async def embed(text)`` signature satisfies the contract without
     inheriting from an exported base class (which RESEARCH §R1.2 confirms is
     not exposed by the cocoindex public surface).

PRODUCT.md invariants covered:
  - **Inv-3** (cross-document canonicalisation freshness) — Stage-5 supplies
    this embedder to ``resolve_entities`` to compute the candidate set used
    for cross-document near-match grouping.
  - **Inv-14** (PairResolver collaborator) — this embedder is one half of the
    pair (embedder + PairResolver) the resolver takes; the PairResolver is
    landed independently by {53.12}.

Lazy import discipline: ``cocoindex.ops.litellm`` is imported INSIDE
``__init__`` (not at module top level), mirroring ``flow.py``'s
``_get_embedder`` idiom. This keeps the module importable in unit tests that
stub a bare ``cocoindex`` without registering the ``cocoindex.ops`` subtree —
the embedder is only ever needed at Stage-5 resolution time.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray


# Canonical Stage-5 entity-embedding configuration. Held as module-level
# constants so they remain visible to readers without having to crack the
# constructor open, and so any future Stage-5 sidecar tests can assert on
# them without instantiating the embedder (which would trigger the lazy
# LiteLLMEmbedder import).
ENTITY_EMBEDDING_MODEL = "text-embedding-3-large"
ENTITY_EMBEDDING_DIMENSIONS = 1024


class KhEntityEmbedder:
    """Entity-name embedder for Stage-5 cocoindex.resolve_entities.

    Distinct from Stage-4 content_text LiteLLMEmbedder — embeds entity-name
    strings (short, often domain-specific) rather than document content.
    Uses the same OpenAI text-embedding-3-large model + dimensions=1024
    for consistency; the embedding is per-name not per-document.

    PRODUCT.md Inv-3 (cross-doc canonicalisation) + Inv-14 (PairResolver
    consumer). The cocoindex resolve_entities collection-level mechanic
    deduplicates inputs via sorted(set(entities)) so the embedding budget
    is proportional to distinct entity names per run.
    """

    def __init__(self) -> None:
        # Lazy import: ``cocoindex.ops.litellm`` is an optional submodule that
        # several pipeline unit tests stub out at the bare-``cocoindex`` level.
        # Importing inside __init__ (rather than at module top) lets the
        # module body import cleanly in those test contexts; the LiteLLM
        # dependency is only resolved when an embedder is actually
        # instantiated, which only happens inside Stage-5 resolution.
        from scripts.cocoindex_pipeline._coco_api import (  # noqa: PLC0415
            LiteLLMEmbedder,
        )

        self._embedder = LiteLLMEmbedder(
            ENTITY_EMBEDDING_MODEL,
            dimensions=ENTITY_EMBEDDING_DIMENSIONS,
        )

    async def embed(self, text: str) -> "NDArray[np.float32]":
        """Embed a single entity-name string (cocoindex _Embedder protocol).

        Thin pass-through to the wrapped LiteLLMEmbedder — no per-name
        preprocessing (normalisation, casing, alias resolution) happens here.
        The cocoindex ``resolve_entities`` caller is responsible for any
        canonicalisation BEFORE the embedder sees the string; per RESEARCH
        §R1.2 the resolver passes the entity name verbatim.
        """
        return await self._embedder.embed(text)
