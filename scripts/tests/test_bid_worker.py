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
        job = {"job_type": "template_fill", "payload": {"form_id": "f1"}}

        with patch("bid_worker.fill_template_job", return_value={"fields_filled": 8}) as mock_fn:
            result = process_job(mock_sb, job)
            mock_fn.assert_called_once_with(mock_sb, job["payload"])

    def test_routes_analyse_form(self):
        """Routes analyse_form to analyse_form_job (ID-145 {145.13})."""
        from bid_worker import process_job

        mock_sb = _make_mock_supabase()
        job = {
            "job_type": "analyse_form",
            "payload": {"body": {"form_id": "f1"}, "auth_context": {}},
        }

        with patch(
            "bid_worker.analyse_form_job",
            return_value={"plane1_questions_inserted": 0},
        ) as mock_fn:
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
    """fill_template_job fills a form's fillable slots — per-format writer
    dispatch (DOCX/PDF/XLSX) with a re-entrant, idempotent-over-
    already-filled contract (ID-145 {145.15}, BI-22, TECH.md §3.3/§3.4)."""

    def _wire_no_prior_filled_fields(self, mock_sb):
        """Idempotency SELECT (form_instance_fields by id) returns no rows
        — nothing is already 'filled', so every mapping stays outstanding."""
        result = MagicMock()
        result.data = []
        (
            mock_sb.from_.return_value.select.return_value.in_.return_value.execute
        ).return_value = result

    def _wire_prior_filled_fields(self, mock_sb, filled_ids):
        result = MagicMock()
        result.data = [{"id": fid, "fill_status": "filled"} for fid in filled_ids]
        (
            mock_sb.from_.return_value.select.return_value.in_.return_value.execute
        ).return_value = result

    def _wire_form(self, mock_sb, form_id, storage_path, mime_type):
        _mock_table_select_single(
            mock_sb,
            {"id": form_id, "storage_path": storage_path, "mime_type": mime_type},
        )

    def _wire_no_prior_completion(self, mock_sb):
        """No existing template_completions row — first fill pass, base
        artefact is the pristine original / fillable.pdf."""
        result = MagicMock()
        result.data = []
        (
            mock_sb.from_.return_value.select.return_value.eq.return_value
            .order.return_value.limit.return_value.execute
        ).return_value = result

    def _wire_prior_completion(self, mock_sb, storage_path):
        """An existing template_completions row — re-fill pass, base
        artefact is the LATEST completion's own output."""
        result = MagicMock()
        result.data = [{"storage_path": storage_path}]
        (
            mock_sb.from_.return_value.select.return_value.eq.return_value
            .order.return_value.limit.return_value.execute
        ).return_value = result

    def _wire_completion_insert(self, mock_sb, completion_id="completion-1"):
        result = MagicMock()
        result.data = [{"id": completion_id}]
        mock_sb.from_.return_value.insert.return_value.execute.return_value = result

    @patch("bid_worker.os.path.exists", return_value=True)
    @patch("bid_worker.os.unlink")
    @patch("bid_worker.os.path.getsize", return_value=12345)
    @patch("bid_worker._validate_completed_document", return_value=[])
    @patch("bid_worker.fill_template")
    def test_docx_happy_path_creates_completion_and_marks_filled(
        self, mock_fill, mock_validate, mock_getsize, mock_unlink, mock_exists
    ):
        """DOCX: downloads original, fills it, uploads completed doc,
        creates a form_instance_id-keyed completion, marks the field
        filled, sets processing_status='completed'."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_no_prior_filled_fields(mock_sb)
        self._wire_form(mock_sb, "form-1", "form-1/document.docx", _DOCX_MIME)
        self._wire_no_prior_completion(mock_sb)
        _mock_storage_download(mock_sb, "tender-documents", b"fake-docx-bytes")
        mock_sb.storage.from_.return_value.upload.return_value = None
        self._wire_completion_insert(mock_sb)
        _mock_table_update(mock_sb)

        mock_fill.return_value = {
            "fields_filled": 1,
            "fields_skipped": 0,
            "fields_failed": 0,
            "errors": [],
            "truncated": [],
        }

        with patch("builtins.open", MagicMock()):
            result = fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 0,
                     "response_text": "Answer 1", "word_limit": None},
                ],
                "user_id": "user-1",
                "options": {},
            })

        assert result["fields_filled"] == 1
        assert result["completion_id"] == "completion-1"
        mock_fill.assert_called_once()
        mock_sb.storage.from_.assert_any_call("tender-documents")
        insert_arg = mock_sb.from_.return_value.insert.call_args[0][0]
        assert insert_arg["form_instance_id"] == "form-1"
        mock_sb.from_.return_value.update.assert_any_call(
            {"fill_status": "filled", "fill_error": None}
        )
        mock_sb.from_.return_value.update.assert_any_call(
            {"processing_status": "completed"}
        )

    @patch("bid_worker.os.path.exists", return_value=True)
    @patch("bid_worker.os.unlink")
    @patch("bid_worker.os.path.getsize", return_value=999)
    @patch("bid_worker.fill_pdf_template")
    def test_pdf_first_pass_uses_fillable_artefact_as_base(self, mock_fill_pdf, *_mocks):
        """PDF, no prior completion: downloads {form_id}/fillable.pdf (the
        plane-2 fillable artefact) as the base, not the original PDF."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_no_prior_filled_fields(mock_sb)
        self._wire_form(mock_sb, "form-1", "form-1/document.pdf", _PDF_MIME)
        self._wire_no_prior_completion(mock_sb)
        _mock_storage_download(mock_sb, "tender-documents", b"%PDF-fillable")
        mock_sb.storage.from_.return_value.upload.return_value = None
        self._wire_completion_insert(mock_sb)
        _mock_table_update(mock_sb)

        mock_fill_pdf.return_value = {
            "fields_filled": 1, "fields_skipped": 0, "fields_failed": 0,
            "errors": [], "truncated": [],
        }

        with patch("builtins.open", MagicMock()):
            fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 0,
                     "response_text": "Answer", "word_limit": None},
                ],
                "user_id": "user-1",
            })

        mock_sb.storage.from_.return_value.download.assert_any_call(
            "form-1/fillable.pdf"
        )
        mock_fill_pdf.assert_called_once()

    @patch("bid_worker.os.path.exists", return_value=True)
    @patch("bid_worker.os.unlink")
    @patch("bid_worker.os.path.getsize", return_value=999)
    @patch("bid_worker.fill_pdf_template")
    def test_refill_pass_uses_latest_completion_as_base(self, mock_fill_pdf, *_mocks):
        """A re-fill pass downloads the LATEST template_completions row's
        storage_path as the base — not the pristine fillable.pdf — so a
        prior pass's answers persist into this pass's output (BI-22)."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_no_prior_filled_fields(mock_sb)
        self._wire_form(mock_sb, "form-1", "form-1/document.pdf", _PDF_MIME)
        self._wire_prior_completion(mock_sb, "form-1/completed_20260101T000000Z.pdf")
        _mock_storage_download(mock_sb, "tender-documents", b"%PDF-prior-completion")
        mock_sb.storage.from_.return_value.upload.return_value = None
        self._wire_completion_insert(mock_sb, "completion-2")
        _mock_table_update(mock_sb)

        mock_fill_pdf.return_value = {
            "fields_filled": 1, "fields_skipped": 0, "fields_failed": 0,
            "errors": [], "truncated": [],
        }

        with patch("builtins.open", MagicMock()):
            fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f2", "table_index": 0, "row_index": 1,
                     "response_text": "Second answer", "word_limit": None},
                ],
                "user_id": "user-1",
            })

        mock_sb.storage.from_.return_value.download.assert_any_call(
            "form-1/completed_20260101T000000Z.pdf"
        )

    @patch("bid_worker.os.path.exists", return_value=True)
    @patch("bid_worker.os.unlink")
    @patch("bid_worker.os.path.getsize", return_value=999)
    @patch("bid_worker.fill_xlsx_template")
    def test_xlsx_happy_path_dispatches_to_xlsx_writer(self, mock_fill_xlsx, *_mocks):
        """XLSX mime_type routes to fill_xlsx_template, not fill_template."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_no_prior_filled_fields(mock_sb)
        self._wire_form(mock_sb, "form-1", "form-1/document.xlsx", _XLSX_MIME)
        self._wire_no_prior_completion(mock_sb)
        _mock_storage_download(mock_sb, "tender-documents", b"fake-xlsx-bytes")
        mock_sb.storage.from_.return_value.upload.return_value = None
        self._wire_completion_insert(mock_sb)
        _mock_table_update(mock_sb)

        mock_fill_xlsx.return_value = {
            "fields_filled": 1, "fields_skipped": 0, "fields_failed": 0,
            "errors": [], "truncated": [],
        }

        with patch("builtins.open", MagicMock()):
            fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 1, "col_index": 2,
                     "response_text": "Answer", "word_limit": None},
                ],
                "user_id": "user-1",
            })

        mock_fill_xlsx.assert_called_once()

    def test_skips_already_filled_fields_before_calling_writer(self):
        """Idempotency (BI-22): a mapping whose CURRENT fill_status is
        already 'filled' is dropped BEFORE the writer runs — a re-fill
        pass only touches outstanding gaps, even given a stale/superset
        mapping list."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_prior_filled_fields(mock_sb, ["f1"])
        self._wire_form(mock_sb, "form-1", "form-1/document.docx", _DOCX_MIME)
        self._wire_no_prior_completion(mock_sb)
        _mock_storage_download(mock_sb, "tender-documents", b"fake-docx-bytes")
        mock_sb.storage.from_.return_value.upload.return_value = None
        self._wire_completion_insert(mock_sb)
        _mock_table_update(mock_sb)

        with patch("bid_worker.fill_template") as mock_fill, \
             patch("bid_worker._validate_completed_document", return_value=[]), \
             patch("bid_worker.os.path.exists", return_value=True), \
             patch("bid_worker.os.unlink"), \
             patch("bid_worker.os.path.getsize", return_value=1), \
             patch("builtins.open", MagicMock()):
            mock_fill.return_value = {
                "fields_filled": 1, "fields_skipped": 0, "fields_failed": 0,
                "errors": [], "truncated": [],
            }
            fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 0,
                     "response_text": "Already filled — should not redo", "word_limit": None},
                    {"field_id": "f2", "table_index": 0, "row_index": 1,
                     "response_text": "Gap — should fill", "word_limit": None},
                ],
                "user_id": "user-1",
            })

            passed_mappings = mock_fill.call_args[0][2]
            assert len(passed_mappings) == 1
            assert passed_mappings[0]["field_id"] == "f2"

    def test_all_fields_already_filled_is_noop(self):
        """Every mapped field already 'filled' -> no writer call, no
        storage I/O, no new completion, no status transition."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_prior_filled_fields(mock_sb, ["f1"])

        with patch("bid_worker.fill_template") as mock_fill:
            result = fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 0,
                     "response_text": "Already filled", "word_limit": None},
                ],
                "user_id": "user-1",
            })

        mock_fill.assert_not_called()
        mock_sb.storage.from_.assert_not_called()
        assert result["completion_id"] is None
        assert result["fields_filled"] == 0

    @patch("bid_worker.os.path.exists", return_value=False)
    @patch("bid_worker.os.unlink")
    @patch("bid_worker.fill_template", side_effect=Exception("Fill error"))
    def test_writer_failure_marks_fill_failed_never_partial_coverage(
        self, mock_fill, mock_unlink, mock_exists
    ):
        """An engine/IO error during the writer sets processing_status to
        'fill_failed' — the ONLY path that ever sets fill_failed (BI-22:
        partial coverage / fields_skipped is a success, never this)."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_no_prior_filled_fields(mock_sb)
        self._wire_form(mock_sb, "form-1", "form-1/document.docx", _DOCX_MIME)
        self._wire_no_prior_completion(mock_sb)
        _mock_storage_download(mock_sb, "tender-documents", b"fake-docx-bytes")
        _mock_table_update(mock_sb)

        with pytest.raises(Exception, match="Fill error"):
            fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 0,
                     "response_text": "Text", "word_limit": None},
                ],
                "user_id": "user-1",
            })

        mock_sb.from_.return_value.update.assert_any_call(
            {"processing_status": "fill_failed"}
        )

    def test_unrecognised_mime_type_raises_before_any_download(self):
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_no_prior_filled_fields(mock_sb)
        self._wire_form(mock_sb, "form-1", "form-1/document.txt", "text/plain")

        with pytest.raises(ValueError, match="unrecognised"):
            fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 0,
                     "response_text": "Text", "word_limit": None},
                ],
                "user_id": "user-1",
            })

        mock_sb.storage.from_.return_value.download.assert_not_called()

    def test_missing_form_instances_row_marks_fill_failed_never_stuck_at_filling(self):
        """ID-145 {145.33}: the setup phase (form lookup, mime resolution,
        completion lookup, base-template download) used to sit OUTSIDE the
        try/except that sets fill_failed — a missing form_instances row
        propagated uncaught and left the form stuck at 'filling' forever.
        A setup-phase lookup failure must now also mark fill_failed."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_no_prior_filled_fields(mock_sb)
        (
            mock_sb.from_.return_value.select.return_value
            .eq.return_value.single.return_value.execute
        ).side_effect = Exception("PGRST116: 0 rows returned")

        with pytest.raises(Exception, match="PGRST116"):
            fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 0,
                     "response_text": "Text", "word_limit": None},
                ],
                "user_id": "user-1",
            })

        mock_sb.from_.return_value.update.assert_any_call(
            {"processing_status": "fill_failed"}
        )

    def test_base_template_download_failure_marks_fill_failed_never_stuck_at_filling(
        self,
    ):
        """Same setup-phase gap (ID-145 {145.33}), different failure point:
        a storage error downloading the base/source template must also
        transition the form to fill_failed, not propagate uncaught."""
        from bid_worker import fill_template_job

        mock_sb = _make_mock_supabase()
        self._wire_no_prior_filled_fields(mock_sb)
        self._wire_form(mock_sb, "form-1", "form-1/document.docx", _DOCX_MIME)
        self._wire_no_prior_completion(mock_sb)
        mock_sb.storage.from_.return_value.download.side_effect = Exception(
            "storage: object not found"
        )

        with pytest.raises(Exception, match="object not found"):
            fill_template_job(mock_sb, {
                "form_id": "form-1",
                "field_mappings": [
                    {"field_id": "f1", "table_index": 0, "row_index": 0,
                     "response_text": "Text", "word_limit": None},
                ],
                "user_id": "user-1",
            })

        mock_sb.from_.return_value.update.assert_any_call(
            {"processing_status": "fill_failed"}
        )


# ── analyse_form (ID-145 {145.13}, BI-20) ────────────────────────────────────


class TestSniffContainer:
    """_sniff_container discriminates pdf / genuine OOXML / legacy OLE2."""

    def test_pdf_magic(self):
        from bid_worker import _sniff_container

        assert _sniff_container(b"%PDF-1.4\n...") == "pdf"

    def test_zip_magic_genuine_ooxml(self):
        from bid_worker import _sniff_container

        assert _sniff_container(b"PK\x03\x04rest-of-zip") == "zip"

    def test_ole2_magic_legacy_office(self):
        from bid_worker import _sniff_container

        assert (
            _sniff_container(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest") == "ole2"
        )

    def test_unknown_bytes(self):
        from bid_worker import _sniff_container

        assert _sniff_container(b"not a real document") == "unknown"


class TestConvertLegacyOfficeToOoxml:
    """_convert_legacy_office_to_ooxml shells out to soffice headless."""

    @patch("bid_worker.subprocess.run")
    def test_success_returns_converted_bytes(self, mock_run):
        from bid_worker import _convert_legacy_office_to_ooxml

        def _fake_run(cmd, capture_output, timeout):
            outdir = cmd[cmd.index("--outdir") + 1]
            with open(os.path.join(outdir, "input.docx"), "wb") as f:
                f.write(b"converted-docx-bytes")
            result = MagicMock()
            result.returncode = 0
            return result

        mock_run.side_effect = _fake_run

        output = _convert_legacy_office_to_ooxml(b"legacy-doc-bytes", "docx")
        assert output == b"converted-docx-bytes"

    @patch("bid_worker.subprocess.run")
    def test_nonzero_exit_raises(self, mock_run):
        from bid_worker import _convert_legacy_office_to_ooxml

        result = MagicMock()
        result.returncode = 1
        result.stderr = b"soffice: command not found"
        mock_run.return_value = result

        with pytest.raises(RuntimeError, match="LibreOffice conversion"):
            _convert_legacy_office_to_ooxml(b"legacy-doc-bytes", "docx")

    @patch("bid_worker.subprocess.run")
    def test_missing_output_file_raises(self, mock_run):
        """Exit 0 but no output file (e.g. soffice silently no-oped) still
        raises — never returns unconverted bytes."""
        from bid_worker import _convert_legacy_office_to_ooxml

        result = MagicMock()
        result.returncode = 0
        result.stderr = b""
        mock_run.return_value = result

        with pytest.raises(RuntimeError, match="LibreOffice conversion"):
            _convert_legacy_office_to_ooxml(b"legacy-doc-bytes", "docx")


class TestExtractPlane1Questions:
    """_extract_plane1_questions bridges to the internal extract-questions
    route and flattens its section/question tree."""

    @patch.dict(
        os.environ,
        {
            "NEXT_PUBLIC_APP_URL": "https://app.example.com",
            "PIPELINE_TRIGGER_SECRET": "sekret",
        },
        clear=False,
    )
    @patch("bid_worker.httpx.post")
    def test_flattens_sections_and_authenticates(self, mock_post):
        from bid_worker import _extract_plane1_questions

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "sections": [
                {
                    "section_name": "A",
                    "section_sequence": 0,
                    "questions": [
                        {
                            "question_text": "Q1?",
                            "question_sequence": 0,
                            "word_limit": 100,
                            "evaluation_weight": None,
                        }
                    ],
                }
            ]
        }
        mock_post.return_value = mock_response

        result = _extract_plane1_questions(b"pdf-bytes", "pdf")

        assert result == [
            {
                "section_name": "A",
                "section_sequence": 0,
                "question_text": "Q1?",
                "question_sequence": 0,
                "word_limit": 100,
                "evaluation_weight": None,
            }
        ]
        mock_response.raise_for_status.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == (
            "https://app.example.com/api/internal/procurement/extract-questions"
        )
        assert kwargs["headers"]["Authorization"] == "Bearer sekret"
        assert kwargs["json"]["format"] == "pdf"

    @patch.dict(
        os.environ,
        {"NEXT_PUBLIC_APP_URL": "", "PIPELINE_TRIGGER_SECRET": "", "CRON_SECRET": ""},
        clear=False,
    )
    def test_missing_env_raises(self):
        from bid_worker import _extract_plane1_questions

        with pytest.raises(RuntimeError, match="NEXT_PUBLIC_APP_URL"):
            _extract_plane1_questions(b"bytes", "pdf")


class TestWriteFormQuestions:
    """_write_form_questions dedups by question_text then upserts new rows."""

    def test_dedups_against_existing_rows(self):
        from bid_worker import _write_form_questions

        mock_sb = _make_mock_supabase()
        existing_result = MagicMock()
        existing_result.data = [{"question_text": "Existing Q?"}]
        (
            mock_sb.from_.return_value.select.return_value.eq.return_value.execute
        ).return_value = existing_result
        upsert_result = MagicMock()
        mock_sb.from_.return_value.upsert.return_value.execute.return_value = (
            upsert_result
        )

        count = _write_form_questions(
            mock_sb,
            "form-1",
            [
                {
                    "section_name": "A",
                    "section_sequence": 0,
                    "question_text": "Existing Q?",
                    "question_sequence": 0,
                    "word_limit": None,
                    "evaluation_weight": None,
                },
                {
                    "section_name": "A",
                    "section_sequence": 0,
                    "question_text": "New Q?",
                    "question_sequence": 1,
                    "word_limit": None,
                    "evaluation_weight": None,
                },
            ],
            created_by="user-1",
        )

        assert count == 1
        mock_sb.from_.return_value.upsert.assert_called_once()
        inserts_arg = mock_sb.from_.return_value.upsert.call_args[0][0]
        assert len(inserts_arg) == 1
        assert inserts_arg[0]["question_text"] == "New Q?"
        assert inserts_arg[0]["created_by"] == "user-1"
        assert inserts_arg[0]["form_instance_id"] == "form-1"

    def test_empty_questions_is_noop(self):
        from bid_worker import _write_form_questions

        mock_sb = _make_mock_supabase()
        count = _write_form_questions(mock_sb, "form-1", [], created_by=None)
        assert count == 0
        mock_sb.from_.assert_not_called()


class TestWriteFormInstanceFields:
    """_write_form_instance_fields maps ExtractedField rows to
    form_instance_fields insert dicts."""

    def test_maps_extracted_field_rows(self):
        from bid_worker import _write_form_instance_fields
        from scripts.cocoindex_pipeline.form_extractors.shared import ExtractedField

        mock_sb = _make_mock_supabase()
        insert_result = MagicMock()
        mock_sb.from_.return_value.insert.return_value.execute.return_value = (
            insert_result
        )

        field = ExtractedField(
            question_text="Q1?",
            field_type="empty_cell",
            fill_status="pending",
            table_index=0,
            row_index=1,
            sequence=1,
        )
        count = _write_form_instance_fields(mock_sb, "form-1", [field])

        assert count == 1
        mock_sb.from_.assert_called_with("form_instance_fields")
        rows_arg = mock_sb.from_.return_value.insert.call_args[0][0]
        assert rows_arg[0]["form_instance_id"] == "form-1"
        assert rows_arg[0]["mapping_status"] == "unreviewed"
        assert rows_arg[0]["fill_status"] == "pending"
        assert rows_arg[0]["table_index"] == 0
        assert rows_arg[0]["row_index"] == 1

    def test_empty_fields_is_noop(self):
        from bid_worker import _write_form_instance_fields

        mock_sb = _make_mock_supabase()
        count = _write_form_instance_fields(mock_sb, "form-1", [])
        assert count == 0
        mock_sb.from_.assert_not_called()


_DOCX_MIME = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
_PDF_MIME = "application/pdf"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class TestAnalyseFormJob:
    """analyse_form_job orchestrates format-routing + both extraction
    planes (ID-145 {145.13} testStrategy)."""

    def _wire_form_questions_dedup_noop(self, mock_sb):
        """Configure the form_questions dedup SELECT to return no existing
        rows, so every extracted question is treated as new."""
        existing_result = MagicMock()
        existing_result.data = []
        (
            mock_sb.from_.return_value.select.return_value.eq.return_value.execute
        ).return_value = existing_result

    @patch("bid_worker._extract_plane1_questions")
    @patch("bid_worker.extract_form_structure")
    def test_docx_happy_path_writes_both_planes_and_marks_analysed(
        self, mock_extract, mock_plane1
    ):
        from bid_worker import analyse_form_job
        from scripts.cocoindex_pipeline.form_extractors.shared import (
            ExtractedField,
            ExtractedForm,
            FormMetadata,
        )

        mock_sb = _make_mock_supabase()
        _mock_table_select_single(
            mock_sb,
            {
                "id": "form-1",
                "storage_path": "form-1/document.docx",
                "mime_type": _DOCX_MIME,
            },
        )
        mock_sb.storage.from_.return_value.download.return_value = (
            b"PK\x03\x04fake-docx-bytes"
        )
        self._wire_form_questions_dedup_noop(mock_sb)
        mock_sb.from_.return_value.upsert.return_value.execute.return_value = (
            MagicMock()
        )
        mock_sb.from_.return_value.insert.return_value.execute.return_value = (
            MagicMock()
        )
        mock_sb.from_.return_value.update.return_value.eq.return_value.execute.return_value = (
            MagicMock()
        )

        async def _fake_extract(raw_bytes: bytes, filename: str):
            assert filename == "document.docx"
            assert raw_bytes.startswith(b"PK\x03\x04")
            return ExtractedForm(
                form_metadata=FormMetadata(
                    form_type="questionnaire", form_format="docx"
                ),
                fields=[
                    ExtractedField(
                        question_text="Q1?",
                        field_type="empty_cell",
                        fill_status="pending",
                        sequence=0,
                    )
                ],
            )

        mock_extract.side_effect = _fake_extract
        mock_plane1.return_value = [
            {
                "section_name": "A",
                "section_sequence": 0,
                "question_text": "Q1?",
                "question_sequence": 0,
                "word_limit": None,
                "evaluation_weight": None,
            }
        ]

        result = analyse_form_job(
            mock_sb,
            {
                "body": {"form_id": "form-1"},
                "auth_context": {"user_id": "user-1", "role": "editor"},
            },
        )

        assert result["plane1_questions_inserted"] == 1
        assert result["plane2_fields_inserted"] == 1
        assert result["plane1_error"] is None
        assert result["plane2_error"] is None
        mock_sb.from_.return_value.update.assert_any_call(
            {"processing_status": "analysed"}
        )

    @patch("bid_worker._extract_plane1_questions")
    @patch("bid_worker.extract_form_structure")
    @patch("bid_worker._convert_legacy_office_to_ooxml")
    def test_legacy_doc_converts_then_routes_to_docx_lane(
        self, mock_convert, mock_extract, mock_plane1
    ):
        """A .doc upload ({145.9}'s DR-059 contract: mime_type already says
        docx, but the stored bytes are still legacy OLE2) is LibreOffice-
        converted before the OOXML lane runs, and storage is overwritten
        with the real converted bytes."""
        from bid_worker import analyse_form_job
        from scripts.cocoindex_pipeline.form_extractors.shared import (
            ExtractedForm,
            FormMetadata,
        )

        mock_sb = _make_mock_supabase()
        _mock_table_select_single(
            mock_sb,
            {
                "id": "form-1",
                "storage_path": "form-1/document.docx",
                "mime_type": _DOCX_MIME,
            },
        )
        # OLE2 magic — a genuine legacy .doc wearing the target docx mime.
        mock_sb.storage.from_.return_value.download.return_value = (
            b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1legacy-doc-bytes"
        )
        mock_convert.return_value = b"PK\x03\x04converted-docx-bytes"
        self._wire_form_questions_dedup_noop(mock_sb)
        mock_sb.from_.return_value.update.return_value.eq.return_value.execute.return_value = (
            MagicMock()
        )

        async def _fake_extract(raw_bytes: bytes, filename: str):
            assert raw_bytes == b"PK\x03\x04converted-docx-bytes"
            return ExtractedForm(
                form_metadata=FormMetadata(
                    form_type="questionnaire", form_format="docx"
                ),
                fields=[],
            )

        mock_extract.side_effect = _fake_extract
        mock_plane1.return_value = []

        analyse_form_job(
            mock_sb, {"body": {"form_id": "form-1"}, "auth_context": {}}
        )

        mock_convert.assert_called_once_with(
            b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1legacy-doc-bytes", "docx"
        )
        mock_sb.storage.from_.return_value.upload.assert_any_call(
            "form-1/document.docx",
            b"PK\x03\x04converted-docx-bytes",
            {"content-type": _DOCX_MIME, "upsert": "true"},
        )

    def test_pdf_happy_path_uploads_fillable_artefact(self):
        from bid_worker import analyse_form_job
        import bid_worker

        mock_sb = _make_mock_supabase()
        _mock_table_select_single(
            mock_sb,
            {
                "id": "form-1",
                "storage_path": "form-1/document.pdf",
                "mime_type": _PDF_MIME,
            },
        )
        mock_sb.storage.from_.return_value.download.return_value = (
            b"%PDF-1.4-fake-bytes"
        )
        self._wire_form_questions_dedup_noop(mock_sb)
        mock_sb.from_.return_value.update.return_value.eq.return_value.execute.return_value = (
            MagicMock()
        )

        fake_field = MagicMock(
            question_text="Company name?",
            page_number=0,
            sequence=0,
            geometry=None,
        )
        fake_pdf_result = MagicMock(
            fields=[fake_field], fillable_pdf_bytes=b"%PDF-fillable-artefact"
        )

        with patch.object(
            bid_worker._form_orchestrator,
            "_detect_pdf_fields",
            return_value=fake_pdf_result,
        ) as mock_detect, patch.object(
            bid_worker, "_extract_plane1_questions", return_value=[]
        ):
            result = analyse_form_job(
                mock_sb, {"body": {"form_id": "form-1"}, "auth_context": {}}
            )

        mock_detect.assert_called_once()
        assert result["plane2_fields_inserted"] == 1
        assert result["plane2_error"] is None
        mock_sb.storage.from_.return_value.upload.assert_any_call(
            "form-1/fillable.pdf",
            b"%PDF-fillable-artefact",
            {"content-type": "application/pdf", "upsert": "true"},
        )

    @patch("bid_worker._extract_plane1_questions")
    @patch("bid_worker.extract_form_structure")
    def test_both_planes_fail_raises_and_marks_analysis_failed(
        self, mock_extract, mock_plane1
    ):
        from bid_worker import analyse_form_job
        from scripts.cocoindex_pipeline.form_extractors.shared import (
            FormExtractionError,
        )

        mock_sb = _make_mock_supabase()
        _mock_table_select_single(
            mock_sb,
            {
                "id": "form-1",
                "storage_path": "form-1/document.docx",
                "mime_type": _DOCX_MIME,
            },
        )
        mock_sb.storage.from_.return_value.download.return_value = (
            b"PK\x03\x04fake-docx-bytes"
        )
        mock_sb.from_.return_value.update.return_value.eq.return_value.execute.return_value = (
            MagicMock()
        )

        async def _raise_extract(raw_bytes: bytes, filename: str):
            raise FormExtractionError("unreadable_docx", filename)

        mock_extract.side_effect = _raise_extract
        mock_plane1.side_effect = RuntimeError("Anthropic 529")

        with pytest.raises(RuntimeError, match="failed both planes"):
            analyse_form_job(
                mock_sb, {"body": {"form_id": "form-1"}, "auth_context": {}}
            )

        mock_sb.from_.return_value.update.assert_any_call(
            {"processing_status": "analysis_failed"}
        )

    @patch("bid_worker._extract_plane1_questions")
    @patch("bid_worker.extract_form_structure")
    def test_plane1_only_failure_still_succeeds_with_plane2_rows(
        self, mock_extract, mock_plane1
    ):
        """Inv-17-style: a Plane-1 failure must not prevent Plane-2's
        already-extracted rows from landing — the job succeeds with
        plane1_error populated rather than raising."""
        from bid_worker import analyse_form_job
        from scripts.cocoindex_pipeline.form_extractors.shared import (
            ExtractedField,
            ExtractedForm,
            FormMetadata,
        )

        mock_sb = _make_mock_supabase()
        _mock_table_select_single(
            mock_sb,
            {
                "id": "form-1",
                "storage_path": "form-1/document.docx",
                "mime_type": _DOCX_MIME,
            },
        )
        mock_sb.storage.from_.return_value.download.return_value = (
            b"PK\x03\x04fake-docx-bytes"
        )
        mock_sb.from_.return_value.insert.return_value.execute.return_value = (
            MagicMock()
        )
        mock_sb.from_.return_value.update.return_value.eq.return_value.execute.return_value = (
            MagicMock()
        )

        async def _fake_extract(raw_bytes: bytes, filename: str):
            return ExtractedForm(
                form_metadata=FormMetadata(
                    form_type="questionnaire", form_format="docx"
                ),
                fields=[
                    ExtractedField(
                        question_text="Q1?",
                        field_type="empty_cell",
                        fill_status="pending",
                        sequence=0,
                    )
                ],
            )

        mock_extract.side_effect = _fake_extract
        mock_plane1.side_effect = RuntimeError("Anthropic 529")

        result = analyse_form_job(
            mock_sb, {"body": {"form_id": "form-1"}, "auth_context": {}}
        )

        assert result["plane2_fields_inserted"] == 1
        assert result["plane1_error"] == "Anthropic 529"
        assert result["plane2_error"] is None
        mock_sb.from_.return_value.update.assert_any_call(
            {"processing_status": "analysed"}
        )

    def test_unrecognised_mime_type_raises_before_any_io(self):
        from bid_worker import analyse_form_job

        mock_sb = _make_mock_supabase()
        _mock_table_select_single(
            mock_sb,
            {
                "id": "form-1",
                "storage_path": "form-1/document.txt",
                "mime_type": "text/plain",
            },
        )

        with pytest.raises(ValueError, match="unrecognised"):
            analyse_form_job(
                mock_sb, {"body": {"form_id": "form-1"}, "auth_context": {}}
            )

        mock_sb.storage.from_.return_value.download.assert_not_called()

    def test_missing_form_instances_row_marks_analysis_failed_never_stuck_at_analysing(
        self,
    ):
        """ID-145 {145.33}: the analyse lane has the IDENTICAL setup-phase
        gap as the fill lane — form lookup, mime resolution, and source
        download sit OUTSIDE the try/except that sets analysis_failed. A
        missing form_instances row must now also mark analysis_failed
        rather than leaving the form stuck at 'analysing' forever."""
        from bid_worker import analyse_form_job

        mock_sb = _make_mock_supabase()
        (
            mock_sb.from_.return_value.select.return_value
            .eq.return_value.single.return_value.execute
        ).side_effect = Exception("PGRST116: 0 rows returned")

        with pytest.raises(Exception, match="PGRST116"):
            analyse_form_job(
                mock_sb, {"body": {"form_id": "form-1"}, "auth_context": {}}
            )

        mock_sb.from_.return_value.update.assert_any_call(
            {"processing_status": "analysis_failed"}
        )

    def test_source_download_failure_marks_analysis_failed_never_stuck_at_analysing(
        self,
    ):
        """Same setup-phase gap (ID-145 {145.33}), different failure point:
        a storage error downloading the source artefact must also
        transition the form to analysis_failed, not propagate uncaught."""
        from bid_worker import analyse_form_job

        mock_sb = _make_mock_supabase()
        _mock_table_select_single(
            mock_sb,
            {
                "id": "form-1",
                "storage_path": "form-1/document.docx",
                "mime_type": _DOCX_MIME,
            },
        )
        mock_sb.storage.from_.return_value.download.side_effect = Exception(
            "storage: object not found"
        )

        with pytest.raises(Exception, match="object not found"):
            analyse_form_job(
                mock_sb, {"body": {"form_id": "form-1"}, "auth_context": {}}
            )

        mock_sb.from_.return_value.update.assert_any_call(
            {"processing_status": "analysis_failed"}
        )
