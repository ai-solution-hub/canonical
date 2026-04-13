"""Embedding generation via OpenAI text-embedding-3-large @ 1024 dims."""

from typing import List, Optional

from openai import OpenAI

from .config import get_env, EMBEDDING_MODEL, EMBEDDING_DIMS, EMBEDDING_PRICE


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
    """Build text for embedding: title + summary + content[:1500].

    For transcripts, uses title + summary + chapter titles as topic outline
    (content is too long and the summary + chapter outline captures semantic
    range better than truncated transcript).
    """
    parts = []

    if title:
        parts.append(title.strip())
    if summary:
        parts.append(summary.strip())

    if content_type == "other":  # Legacy: was transcript type
        # Add chapter titles as topic outline for better semantic coverage
        if metadata:
            chapters = metadata.get("chapters", [])
            if chapters:
                chapter_titles = [ch.get("title", "") for ch in chapters if ch.get("title")]
                if chapter_titles:
                    parts.append("Topics: " + " | ".join(chapter_titles))
    else:
        content_truncated = (content or "").strip()[:1500]
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
