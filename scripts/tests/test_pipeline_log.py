"""Tests for pipeline_log.py — pipeline run logging to Supabase."""

import sys
import os
import json
import io
from unittest.mock import patch, MagicMock, Mock
from urllib.error import HTTPError

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

MOCK_URL = "https://test.supabase.co"
MOCK_KEY = "test-secret-key-abc123"


@pytest.fixture(autouse=True)
def mock_config():
    """Mock Supabase config for all tests."""
    with patch("kb_pipeline.pipeline_log.get_supabase_url", return_value=MOCK_URL), \
         patch("kb_pipeline.pipeline_log.get_supabase_secret_key", return_value=MOCK_KEY):
        yield


from kb_pipeline.pipeline_log import (
    _supabase_post,
    _supabase_patch,
    start_run,
    complete_run,
    fail_run,
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
        url="https://test.supabase.co/rest/v1/pipeline_runs",
        code=code,
        msg="Error",
        hdrs={},
        fp=io.BytesIO(body.encode("utf-8")),
    )


# ── start_run ──

class TestStartRun:
    """Tests for start_run()."""

    @patch("kb_pipeline.pipeline_log.urllib.request.urlopen")
    def test_returns_uuid_on_success(self, mock_urlopen):
        """Successful start_run returns the pipeline run UUID."""
        mock_urlopen.return_value = _make_response(
            [{"id": "run-uuid-123", "status": "running"}]
        )
        result = start_run("ingest")
        assert result == "run-uuid-123"

    @patch("kb_pipeline.pipeline_log.urllib.request.urlopen")
    def test_returns_none_on_failure(self, mock_urlopen):
        """HTTP error during start_run returns None."""
        mock_urlopen.side_effect = _make_http_error(500, "Server error")
        result = start_run("ingest")
        assert result is None


# ── complete_run ──

class TestCompleteRun:
    """Tests for complete_run()."""

    @patch("kb_pipeline.pipeline_log.urllib.request.urlopen")
    def test_sends_correct_patch_body(self, mock_urlopen):
        """PATCH body includes status, items_processed, completed_at, and optional cost."""
        mock_urlopen.return_value = _make_response(
            [{"id": "run-1", "status": "completed"}]
        )
        complete_run("run-1", items_processed=42, cost=1.23)
        req = mock_urlopen.call_args[0][0]
        body = json.loads(req.data.decode("utf-8"))
        assert body["status"] == "completed"
        assert body["items_processed"] == 42
        assert body["cost"] == 1.23
        assert "completed_at" in body
        assert "pipeline_runs?id=eq.run-1" in req.full_url

    @patch("kb_pipeline.pipeline_log.urllib.request.urlopen")
    def test_http_error_handled_gracefully(self, mock_urlopen):
        """HTTP error during complete_run does not raise — handled gracefully."""
        mock_urlopen.side_effect = _make_http_error(500, "Server error")
        # Should not raise
        complete_run("run-1", items_processed=10)


# ── fail_run ──

class TestFailRun:
    """Tests for fail_run()."""

    @patch("kb_pipeline.pipeline_log.urllib.request.urlopen")
    def test_sends_correct_patch_body(self, mock_urlopen):
        """PATCH body includes status=failed, completed_at, and error_message."""
        mock_urlopen.return_value = _make_response(
            [{"id": "run-1", "status": "failed"}]
        )
        fail_run("run-1", error_message="Something went wrong")
        req = mock_urlopen.call_args[0][0]
        body = json.loads(req.data.decode("utf-8"))
        assert body["status"] == "failed"
        assert body["error_message"] == "Something went wrong"
        assert "completed_at" in body

    @patch("kb_pipeline.pipeline_log.urllib.request.urlopen")
    def test_truncates_long_error_message(self, mock_urlopen):
        """Error message longer than 2000 chars is truncated."""
        mock_urlopen.return_value = _make_response(
            [{"id": "run-1", "status": "failed"}]
        )
        long_msg = "x" * 5000
        fail_run("run-1", error_message=long_msg)
        req = mock_urlopen.call_args[0][0]
        body = json.loads(req.data.decode("utf-8"))
        assert len(body["error_message"]) == 2000


# ── _supabase_post + _supabase_patch ──

class TestSupabaseHelpers:
    """Tests for _supabase_post and _supabase_patch HTTP error handling."""

    @patch("kb_pipeline.pipeline_log.urllib.request.urlopen")
    def test_supabase_post_http_error_returns_none(self, mock_urlopen):
        """_supabase_post returns None on HTTP error."""
        mock_urlopen.side_effect = _make_http_error(400, "Bad request")
        result = _supabase_post("pipeline_runs", {"status": "running"})
        assert result is None

    @patch("kb_pipeline.pipeline_log.urllib.request.urlopen")
    def test_supabase_patch_http_error_returns_none(self, mock_urlopen):
        """_supabase_patch returns None on HTTP error."""
        mock_urlopen.side_effect = _make_http_error(404, "Not found")
        result = _supabase_patch("pipeline_runs?id=eq.missing", {"status": "failed"})
        assert result is None
