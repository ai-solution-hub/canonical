"""Real-behaviour tests for the ID-52 form extractors (PRODUCT Inv-2).

These tests open the actual SQ PDF fixture (a blank `Procurement Policy
Note: Standard Selection Questionnaire (PPN 03/24)` form, 510 KB, 57
pages) — NO mocks of pdfplumber internals, per
``docs/reference/test-philosophy.md``. The corpus PDF is the single
verification artefact for Inv-15 (container-artefact bypass) and the
Inv-8 / Inv-10 / Inv-11 / Inv-12 / Inv-14 / Inv-17 acceptance lines
declared in ``docs/specs/form-extraction/PLAN.md`` §{52.9}.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pdfplumber
import pytest

from scripts.cocoindex_pipeline.form_extractors.pdf import extract as pdf_extract
from scripts.cocoindex_pipeline.form_extractors.shared import (
    ExtractedField,
    ExtractedForm,
    FormExtractionError,
    FormMetadata,
)

# ──────────────────────────────────────────────────────────────────────────
# Fixture path — committed symlink to the canonical corpus PDF.
# ──────────────────────────────────────────────────────────────────────────

_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "form-extraction"
_SQ_PDF_PATH = _FIXTURE_DIR / "standard-selection-questionnaire-ppn-03-24.pdf"


@pytest.fixture(scope="module")
def sq_pdf_bytes() -> bytes:
    """Raw bytes for the SQ PDF fixture (real corpus file)."""
    assert _SQ_PDF_PATH.exists(), (
        f"corpus fixture missing — {_SQ_PDF_PATH} should symlink to "
        f"docs/testing/test-data/templates/sq-standard-selection-questionnaire/"
        f"standard-selection-questionnaire-ppn-03-24.pdf"
    )
    return _SQ_PDF_PATH.read_bytes()


@pytest.fixture(scope="module")
def sq_form(sq_pdf_bytes: bytes) -> ExtractedForm:
    """The extracted form for the SQ PDF — module-scoped to amortise
    the ~1-2s pdfplumber walk across the assertion-bundle below."""
    return asyncio.run(
        pdf_extract(sq_pdf_bytes, "standard-selection-questionnaire-ppn-03-24.pdf")
    )


# ──────────────────────────────────────────────────────────────────────────
# Shared-model shape (TECH §2.2 strictness)
# ──────────────────────────────────────────────────────────────────────────


class TestSharedModels:
    """Smoke tests for the ``shared.py`` Pydantic shapes."""

    def test_extracted_field_forbids_extra_keys(self) -> None:
        """``extra="forbid"`` — surfaces drift at construction time."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ExtractedField(
                field_type="empty_cell",
                fill_status="pending",
                sequence=0,
                unexpected_extra_key="boom",  # type: ignore[call-arg]
            )

    def test_extracted_field_strict_typing(self) -> None:
        """``strict=True`` — rejects coerced types per
        cocoindex-extraction-contract pattern."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ExtractedField(
                field_type="empty_cell",
                fill_status="pending",
                sequence="0",  # type: ignore[arg-type]
            )

    def test_extracted_field_field_type_literal_set(self) -> None:
        """``field_type`` matches TECH §2.2 literal set exactly."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ExtractedField(
                field_type="unknown_type",  # type: ignore[arg-type]
                fill_status="pending",
                sequence=0,
            )

    def test_extracted_field_fill_status_literal_set(self) -> None:
        """``fill_status`` matches TECH §2.2 literal set exactly."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ExtractedField(
                field_type="empty_cell",
                fill_status="wrong",  # type: ignore[arg-type]
                sequence=0,
            )

    def test_extracted_field_defaults(self) -> None:
        """Reference URLs default to empty list; optionals default None."""
        field = ExtractedField(
            field_type="empty_cell",
            fill_status="pending",
            sequence=0,
        )
        assert field.reference_urls == []
        assert field.question_text is None
        assert field.placeholder_text is None
        assert field.row_index is None
        assert field.col_index is None
        assert field.table_index is None
        assert field.section_name is None
        assert field.word_limit is None
        assert field.is_mandatory is None

    def test_extracted_form_carries_metadata_and_fields(self) -> None:
        meta = FormMetadata(form_type="questionnaire", form_format="pdf")
        form = ExtractedForm(form_metadata=meta, fields=[])
        assert form.form_metadata.form_format == "pdf"
        assert form.fields == []

    def test_form_extraction_error_carries_reason_and_path(self) -> None:
        err = FormExtractionError(
            reason="corrupt_pdf", rel_path="foo/bar.pdf", details="boom"
        )
        assert err.reason == "corrupt_pdf"
        assert err.rel_path == "foo/bar.pdf"
        assert err.details == "boom"
        assert "corrupt_pdf" in str(err)
        assert "foo/bar.pdf" in str(err)
        assert "boom" in str(err)


# ──────────────────────────────────────────────────────────────────────────
# Inv-15 — page-container artefact bypass
# ──────────────────────────────────────────────────────────────────────────


class TestPdfContainerArtefactBypass:
    """PRODUCT Inv-15 — true 57-page extent, not the container header."""

    def test_pdfplumber_reports_57_pages_not_8(self, sq_pdf_bytes: bytes) -> None:
        """Sanity-check the pdfplumber pin reads the SQ PDF as 57 pages."""
        import io

        with pdfplumber.open(io.BytesIO(sq_pdf_bytes)) as pdf:
            assert len(pdf.pages) == 57

    def test_extracted_form_covers_pages_beyond_page_8(
        self, sq_form: ExtractedForm
    ) -> None:
        """The container header reports 8 pages; the true content is 57.
        Inv-15 demands the extractor reads the true extent — verified
        here by checking that at least one extracted field originates
        in Annex B (which begins on page 17, beyond the 8-page artefact)."""
        annex_b_fields = [
            f
            for f in sq_form.fields
            if f.section_name and "Annex B" in f.section_name
        ]
        assert len(annex_b_fields) > 0, (
            "no Annex B fields extracted — Inv-15 truncation regression "
            "(Annex B starts on page 17 of the 57-page PDF)"
        )


# ──────────────────────────────────────────────────────────────────────────
# Inv-10 — mandatory/optional flag preserved when the form expresses it
# ──────────────────────────────────────────────────────────────────────────


class TestPdfMandatoryFlag:
    """PRODUCT Inv-10 — preserves M/O flags from Annex B Part 1's
    2-column ``[M|O, question]`` table; never infers from omission."""

    def test_annex_b_part_1_m_flag_recorded(
        self, sq_form: ExtractedForm
    ) -> None:
        """Annex B Part 1 (page 17) carries 2-column ``[M|O, question]``
        rows — the M-flagged "Name (if, registered, please give the
        registered name)" row must extract with ``is_mandatory=True``."""
        m_flagged = [
            f
            for f in sq_form.fields
            if f.is_mandatory is True
            and f.question_text
            and "Name" in f.question_text
            and "registered" in f.question_text
        ]
        assert m_flagged, (
            "no M-flagged 'Name (if, registered…)' row found — Inv-10 "
            "M/O flag extraction regression on the SQ PDF Annex B Part 1 "
            "2-column table"
        )

    def test_annex_b_part_1_o_flag_recorded(
        self, sq_form: ExtractedForm
    ) -> None:
        """The "Please tell us which lot(s) you wish to bid for" row
        carries an explicit ``O`` flag (page 19) — must extract with
        ``is_mandatory=False``, not None."""
        o_flagged = [
            f
            for f in sq_form.fields
            if f.is_mandatory is False
            and f.question_text
            and "lot" in f.question_text.lower()
        ]
        assert o_flagged, (
            "no O-flagged 'lot(s) you wish to bid for' row found — Inv-10 "
            "O/false extraction regression"
        )

    def test_q6_2_section_and_mandatory_flag(
        self, sq_form: ExtractedForm
    ) -> None:
        """Q6.2's containing table is 2-column ``[number, question]``
        with NO M/O flag column (verified against the live PDF), so
        per Inv-10 ("never inferred from omission") ``is_mandatory`` is
        None. Section name carries the hierarchical Annex / Section
        context per Inv-12.

        Production-behaviour finding (escalated in subtask journal):
        the live SQ PDF (PPN 03/24) places the FILLABLE q6.x rows in
        ``Annex C - Selection Questionnaire Template`` → ``Section 6 -
        Technical and Professional Ability``, NOT in Annex B as the
        PRODUCT spec example states. ``Annex B - Standard Selection
        Questions`` (page 17) carries the M/O-flagged Part 1 schema +
        the textual descriptions of the questions; ``Annex C`` (page 30+)
        carries the answerable template form. The test reflects the
        PDF, not the spec's loose Annex reference.
        """
        q6_2 = [
            f
            for f in sq_form.fields
            if f.question_text
            and "no more" in f.question_text
            and "[500]" in f.question_text
        ]
        assert q6_2, (
            "no q6.2 ([500] words) row found — Inv-12 reading-order "
            "regression on Section 6"
        )
        q = q6_2[0]
        # Section name must carry the Annex container + Section context
        # (Inv-12 hierarchy). The live PDF places q6.2 in Annex C / Section 6.
        assert q.section_name and "Annex C" in q.section_name, (
            f"q6.2 section_name={q.section_name!r} missing 'Annex C' "
            f"container — Inv-12 regression"
        )
        assert q.section_name and "Section 6" in q.section_name, (
            f"q6.2 section_name={q.section_name!r} missing 'Section 6' "
            f"inner label — Inv-12 regression"
        )
        # Inv-10: q6.2 row's table has no M/O column → is_mandatory stays None.
        assert q.is_mandatory is None, (
            f"q6.2 is_mandatory={q.is_mandatory!r}, expected None — "
            f"Inv-10 violation (inferred from omission)"
        )


# ──────────────────────────────────────────────────────────────────────────
# Inv-11 — inline word limit
# ──────────────────────────────────────────────────────────────────────────


class TestPdfWordLimit:
    """PRODUCT Inv-11 — inline ``[NNN] words`` token captured on the
    field row, however the form expresses it."""

    def test_q6_2_word_limit_500(self, sq_form: ExtractedForm) -> None:
        """SQ q6.2 carries inline ``[500] words`` — must extract as
        ``word_limit=500``."""
        q6_2 = [
            f
            for f in sq_form.fields
            if f.question_text
            and "[500]" in f.question_text
            and "no more" in f.question_text
        ]
        assert q6_2, "no q6.2 [500] words row found"
        assert q6_2[0].word_limit == 500, (
            f"q6.2 word_limit={q6_2[0].word_limit!r}, expected 500 "
            f"— Inv-11 inline-token regression"
        )


# ──────────────────────────────────────────────────────────────────────────
# Inv-8 — coordinates; leave empty rather than fabricate
# ──────────────────────────────────────────────────────────────────────────


class TestPdfCoordinates:
    """PRODUCT Inv-8 — coordinates recorded where they meaningfully apply
    (table row/col/index); left None for free-prose regions."""

    def test_table_fields_carry_table_index(
        self, sq_form: ExtractedForm
    ) -> None:
        """Any field originating from a parsed table must carry a
        ``table_index`` integer (per-page table counter)."""
        table_fields = [f for f in sq_form.fields if f.table_index is not None]
        assert table_fields, "no table-sourced fields recorded"
        for f in table_fields:
            assert isinstance(f.table_index, int)
            assert f.table_index >= 0

    def test_non_tabular_field_col_index_is_none(
        self, sq_form: ExtractedForm
    ) -> None:
        """Inv-8 — where a column coordinate does not meaningfully apply
        (free prose outside a table), ``col_index`` is None, not
        fabricated."""
        prose_fields = [
            f
            for f in sq_form.fields
            if f.table_index is None and f.question_text
        ]
        for f in prose_fields:
            assert f.col_index is None, (
                f"non-tabular field fabricated col_index={f.col_index} — "
                f"Inv-8 regression"
            )


# ──────────────────────────────────────────────────────────────────────────
# Inv-12 — section hierarchy + reading-order sequence
# ──────────────────────────────────────────────────────────────────────────


class TestPdfSectionAndSequence:
    """PRODUCT Inv-12 — section names preserved; ``sequence`` is the
    reading-order position within the form."""

    def test_sequence_is_strictly_increasing(
        self, sq_form: ExtractedForm
    ) -> None:
        """Reading-order ``sequence`` must be strictly increasing across
        the extracted field list."""
        seqs = [f.sequence for f in sq_form.fields]
        assert seqs == sorted(seqs), (
            "sequence values are not in reading order — Inv-12 regression"
        )
        # Strict-increasing (no duplicates) — sequence is a per-form
        # reading-order id, not a group key.
        assert len(set(seqs)) == len(seqs), (
            "duplicate sequence values — Inv-12 regression"
        )

    def test_multiple_distinct_section_names_observed(
        self, sq_form: ExtractedForm
    ) -> None:
        """The SQ PDF has multiple sections (Part 1, Annex B, Section 4,
        Section 5, Section 6, Section 7…); the extractor must observe and
        record at least 2 distinct section names."""
        sections = {f.section_name for f in sq_form.fields if f.section_name}
        assert len(sections) >= 2, (
            f"only {len(sections)} distinct section_name(s) observed — "
            f"Inv-12 regression"
        )


# ──────────────────────────────────────────────────────────────────────────
# Inv-9 — placeholder-vs-authored distinction
# ──────────────────────────────────────────────────────────────────────────


class TestPdfPlaceholderVsAuthored:
    """PRODUCT Inv-9 — extractor does not drop authored questions whose
    answer cell is blank; placeholder text marked distinctly."""

    def test_authored_questions_preserved_with_empty_response_cells(
        self, sq_form: ExtractedForm
    ) -> None:
        """Inv-9 — most SQ rows are authored questions with empty
        response cells; they must appear as ``field_type='empty_cell'``
        WITH ``question_text``, NOT be dropped."""
        authored = [
            f
            for f in sq_form.fields
            if f.field_type == "empty_cell" and f.question_text
        ]
        assert authored, (
            "no authored-question + empty-response-cell rows recorded — "
            "Inv-9 regression (questions dropped because answer cell blank)"
        )


# ──────────────────────────────────────────────────────────────────────────
# Inv-17 — extraction failure surfaces a typed error
# ──────────────────────────────────────────────────────────────────────────


class TestPdfFailureSurfacing:
    """PRODUCT Inv-17 — corrupt input raises ``FormExtractionError``;
    never silently returns an empty ``ExtractedForm``."""

    def test_corrupt_bytes_raises_form_extraction_error(self) -> None:
        with pytest.raises(FormExtractionError) as excinfo:
            asyncio.run(pdf_extract(b"not a real pdf", "corrupt.pdf"))
        assert excinfo.value.rel_path == "corrupt.pdf"
        assert excinfo.value.reason  # non-empty machine-readable token

    def test_empty_bytes_raises_form_extraction_error(self) -> None:
        with pytest.raises(FormExtractionError) as excinfo:
            asyncio.run(pdf_extract(b"", "empty.pdf"))
        assert excinfo.value.rel_path == "empty.pdf"
