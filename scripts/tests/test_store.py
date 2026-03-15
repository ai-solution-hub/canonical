"""Tests for store.py — Supabase storage operations."""

import sys
import os
import json
import io
from unittest.mock import patch, MagicMock, Mock
from urllib.error import HTTPError, URLError

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

# We must mock config before importing store to avoid .env reads
MOCK_URL = "https://test.supabase.co"
MOCK_KEY = "test-secret-key-abc123"


@pytest.fixture(autouse=True)
def mock_config():
    """Mock Supabase config for all tests."""
    with patch("kb_pipeline.store.get_supabase_url", return_value=MOCK_URL), \
         patch("kb_pipeline.store.get_supabase_secret_key", return_value=MOCK_KEY):
        yield


from kb_pipeline.store import (
    _headers,
    _request,
    insert_content_item,
    update_content_item,
    merge_item_metadata,
    check_url_exists,
    log_quality_issue,
    resolve_quality_issue,
    fetch_records,
    fetch_taxonomy,
)


# ── Helpers ──

def _make_response(body, status=200):
    """Create a mock HTTP response with given body and status."""
    resp = MagicMock()
    resp.status = status
    if body is not None:
        encoded = json.dumps(body).encode("utf-8")
    else:
        encoded = b""
    resp.read.return_value = encoded
    resp.__enter__ = Mock(return_value=resp)
    resp.__exit__ = Mock(return_value=False)
    return resp


def _make_http_error(code=400, body="Bad Request"):
    """Create an HTTPError with readable body."""
    err = HTTPError(
        url="https://test.supabase.co/rest/v1/test",
        code=code,
        msg="Error",
        hdrs={},
        fp=io.BytesIO(body.encode("utf-8")),
    )
    return err


# ── _headers ──

class TestHeaders:
    """Tests for _headers() helper."""

    def test_returns_correct_keys(self):
        """Headers dict contains apikey, Authorization, Content-Type, Prefer."""
        h = _headers()
        assert set(h.keys()) == {"apikey", "Authorization", "Content-Type", "Prefer"}

    def test_bearer_token_format(self):
        """Authorization header uses Bearer token format."""
        h = _headers()
        assert h["Authorization"] == f"Bearer {MOCK_KEY}"
        assert h["apikey"] == MOCK_KEY

    def test_custom_prefer_parameter(self):
        """Custom prefer parameter is passed through."""
        h = _headers(prefer="return=minimal")
        assert h["Prefer"] == "return=minimal"


# ── _request ──

class TestRequest:
    """Tests for _request() — low-level Supabase REST wrapper."""

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_get_request_no_body(self, mock_urlopen):
        """GET request sends no body."""
        mock_urlopen.return_value = _make_response([{"id": "abc"}])
        status, data = _request("GET", "content_items?select=id")
        assert status == 200
        assert data == [{"id": "abc"}]
        # Verify the Request object had no data (GET)
        call_args = mock_urlopen.call_args
        req = call_args[0][0]
        assert req.data is None
        assert req.method == "GET"

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_post_request_with_json_body(self, mock_urlopen):
        """POST request sends JSON-encoded body."""
        mock_urlopen.return_value = _make_response([{"id": "new-id"}], status=201)
        status, data = _request("POST", "content_items", {"title": "Test"})
        assert status == 201
        req = mock_urlopen.call_args[0][0]
        assert req.data == json.dumps({"title": "Test"}).encode("utf-8")
        assert req.method == "POST"

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_patch_request_with_json_body(self, mock_urlopen):
        """PATCH request sends JSON-encoded body."""
        mock_urlopen.return_value = _make_response(None, status=204)
        status, data = _request("PATCH", "content_items?id=eq.123", {"title": "Updated"})
        assert status == 204
        assert data is None
        req = mock_urlopen.call_args[0][0]
        assert req.method == "PATCH"

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_successful_response_parses_json(self, mock_urlopen):
        """Successful response body is parsed as JSON."""
        mock_urlopen.return_value = _make_response({"count": 42})
        status, data = _request("GET", "test")
        assert status == 200
        assert data == {"count": 42}

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_empty_response_body_returns_none(self, mock_urlopen):
        """Empty response body returns None as data."""
        mock_urlopen.return_value = _make_response(None, status=200)
        status, data = _request("GET", "test")
        assert status == 200
        assert data is None

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_http_error_returns_code_and_body(self, mock_urlopen):
        """HTTPError returns (error_code, error_body_string)."""
        mock_urlopen.side_effect = _make_http_error(409, '{"message":"conflict"}')
        status, body = _request("POST", "content_items", {"title": "Dup"})
        assert status == 409
        assert "conflict" in body


# ── insert_content_item ──

class TestInsertContentItem:
    """Tests for insert_content_item()."""

    @patch("kb_pipeline.store._request")
    def test_successful_insert_returns_id(self, mock_req):
        """Successful insert returns (True, item_id)."""
        mock_req.return_value = (201, [{"id": "item-uuid-123"}])
        success, item_id = insert_content_item({"title": "Test Article"})
        assert success is True
        assert item_id == "item-uuid-123"

    @patch("kb_pipeline.store._request")
    def test_product_description_auto_adds_keyword(self, mock_req):
        """product_description content type auto-injects keyword."""
        mock_req.return_value = (201, [{"id": "pd-id"}])
        record = {"content_type": "product_description", "ai_keywords": ["security"]}
        insert_content_item(record)
        # Verify the record passed to _request includes the auto-added keyword
        sent_record = mock_req.call_args[0][2]
        assert "product_description" in sent_record["ai_keywords"]
        assert "security" in sent_record["ai_keywords"]

    @patch("kb_pipeline.store._request")
    def test_failed_insert_returns_error(self, mock_req):
        """Failed insert returns (False, error_message)."""
        mock_req.return_value = (400, '{"message":"bad request"}')
        success, error = insert_content_item({"title": ""})
        assert success is False
        assert "bad request" in error

    @patch("kb_pipeline.store._request")
    def test_empty_response_list_returns_empty_id(self, mock_req):
        """201 with empty list returns (True, '')."""
        mock_req.return_value = (201, [])
        success, item_id = insert_content_item({"title": "Test"})
        assert success is True
        assert item_id == ""


# ── update_content_item ──

class TestUpdateContentItem:
    """Tests for update_content_item()."""

    @patch("kb_pipeline.store._request")
    def test_successful_update(self, mock_req):
        """Successful update (200/204) returns True."""
        mock_req.return_value = (204, None)
        assert update_content_item("abc-123", {"title": "New"}) is True

    @patch("kb_pipeline.store._request")
    def test_failed_update(self, mock_req):
        """Failed update returns False."""
        mock_req.return_value = (500, "Internal error")
        assert update_content_item("abc-123", {"title": "Bad"}) is False

    @patch("kb_pipeline.store._request")
    def test_correct_path_construction(self, mock_req):
        """Path includes the item ID in PostgREST filter format."""
        mock_req.return_value = (204, None)
        update_content_item("my-uuid-456", {"title": "X"})
        call_path = mock_req.call_args[0][1]
        assert call_path == "content_items?id=eq.my-uuid-456"


# ── merge_item_metadata ──

class TestMergeItemMetadata:
    """Tests for merge_item_metadata() — RPC-based JSONB merge."""

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_successful_merge(self, mock_urlopen):
        """Successful RPC call returns True."""
        mock_urlopen.return_value = _make_response(None, status=200)
        assert merge_item_metadata("item-1", {"key": "val"}) is True

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_http_error_returns_false(self, mock_urlopen):
        """HTTPError during merge returns False."""
        mock_urlopen.side_effect = _make_http_error(500, "Server error")
        assert merge_item_metadata("item-1", {"key": "val"}) is False

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_correct_rpc_payload(self, mock_urlopen):
        """RPC payload includes p_item_id and p_new_data."""
        mock_urlopen.return_value = _make_response(None, status=200)
        merge_item_metadata("uuid-abc", {"extra": "data"})
        req = mock_urlopen.call_args[0][0]
        body = json.loads(req.data.decode("utf-8"))
        assert body["p_item_id"] == "uuid-abc"
        assert body["p_new_data"] == {"extra": "data"}
        assert "rpc/merge_item_metadata" in req.full_url


# ── check_url_exists ──

class TestCheckUrlExists:
    """Tests for check_url_exists()."""

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_url_found_returns_id(self, mock_urlopen):
        """Existing URL returns the item ID."""
        mock_urlopen.return_value = _make_response([{"id": "found-id"}])
        result = check_url_exists("https://example.com/article")
        assert result == "found-id"

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_url_not_found_returns_none(self, mock_urlopen):
        """Non-existent URL returns None."""
        mock_urlopen.return_value = _make_response([])
        result = check_url_exists("https://example.com/missing")
        assert result is None

    def test_empty_url_returns_none(self):
        """Empty URL returns None immediately without making a request."""
        assert check_url_exists("") is None
        assert check_url_exists(None) is None

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_url_is_percent_encoded(self, mock_urlopen):
        """URL with special characters is percent-encoded in query."""
        mock_urlopen.return_value = _make_response([])
        check_url_exists("https://example.com/path?q=hello world&x=1")
        req = mock_urlopen.call_args[0][0]
        # The source_url value should be percent-encoded (no raw spaces)
        assert "%20" in req.full_url or "+" in req.full_url
        assert " world" not in req.full_url


# ── log_quality_issue + resolve_quality_issue ──

class TestQualityIssues:
    """Tests for log_quality_issue() and resolve_quality_issue()."""

    @patch("kb_pipeline.store._request")
    def test_log_quality_issue_success(self, mock_req):
        """Successful quality issue logging returns True."""
        mock_req.return_value = (201, None)
        result = log_quality_issue("item-1", "short_content", severity="warning")
        assert result is True

    @patch("kb_pipeline.store._request")
    def test_log_quality_issue_correct_fields(self, mock_req):
        """Log sends correct record fields to Supabase."""
        mock_req.return_value = (201, None)
        log_quality_issue(
            "item-1", "low_confidence",
            severity="error",
            details={"score": 0.45},
            source_url="https://example.com",
            batch_name="batch-001",
        )
        sent_record = mock_req.call_args[0][2]
        assert sent_record["content_item_id"] == "item-1"
        assert sent_record["flag_type"] == "low_confidence"
        assert sent_record["severity"] == "error"
        assert sent_record["details"] == {"score": 0.45}
        assert sent_record["source_url"] == "https://example.com"
        assert sent_record["ingestion_batch"] == "batch-001"

    @patch("kb_pipeline.store._request")
    def test_resolve_sets_resolved_fields(self, mock_req):
        """resolve_quality_issue sets resolved=True with timestamp."""
        mock_req.return_value = (200, None)
        result = resolve_quality_issue("item-1", "short_content", notes="Fixed")
        assert result is True
        sent_updates = mock_req.call_args[0][2]
        assert sent_updates["resolved"] is True
        assert "resolved_at" in sent_updates
        assert sent_updates["resolved_by"] == "pipeline"
        assert sent_updates["resolution_notes"] == "Fixed"


# ── fetch_records ──

class TestFetchRecords:
    """Tests for fetch_records() — paginated content item retrieval."""

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_paginated_results_returned(self, mock_urlopen):
        """Multiple pages are fetched and combined."""
        page1 = [{"id": f"item-{i}"} for i in range(50)]
        page2 = [{"id": f"item-{i}"} for i in range(50, 75)]
        mock_urlopen.side_effect = [
            _make_response(page1),
            _make_response(page2),
        ]
        records = fetch_records()
        assert len(records) == 75

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_respects_limit(self, mock_urlopen):
        """Results are truncated to the specified limit."""
        page = [{"id": f"item-{i}"} for i in range(50)]
        mock_urlopen.return_value = _make_response(page)
        records = fetch_records(limit=10)
        assert len(records) == 10

    @patch("kb_pipeline.store.urllib.request.urlopen")
    def test_http_error_stops_pagination(self, mock_urlopen):
        """HTTPError during fetch stops pagination and returns partial results."""
        mock_urlopen.side_effect = _make_http_error(500, "Server error")
        records = fetch_records()
        assert records == []


# ── fetch_taxonomy ──

class TestFetchTaxonomy:
    """Tests for fetch_taxonomy()."""

    @patch("kb_pipeline.store._request")
    def test_returns_domains_and_subtopics_tuple(self, mock_req):
        """Successful fetch returns (domains, subtopics) tuple."""
        domains = [{"id": 1, "name": "Security"}]
        subtopics = [{"id": 10, "domain_id": 1, "name": "Access Control"}]
        mock_req.side_effect = [
            (200, domains),
            (200, subtopics),
        ]
        result = fetch_taxonomy()
        assert result == (domains, subtopics)

    @patch("kb_pipeline.store._request")
    def test_non_200_raises_runtime_error(self, mock_req):
        """Non-200 status for domains raises RuntimeError."""
        mock_req.return_value = (500, "Server error")
        with pytest.raises(RuntimeError, match="Failed to fetch taxonomy domains"):
            fetch_taxonomy()

    @patch("kb_pipeline.store._request")
    def test_non_200_subtopics_raises_runtime_error(self, mock_req):
        """Non-200 status for subtopics raises RuntimeError."""
        mock_req.side_effect = [
            (200, [{"id": 1, "name": "Security"}]),
            (500, "Server error"),
        ]
        with pytest.raises(RuntimeError, match="Failed to fetch taxonomy subtopics"):
            fetch_taxonomy()
