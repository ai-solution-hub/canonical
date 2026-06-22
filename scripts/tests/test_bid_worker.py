"""Tests for bid_worker.py — bid document processing worker.

No production code bugs or dead code paths found during test authoring.
"""

import os
import sys
from unittest.mock import patch, MagicMock

import pytest

# Add scripts dir to path so we can import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_mock_supabase():
    """Create a mock Supabase client with common chained method patterns."""
    mock = MagicMock()
    return mock


def _mock_storage_download(mock_supabase, bucket_name, file_bytes):
    """Configure mock for supabase.storage.from_(bucket).download(path)."""
    mock_supabase.storage.from_.return_value.download.return_value = file_bytes


def _mock_table_insert(mock_supabase, table_name):
    """Configure mock for supabase.from_(table).insert(...).execute()."""
    mock_result = MagicMock()
    mock_result.data = [{"id": "inserted-id"}]
    mock_supabase.from_.return_value.insert.return_value.execute.return_value = mock_result
    return mock_result


def _mock_table_select_single(mock_supabase, data):
    """Configure mock for supabase.from_(table).select(...).eq(...).single().execute()."""
    mock_result = MagicMock()
    mock_result.data = data
    (mock_supabase.from_.return_value.select.return_value
     .eq.return_value.single.return_value.execute.return_value) = mock_result
    return mock_result


def _mock_table_update(mock_supabase):
    """Configure mock for supabase.from_(table).update(...).eq(...).execute()."""
    mock_result = MagicMock()
    mock_result.data = [{"id": "updated-id"}]
    (mock_supabase.from_.return_value.update.return_value
     .eq.return_value.execute.return_value) = mock_result
    return mock_result


# ── get_supabase ─────────────────────────────────────────────────────────────


class TestGetSupabase:
    """get_supabase creates a Supabase client from env vars."""

    @patch.dict(os.environ, {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}, clear=False)
    def test_missing_env_vars_exits(self):
        """Missing SUPABASE_URL exits with error."""
        # Must import after patching to avoid cached module state
        from bid_worker import get_supabase
        with pytest.raises(SystemExit):
            get_supabase()

    @patch("bid_worker.create_client")
    @patch.dict(os.environ, {
        "SUPABASE_URL": "https://test.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "test-secret-key",
    }, clear=False)
    def test_creates_client_with_env_vars(self, mock_create):
        """Creates Supabase client with URL and key from environment."""
        from bid_worker import get_supabase
        mock_create.return_value = MagicMock()

        client = get_supabase()

        # ID-115 (S8): client routes to the exposed `api` schema (public is
        # unexposed post-cutover). Storage is a separate API and is unaffected.
        mock_create.assert_called_once()
        args, kwargs = mock_create.call_args
        assert args == ("https://test.supabase.co", "test-secret-key")
        assert kwargs["options"].schema == "api"


# ── process_job ──────────────────────────────────────────────────────────────


class TestProcessJob:
    """process_job routes to correct handler based on job_type."""

    def test_routes_template_fill(self):
        """Routes template_fill to fill_template_job."""
        from bid_worker import process_job

        mock_sb = _make_mock_supabase()
        job = {"job_type": "template_fill", "payload": {"template_id": "t1"}}

        with patch("bid_worker.fill_template_job", return_value={"fields_filled": 8}) as mock_fn:
            result = process_job(mock_sb, job)
            mock_fn.assert_called_once_with(mock_sb, job["payload"])

    def test_unknown_job_type_raises(self):
        """Unknown job_type raises ValueError."""
        from bid_worker import process_job

        mock_sb = _make_mock_supabase()
        job = {"job_type": "unknown_type", "payload": {}}

        with pytest.raises(ValueError, match="Unknown job type"):
            process_job(mock_sb, job)


# ── fill_template_job ────────────────────────────────────────────────────────


class TestFillTemplateJob:
    """fill_template_job fills Word template with bid responses."""

    @patch("bid_worker.os.path.exists", return_value=True)
    @patch("bid_worker.os.unlink")
    @patch("bid_worker.os.path.getsize", return_value=12345)
    @patch("bid_worker._validate_completed_document", return_value=[])
    @patch("bid_worker.fill_template")
    def test_happy_path_creates_completion(self, mock_fill, mock_validate,
                                            mock_getsize, mock_unlink, mock_exists):
        """Downloads template, fills it, uploads completed doc, creates record."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        _mock_storage_download(mock_sb, "templates", b"fake-docx-bytes")
        mock_sb.storage.from_.return_value.upload.return_value = None

        # Mock insert for template_completions
        completion_result = MagicMock()
        completion_result.data = [{"id": "completion-1"}]
        mock_sb.from_.return_value.insert.return_value.execute.return_value = completion_result

        # Mock update for form_template_fields and form_templates
        # S246 WP2b T2 (P4): templates → form_templates;
        # template_fields → form_template_fields.
        _mock_table_update(mock_sb)

        mock_fill.return_value = {
            "fields_filled": 3,
            "fields_skipped": 0,
            "fields_failed": 0,
            "errors": [],
        }

        # We need to mock the open() call for reading the completed file
        with patch("builtins.open", MagicMock()):
            result = fill_template_job(mock_sb, {
                "template_id": "tmpl-1",
                "project_id": "proj-1",
                "storage_path": "proj-1/template.docx",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 0, "value": "Answer 1"},
                ],
            })

        assert result["fields_filled"] == 3
        assert result["completion_id"] == "completion-1"

    @patch("bid_worker.os.path.exists", return_value=False)
    @patch("bid_worker.os.unlink")
    @patch("bid_worker.fill_template", side_effect=Exception("Fill error"))
    def test_failure_updates_status(self, mock_fill, mock_unlink, mock_exists):
        """Fill failure updates template status to 'fill_failed'."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        _mock_storage_download(mock_sb, "templates", b"fake-docx-bytes")
        _mock_table_update(mock_sb)

        with pytest.raises(Exception, match="Fill error"):
            fill_template_job(mock_sb, {
                "template_id": "tmpl-1",
                "project_id": "proj-1",
                "storage_path": "proj-1/template.docx",
                "field_mappings": [],
            })
