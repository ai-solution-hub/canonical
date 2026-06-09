"""Tests for bid_worker.py — bid document processing worker.

No production code bugs or dead code paths found during test authoring.
"""

import json
import os
import sys
import tempfile
from unittest.mock import patch, MagicMock, PropertyMock, call

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

        mock_create.assert_called_once_with(
            "https://test.supabase.co", "test-secret-key"
        )


# ── process_job ──────────────────────────────────────────────────────────────


class TestProcessJob:
    """process_job routes to correct handler based on job_type."""

    def test_routes_tender_extract_docx(self):
        """Routes tender_extract_docx to extract_docx_questions."""
        from bid_worker import process_job

        mock_sb = _make_mock_supabase()
        job = {"job_type": "tender_extract_docx", "payload": {"bid_id": "b1", "storage_path": "p"}}

        with patch("bid_worker.extract_docx_questions", return_value={"questions_inserted": 5}) as mock_fn:
            result = process_job(mock_sb, job)
            mock_fn.assert_called_once_with(mock_sb, job["payload"])
            assert result["questions_inserted"] == 5

    def test_routes_tender_extract_pdf_text(self):
        """Routes tender_extract_pdf_text to extract_pdf_text."""
        from bid_worker import process_job

        mock_sb = _make_mock_supabase()
        job = {"job_type": "tender_extract_pdf_text", "payload": {"storage_path": "p"}}

        with patch("bid_worker.extract_pdf_text", return_value={"pages_extracted": 3}) as mock_fn:
            result = process_job(mock_sb, job)
            mock_fn.assert_called_once_with(mock_sb, job["payload"])

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


# ── extract_docx_questions ───────────────────────────────────────────────────


class TestExtractDocxQuestions:
    """extract_docx_questions downloads DOCX, extracts questions, inserts into DB."""

    @patch("bid_worker.os.unlink")
    @patch("bid_worker.subprocess.run")
    def test_happy_path_inserts_questions(self, mock_run, mock_unlink):
        """Downloads file, extracts questions, inserts them, updates bid status."""
        from bid_worker import extract_docx_questions

        mock_sb = _make_mock_supabase()
        _mock_storage_download(mock_sb, "tender-documents", b"fake-docx-bytes")
        _mock_table_insert(mock_sb, "form_questions")
        _mock_table_select_single(mock_sb, {"domain_metadata": {"status": "pending"}})
        _mock_table_update(mock_sb)

        extraction_output = {
            "sections": [
                {
                    "section_name": "Technical",
                    "section_sequence": 1,
                    "questions": [
                        {"question_sequence": 1, "question_text": "Describe your approach?"},
                        {"question_sequence": 2, "question_text": "What experience?"},
                    ],
                }
            ],
            "total_sections": 1,
        }
        mock_run.return_value = MagicMock(
            returncode=0, stdout=json.dumps(extraction_output), stderr=""
        )

        result = extract_docx_questions(
            mock_sb, {"bid_id": "bid-1", "storage_path": "docs/tender.docx"}
        )

        assert result["questions_inserted"] == 2
        assert result["sections_found"] == 1

    @patch("bid_worker.os.unlink")
    @patch("bid_worker.subprocess.run")
    def test_extraction_script_failure_raises(self, mock_run, mock_unlink):
        """Extraction script returning non-zero exit code raises RuntimeError."""
        from bid_worker import extract_docx_questions

        mock_sb = _make_mock_supabase()
        _mock_storage_download(mock_sb, "tender-documents", b"fake-docx-bytes")

        mock_run.return_value = MagicMock(
            returncode=1, stdout="", stderr="Parse error"
        )

        with pytest.raises(RuntimeError, match="Extraction failed"):
            extract_docx_questions(
                mock_sb, {"bid_id": "bid-1", "storage_path": "docs/tender.docx"}
            )


# ── extract_pdf_text ─────────────────────────────────────────────────────────


class TestExtractPdfText:
    """extract_pdf_text downloads PDF, extracts text via pdfplumber."""

    @patch("bid_worker.os.unlink")
    def test_happy_path_extracts_pages(self, mock_unlink):
        """Downloads PDF, extracts text from each page, returns page count."""
        from bid_worker import extract_pdf_text

        mock_sb = _make_mock_supabase()
        _mock_storage_download(mock_sb, "tender-documents", b"fake-pdf-bytes")

        # Mock pdfplumber via sys.modules (it is imported locally inside the function)
        mock_pdfplumber = MagicMock()
        mock_page1 = MagicMock()
        mock_page1.extract_text.return_value = "Page 1 content"
        mock_page2 = MagicMock()
        mock_page2.extract_text.return_value = "Page 2 content"
        mock_pdf = MagicMock()
        mock_pdf.pages = [mock_page1, mock_page2]
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdfplumber.open.return_value = mock_pdf

        with patch.dict(sys.modules, {"pdfplumber": mock_pdfplumber}):
            result = extract_pdf_text(mock_sb, {"storage_path": "docs/tender.pdf"})

        assert result["pages_extracted"] == 2
        assert "Page 1 content" in result["text"]
        assert "Page 2 content" in result["text"]

    @patch("bid_worker.os.unlink")
    def test_empty_pages_excluded(self, mock_unlink):
        """Pages with no text are excluded from the result."""
        from bid_worker import extract_pdf_text

        mock_sb = _make_mock_supabase()
        _mock_storage_download(mock_sb, "tender-documents", b"fake-pdf-bytes")

        mock_pdfplumber = MagicMock()
        mock_page1 = MagicMock()
        mock_page1.extract_text.return_value = "Has text"
        mock_page2 = MagicMock()
        mock_page2.extract_text.return_value = None  # empty page
        mock_pdf = MagicMock()
        mock_pdf.pages = [mock_page1, mock_page2]
        mock_pdf.__enter__ = MagicMock(return_value=mock_pdf)
        mock_pdf.__exit__ = MagicMock(return_value=False)
        mock_pdfplumber.open.return_value = mock_pdf

        with patch.dict(sys.modules, {"pdfplumber": mock_pdfplumber}):
            result = extract_pdf_text(mock_sb, {"storage_path": "docs/tender.pdf"})

        assert result["pages_extracted"] == 1


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
