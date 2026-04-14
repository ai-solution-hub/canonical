"""Embedding generation via OpenAI text-embedding-3-large @ 1024 dims."""

from typing import List, Optional

from openai import OpenAI

from .config import get_env, EMBEDDING_MODEL, EMBEDDING_DIMS, EMBEDDING_PRICE


MAX_EMBEDDING_CHARS = 24_000
"""Maximum characters of content included in the embedding input.

Mirrors the TypeScript pipeline's constant in ``lib/ai/embed.ts`` (the single
source of truth for the figure). Keeping the two values aligned closes the
Plan D Divergence 1 finding — the Python pipeline previously truncated at
1,500 characters, producing embeddings that represented only the first two or
three paragraphs of a typical policy document.
"""


# Module-level client (lazy init)
_client = None


def _get_client():
    global _client
    if _client is None:
        env = get_env()
        _client = OpenAI(api_key=env["OPENAI_API_KEY"])
    return _client


def build_embedding_text(
    title: str,
    summary: str,
    content: str,
    content_type: str = "article",
    metadata: dict = None,
) -> str:
    """Build text for embedding: ``title + summary + content[:MAX_EMBEDDING_CHARS]``.

    ``MAX_EMBEDDING_CHARS`` is 24,000, matching the TypeScript classify path in
    ``lib/ai/embed.ts``. Summary inclusion is retained on the Python path by
    design (Plan D D5): the AI-generated summary is a useful semantic signal
    at negligible token cost.

    For transcripts (``content_type == "other"``), uses title + summary +
    chapter titles as a topic outline instead of the raw transcript body. This
    divergence from the TypeScript path is intentional and documented in
    ``docs/operations/re-ingestion-quality-protocol.md`` (Divergence 3).
    """
    parts = []

    if title:
        parts.append(title.strip())
    if summary:
        parts.append(summary.strip())

    if content_type == "other":  # Legacy: was transcript type
        if metadata:
            chapters = metadata.get("chapters", [])
            if chapters:
                chapter_titles = [ch.get("title", "") for ch in chapters if ch.get("title")]
                if chapter_titles:
                    parts.append("Topics: " + " | ".join(chapter_titles))
    else:
        content_truncated = (content or "").strip()[:MAX_EMBEDDING_CHARS]
        if content_truncated:
            parts.append(content_truncated)

    return "\n\n".join(parts) if parts else " "


def generate_embedding(text: str) -> tuple[List[float], int]:
    """Generate a single embedding. Returns (vector, token_count)."""
    client = _get_client()

    if not text.strip():
        text = " "

    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=[text],
        dimensions=EMBEDDING_DIMS,
    )

    vector = response.data[0].embedding
    tokens = response.usage.total_tokens
    return vector, tokens


def generate_embeddings_batch(texts: List[str]) -> tuple[List[List[float]], int]:
    """Generate embeddings for a batch of texts. Returns (vectors, total_tokens).

    Any texts that produce a None embedding are logged and replaced with an
    empty list so callers always receive a list of the same length as the input.
    """
    import logging

    logger = logging.getLogger(__name__)
    client = _get_client()

    # Replace empty strings
    clean_texts = [t if t.strip() else " " for t in texts]

    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=clean_texts,
        dimensions=EMBEDDING_DIMS,
    )

    # Sort by index to maintain order
    vectors = [None] * len(texts)
    for item in response.data:
        vectors[item.index] = item.embedding

    # Validate: raise on any None vectors (wrong dimension would corrupt DB)
    for i, vec in enumerate(vectors):
        if vec is None:
            raise ValueError(
                f"Embedding at index {i} returned None "
                f"(text length={len(texts[i])}). "
                "Cannot store a null vector — check input text or API response."
            )

    return vectors, response.usage.total_tokens


def estimate_cost(tokens: int) -> float:
    """Estimate embedding cost in USD."""
    return tokens * EMBEDDING_PRICE
