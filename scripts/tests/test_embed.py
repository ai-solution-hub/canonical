"""Tests for embed.py — embedding text construction, generation, and cost estimation."""

import sys
import os
from unittest.mock import patch, MagicMock

import pytest

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.embed import (
    build_embedding_text,
    generate_embedding,
    generate_embeddings_batch,
    estimate_cost,
)
from kb_pipeline.config import EMBEDDING_MODEL, EMBEDDING_DIMS, EMBEDDING_PRICE


# ──────────────────────────────────────────
# build_embedding_text
# ──────────────────────────────────────────

class TestBuildEmbeddingText:
    """Tests for constructing text used for embedding generation."""

    def test_title_summary_content_joined(self):
        """Title, summary, and content are joined with double newlines."""
        result = build_embedding_text(
            title="My Title",
            ai_summary="A summary.",
            content="Full content here.",
        )
        assert result == "My Title\n\nA summary.\n\nFull content here."

    def test_content_truncated_to_1500_for_non_transcript(self):
        """Content is truncated to 1500 characters for non-transcript types."""
        long_content = "z" * 2000
        result = build_embedding_text(
            title="T",
            ai_summary="S",
            content=long_content,
            content_type="article",
        )
        # The content part should be exactly 1500 chars
        parts = result.split("\n\n")
        assert len(parts) == 3
        assert len(parts[2]) == 1500

    def test_transcript_uses_chapter_titles(self):
        """Transcript type ('other') uses chapter titles instead of content."""
        metadata = {
            "chapters": [
                {"title": "Introduction"},
                {"title": "Main Discussion"},
                {"title": "Conclusion"},
            ]
        }
        result = build_embedding_text(
            title="Podcast Ep 1",
            ai_summary="Summary of episode.",
            content="Very long transcript...",
            content_type="other",
            metadata=metadata,
        )
        assert "Topics: Introduction | Main Discussion | Conclusion" in result
        # Content body should NOT appear for transcripts
        assert "Very long transcript" not in result

    def test_transcript_no_chapters_omits_content(self):
        """Transcript with no chapters omits content section entirely."""
        result = build_embedding_text(
            title="Podcast Ep 2",
            ai_summary="Summary.",
            content="Long transcript text...",
            content_type="other",
            metadata={},
        )
        assert "Long transcript text" not in result
        assert result == "Podcast Ep 2\n\nSummary."

    def test_empty_parts_omitted(self):
        """Empty or whitespace-only parts are omitted."""
        result = build_embedding_text(
            title="",
            ai_summary="Just a summary.",
            content="",
        )
        assert result == "Just a summary."

    def test_all_empty_returns_single_space(self):
        """When all inputs are empty, returns a single space."""
        result = build_embedding_text(
            title="",
            ai_summary="",
            content="",
        )
        assert result == " "

    def test_none_and_empty_handled_gracefully(self):
        """None values for content are handled without error."""
        result = build_embedding_text(
            title=None,
            ai_summary=None,
            content=None,
        )
        assert result == " "

    def test_transcript_no_metadata(self):
        """Transcript type with metadata=None omits content."""
        result = build_embedding_text(
            title="Title",
            ai_summary="",
            content="Long transcript",
            content_type="other",
            metadata=None,
        )
        # No chapters, no content for transcript — just title
        assert result == "Title"


# ──────────────────────────────────────────
# generate_embedding
# ──────────────────────────────────────────

class TestGenerateEmbedding:
    """Tests for single embedding generation (OpenAI API mocked)."""

    @pytest.fixture(autouse=True)
    def _reset_client(self):
        """Reset the module-level OpenAI client before each test."""
        import kb_pipeline.embed as mod
        mod._client = None
        yield
        mod._client = None

    def _mock_embedding_response(self, vector=None, total_tokens=10):
        """Build a mock OpenAI embeddings response."""
        if vector is None:
            vector = [0.1] * EMBEDDING_DIMS
        response = MagicMock()
        data_item = MagicMock()
        data_item.embedding = vector
        response.data = [data_item]
        response.usage = MagicMock(total_tokens=total_tokens)
        return response

    @patch("kb_pipeline.embed._get_client")
    def test_returns_vector_and_token_count(self, mock_get_client):
        """Returns a (vector, token_count) tuple."""
        mock_client = MagicMock()
        expected_vector = [0.5] * EMBEDDING_DIMS
        mock_client.embeddings.create.return_value = self._mock_embedding_response(
            vector=expected_vector, total_tokens=42
        )
        mock_get_client.return_value = mock_client

        vector, tokens = generate_embedding("Some text to embed")
        assert vector == expected_vector
        assert tokens == 42

    @patch("kb_pipeline.embed._get_client")
    def test_empty_text_replaced_with_space(self, mock_get_client):
        """Empty or whitespace-only text is replaced with a single space."""
        mock_client = MagicMock()
        mock_client.embeddings.create.return_value = self._mock_embedding_response()
        mock_get_client.return_value = mock_client

        generate_embedding("   ")

        call_args = mock_client.embeddings.create.call_args
        assert call_args.kwargs["input"] == [" "]

    @patch("kb_pipeline.embed._get_client")
    def test_correct_model_and_dimensions(self, mock_get_client):
        """Correct model and dimensions are passed to the API."""
        mock_client = MagicMock()
        mock_client.embeddings.create.return_value = self._mock_embedding_response()
        mock_get_client.return_value = mock_client

        generate_embedding("test text")

        call_args = mock_client.embeddings.create.call_args
        assert call_args.kwargs["model"] == EMBEDDING_MODEL
        assert call_args.kwargs["dimensions"] == EMBEDDING_DIMS

    @patch("kb_pipeline.embed._get_client")
    def test_api_error_propagates(self, mock_get_client):
        """OpenAI API errors propagate to the caller."""
        mock_client = MagicMock()
        mock_client.embeddings.create.side_effect = RuntimeError("OpenAI down")
        mock_get_client.return_value = mock_client

        with pytest.raises(RuntimeError, match="OpenAI down"):
            generate_embedding("text")


# ──────────────────────────────────────────
# generate_embeddings_batch
# ──────────────────────────────────────────

class TestGenerateEmbeddingsBatch:
    """Tests for batch embedding generation (OpenAI API mocked)."""

    @pytest.fixture(autouse=True)
    def _reset_client(self):
        """Reset the module-level OpenAI client before each test."""
        import kb_pipeline.embed as mod
        mod._client = None
        yield
        mod._client = None

    def _mock_batch_response(self, vectors, total_tokens=50):
        """Build a mock batch embeddings response with index ordering."""
        response = MagicMock()
        data_items = []
        for i, vec in enumerate(vectors):
            item = MagicMock()
            item.index = i
            item.embedding = vec
            data_items.append(item)
        response.data = data_items
        response.usage = MagicMock(total_tokens=total_tokens)
        return response

    @patch("kb_pipeline.embed._get_client")
    def test_returns_vectors_in_correct_order(self, mock_get_client):
        """Vectors are returned sorted by index, matching input order."""
        mock_client = MagicMock()
        vec_a = [0.1] * 5
        vec_b = [0.2] * 5
        # Simulate out-of-order API response
        response = MagicMock()
        item_b = MagicMock(index=1, embedding=vec_b)
        item_a = MagicMock(index=0, embedding=vec_a)
        response.data = [item_b, item_a]  # reversed order
        response.usage = MagicMock(total_tokens=20)
        mock_client.embeddings.create.return_value = response
        mock_get_client.return_value = mock_client

        vectors, tokens = generate_embeddings_batch(["text A", "text B"])
        assert vectors[0] == vec_a
        assert vectors[1] == vec_b

    @patch("kb_pipeline.embed._get_client")
    def test_empty_strings_replaced_with_space(self, mock_get_client):
        """Empty strings in the batch are replaced with a single space."""
        mock_client = MagicMock()
        mock_client.embeddings.create.return_value = self._mock_batch_response(
            [[0.1] * 3, [0.2] * 3]
        )
        mock_get_client.return_value = mock_client

        generate_embeddings_batch(["hello", "  "])

        call_args = mock_client.embeddings.create.call_args
        assert call_args.kwargs["input"] == ["hello", " "]

    @patch("kb_pipeline.embed._get_client")
    def test_returns_total_tokens(self, mock_get_client):
        """Total tokens from usage are returned."""
        mock_client = MagicMock()
        mock_client.embeddings.create.return_value = self._mock_batch_response(
            [[0.1] * 3], total_tokens=99
        )
        mock_get_client.return_value = mock_client

        _, tokens = generate_embeddings_batch(["some text"])
        assert tokens == 99

    @patch("kb_pipeline.embed._get_client")
    def test_none_vector_raises_value_error(self, mock_get_client):
        """If API returns None for a vector, a ValueError is raised."""
        mock_client = MagicMock()
        # Simulate a response where one embedding is missing (only index 0 returned for 2 inputs)
        response = MagicMock()
        item = MagicMock(index=0, embedding=[0.1])
        response.data = [item]  # Only 1 item for 2 inputs
        response.usage = MagicMock(total_tokens=10)
        mock_client.embeddings.create.return_value = response
        mock_get_client.return_value = mock_client

        with pytest.raises(ValueError, match="returned None"):
            generate_embeddings_batch(["text a", "text b"])


# ──────────────────────────────────────────
# estimate_cost
# ──────────────────────────────────────────

class TestEmbedEstimateCost:
    """Tests for embedding cost estimation."""

    def test_zero_tokens_zero_cost(self):
        """Zero tokens returns zero cost."""
        assert estimate_cost(0) == 0.0

    def test_known_token_count(self):
        """Known token count produces expected cost."""
        cost = estimate_cost(1_000_000)
        expected = 1_000_000 * EMBEDDING_PRICE
        assert abs(cost - expected) < 1e-10
        # EMBEDDING_PRICE is 0.13 / 1M, so 1M tokens = $0.13
        assert abs(cost - 0.13) < 1e-10
