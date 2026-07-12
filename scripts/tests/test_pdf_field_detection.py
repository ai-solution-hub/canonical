"""Real-behaviour tests for the PDF Plane-2 field detector (ID-145.11,
DR-057, BI-20).

These tests exercise the actual SQ PDF fixture (the `Procurement Policy
Note: Standard Selection Questionnaire (PPN 03/24)` blank form, 57
pages) through the REAL ``commonforms``/``pypdf``/``pdfplumber`` stack —
no mocks, per ``docs/reference/test-philosophy.md``. Live detection is
slow (seconds, plus a one-time HuggingFace model download) so the
detection call is memoised behind a module-scoped fixture.

Baseline: TECH.md §1.3 / ARCH-REVIEW.md §4.1 measured 198 fields on this
PDF (141 ``/Tx`` text + 57 ``/Btn`` checkbox) in 35.9s CPU. Re-verified
here at impl time — same exact count reproduced.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from scripts.cocoindex_pipeline.form_extractors.pdf import (
    PdfFieldDetectionError,
    PdfFieldDetectionResult,
    acroform_field_count,
    detect_pdf_fields,
)

_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "form-extraction"
_SQ_PDF_PATH = _FIXTURE_DIR / "standard-selection-questionnaire-ppn-03-24.pdf"
_CORRUPT_PDF_PATH = _FIXTURE_DIR / "corrupt.pdf"

_MEASURED_FIELD_COUNT = 198
_MEASURED_TX_COUNT = 141
_MEASURED_BTN_COUNT = 57


@pytest.fixture(scope="module")
def sq_pdf_bytes() -> bytes:
    """Raw bytes for the SQ PDF fixture (real corpus file)."""
    assert _SQ_PDF_PATH.exists(), (
        f"corpus fixture missing — {_SQ_PDF_PATH} should symlink to "
        "docs/testing/test-data/templates/sq-standard-selection-questionnaire/"
        "standard-selection-questionnaire-ppn-03-24.pdf"
    )
    return _SQ_PDF_PATH.read_bytes()


@pytest.fixture(scope="module")
def sq_detection(sq_pdf_bytes: bytes) -> PdfFieldDetectionResult:
    """The live commonforms detection run over the SQ PDF — module-
    scoped to pay the render→detect→write cost (+ one-time model
    download) exactly once across the assertion bundle below."""
    return detect_pdf_fields(
        sq_pdf_bytes, "standard-selection-questionnaire-ppn-03-24.pdf"
    )


# ──────────────────────────────────────────────────────────────────────────
# AcroForm dead-end (TECH.md §1.3 — flat PDFs, 0 native fields)
# ──────────────────────────────────────────────────────────────────────────


class TestAcroFormDeadEnd:
    def test_flat_sq_pdf_has_zero_native_acroform_fields(self, sq_pdf_bytes: bytes) -> None:
        """The real Standard SQ PDF is FLAT — pypdf's native AcroForm
        reader is a dead end, which is exactly why ML detection
        (``detect_pdf_fields``) is mandatory rather than optional."""
        assert acroform_field_count(sq_pdf_bytes) == 0


# ──────────────────────────────────────────────────────────────────────────
# Detection baseline (TECH.md §1.3 / ARCH-REVIEW §4.1 measured numbers)
# ──────────────────────────────────────────────────────────────────────────


class TestDetectionBaseline:
    def test_detects_the_measured_198_fields(self, sq_detection: PdfFieldDetectionResult) -> None:
        assert len(sq_detection.fields) == _MEASURED_FIELD_COUNT

    def test_widget_type_split_matches_the_measured_readback(
        self, sq_detection: PdfFieldDetectionResult
    ) -> None:
        tx_count = sum(1 for f in sq_detection.fields if f.acroform_type == "/Tx")
        btn_count = sum(1 for f in sq_detection.fields if f.acroform_type == "/Btn")
        assert tx_count == _MEASURED_TX_COUNT
        assert btn_count == _MEASURED_BTN_COUNT

    def test_field_names_are_unique(self, sq_detection: PdfFieldDetectionResult) -> None:
        names = [f.field_name for f in sq_detection.fields]
        assert len(names) == len(set(names))

    def test_sequence_is_a_dense_reading_order(self, sq_detection: PdfFieldDetectionResult) -> None:
        sequences = sorted(f.sequence for f in sq_detection.fields)
        assert sequences == list(range(len(sq_detection.fields)))

    def test_page_numbers_are_within_the_document_range(
        self, sq_detection: PdfFieldDetectionResult
    ) -> None:
        assert all(0 <= f.page_number < 57 for f in sq_detection.fields)

    def test_bbox_is_well_formed(self, sq_detection: PdfFieldDetectionResult) -> None:
        for field in sq_detection.fields:
            x0, y0, x1, y1 = field.bbox
            assert x0 < x1
            assert y0 < y1

    def test_returns_the_fillable_pdf_artefact(self, sq_detection: PdfFieldDetectionResult) -> None:
        """The fill step ({145.15}) consumes this artefact — it must be
        a real, non-empty PDF distinct from the flat original."""
        assert sq_detection.fillable_pdf_bytes.startswith(b"%PDF-")
        assert len(sq_detection.fillable_pdf_bytes) > 0

    def test_fillable_artefact_now_has_the_detected_acroform_fields(
        self, sq_detection: PdfFieldDetectionResult
    ) -> None:
        """Round-trip check: the fillable artefact's own native AcroForm
        field count matches detection — proves the artefact is genuinely
        fillable, not just a passthrough copy of the flat original."""
        assert acroform_field_count(sq_detection.fillable_pdf_bytes) == _MEASURED_FIELD_COUNT


# ──────────────────────────────────────────────────────────────────────────
# Mandatory label-pairing (TECH.md §3.2 — never a structural no-op)
# ──────────────────────────────────────────────────────────────────────────


class TestLabelPairing:
    def test_every_field_has_non_empty_paired_label_text(
        self, sq_detection: PdfFieldDetectionResult
    ) -> None:
        """The load-bearing assertion: PDF auto-map ({145.14}) matches
        lexically on ``question_text`` — an empty label on any field
        would make that field structurally invisible to auto-map."""
        empty = [f.field_name for f in sq_detection.fields if not f.question_text.strip()]
        assert empty == [], f"{len(empty)} field(s) paired with no label text: {empty[:10]}"

    def test_paired_labels_are_not_just_whitespace_or_punctuation(
        self, sq_detection: PdfFieldDetectionResult
    ) -> None:
        for field in sq_detection.fields:
            assert any(ch.isalnum() for ch in field.question_text), (
                f"{field.field_name}: paired label {field.question_text!r} "
                "carries no alphanumeric content"
            )


# ──────────────────────────────────────────────────────────────────────────
# Failure surfacing
# ──────────────────────────────────────────────────────────────────────────


class TestFailureSurfacing:
    def test_corrupt_pdf_raises_a_typed_error(self) -> None:
        assert _CORRUPT_PDF_PATH.exists(), f"fixture missing — {_CORRUPT_PDF_PATH}"
        raw_bytes = _CORRUPT_PDF_PATH.read_bytes()
        with pytest.raises(PdfFieldDetectionError, match="corrupt.pdf"):
            detect_pdf_fields(raw_bytes, "corrupt.pdf")
