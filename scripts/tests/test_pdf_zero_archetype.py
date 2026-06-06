"""Inv-17 graceful-empty-with-recorded-reason — PDF extractor parity (bl-232).

Background
----------

The PDF extractor (``scripts/cocoindex_pipeline/form_extractors/pdf.py``)
``extract()`` RAISES ``FormExtractionError`` on the genuinely-broken inputs:

  - empty bytes (``reason='empty_pdf'``),
  - unreadable / non-PDF bytes (``reason='corrupt_pdf'``),
  - a PDF with zero pages (``reason='empty_pdf'``).

Those strict paths are covered in ``test_form_extractors.py`` and STAY
strict per the ratified PRODUCT Inv-17 amendment.

There is a fourth case that is NOT a raise: a structurally VALID PDF
whose pages carry no parseable table rows and no M/O-flagged prose —
``_row_to_field`` and ``_emit_freeprose_fields`` both yield nothing, and
``extract()`` returns ``ExtractedForm(fields=[])``.

Disposition (xlsx parity, bl-232)
---------------------------------

The XLSX extractor's ratified S278 semantic (graceful-empty MUST NOT be
SILENT) applies here too: ``extract`` stays graceful (returns an empty
``ExtractedForm``, no raise) AND emits the structured
``form_extractor.zero_archetype`` log carrying the machine-readable
``NO_ARCHETYPE_REASON`` token, mirroring
``scripts/cocoindex_pipeline/form_extractors/xlsx.py``. Before bl-232 the
PDF extractor was silent at module level — the graceful-empty outcome was
only observable via ``flow.py``'s ``FORM_WRITE_GRACEFUL_EMPTY_REASON``
log outside the extractor.

References:
  - docs/specs/id-52-form-extraction/PRODUCT.md Inv-17 (graceful-empty
    -with-recorded-reason admitted as a valid shape, S278).
  - scripts/cocoindex_pipeline/form_extractors/xlsx.py
    (``NO_ARCHETYPE_REASON`` single source of truth + the mirrored log).
  - scripts/tests/test_xlsx_zero_archetype.py (the XLSX twin of this file).
  - docs/reference/test-philosophy.md (real-behaviour: builds a real
    one-page PDF byte-for-byte, runs the real extractor — no mocks).
"""

from __future__ import annotations

import asyncio
import io
import json
import logging

import pdfplumber

from scripts.cocoindex_pipeline.form_extractors.pdf import extract as pdf_extract
from scripts.cocoindex_pipeline.form_extractors.shared import ExtractedForm
from scripts.cocoindex_pipeline.form_extractors.xlsx import NO_ARCHETYPE_REASON


def _build_one_page_pdf(text_lines: list[str]) -> bytes:
    """Assemble a minimal, spec-valid one-page PDF 1.4 document whose page
    renders ``text_lines`` (Helvetica, one line per ``T*`` advance).

    Hand-assembled because the Python test environment has no PDF-writing
    dependency (pdfplumber is read-only); the xref offsets are computed,
    so pdfplumber/pdfminer open the bytes cleanly — the strict-raise
    guards in ``extract`` (empty bytes / corrupt bytes / zero pages) are
    NOT triggered by these fixtures.
    """
    content = (
        b"BT /F1 12 Tf 14 TL 72 720 Td "
        + b" T* ".join(b"(" + ln.encode("ascii") + b") Tj" for ln in text_lines)
        + b" ET"
    )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length "
        + str(len(content)).encode("ascii")
        + b" >>\nstream\n"
        + content
        + b"\nendstream",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets: list[int] = []
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode("ascii"))
        out.write(body)
        out.write(b"\nendobj\n")
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    out.write(b"0000000000 65535 f \n")
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode("ascii"))
    out.write(b"trailer\n")
    out.write(f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n".encode("ascii"))
    out.write(f"startxref\n{xref_pos}\n%%EOF\n".encode("ascii"))
    return out.getvalue()


def _build_zero_archetype_pdf() -> bytes:
    """A valid one-page PDF whose content matches NO extraction archetype:
    freeform prose only — no tables (``_row_to_field`` never fires) and no
    lone ``M``/``O`` flag lines (the ``_emit_freeprose_fields`` fallback
    yields nothing)."""
    return _build_one_page_pdf(
        [
            "Internal project notes.",
            "Freeform prose, not a structured form.",
        ]
    )


def _build_mo_prose_pdf() -> bytes:
    """A valid one-page PDF whose prose carries an ``M``-flagged question
    row, exercising the ``_emit_freeprose_fields`` fallback (one field
    emitted → NOT the graceful-empty path)."""
    return _build_one_page_pdf(
        [
            "M",
            "Provide details of your organisation's quality policy.",
        ]
    )


class TestZeroArchetypePdfGracefulSemantic:
    """Inv-17 graceful-empty-with-recorded-reason — PDF parity (bl-232)."""

    def test_zero_archetype_pdf_returns_empty_form_not_error(self) -> None:
        """A structurally VALID PDF whose pages match no archetype returns
        an ``ExtractedForm`` with ``fields == []`` and DOES NOT raise
        ``FormExtractionError`` — distinct from the strict-raise paths
        (empty bytes / corrupt bytes / zero pages), which stay strict."""
        raw = _build_zero_archetype_pdf()

        form = asyncio.run(pdf_extract(raw, "zero-archetype.pdf"))

        assert isinstance(form, ExtractedForm)
        assert form.fields == []
        assert form.form_metadata.form_format == "pdf"

    def test_zero_archetype_pdf_emits_surfaced_reason_not_silent(
        self,
        caplog,
    ) -> None:
        """Inv-17 graceful-empty MUST NOT be silent: ``extract`` emits a
        structured ``form_extractor`` log carrying the machine-readable
        no-archetype reason — xlsx parity (bl-232). Before this fix the
        PDF extractor had no module logger and the graceful-empty outcome
        was observable only via ``flow.py``'s form-write log."""
        raw = _build_zero_archetype_pdf()

        with caplog.at_level(logging.INFO):
            asyncio.run(pdf_extract(raw, "zero-archetype.pdf"))

        structured_records: list[dict[str, object]] = []
        for record in caplog.records:
            try:
                payload = json.loads(record.getMessage())
            except (ValueError, TypeError):
                continue
            if isinstance(payload, dict) and payload.get("reason") == NO_ARCHETYPE_REASON:
                structured_records.append(payload)

        assert structured_records, (
            "expected a structured form_extractor log carrying "
            f"reason={NO_ARCHETYPE_REASON!r}; got "
            f"{[r.getMessage() for r in caplog.records]!r}"
        )
        payload = structured_records[0]
        # Mirror the xlsx log shape exactly: event key + correlatable fields.
        assert payload["event"] == "form_extractor.zero_archetype"
        assert payload["reason"] == NO_ARCHETYPE_REASON
        assert payload["rel_path"] == "zero-archetype.pdf"
        assert payload["form_format"] == "pdf"
        assert payload["page_count"] == 1

    def test_pdf_with_extracted_fields_does_not_emit_zero_archetype_log(
        self,
        caplog,
    ) -> None:
        """Guard: the zero-archetype log fires ONLY on the graceful-empty
        path. A page with an M/O-flagged prose row (the free-prose
        fallback schema) emits a field and NO zero-archetype log."""
        raw = _build_mo_prose_pdf()

        with caplog.at_level(logging.INFO):
            form = asyncio.run(pdf_extract(raw, "mo-prose.pdf"))

        assert len(form.fields) == 1
        assert form.fields[0].is_mandatory is True
        for record in caplog.records:
            try:
                payload = json.loads(record.getMessage())
            except (ValueError, TypeError):
                continue
            if isinstance(payload, dict):
                assert payload.get("event") != "form_extractor.zero_archetype"

    def test_pdf_is_genuinely_valid_not_the_strict_raise_path(self) -> None:
        """Guard: prove the fixture is a VALID PDF (pdfplumber opens it,
        has >= 1 page with extractable text) so the zero-field outcome is
        the archetype-miss path, NOT one of the strict-raise paths."""
        raw = _build_zero_archetype_pdf()
        assert raw  # non-empty bytes → not the empty_pdf raise path
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            assert len(pdf.pages) == 1  # → not the zero-page raise path
            text = pdf.pages[0].extract_text() or ""
            assert text.strip()  # real content — page is not blank
