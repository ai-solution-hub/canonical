"""Real-behaviour tests for the PDF Plane-2 field detector (ID-145.11,
DR-057, BI-20).

These tests exercise the actual SQ PDF fixture (the `Procurement Policy
Note: Standard Selection Questionnaire (PPN 03/24)` blank form, 57
pages) through the REAL ``commonforms``/``pypdf``/``pdfplumber`` stack —
no mocks, per ``docs/reference/testing/test-philosophy.md``. Live detection is
slow (seconds, plus a one-time HuggingFace model download) so the
detection call is memoised behind a module-scoped fixture.

Baseline: TECH.md §1.3 / ARCH-REVIEW.md §4.1 measured 198 fields on this
PDF (141 ``/Tx`` text + 57 ``/Btn`` checkbox) in 35.9s CPU. Re-verified
here at impl time — same exact count reproduced.
"""

from __future__ import annotations

from pathlib import Path

import pytest

# The Plane-2 stack (commonforms + torch closure) is heavyweight and only
# installed where requirements.txt is — skip cleanly elsewhere instead of
# erroring the whole scripts/tests/ collection (S467 integration guard).
pytest.importorskip("pypdf", reason="pypdf not installed (requirements.txt)")
pytest.importorskip("commonforms", reason="commonforms not installed (requirements.txt)")
pytest.importorskip("pdfplumber", reason="pdfplumber not installed (requirements.txt)")

from scripts.cocoindex_pipeline.form_extractors.pdf import (
    PdfFieldDetectionError,
    PdfFieldDetectionResult,
    _normalise_geometry,
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
# Geometry normalisation (ID-147 {147.9}, TECH.md §3, DR-064 Option A;
# PRODUCT §C1/§C4) — pure-function unit tests against known /Rect + page
# dims, no commonforms detection run needed.
# ──────────────────────────────────────────────────────────────────────────


class TestNormaliseGeometry:
    def test_zero_rotation_zero_origin_known_rect(self) -> None:
        """No rotation, MediaBox origin (0, 0) — the baseline case: a
        known /Rect near the top-left of the page maps to the expected
        DISPLAYED top-left fractions (same math the pre-existing
        ftop/fbottom flip already does, just fraction-normalised)."""
        geometry = _normalise_geometry(
            50.0,
            700.0,
            150.0,
            750.0,
            page_width=600.0,
            page_height=800.0,
            mediabox_llx=0.0,
            mediabox_lly=0.0,
            rotation=0,
            page_number=3,
        )
        assert geometry["left"] == pytest.approx(50 / 600)
        assert geometry["top"] == pytest.approx(50 / 800)
        assert geometry["width"] == pytest.approx(100 / 600)
        assert geometry["height"] == pytest.approx(50 / 800)
        assert geometry["page"] == 3
        assert geometry["rotation"] == 0

    def test_rotate_90_non_zero_mediabox_origin(self) -> None:
        """The load-bearing testStrategy fixture: a /Rotate 90 page with
        a non-zero MediaBox origin must still yield the correct
        DISPLAYED top-left box — guards §C4's "never a misaligned box"
        against both failure modes the un-normalised code was exposed
        to (rotation AND origin offset)."""
        geometry = _normalise_geometry(
            20.0,
            180.0,
            40.0,
            200.0,
            page_width=100.0,
            page_height=200.0,
            mediabox_llx=10.0,
            mediabox_lly=20.0,
            rotation=90,
            page_number=5,
        )
        assert geometry["left"] == pytest.approx(0.8)
        assert geometry["top"] == pytest.approx(0.1)
        assert geometry["width"] == pytest.approx(0.1)
        assert geometry["height"] == pytest.approx(0.2)
        assert geometry["page"] == 5
        assert geometry["rotation"] == 90

    def test_rotate_180(self) -> None:
        """A 180° page flips the box to the opposite corner — the same
        rect as the zero-rotation case above now reads near the
        bottom-right instead of the top-left."""
        geometry = _normalise_geometry(
            50.0,
            700.0,
            150.0,
            750.0,
            page_width=600.0,
            page_height=800.0,
            mediabox_llx=0.0,
            mediabox_lly=0.0,
            rotation=180,
            page_number=0,
        )
        assert geometry["left"] == pytest.approx(0.75)
        assert geometry["top"] == pytest.approx(0.875)
        assert geometry["width"] == pytest.approx(100 / 600)
        assert geometry["height"] == pytest.approx(50 / 800)
        assert geometry["rotation"] == 180

    def test_rotate_270_non_zero_mediabox_origin(self) -> None:
        """The 270° counterpart of the /Rotate 90 fixture above — same
        input rect, opposite rotation direction, distinct expected
        placement (guards against a hard-coded 90-only transform)."""
        geometry = _normalise_geometry(
            20.0,
            180.0,
            40.0,
            200.0,
            page_width=100.0,
            page_height=200.0,
            mediabox_llx=10.0,
            mediabox_lly=20.0,
            rotation=270,
            page_number=5,
        )
        assert geometry["left"] == pytest.approx(0.1)
        assert geometry["top"] == pytest.approx(0.7)
        assert geometry["width"] == pytest.approx(0.1)
        assert geometry["height"] == pytest.approx(0.2)
        assert geometry["rotation"] == 270

    def test_unsupported_rotation_raises_value_error(self) -> None:
        """A non-multiple-of-90 rotation (malformed /Rotate) must never
        silently produce a box — the caller (detect_pdf_fields) catches
        this and degrades to geometry=None per §C4."""
        with pytest.raises(ValueError, match="unsupported page rotation"):
            _normalise_geometry(
                0.0,
                0.0,
                10.0,
                10.0,
                page_width=100.0,
                page_height=100.0,
                mediabox_llx=0.0,
                mediabox_lly=0.0,
                rotation=45,
                page_number=0,
            )

    def test_all_fractions_within_unit_range_when_rect_is_on_page(self) -> None:
        """A /Rect that lies fully within the page bounds must normalise
        to fractions within [0, 1] — a sanity bound that would catch a
        sign error or an axis swap the individual value assertions above
        might not."""
        for rotation in (0, 90, 180, 270):
            geometry = _normalise_geometry(
                10.0,
                10.0,
                20.0,
                20.0,
                page_width=100.0,
                page_height=50.0,
                mediabox_llx=0.0,
                mediabox_lly=0.0,
                rotation=rotation,
                page_number=0,
            )
            for key in ("left", "top", "width", "height"):
                assert 0.0 <= geometry[key] <= 1.0, (rotation, key, geometry)


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

    def test_every_field_has_well_formed_displayed_space_geometry(
        self, sq_detection: PdfFieldDetectionResult
    ) -> None:
        """End-to-end wiring check (ID-147 {147.9}): every detected field
        on the real SQ PDF carries a geometry dict with the expected
        shape and in-range fractions — the un-rotated real-world case
        (this fixture is a standard portrait PDF, rotation 0)."""
        for field in sq_detection.fields:
            assert field.geometry is not None
            assert set(field.geometry) == {
                "left",
                "top",
                "width",
                "height",
                "page",
                "rotation",
            }
            assert field.geometry["page"] == field.page_number
            assert field.geometry["rotation"] in (0, 90, 180, 270)
            for key in ("left", "top", "width", "height"):
                assert 0.0 <= field.geometry[key] <= 1.0, (field.field_name, key)


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
