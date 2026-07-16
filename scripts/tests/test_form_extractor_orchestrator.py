"""Tests for the ``extract_form_structure`` orchestrator (DR-058, ID-145.10).

The orchestrator is a plain deterministic ``(raw_bytes, filename) ->
ExtractedForm | None`` dispatcher (NO LLM): it routes to the per-format
reader by filename suffix and returns the reader's ``ExtractedForm`` — or
``None`` for non-form / out-of-scope inputs. No cocoindex dependency — the
{145.13} analyse_form worker calls it directly on the bytes it reads from
storage.

WHAT THIS PROVES:
  - ``.xlsx`` / ``.docx`` route to the matching reader's ``extract`` (called
    with the same raw bytes + filename the dispatcher received).
  - ``.pdf`` routes to ``_detect_pdf_fields`` ({145.11}'s commonforms
    detector) then shape-adapts the result to ``ExtractedForm`` via
    ``_pdf_result_to_extracted_form`` (ID-145.13 wiring — see the PDF
    WIRING note below); a detection failure wraps as this package's own
    ``FormExtractionError`` (Inv-17 parity with the docx/xlsx readers);
    with the heavy Plane-2 stack unavailable (``_detect_pdf_fields is
    None``), it returns ``None`` and logs
    ``form_extractor.skip``/``pdf_dependencies_unavailable`` instead of
    raising ``ImportError``.
  - ``.xls`` returns ``None`` and logs ``form_extractor.skip`` (Inv-3 — no raise).
  - Any other suffix (``.md``, ``.txt``) returns ``None`` (not a form).
  - The orchestrator is exported from the package ``__init__`` (the single
    public entry-point symbol).

RE-HOMING NOTE (ID-145.10 / DR-058): this file replaces the id-52 version,
which drove the orchestrator through a cocoindex ``FileLike`` fake and
covered a ``TestMemoHitSerdeRoundTrip`` class proving cocoindex's memo-serde
dict/typed round-trip via ``coerce_extracted_form``. Both are cocoindex-flow
machinery that no longer applies once the orchestrator is decoupled from the
corpus walk (DR-014) — dropped here, not carried forward as dead coverage.

PDF WIRING (ID-145.13): {145.11} landed its own commonforms-based module at
this package's ``pdf.py`` path (DR-057 — real UK procurement PDFs are FLAT,
so commonforms detection is mandatory), with a different output shape
(``PdfFieldDetectionResult``, not this package's ``ExtractedForm``).
{145.13} wires it into the dispatcher via ``_pdf_result_to_extracted_form``.
The PDF tests below monkeypatch ``orch_module._detect_pdf_fields`` with a
duck-typed ``SimpleNamespace`` fake (mirroring the ``PdfDetectedField`` /
``PdfFieldDetectionResult`` shape's attributes only — ``_pdf_result_to_
extracted_form`` never isinstance-checks) rather than importing the real
``pdf`` module, so these tests run WITHOUT the heavy commonforms/pypdf/
pdfplumber stack installed (S467 — matches ``test_pdf_field_detection.py``'s
own ``pytest.importorskip`` guard convention for real-behaviour coverage of
``detect_pdf_fields`` itself).

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.
"""

from __future__ import annotations

import asyncio
import json
import logging
from types import SimpleNamespace

import pytest

from scripts.cocoindex_pipeline.form_extractors import (
    extract_form_structure,
)
from scripts.cocoindex_pipeline.form_extractors import (
    orchestrator as orch_module,
)
from scripts.cocoindex_pipeline.form_extractors.shared import (
    ExtractedField,
    ExtractedForm,
    FormExtractionError,
    FormMetadata,
)

# A real, minimal, syntactically-valid single-page PDF (no fields, no
# content) — the orchestrator's not-wired ``.pdf`` branch never parses the
# bytes, but the ruling is explicit that this test must feed a REAL PDF, not
# an arbitrary byte string standing in for one.
_MINIMAL_PDF_BYTES = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n"
    b"%%EOF"
)


def _make_form(form_format: str) -> ExtractedForm:
    return ExtractedForm(
        form_metadata=FormMetadata(form_type="tender", form_format=form_format),
        fields=[
            ExtractedField(
                question_text="Q1?",
                field_type="empty_cell",
                fill_status="pending",
                sequence=0,
            )
        ],
    )


# ── Public-export contract ─────────────────────────────────────────────────


def test_extract_form_structure_exported_from_package() -> None:
    """The orchestrator is the single public entry-point symbol on the
    package init."""
    from scripts.cocoindex_pipeline import form_extractors

    assert hasattr(form_extractors, "extract_form_structure")
    assert callable(form_extractors.extract_form_structure)


# ── Suffix dispatch ─────────────────────────────────────────────────────────


class TestSuffixDispatch:
    def test_pdf_routes_to_detect_pdf_fields_and_shape_adapts(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """``.pdf`` dispatches to ``_detect_pdf_fields`` then shape-adapts
        via ``_pdf_result_to_extracted_form`` (ID-145.13 wiring).
        GEOMETRY-PERSISTENCE assertion: ``table_index`` <- page_number,
        ``row_index`` <- sequence, ``col_index`` stays unused (None).
        GEOMETRY CARRY-THROUGH assertion (ID-147 {147.9}): the
        detector's ``geometry`` dict rides through unchanged onto
        ``ExtractedField.geometry``."""
        fake_geometry = {
            "left": 0.1,
            "top": 0.2,
            "width": 0.3,
            "height": 0.05,
            "page": 2,
            "rotation": 0,
        }
        fake_field = SimpleNamespace(
            question_text="Company name?",
            page_number=2,
            sequence=5,
            geometry=fake_geometry,
        )
        fake_result = SimpleNamespace(
            fields=[fake_field], fillable_pdf_bytes=b"%PDF-fake-fillable"
        )

        def _fake_detect(raw_bytes: bytes, filename: str):
            assert raw_bytes == _MINIMAL_PDF_BYTES
            assert filename == "blank.pdf"
            return fake_result

        monkeypatch.setattr(orch_module, "_detect_pdf_fields", _fake_detect)

        result = asyncio.run(
            extract_form_structure(_MINIMAL_PDF_BYTES, "blank.pdf")
        )

        assert isinstance(result, ExtractedForm)
        assert result.form_metadata.form_format == "pdf"
        assert result.form_metadata.form_type == "questionnaire"
        assert len(result.fields) == 1
        field = result.fields[0]
        assert field.question_text == "Company name?"
        assert field.field_type == "empty_cell"
        assert field.fill_status == "pending"
        assert field.table_index == 2  # page_number
        assert field.row_index == 5  # sequence (reading order)
        assert field.col_index is None  # no column concept for flat PDF
        assert field.sequence == 5
        assert field.geometry == fake_geometry

    def test_pdf_field_with_no_geometry_degrades_to_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A detected field whose page rotation could not be normalised
        (pdf.py's ``_normalise_geometry`` ValueError guard) carries
        ``geometry=None`` through — §C4 degrade, never a misaligned
        box."""
        fake_field = SimpleNamespace(
            question_text="Unmappable field?",
            page_number=0,
            sequence=0,
            geometry=None,
        )
        fake_result = SimpleNamespace(
            fields=[fake_field], fillable_pdf_bytes=b"%PDF-fake-fillable"
        )
        monkeypatch.setattr(
            orch_module, "_detect_pdf_fields", lambda raw, name: fake_result
        )

        result = asyncio.run(
            extract_form_structure(_MINIMAL_PDF_BYTES, "blank.pdf")
        )

        assert isinstance(result, ExtractedForm)
        assert result.fields[0].geometry is None

    def test_pdf_detection_error_wraps_as_form_extraction_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A ``detect_pdf_fields`` failure (malformed/encrypted PDF) wraps
        as this package's own ``FormExtractionError`` — Inv-17 contract
        parity with the docx/xlsx readers, never a raw
        ``PdfFieldDetectionError`` escaping the dispatcher."""

        def _raise(raw_bytes: bytes, filename: str):
            raise orch_module.PdfFieldDetectionError(
                f"{filename}: could not be parsed (malformed or encrypted PDF)"
            )

        monkeypatch.setattr(orch_module, "_detect_pdf_fields", _raise)

        with pytest.raises(FormExtractionError) as exc_info:
            asyncio.run(extract_form_structure(_MINIMAL_PDF_BYTES, "blank.pdf"))
        assert exc_info.value.reason == "corrupt_pdf"
        assert exc_info.value.rel_path == "blank.pdf"

    def test_pdf_dependencies_unavailable_returns_none_and_logs_skip(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """With the heavy Plane-2 stack unavailable (``_detect_pdf_fields``
        resolves to ``None`` at import time — S467), a ``.pdf`` input
        returns None and logs ``form_extractor.skip``/
        ``pdf_dependencies_unavailable``, never raises ``ImportError``."""
        monkeypatch.setattr(orch_module, "_detect_pdf_fields", None)
        with caplog.at_level(logging.WARNING):
            result = asyncio.run(
                extract_form_structure(_MINIMAL_PDF_BYTES, "blank.pdf")
            )

        assert result is None
        skip_logs = [
            json.loads(rec.message)
            for rec in caplog.records
            if rec.message.startswith("{") and "form_extractor.skip" in rec.message
        ]
        assert skip_logs, "a .pdf input must emit a form_extractor.skip log line"
        assert skip_logs[0]["reason"] == "pdf_dependencies_unavailable"
        assert skip_logs[0]["rel_path"] == "blank.pdf"

    def test_xlsx_routes_to_xlsx_extract(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _fake_xlsx(raw_bytes: bytes, filename: str) -> ExtractedForm:
            return _make_form("xlsx")

        monkeypatch.setattr(orch_module, "_extract_xlsx", _fake_xlsx)

        result = asyncio.run(extract_form_structure(b"PK\x03\x04", "sheet.xlsx"))
        assert isinstance(result, ExtractedForm)
        assert result.form_metadata.form_format == "xlsx"
        # §C4 degrade: no spatial geometry for the DOCX/XLSX path — only
        # table_index/row_index reading order (unaffected by this
        # subtask, asserted here as the negative-space guard).
        assert result.fields[0].geometry is None

    def test_docx_routes_to_docx_extract(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _fake_docx(raw_bytes: bytes, filename: str) -> ExtractedForm:
            return _make_form("docx")

        monkeypatch.setattr(orch_module, "_extract_docx", _fake_docx)

        result = asyncio.run(extract_form_structure(b"PK\x03\x04", "doc.docx"))
        assert isinstance(result, ExtractedForm)
        assert result.form_metadata.form_format == "docx"
        assert result.fields[0].geometry is None  # §C4 degrade

    def test_xls_returns_none_and_logs_skip(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Inv-3: legacy ``.xls`` is out of scope for this dispatcher —
        return None, log skip, no raise. {145.13} converts .xls to .xlsx via
        LibreOffice headless BEFORE calling this dispatcher (DR-059)."""
        with caplog.at_level(logging.INFO):
            result = asyncio.run(
                extract_form_structure(b"\xd0\xcf\x11\xe0", "legacy.xls")
            )
        assert result is None
        skip_logs = [
            json.loads(rec.message)
            for rec in caplog.records
            if rec.message.startswith("{") and "form_extractor.skip" in rec.message
        ]
        assert skip_logs, "an .xls input must emit a form_extractor.skip log line"
        assert skip_logs[0]["reason"] == "xls_out_of_scope"
        assert skip_logs[0]["rel_path"] == "legacy.xls"

    def test_markdown_returns_none(self) -> None:
        """A non-form suffix (``.md``) is not form-relevant → None, no log."""
        result = asyncio.run(extract_form_structure(b"# notes", "notes.md"))
        assert result is None

    def test_no_suffix_returns_none(self) -> None:
        """A filename with no extension is not form-relevant → None."""
        result = asyncio.run(extract_form_structure(b"data", "README"))
        assert result is None

    def test_uppercase_suffix_normalised(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Suffix matching is case-insensitive (``.XLSX`` routes like
        ``.xlsx``)."""

        async def _fake_xlsx(raw_bytes: bytes, filename: str) -> ExtractedForm:
            return _make_form("xlsx")

        monkeypatch.setattr(orch_module, "_extract_xlsx", _fake_xlsx)
        result = asyncio.run(extract_form_structure(b"PK\x03\x04", "SHEET.XLSX"))
        assert isinstance(result, ExtractedForm)

    def test_uppercase_pdf_suffix_also_routes_to_pdf_branch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Case-insensitivity holds for the ``.pdf`` branch too (``.PDF``
        behaves like ``.pdf`` — dispatches to ``_detect_pdf_fields``, not
        the "not a form" fallthrough)."""
        fake_result = SimpleNamespace(fields=[], fillable_pdf_bytes=b"%PDF-fake")
        monkeypatch.setattr(
            orch_module, "_detect_pdf_fields", lambda raw, name: fake_result
        )
        result = asyncio.run(
            extract_form_structure(_MINIMAL_PDF_BYTES, "BLANK.PDF")
        )
        assert isinstance(result, ExtractedForm)
        assert result.form_metadata.form_format == "pdf"
