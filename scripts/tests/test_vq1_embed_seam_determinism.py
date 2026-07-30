"""VQ-1 (id-397 §8.8 / id-400) — embed-seam determinism MEASUREMENT.

Census #41 failure #4 observed ~1e-5-different vectors on unchanged bytes
after a memo re-ingest. The board HELD C-31's embedding half pending this
measurement ("measure, don't rule"). Two candidate mechanisms:

  (a) provider-side nondeterminism: OpenAI `text-embedding-3-large` is known
      to return vectors differing at ~1e-5 across identical requests — every
      pre-id-400 walk re-ran the outer component, and any embed that escaped
      the engine memo re-hit the API;
  (b) KH-side seam drift: truncation / float conversion / round-tripping.

This module MEASURES both layers:

  1. LOCAL LAYER (ungated, every sweep): the KH-owned seam
     (`_truncate_embedding_input` + `embed_content_text`'s float conversion)
     is byte-deterministic for identical input — proven with a stub embedder,
     no network. Any census-observed drift is therefore NOT introduced by
     KH code between content_text and the declared vector.

  2. REAL TIER (owner-gated: `KH_RUN_VQ1_REAL=1` + `OPENAI_API_KEY`): embeds
     the same text twice through TWO FRESH LiteLLMEmbedder instances (two
     instances so the engine per-text memo cannot mask the provider) and
     PRINTS a structured measurement record (max abs delta / L2 / identical)
     for the census journal. The test asserts only shape/dimension — it must
     NOT turn red on provider nondeterminism; the verdict on C-31's embedding
     half belongs to the owner with this measurement in hand.

Post-id-400 context for the eventual ruling: unchanged items now memo-skip
whole walks (no re-embed at all on no-op re-ingest), so provider
nondeterminism can only re-stamp vectors on byte changes and
`full_reprocess` — paths that legitimately re-embed.
"""

from __future__ import annotations

import asyncio
import json
import os

import pytest

from scripts.cocoindex_pipeline import flow


class TestVq1LocalSeamDeterminism:
    """Layer 1 — the KH-owned seam is deterministic (no network)."""

    def test_truncation_is_deterministic_and_idempotent(self) -> None:
        text = "Procurement evaluation criteria. " * 2000  # forces truncation
        first = flow._truncate_embedding_input(text)
        second = flow._truncate_embedding_input(text)
        assert first == second, "truncation must be byte-deterministic"
        # Idempotent: re-truncating the truncated slice is a no-op.
        assert flow._truncate_embedding_input(first) == first

    def test_under_budget_text_passes_through_unchanged(self) -> None:
        text = "Short stable doc body."
        assert flow._truncate_embedding_input(text) is text

    def test_embed_content_text_float_conversion_is_deterministic(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With a fixed-vector embedder, two embed_content_text calls on the
        same input produce IDENTICAL float lists — the KH conversion layer
        (numpy → list[float]) introduces no drift."""

        class _StubEmbedder:
            async def embed(self, text: str) -> list[float]:
                # Deterministic function of the input text, 1024-wide.
                seed = float(len(text) % 97) / 97.0
                return [((i * 31 + 7) % 1000) / 1000.0 + seed for i in range(1024)]

        monkeypatch.setattr(flow, "_EMBEDDER", _StubEmbedder())
        text = "Identical bytes embed identically at the KH seam."
        v1 = asyncio.run(flow.embed_content_text(text))
        v2 = asyncio.run(flow.embed_content_text(text))
        assert v1 == v2, "KH seam must be byte-deterministic for equal input"
        assert len(v1) == flow.EMBEDDING_DIMENSIONS


@pytest.mark.skipif(
    os.environ.get("KH_RUN_VQ1_REAL") != "1" or not os.environ.get("OPENAI_API_KEY"),
    reason=(
        "VQ-1 real-tier measurement is OWNER-GATED (API spend): set "
        "KH_RUN_VQ1_REAL=1 and OPENAI_API_KEY to run. The measurement prints "
        "a structured record for the census journal; it never rules on "
        "provider nondeterminism (C-31 embedding half is HELD)."
    ),
)
class TestVq1RealTierMeasurement:
    """Layer 2 — provider-side determinism, measured not ruled."""

    def test_measure_provider_vector_delta_on_identical_input(self) -> None:
        from scripts.cocoindex_pipeline._coco_api import LiteLLMEmbedder

        text = (
            "VQ-1 fixed probe text: identical bytes, embedded twice through "
            "two fresh embedder instances to bypass the per-text memo."
        )

        async def _measure() -> dict:
            e1 = LiteLLMEmbedder(
                flow.EMBEDDING_MODEL, dimensions=flow.EMBEDDING_DIMENSIONS
            )
            e2 = LiteLLMEmbedder(
                flow.EMBEDDING_MODEL, dimensions=flow.EMBEDDING_DIMENSIONS
            )
            v1 = [float(x) for x in await e1.embed(text)]
            v2 = [float(x) for x in await e2.embed(text)]
            deltas = [abs(a - b) for a, b in zip(v1, v2)]
            return {
                "event": "vq1.embed_seam_measurement",
                "model": flow.EMBEDDING_MODEL,
                "dimensions": len(v1),
                "identical": v1 == v2,
                "max_abs_delta": max(deltas),
                "l2_delta": sum(d * d for d in deltas) ** 0.5,
                "nonzero_delta_components": sum(1 for d in deltas if d > 0.0),
            }

        record = asyncio.run(_measure())
        # Measurement record for the census journal — captured via `-s` or the
        # pytest report; the assertions below check ONLY the contract shape.
        print(json.dumps(record))
        assert record["dimensions"] == flow.EMBEDDING_DIMENSIONS
