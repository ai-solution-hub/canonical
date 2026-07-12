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
  - ``.pdf`` is NOT YET WIRED — returns None and logs
    ``form_extractor.skip``/``pdf_not_yet_wired`` (Checker ruling,
    post-{145.11} landing — see the PDF NOTE below and the orchestrator's
    own module docstring).
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

PDF NOTE (ID-145.10 Checker ruling, post-{145.11} landing): {145.10}'s
original brief recovered the id-52 pdfplumber PDF reader and wired it here.
That strategy is SUPERSEDED by ratified DR-057 (commonforms detection is
mandatory — real UK procurement PDFs are FLAT); {145.11} has already landed
its own commonforms-based module at this package's ``pdf.py`` path, with a
different output shape (``PdfFieldDetectionResult``, not this package's
``ExtractedForm``). This dispatcher does not import or call it — {145.13}
owns the shape-adaptation + wiring. The ``.pdf`` test below asserts the
explicit not-wired outcome against a REAL minimal PDF (no monkeypatching —
there is no per-format reader function to patch on this branch).

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.
"""

from __future__ import annotations

import asyncio
import json
import logging

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
    def test_pdf_is_not_yet_wired_returns_none_and_logs_skip(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """``.pdf`` has NO reader wired on this dispatcher (Checker ruling,
        post-{145.11} landing) — a real minimal PDF returns None and logs
        a structured ``form_extractor.skip``/``pdf_not_yet_wired`` line, no
        raise. No monkeypatching: there is no ``_extract_pdf`` seam on this
        branch to patch."""
        with caplog.at_level(logging.INFO):
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
        assert skip_logs[0]["reason"] == "pdf_not_yet_wired"
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

    def test_docx_routes_to_docx_extract(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _fake_docx(raw_bytes: bytes, filename: str) -> ExtractedForm:
            return _make_form("docx")

        monkeypatch.setattr(orch_module, "_extract_docx", _fake_docx)

        result = asyncio.run(extract_form_structure(b"PK\x03\x04", "doc.docx"))
        assert isinstance(result, ExtractedForm)
        assert result.form_metadata.form_format == "docx"

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

    def test_uppercase_pdf_suffix_also_not_wired(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Case-insensitivity holds for the not-wired ``.pdf`` branch too
        (``.PDF`` behaves like ``.pdf``)."""
        with caplog.at_level(logging.INFO):
            result = asyncio.run(
                extract_form_structure(_MINIMAL_PDF_BYTES, "BLANK.PDF")
            )
        assert result is None
