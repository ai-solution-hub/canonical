"""Tests for dedup.py — URL matching and embedding similarity deduplication."""

import sys
import os
import json
import io
from unittest.mock import patch, MagicMock, Mock
from urllib.error import HTTPError, URLError

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

MOCK_URL = "https://test.supabase.co"
MOCK_KEY = "test-secret-key-abc123"


@pytest.fixture(autouse=True)
def mock_config():
    """Mock Supabase config for all tests."""
    with patch("kb_pipeline.dedup.get_supabase_url", return_value=MOCK_URL), \
         patch("kb_pipeline.dedup.get_supabase_secret_key", return_value=MOCK_KEY), \
         patch("kb_pipeline.store.get_supabase_url", return_value=MOCK_URL), \
         patch("kb_pipeline.store.get_supabase_secret_key", return_value=MOCK_KEY):
        yield


from kb_pipeline.dedup import (
    check_duplicate_url,
    check_duplicate_embedding,
    is_duplicate,
)


# ── Helpers ──

def _make_response(body, status=200):
    """Create a mock HTTP response."""
    resp = MagicMock()
    resp.status = status
    encoded = json.dumps(body).encode("utf-8") if body is not None else b""
    resp.read.return_value = encoded
    resp.__enter__ = Mock(return_value=resp)
    resp.__exit__ = Mock(return_value=False)
    return resp


def _make_http_error(code=400, body="Bad Request"):
    """Create an HTTPError with readable body."""
    return HTTPError(
        url="https://test.supabase.co/rest/v1/rpc/find_similar_content",
        code=code,
        msg="Error",
        hdrs={},
        fp=io.BytesIO(body.encode("utf-8")),
    )


SAMPLE_EMBEDDING = [0.1] * 1024


# ── check_duplicate_url ──

class TestCheckDuplicateUrl:
    """Tests for check_duplicate_url()."""

    def test_empty_url_returns_none(self):
        """Empty or None URL returns None without making a request."""
        assert check_duplicate_url("") is None
        assert check_duplicate_url(None) is None

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_delegates_to_check_url_exists(self, mock_urlopen):
        """Non-empty URL delegates to store.check_url_exists."""
        mock_urlopen.return_value = _make_response([{"id": "existing-id"}])
        result = check_duplicate_url("https://example.com/page")
        assert result == "existing-id"


# ── check_duplicate_embedding ──

class TestCheckDuplicateEmbedding:
    """Tests for check_duplicate_embedding() — RPC-based similarity search."""

    @patch("kb_pipeline.dedup.urllib.request.urlopen")
    def test_matches_above_threshold_returned(self, mock_urlopen):
        """Matches with similarity >= threshold are included."""
        mock_urlopen.return_value = _make_response([
            {"id": "match-1", "title": "Similar Article", "similarity": 0.95},
            {"id": "match-2", "title": "Another Match", "similarity": 0.92},
        ])
        matches = check_duplicate_embedding(SAMPLE_EMBEDDING, threshold=0.90)
        assert len(matches) == 2
        assert matches[0]["id"] == "match-1"
        assert matches[0]["similarity"] == 0.95

    @patch("kb_pipeline.dedup.urllib.request.urlopen")
    def test_matches_below_threshold_filtered(self, mock_urlopen):
        """Matches below threshold are excluded even if returned by the RPC."""
        mock_urlopen.return_value = _make_response([
            {"id": "high", "title": "High", "similarity": 0.95},
            {"id": "low", "title": "Low", "similarity": 0.85},
        ])
        matches = check_duplicate_embedding(SAMPLE_EMBEDDING, threshold=0.90)
        assert len(matches) == 1
        assert matches[0]["id"] == "high"

    @patch("kb_pipeline.dedup.urllib.request.urlopen")
    def test_empty_response_returns_empty_list(self, mock_urlopen):
        """Empty response from RPC returns empty list."""
        mock_urlopen.return_value = _make_response([])
        matches = check_duplicate_embedding(SAMPLE_EMBEDDING)
        assert matches == []

    @patch("kb_pipeline.dedup.urllib.request.urlopen")
    def test_network_error_returns_empty_list(self, mock_urlopen):
        """URLError and HTTPError return empty list."""
        mock_urlopen.side_effect = URLError("Connection refused")
        matches = check_duplicate_embedding(SAMPLE_EMBEDDING)
        assert matches == []

    @patch("kb_pipeline.dedup.urllib.request.urlopen")
    def test_http_error_returns_empty_list(self, mock_urlopen):
        """HTTPError returns empty list."""
        mock_urlopen.side_effect = _make_http_error(500, "Server error")
        matches = check_duplicate_embedding(SAMPLE_EMBEDDING)
        assert matches == []

    @patch("kb_pipeline.dedup.urllib.request.urlopen")
    def test_json_parse_error_returns_empty_list(self, mock_urlopen):
        """Malformed JSON response returns empty list."""
        resp = MagicMock()
        resp.read.return_value = b"not valid json"
        resp.__enter__ = Mock(return_value=resp)
        resp.__exit__ = Mock(return_value=False)
        mock_urlopen.return_value = resp
        matches = check_duplicate_embedding(SAMPLE_EMBEDDING)
        assert matches == []

    @patch("kb_pipeline.dedup.urllib.request.urlopen")
    def test_correct_rpc_payload(self, mock_urlopen):
        """RPC payload contains query_embedding, similarity_threshold, limit_count."""
        mock_urlopen.return_value = _make_response([])
        check_duplicate_embedding(SAMPLE_EMBEDDING, threshold=0.88, limit=5)
        req = mock_urlopen.call_args[0][0]
        body = json.loads(req.data.decode("utf-8"))
        assert body["query_embedding"] == SAMPLE_EMBEDDING
        assert body["similarity_threshold"] == 0.88
        assert body["limit_count"] == 5
        assert "rpc/find_similar_content" in req.full_url


# ── is_duplicate ──

class TestIsDuplicate:
    """Tests for is_duplicate() — combined URL + embedding check."""

    @patch("kb_pipeline.dedup.check_duplicate_embedding")
    @patch("kb_pipeline.dedup.check_duplicate_url")
    def test_url_match_returns_true_url(self, mock_url, mock_emb):
        """URL match returns (True, id, 'url')."""
        mock_url.return_value = "url-match-id"
        result = is_duplicate(source_url="https://example.com/page")
        assert result == (True, "url-match-id", "url")
        # Embedding check should NOT be called when URL matches
        mock_emb.assert_not_called()

    @patch("kb_pipeline.dedup.check_duplicate_embedding")
    @patch("kb_pipeline.dedup.check_duplicate_url")
    def test_no_url_match_embedding_match(self, mock_url, mock_emb):
        """No URL match + embedding match returns (True, id, 'embedding')."""
        mock_url.return_value = None
        mock_emb.return_value = [{"id": "emb-match-id", "title": "Similar", "similarity": 0.95}]
        result = is_duplicate(source_url="https://new.com", embedding=SAMPLE_EMBEDDING)
        assert result == (True, "emb-match-id", "embedding")

    @patch("kb_pipeline.dedup.check_duplicate_embedding")
    @patch("kb_pipeline.dedup.check_duplicate_url")
    def test_no_matches_returns_false(self, mock_url, mock_emb):
        """No URL or embedding match returns (False, None, '')."""
        mock_url.return_value = None
        mock_emb.return_value = []
        result = is_duplicate(source_url="https://new.com", embedding=SAMPLE_EMBEDDING)
        assert result == (False, None, "")

    @patch("kb_pipeline.dedup.check_duplicate_embedding")
    @patch("kb_pipeline.dedup.check_duplicate_url")
    def test_no_url_no_embedding_returns_false(self, mock_url, mock_emb):
        """No URL and no embedding provided returns (False, None, '')."""
        mock_url.return_value = None
        result = is_duplicate(source_url="", embedding=None)
        assert result == (False, None, "")
        mock_emb.assert_not_called()

    @patch("kb_pipeline.dedup.check_duplicate_embedding")
    @patch("kb_pipeline.dedup.check_duplicate_url")
    def test_url_match_takes_priority(self, mock_url, mock_emb):
        """URL match takes priority over embedding match."""
        mock_url.return_value = "url-id"
        mock_emb.return_value = [{"id": "emb-id", "title": "X", "similarity": 0.99}]
        is_dup, item_id, method = is_duplicate(
            source_url="https://example.com", embedding=SAMPLE_EMBEDDING
        )
        assert is_dup is True
        assert item_id == "url-id"
        assert method == "url"
        mock_emb.assert_not_called()
