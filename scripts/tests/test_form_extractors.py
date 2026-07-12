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
from docx import Document

from scripts.cocoindex_pipeline.form_extractors.docx import extract as docx_extract
from scripts.cocoindex_pipeline.form_extractors.pdf import extract as pdf_extract
from scripts.cocoindex_pipeline.form_extractors.shared import (
    ExtractedField,
    ExtractedForm,
    FormExtractionError,
    FormMetadata,
)
from scripts.cocoindex_pipeline.form_extractors.xlsx import extract as xlsx_extract

# ──────────────────────────────────────────────────────────────────────────
# Fixture path — committed symlinks to the canonical corpus files.
# ──────────────────────────────────────────────────────────────────────────

_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "form-extraction"
_SQ_PDF_PATH = _FIXTURE_DIR / "standard-selection-questionnaire-ppn-03-24.pdf"
_EFA_XLSX_PATH = _FIXTURE_DIR / "evaluation-matrix-itt-vol8.xlsx"

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


# ══════════════════════════════════════════════════════════════════════════
# XLSX reader — {52.10} acceptance tests against the EFA fixture.
#
# Real-behaviour tests (per ``docs/reference/test-philosophy.md``): the
# extractor reads the actual EFA fixture, NO mocks of openpyxl internals.
# The fixture lives under ``scripts/tests/fixtures/form-extraction`` as a
# symlink to ``docs/testing/test-data/templates/itt-services-efa/...``.
# ══════════════════════════════════════════════════════════════════════════


@pytest.fixture(scope="module")
def efa_xlsx_bytes() -> bytes:
    """Raw bytes for the EFA evaluation-matrix XLSX fixture."""
    assert _EFA_XLSX_PATH.exists(), (
        f"corpus fixture missing — {_EFA_XLSX_PATH} should symlink to "
        f"docs/testing/test-data/templates/itt-services-efa/"
        f"evaluation-matrix-itt-vol8.xlsx"
    )
    return _EFA_XLSX_PATH.read_bytes()


@pytest.fixture(scope="module")
def efa_form(efa_xlsx_bytes: bytes) -> ExtractedForm:
    """Module-scoped EFA extraction — amortise openpyxl walk."""
    return asyncio.run(
        xlsx_extract(efa_xlsx_bytes, "evaluation-matrix-itt-vol8.xlsx")
    )


# ──────────────────────────────────────────────────────────────────────────
# Inv-2 / TECH §2.2 — public shape matches PDF reader
# ──────────────────────────────────────────────────────────────────────────


class TestXlsxPublicShape:
    """The XLSX extractor exposes the same ``extract(raw_bytes, filename)
    -> ExtractedForm`` async signature as the PDF reader (TECH §2.2)."""

    def test_efa_extracts_to_extracted_form(self, efa_form: ExtractedForm) -> None:
        assert isinstance(efa_form, ExtractedForm)
        assert isinstance(efa_form.form_metadata, FormMetadata)
        assert efa_form.form_metadata.form_format == "xlsx"
        assert efa_form.fields, "no fields extracted from EFA"
        for field in efa_form.fields:
            assert isinstance(field, ExtractedField)


# ──────────────────────────────────────────────────────────────────────────
# Inv-13 — per-form dedup: Bidder 1 ≡ Bidder 2 → N fields, NOT 2N
# ──────────────────────────────────────────────────────────────────────────


class TestXlsxEfaDedup:
    """PRODUCT Inv-13 — the EFA workbook repeats the same scoring matrix
    across the ``Bidder 1`` and ``Bidder 2`` sheets; the extractor records
    each distinct question once, not once per copy. Dedup is keyed on
    ``(section_name, normalise(question_text))`` per TECH §2.3."""

    def test_efa_total_field_count_deduped_to_19(
        self, efa_form: ExtractedForm
    ) -> None:
        """Inv-13 — the EFA workbook repeats its scoring matrix across the
        ``Bidder 1`` and ``Bidder 2`` sheets. With per-form dedup keyed on
        ``(section_name, normalise(question_text))`` the extractor records
        each distinct question once: 19 deduped fields (Part2=2, Part3=1,
        Part4=5, Part5=3, Part6=1, Part7=7), NOT 38 (19 per bidder copy)."""
        assert len(efa_form.fields) == 19, (
            f"Inv-13 EFA dedup regression — expected exactly 19 deduped "
            f"fields (Bidder 1 ≡ Bidder 2 collapsed), got "
            f"{len(efa_form.fields)}"
        )

    def test_efa_bidder_questions_deduped_to_n_not_2n(
        self, efa_form: ExtractedForm
    ) -> None:
        """Every ``2.1`` / ``3.1`` / ``4.1..4.5`` / ``5.1..5.3`` /
        ``6.1`` / ``7.1..7.7`` row appears EXACTLY once across the
        whole form, not twice (once per bidder sheet)."""
        authored = [
            f
            for f in efa_form.fields
            if f.question_text and "Bidders" in (f.question_text or "")
        ] + [
            f
            for f in efa_form.fields
            if f.question_text and any(
                tag in f.question_text
                for tag in (
                    "Overall assessment",
                    "Detailed programme",
                    "Approach to construction",
                    "Management procedure",
                    "Panel Members",
                    "Total project cost",
                    "Pricing schedules",
                    "Life cycle",
                )
            )
        ]
        # Group by normalised text — every group should be size 1 (deduped).
        groups: dict[str, int] = {}
        for f in authored:
            key = (f.question_text or "").strip().lower()
            groups[key] = groups.get(key, 0) + 1
        duplicates = {k: c for k, c in groups.items() if c > 1}
        assert not duplicates, (
            f"EFA dedup regression — {len(duplicates)} question(s) appear "
            f"more than once across Bidder 1 / Bidder 2: "
            f"{list(duplicates.items())[:5]}"
        )

    def test_efa_known_question_text_present_exactly_once(
        self, efa_form: ExtractedForm
    ) -> None:
        """The 2.1 question (\"Bidders should outline their overall
        approach…\") exists on BOTH Bidder 1 (rendered with a typo
        \"nsample\") and Bidder 2 (rendered \"sample\") in the raw
        workbook. Per Inv-13 dedup keyed on the NORMALISED text these
        are distinct, so the extractor preserves both as distinct
        candidates. The acceptance bar is that within each rendering,
        the question appears once — not duplicated by sheet."""
        approach = [
            f
            for f in efa_form.fields
            if f.question_text and "overall approach" in (f.question_text.lower())
        ]
        # Each surface variant should appear once.
        normalised: dict[str, int] = {}
        for f in approach:
            key = (f.question_text or "").strip().lower()
            normalised[key] = normalised.get(key, 0) + 1
        for variant, count in normalised.items():
            assert count == 1, (
                f"variant {variant!r} appeared {count} times — duplicate "
                f"sheet copy not deduped"
            )


# ──────────────────────────────────────────────────────────────────────────
# Inv-8 — coordinates populated for scoring-matrix rows
# ──────────────────────────────────────────────────────────────────────────


class TestXlsxEfaCoordinates:
    """PRODUCT Inv-8 — scoring-matrix rows expose row/col/table indices."""

    def test_efa_scoring_matrix_rows_have_coordinates(
        self, efa_form: ExtractedForm
    ) -> None:
        scoring_fields = [
            f
            for f in efa_form.fields
            if f.section_name and "OVERALL APPROACH" in (f.section_name or "").upper()
        ]
        assert scoring_fields, "no Part 2 OVERALL APPROACH question found"
        for f in scoring_fields:
            assert isinstance(f.row_index, int), (
                f"row_index missing on {f.question_text!r}"
            )
            assert isinstance(f.col_index, int), (
                f"col_index missing on {f.question_text!r}"
            )
            assert isinstance(f.table_index, int), (
                f"table_index missing on {f.question_text!r}"
            )


# ──────────────────────────────────────────────────────────────────────────
# Inv-12 — section names: Part 2 — OVERALL APPROACH etc.
# ──────────────────────────────────────────────────────────────────────────


class TestXlsxEfaSections:
    """PRODUCT Inv-12 — section hierarchy preserved from the
    Scoring Matrix's section-header rows (Part N — TITLE)."""

    def test_efa_part_2_section_name_recorded(
        self, efa_form: ExtractedForm
    ) -> None:
        part2 = [
            f
            for f in efa_form.fields
            if f.section_name and "OVERALL APPROACH" in (f.section_name or "").upper()
        ]
        assert part2, (
            "no Part 2 OVERALL APPROACH-sectioned field recorded — "
            "Inv-12 regression"
        )

    def test_efa_multiple_part_sections_observed(
        self, efa_form: ExtractedForm
    ) -> None:
        """The EFA scoring matrix has Parts 2, 3, 4, 5, 6, 7 — at least
        4 of those should appear as distinct section names."""
        section_names = {
            f.section_name
            for f in efa_form.fields
            if f.section_name and "PART" in (f.section_name or "").upper()
        }
        assert len(section_names) >= 4, (
            f"only {len(section_names)} distinct Part sections seen — "
            f"Inv-12 regression"
        )


# ──────────────────────────────────────────────────────────────────────────
# Inv-12 — sequence is reading-order
# ──────────────────────────────────────────────────────────────────────────


class TestXlsxSequence:
    """PRODUCT Inv-12 — reading-order ``sequence`` strictly increasing."""

    def test_efa_sequence_strictly_increasing(
        self, efa_form: ExtractedForm
    ) -> None:
        seqs = [f.sequence for f in efa_form.fields]
        assert seqs == sorted(seqs), (
            "EFA sequence not in reading order — Inv-12 regression"
        )
        assert len(set(seqs)) == len(seqs), (
            "EFA duplicate sequence values — Inv-12 regression"
        )


# ──────────────────────────────────────────────────────────────────────────
# Inv-17 — corrupt / empty XLSX raises FormExtractionError
# ──────────────────────────────────────────────────────────────────────────


class TestXlsxFailureSurfacing:
    """PRODUCT Inv-17 — corrupt input raises ``FormExtractionError``;
    never silently returns an empty ``ExtractedForm``."""

    def test_corrupt_bytes_raises_form_extraction_error(self) -> None:
        with pytest.raises(FormExtractionError) as excinfo:
            asyncio.run(xlsx_extract(b"not a real xlsx", "corrupt.xlsx"))
        assert excinfo.value.rel_path == "corrupt.xlsx"
        assert excinfo.value.reason

    def test_empty_bytes_raises_form_extraction_error(self) -> None:
        with pytest.raises(FormExtractionError) as excinfo:
            asyncio.run(xlsx_extract(b"", "empty.xlsx"))
        assert excinfo.value.rel_path == "empty.xlsx"
        assert excinfo.value.reason


# ──────────────────────────────────────────────────────────────────────────
# TECH §2.3 — dedup only collapses identical text WITHIN a single form
# ──────────────────────────────────────────────────────────────────────────


class TestXlsxDedupScope:
    """TECH §2.3 — dedup is per-form (workspace-scoped). Two distinct
    forms in the same workspace may legitimately share question text;
    catalogue-level reuse is Path-C's concern.

    This test verifies the in-form dedup does not flatten genuinely
    different questions: the EFA scoring matrix contains both a 4.1
    question (\"Overall assessment of Design solution\") and a 4.2
    question (\"Overall assessment of environmental strategy/solution\")
    — these share a 3-word prefix but are different questions and must
    BOTH survive dedup as separate fields.
    """

    def test_efa_similar_questions_not_collapsed(
        self, efa_form: ExtractedForm
    ) -> None:
        design = [
            f
            for f in efa_form.fields
            if f.question_text
            and "Overall assessment of Design solution"
            in (f.question_text or "")
        ]
        env = [
            f
            for f in efa_form.fields
            if f.question_text
            and "Overall assessment of environmental"
            in (f.question_text or "")
        ]
        assert design and env, (
            "4.1 / 4.2 'Overall assessment of …' questions missing — "
            "TECH §2.3 regression (over-collapsed two distinct questions)"
        )


# ──────────────────────────────────────────────────────────────────────────
# DOCX reader — Charnwood ``ITT Services.docx`` (PLAN §{52.11}).
# 1908 paragraphs + 8 tables; the question source is BOTH the prose
# (placeholder spans inside authored paragraphs) AND the tables
# (authored Q/A + placeholder grids).
# ──────────────────────────────────────────────────────────────────────────

_CHARNWOOD_DOCX_PATH = _FIXTURE_DIR / "itt-services-charnwood.docx"


@pytest.fixture(scope="module")
def charnwood_docx_bytes() -> bytes:
    """Raw bytes for the Charnwood DOCX fixture (real corpus file)."""
    assert _CHARNWOOD_DOCX_PATH.exists(), (
        f"corpus fixture missing — {_CHARNWOOD_DOCX_PATH} should symlink to "
        f"docs/testing/test-data/templates/itt-services-charnwood/"
        f"ITT Services.docx"
    )
    return _CHARNWOOD_DOCX_PATH.read_bytes()


@pytest.fixture(scope="module")
def charnwood_form(charnwood_docx_bytes: bytes) -> ExtractedForm:
    """Module-scoped extraction so the pandoc + python-docx walk runs
    once across the assertion bundle below (the Charnwood file has
    unaccepted tracked changes — pandoc resolves them on each open)."""
    return asyncio.run(
        docx_extract(charnwood_docx_bytes, "itt-services-charnwood.docx")
    )


class TestDocxFixtureBaseline:
    """Sanity-check the corpus shape the spec was written against."""

    def test_charnwood_raw_para_and_table_counts(
        self, charnwood_docx_bytes: bytes
    ) -> None:
        """PLAN §{52.11} acceptance line — 1908 paragraphs + 8 tables.

        Verifies the **raw** counts (no pandoc clean-up): the
        extractor operates against these bytes, and the spec count
        is the single point of reference for "the question source"
        the extractor must cover.
        """
        import io

        raw_doc = Document(io.BytesIO(charnwood_docx_bytes))
        assert len(raw_doc.paragraphs) == 1908, (
            f"raw paragraph count drifted from spec baseline (PLAN §{{52.11}}): "
            f"{len(raw_doc.paragraphs)} vs 1908"
        )
        assert len(raw_doc.tables) == 8, (
            f"raw table count drifted from spec baseline (PLAN §{{52.11}}): "
            f"{len(raw_doc.tables)} vs 8"
        )


class TestCharnwoodPerTable:
    """ID-52.20 investigation, SUPERSEDED by DR-058 (ID-145.10) — pin the
    field count of EVERY Charnwood table so no table's zero is silent.

    The original ID-52.20 ruling below pinned 7 of 8 Charnwood tables to a
    documented "legit-zero" because the id-52 readers modelled exactly two
    archetypes (an authored Q/A header, and a first-column placeholder
    grid) and nothing else. FORM-EXTRACTION-SPIKE.md §1.2 measured that
    directly as a DESIGN LIMIT, not a bounded bug — 7/8 real fillable
    Charnwood tables (contact block, timetable, checklist, pricing,
    declaration, signature) were silently dropped. TECH.md §3.2 / spike §5
    mandate generalising past the two archetypes: DR-058's shape-3 fallback
    (a generic labelled-cell -> empty/placeholder-cell detector, plus
    standalone-bracket-label detection) now recovers those tables. This
    class re-rules each table against the MEASURED post-generalisation
    output — every table is asserted to an EXACT count, and every
    remaining zero carries a documented reason. No silent
    under-*or*-over-extraction.

    Rulings (raw shape → reason):

    * ``table[0]`` 3×2 ``[Name]``/``[Tel]`` — **4 fields (shape 3, rule
      1 — standalone bracket-label cells).** ``[Name]``, ``[Tel]``,
      ``[Job title]``, ``[Departmental Email]`` each emit as their own
      ``field_type='placeholder'`` field (row2's ``[Your Department
      Name]`` is a horizontal merge — the merge-continuation guard emits
      it once, not twice). The ID-52.20 "legit-zero" ruling for this
      table is exactly the overfit DR-058 supersedes: a bare bracketed
      label IS a fill-in-the-blank slot, just not the narrower
      ``[Insert …]`` instruction shape the archetype patterns recognise.
    * ``table[1]`` 12×3 ``Stage``/``Date(s)`` — **10 fields (shape 3,
      rule 2 — adjacent label + placeholder-cell pair).** The header row
      itself (``Stage``/``Date(s) and time(s)``) correctly emits nothing
      (neither cell is empty/placeholder-shaped); each data row's stage
      label pairs with its ``[Insert date]``/``[Insert date and time]``
      placeholder cell.
    * ``table[2]`` 12×2 ``SCHEDULE HEADING``/``COMPLETED?`` — **11 fields
      (shape 3, rule 2).** Each schedule label pairs with its ``□``
      checkbox-glyph answer cell (the generic answer-marker set admits
      checkbox glyphs alongside true emptiness and the archetype
      placeholder patterns).
    * ``table[3]`` 7×2 ``Insert question title``/``Insert %`` — **7
      fields, UNCHANGED (shape 2, the archetype placeholder-grid
      fast-path — DR-058 keeps the two archetypes as high-precision
      fast-paths layered OVER the generic detector).**
    * ``table[4]`` 5×2 ``0-3``/``Completely unsatisfactory …`` —
      **legit-zero, UNCHANGED.** Evaluator scoring rubric: BOTH cells on
      every row carry authored descriptor prose (a score band + its
      description), so shape 3's rule 2 correctly does not fire (it
      requires exactly one side of a pair to be empty/placeholder-shaped
      — two authored-prose cells is a reference table, not a fillable
      slot). The spike's own verdict calls this table "arguably correct"
      to leave at zero (FORM-EXTRACTION-SPIKE.md §1.2).
    * ``table[5]`` 8×2 ``Service component description``/``Costs (£)`` —
      **1 field (shape 3, rule 2 — the ``Total Costs (£) *``/``£`` row
      only).** The header row and the 6 blank line-item rows (both
      cells empty on every one) correctly emit nothing — rule 2 requires
      a labelled cell on one side, and a row with BOTH cells blank has no
      label to anchor a field on. Capturing the free-form per-line-item
      pricing grid would need a header-driven "column labels + blank body
      rows" pattern distinct from cell-adjacency pairing; left as a
      known, disclosed gap (not attempted — DR-058 scope is the
      cell-adjacency generalisation TECH.md §3.2 names, not a bespoke
      third archetype).
    * ``table[6]`` 6×2 ``I DECLARE THAT …``/``Name:`` … — **5 fields
      (shape 3, rule 2 — bidirectional).** The declaration statement row
      (both cells carry the same merged prose) correctly emits nothing;
      the 5 labelled slots (``Name:``, ``Position (Job Title):``,
      ``Date:``, ``Telephone number:``, ``Signature:``) each pair with
      their EMPTY left-hand cell — rule 2 checks both neighbour
      directions, since the blank slot sits to the label's LEFT here
      (unlike table[1]/[2]/[7] where it sits to the right).
    * ``table[7]`` 15×2 ``SIGNED for and on behalf of the Council``/`` ``
      — **10 fields (shape 3, rule 2).** Each signature-block label
      (``SIGNED for and on behalf of the Council``, ``Print Name and
      Address``, …) pairs with its empty right-hand cell; blank spacer
      rows (both cells empty) correctly emit nothing.

    FINAL Charnwood counts (DR-058 re-pin, supersedes {52.19}):
    total = 99, paragraph-sourced (``table_index is None``) = 51
    (UNCHANGED from {52.19} — the paragraph-level placeholder walk is
    untouched by this generalisation), table-sourced = 48 across 7 of
    the document's 8 tables (up from 7 fields / 1 table).
    """

    # table_index → (expected field count, ruling/reason). Zero entries
    # carry the documented reason as the assertion message so a future
    # drift cannot silently re-introduce an unexplained zero.
    _EXPECTED: dict[int, tuple[int, str]] = {
        0: (4, "shape 3 rule 1: standalone bracket-label cells ([Name]/[Tel]/[Job title]/[Departmental Email])"),
        1: (10, "shape 3 rule 2: timetable label + [Insert date] placeholder pairs"),
        2: (11, "shape 3 rule 2: schedule label + checkbox-glyph answer pairs"),
        3: (7, "placeholder grid (Inv-9, shape 2 archetype, unchanged): 7 'Insert question title' rows"),
        4: (0, "legit-zero, unchanged: evaluator scoring rubric — both cells are authored prose, no empty/placeholder side"),
        5: (1, "shape 3 rule 2: only the 'Total Costs (£) *' / '£' row — blank per-line-item rows have no labelled cell to anchor on (disclosed gap)"),
        6: (5, "shape 3 rule 2 (bidirectional): Name:/Position:/Date:/Telephone number:/Signature: pair with their EMPTY left-hand cell"),
        7: (10, "shape 3 rule 2: signature-block labels pair with their empty right-hand cell"),
    }

    def test_charnwood_per_table_field_count(
        self, charnwood_form: ExtractedForm, charnwood_docx_bytes: bytes
    ) -> None:
        """Every one of the 8 Charnwood tables is asserted to an EXACT
        expected count — non-zero with a captured shape, or zero with a
        documented legit-zero reason. No silent under-extraction."""
        import io

        counts: dict[int, int] = {ti: 0 for ti in self._EXPECTED}
        for field in charnwood_form.fields:
            if field.table_index is not None:
                counts[field.table_index] = counts.get(field.table_index, 0) + 1

        # Every table the document carries must be ruled (no table is
        # absent from the expectation map — guards against a new table
        # appearing and silently surfacing/dropping fields).
        raw_doc = Document(io.BytesIO(charnwood_docx_bytes))
        assert len(raw_doc.tables) == len(self._EXPECTED), (
            f"Charnwood table count drifted ({len(raw_doc.tables)} tables) — "
            f"the per-table ruling map covers {len(self._EXPECTED)}; re-rule "
            f"the new/removed table before re-pinning {{52.19}} counts"
        )

        for table_index, (expected, reason) in self._EXPECTED.items():
            actual = counts.get(table_index, 0)
            assert actual == expected, (
                f"table[{table_index}] field count {actual} != expected "
                f"{expected} — ruling: {reason}"
            )

    def test_charnwood_total_paragraph_table_counts(
        self, charnwood_form: ExtractedForm
    ) -> None:
        """DR-058 re-pin (supersedes {52.19}) — headline totals against the
        MEASURED post-generalisation output: 99 total, 51 paragraph-sourced
        (unchanged — the paragraph walk is untouched by DR-058), 48
        table-sourced across 7 of the document's 8 tables (up from 7 fields
        confined to table[3] alone). See TestCharnwoodPerTable for the
        per-table ruling this total is built from."""
        fields = charnwood_form.fields
        paragraph_sourced = [f for f in fields if f.table_index is None]
        table_sourced = [f for f in fields if f.table_index is not None]
        assert len(fields) == 99, (
            f"Charnwood TOTAL field count drifted: {len(fields)} != 99 "
            f"(DR-058 re-pin, feeds ID-145.10 regression gate)"
        )
        assert len(paragraph_sourced) == 51, (
            f"Charnwood paragraph-sourced count drifted: "
            f"{len(paragraph_sourced)} != 51 — the paragraph-level walk is "
            f"untouched by the DR-058 table generalisation"
        )
        assert len(table_sourced) == 48, (
            f"Charnwood table-sourced count drifted: "
            f"{len(table_sourced)} != 48"
        )
        tables_with_fields = {f.table_index for f in table_sourced}
        assert tables_with_fields == {0, 1, 2, 3, 5, 6, 7}, (
            f"Charnwood tables-with-fields drifted: {sorted(tables_with_fields)} "
            f"!= [0,1,2,3,5,6,7] — table[4] (the scoring rubric) is the one "
            f"documented legit-zero (TestCharnwoodPerTable); DR-058's "
            f"regression gate is 'Charnwood >= its 8 real fillable tables' — "
            f"7 of 8 clear that bar, up from 1 of 8 pre-generalisation"
        )


class TestDocxParasAndTablesBoth:
    """PRODUCT Inv-8 + Inv-12 — the extractor walks BOTH paragraphs AND
    tables, recording fields from each in reading-order ``sequence``."""

    def test_fields_originate_from_both_paragraphs_and_tables(
        self, charnwood_form: ExtractedForm
    ) -> None:
        """At least one field must come from a paragraph (table_index
        is None) AND at least one must come from a table (table_index
        is an integer). If only one side fires the extractor is
        dropping content the spec demands."""
        paragraph_sourced = [
            f for f in charnwood_form.fields if f.table_index is None
        ]
        table_sourced = [
            f for f in charnwood_form.fields if f.table_index is not None
        ]
        assert paragraph_sourced, (
            "no paragraph-sourced fields — the extractor missed the "
            "1908-paragraph prose-side question source (PLAN §{52.11} "
            "Inv-8 paras+tables)"
        )
        assert table_sourced, (
            "no table-sourced fields — the extractor missed the 8-table "
            "structural question source (PLAN §{52.11} Inv-8 paras+tables)"
        )

    def test_sequence_is_strictly_increasing(
        self, charnwood_form: ExtractedForm
    ) -> None:
        """Inv-12 — ``sequence`` must be the reading-order position
        across the WHOLE form (paragraphs and tables interleaved)."""
        seqs = [f.sequence for f in charnwood_form.fields]
        assert seqs == sorted(seqs), "sequence not in reading order"
        assert len(set(seqs)) == len(seqs), "duplicate sequence values"


class TestDocxPlaceholderGrid:
    """PRODUCT Inv-9 — ``Insert question title`` grid rows surface as
    placeholders, not authored questions.

    Charnwood ``ITT Services.docx`` table 3 is a 7-row 2-col grid:

    | Insert question title | Insert % |
    | Insert questions title | Insert % |
    | ... |

    Every first-column cell is placeholder text; the spec demands
    ``field_type='placeholder'``, ``placeholder_text`` populated,
    ``question_text=None`` per Inv-9.
    """

    def test_placeholder_grid_rows_have_no_authored_question(
        self, charnwood_form: ExtractedForm
    ) -> None:
        placeholder_grid_fields = [
            f
            for f in charnwood_form.fields
            if f.field_type == "placeholder"
            and f.placeholder_text
            and "Insert question" in f.placeholder_text
        ]
        assert placeholder_grid_fields, (
            "no 'Insert question title' grid rows extracted — Inv-9 "
            "placeholder-grid regression (Charnwood table 3)"
        )
        for f in placeholder_grid_fields:
            assert f.question_text is None, (
                f"placeholder-grid row carried question_text={f.question_text!r} — "
                f"Inv-9 violation (placeholder grid must not synthesise "
                f"an authored question)"
            )
            assert f.placeholder_text is not None
            assert f.field_type == "placeholder"
            assert f.table_index is not None, (
                "placeholder-grid row must carry table_index — Inv-8"
            )


class TestDocxAuthoredQuestionsPreserved:
    """PRODUCT Inv-9 — authored questions with empty answer cells must
    be preserved (not dropped because the answer slot is blank)."""

    def test_authored_paragraph_question_text_populated(
        self, charnwood_form: ExtractedForm
    ) -> None:
        """Paragraph-sourced placeholder fields must record the full
        paragraph as ``question_text`` (so the filler has context) and
        the placeholder span as ``placeholder_text``."""
        paragraph_sourced = [
            f
            for f in charnwood_form.fields
            if f.table_index is None
            and f.question_text
            and f.placeholder_text
        ]
        assert paragraph_sourced, (
            "no paragraph fields carrying both authored prose + "
            "placeholder span — Inv-9 paragraph-side regression"
        )
        # E-Mail: [Insert departmental email address] is in the
        # document header — confirm the placeholder span survives.
        email_field = [
            f
            for f in paragraph_sourced
            if f.placeholder_text
            and "departmental email" in f.placeholder_text.lower()
        ]
        assert email_field, (
            "expected '[Insert departmental email address]' placeholder "
            "from the document header — Inv-9 paragraph-side regression"
        )


class TestDocxWordLimit:
    """PRODUCT Inv-11 — word limit extracted via the reused
    ``_extract_word_limit`` helper when the form expresses one."""

    def test_extracted_word_limit_uses_reused_helper(self) -> None:
        """Direct unit check of the reused helper — ensures the import
        path delivers the same regex as the prior art."""
        from scripts.cocoindex_pipeline.form_extractors.docx import (
            _extract_word_limit as docx_extract_word_limit,
        )

        assert docx_extract_word_limit("Max 500 words") == 500
        assert docx_extract_word_limit("(no more than 250 words)") == 250
        assert docx_extract_word_limit("no limit stated") is None


class TestDocxSectionFromHeading:
    """PRODUCT Inv-12 — section name inherits from the most recent
    Heading-styled paragraph above the field.

    The reused ``_extract_section_headings`` helper maps tables to
    headings; our wrapper inlines that walk so paragraphs share the
    same streaming-section state.
    """

    def test_some_fields_carry_section_name(
        self, charnwood_form: ExtractedForm
    ) -> None:
        """At least some fields must carry a non-None ``section_name``
        — the Charnwood document uses Heading-styled paragraphs (e.g.
        ``SECTION A Company Details``)."""
        with_section = [
            f for f in charnwood_form.fields if f.section_name
        ]
        assert with_section, (
            "no fields carry section_name — Inv-12 regression (heading "
            "tracking broken)"
        )


class TestDocxMetadata:
    """``FormMetadata`` shape matches the PDF + XLSX readers."""

    def test_form_format_is_docx(self, charnwood_form: ExtractedForm) -> None:
        assert charnwood_form.form_metadata.form_format == "docx"

    def test_form_title_falls_back_to_filename(
        self, charnwood_form: ExtractedForm
    ) -> None:
        """When no title-styled paragraph is detected, the wrapper
        falls back to the supplied filename (mirrors the PDF reader's
        title fallback)."""
        assert charnwood_form.form_metadata.form_title == (
            "itt-services-charnwood.docx"
        )


class TestDocxFailureSurfacing:
    """PRODUCT Inv-17 — corrupt or empty input raises
    ``FormExtractionError``; never silently returns an empty
    ``ExtractedForm``."""

    def test_corrupt_bytes_raises_form_extraction_error(self) -> None:
        with pytest.raises(FormExtractionError) as excinfo:
            asyncio.run(docx_extract(b"not a real docx", "corrupt.docx"))
        assert excinfo.value.rel_path == "corrupt.docx"
        assert excinfo.value.reason  # non-empty machine-readable token

    def test_empty_bytes_raises_form_extraction_error(self) -> None:
        with pytest.raises(FormExtractionError) as excinfo:
            asyncio.run(docx_extract(b"", "empty.docx"))
        assert excinfo.value.rel_path == "empty.docx"
        assert excinfo.value.reason == "empty_docx"


# ──────────────────────────────────────────────────────────────────────────
# Inv-17 — the committed `corrupt.pdf` batch fixture raises (drives the
# integration batch's `status='analysis_failed'` row in {52.13}).
# ──────────────────────────────────────────────────────────────────────────


class TestCorruptPdfBatchFixture:
    """PRODUCT Inv-17 — the committed ``corrupt.pdf`` fixture (a real,
    truncated, non-symlink byte file) is the failure member of the
    ``form-extraction.integration.test.ts`` batch
    ``[corrupt.pdf, sq.pdf, efa.xlsx, charnwood.docx]``. Asserting it
    raises ``FormExtractionError`` here (deterministically, no infra)
    anchors the fixture's purpose: the pipeline write path
    (``flow.py::ingest_file``) catches that error and declares one
    ``form_templates`` row with ``status='analysis_failed'`` while the
    three readable forms extract normally (batch not halted)."""

    _CORRUPT_PDF_PATH = _FIXTURE_DIR / "corrupt.pdf"

    def test_corrupt_pdf_fixture_exists_and_is_a_real_file(self) -> None:
        assert self._CORRUPT_PDF_PATH.exists(), (
            f"batch failure fixture missing — {self._CORRUPT_PDF_PATH} must be a "
            f"real (non-symlink) truncated PDF that pdfplumber cannot open"
        )
        assert not self._CORRUPT_PDF_PATH.is_symlink(), (
            "corrupt.pdf must be a real byte file, NOT a symlink (per {52.13} brief)"
        )

    def test_corrupt_pdf_fixture_raises_form_extraction_error(self) -> None:
        raw = self._CORRUPT_PDF_PATH.read_bytes()
        assert raw  # non-empty bytes — exercises the open-failure path, not empty_pdf
        with pytest.raises(FormExtractionError) as excinfo:
            asyncio.run(pdf_extract(raw, "corrupt.pdf"))
        assert excinfo.value.rel_path == "corrupt.pdf"
        assert excinfo.value.reason  # non-empty machine-readable token


# ──────────────────────────────────────────────────────────────────────────
# DR-058 (ID-145.10) — generalisation regression gate. The two archetypes
# (authored Q/A header, placeholder grid for DOCX; CSP/EFA header signatures
# for XLSX) reproduce the id-52 ACCEPTANCE.md numbers exactly on in-corpus
# fixtures but measured ZERO on unseen real forms
# (FORM-EXTRACTION-SPIKE.md §1.1). This section pins the corpus regression
# gate the recovery+generalisation subtask brief names explicitly: Charnwood
# >= 8 real fillable tables (TestCharnwoodPerTable, above), annex_2 > 0,
# annex_3 rate-card rows detected, EFA stays exactly 19 (no regression from
# the new XLSX fallback), CSP stays exactly 45 (the archetype fast-path,
# unchanged by generalisation) — plus two isolated synthetic proofs that the
# generic rule itself (not just the real corpus) fires beyond the two
# archetypes, and one proof that it does NOT fire on non-form metadata
# (the measured false-positive risk the header+repetition gating in
# xlsx.py exists to close — EFA's own "Title Sheet"/"Summary" sheets).
# ──────────────────────────────────────────────────────────────────────────


class TestDR058UnseenRealFormsRegressionGate:
    """Real-corpus regression gate, measured against the owner-provided
    forms the id-52 archetypes never saw."""

    _ANNEX_2_PATH = _FIXTURE_DIR / "annex_2_supplier_response.docx"
    _ANNEX_3_PATH = _FIXTURE_DIR / "annex_3_pricing_approach.xlsx"
    _CSP_PATH = _FIXTURE_DIR / "Cloud Security Principles Checklist V5_3.xlsx"

    def test_annex_2_docx_yields_nonzero_fields(self) -> None:
        """British Council annex_2 supplier-response DOCX — measured ZERO
        pre-generalisation (0 fields; FORM-EXTRACTION-SPIKE.md §1.1's
        header row is a merged section banner, not the id-52 archetypes'
        assumed ``rows[0]``). The requirement prose lives one cell per row,
        followed by trailing blank paragraphs after a "Supplier Response:"
        label — the shape-3 rule-3 cell-internal-trailing-blank detector."""
        assert self._ANNEX_2_PATH.exists(), (
            f"fixture missing — {self._ANNEX_2_PATH} should symlink to "
            f"docs/testing/test-data/templates/rfp-british-council/"
            f"annex_2_supplier_response.docx"
        )
        raw = self._ANNEX_2_PATH.read_bytes()
        form = asyncio.run(docx_extract(raw, "annex_2_supplier_response.docx"))
        assert len(form.fields) > 0, (
            "annex_2 must yield >0 fields post-generalisation (measured 0 "
            "pre-generalisation — FORM-EXTRACTION-SPIKE.md §1.1)"
        )
        # At least one field must carry the real requirement prose (not
        # just header-row noise) — proves rule 3 actually fired.
        assert any(
            f.question_text and "avoided" in f.question_text.lower()
            for f in form.fields
        ), "expected the Social Value requirement prose among the extracted fields"

    def test_annex_3_xlsx_rate_card_rows_detected(self) -> None:
        """British Council annex_3 rate-card XLSX — measured ZERO
        pre-generalisation (FORM-EXTRACTION-SPIKE.md §1.1). The "Rate Card
        & Resources" sheet matches neither the EFA nor CSP header
        signature; each role row pairs a labelled Role cell with its
        unfilled Day Rate cell (a bare numeric zero default)."""
        assert self._ANNEX_3_PATH.exists(), (
            f"fixture missing — {self._ANNEX_3_PATH} should symlink to "
            f"docs/testing/test-data/templates/rfp-british-council/"
            f"annex_3_pricing_approach.xlsx"
        )
        raw = self._ANNEX_3_PATH.read_bytes()
        form = asyncio.run(xlsx_extract(raw, "annex_3_pricing_approach.xlsx"))
        assert len(form.fields) > 0, (
            "annex_3 must yield >0 fields post-generalisation (measured 0 "
            "pre-generalisation — FORM-EXTRACTION-SPIKE.md §1.1)"
        )
        # At least one field must be a rate-card role row (not just the
        # VAT/Overall Price summary lines).
        assert any(
            f.question_text and f.question_text.lower().startswith("e.g.")
            for f in form.fields
        ), "expected at least one 'e.g. <role>' rate-card row among the extracted fields"

    def test_csp_xlsx_matches_acceptance_baseline_unregressed(self) -> None:
        """CSP Cloud Security Principles checklist — the CSP archetype
        fast-path (unchanged by DR-058) must still hit its measured 45
        (FORM-EXTRACTION-SPIKE.md §1.1 / the id-52 ACCEPTANCE.md baseline);
        the generic XLSX fallback must NOT also fire on this sheet (it is
        archetype-claimed, so shape 3 never runs on it — a drift here would
        mean the archetype dispatch order broke)."""
        assert self._CSP_PATH.exists(), (
            f"fixture missing — {self._CSP_PATH} should symlink to "
            f"docs/testing/test-data/templates/csp-cloud-security-principles/"
            f"Cloud Security Principles Checklist V5_3.xlsx"
        )
        raw = self._CSP_PATH.read_bytes()
        form = asyncio.run(
            xlsx_extract(raw, "Cloud Security Principles Checklist V5_3.xlsx")
        )
        assert len(form.fields) == 45, (
            f"CSP field count drifted: {len(form.fields)} != 45 "
            f"(FORM-EXTRACTION-SPIKE.md §1.1 baseline)"
        )


class TestDR058GenericRuleIsolated:
    """Synthetic, isolated proofs that the shape-3 generic rule itself
    fires beyond the two archetypes — independent of the real corpus above,
    so a future change that narrows the rule fails here with a direct,
    minimal repro rather than only via an opaque real-fixture count drift."""

    def test_docx_generic_label_to_empty_cell_row_beyond_archetypes(self) -> None:
        """A 2-column table whose header does NOT classify as an authored
        Q/A table (``_classify_header`` returns None for both columns —
        neither archetype 1 nor archetype 2 can fire) still yields a field
        from a plain "label cell followed by an empty cell" row."""
        from docx import Document as _Document

        doc = _Document()
        table = doc.add_table(rows=2, cols=2)
        table.rows[0].cells[0].text = "Company Registration Number"
        table.rows[0].cells[1].text = ""  # genuinely empty answer cell
        table.rows[1].cells[0].text = "VAT Number"
        table.rows[1].cells[1].text = ""
        import io

        buf = io.BytesIO()
        doc.save(buf)

        form = asyncio.run(docx_extract(buf.getvalue(), "synthetic-generic.docx"))
        labels = {f.question_text for f in form.fields if f.question_text}
        assert "Company Registration Number" in labels
        assert "VAT Number" in labels
        assert all(f.field_type == "empty_cell" for f in form.fields)

    def test_xlsx_generic_labelled_adjacent_empty_cell_beyond_archetypes(
        self,
    ) -> None:
        """A worksheet matching neither the CSP header signature
        (``Principle``/``Implementation``) nor the EFA signature
        (``Ref``/``Criteria``) still yields fields from repeated
        labelled-cell + empty-adjacent-cell rows (>= the 3-row repetition
        floor xlsx.py's generic fallback requires)."""
        import io

        import openpyxl

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Supplier Details"
        ws["A1"] = "Field"
        ws["B1"] = "Response"
        ws["A2"] = "Company name"
        ws["A3"] = "Registered address"
        ws["A4"] = "Company registration number"
        # B2..B4 deliberately left blank — the unfilled answer cells.
        buf = io.BytesIO()
        wb.save(buf)

        form = asyncio.run(xlsx_extract(buf.getvalue(), "synthetic-generic.xlsx"))
        labels = {f.question_text for f in form.fields if f.question_text}
        assert "Company name" in labels
        assert "Registered address" in labels
        assert "Company registration number" in labels


class TestDR058GenericFallbackDoesNotFireOnMetadata:
    """Locks in the false-positive guard the header+repetition gating in
    ``xlsx.py`` exists for — measured against the EFA workbook's own
    non-scoring-matrix sheets during DR-058 development: a document-metadata
    block (scattered short label/value pairs with large gaps) and a
    sub-header row immediately following a real header must NOT produce
    fields on their own (below the repetition floor)."""

    def test_xlsx_sparse_metadata_block_yields_no_generic_fields(self) -> None:
        """A metadata block (title/owner/organisation rows with a gapped
        column layout) is NOT a repeating table — the generic fallback
        must require >= 3 repeating candidate rows before accepting a
        region, so an isolated 1-2-row coincidental match is discarded."""
        import io

        import openpyxl

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Document Properties"
        ws["B24"] = "Document Properties"
        ws["B25"] = "Document Owner"
        ws["F25"] = "Deputy Director"
        ws["B26"] = "Organisation"
        ws["F26"] = "Acme Council"
        buf = io.BytesIO()
        wb.save(buf)

        form = asyncio.run(xlsx_extract(buf.getvalue(), "synthetic-metadata.xlsx"))
        assert form.fields == [], (
            "a sparse metadata block below the repetition floor must yield "
            "zero generic fields — a coincidental single-row match is not "
            "a genuine repeating fillable table"
        )


# ──────────────────────────────────────────────────────────────────────────
# DR-058 — w:sdt content controls + highlighted runs (TECH §3.2: "ALSO emit
# w:sdt content-controls + highlighted runs"). No real corpus fixture
# exercises either shape (Charnwood has 0 sdt elements and its 188
# highlighted runs are all non-empty buyer-customisation emphasis, not
# blank fill-in slots — see the module docstring on
# ``_highlighted_run_fields`` in docx.py for the measured false-positive
# evidence that shaped this design) — these are synthetic, built
# programmatically with raw OOXML elements (the same pattern
# ``test_docx_tracked_changes_regression.py`` uses for w:ins/w:del).
# ──────────────────────────────────────────────────────────────────────────


def _build_docx_with_sdt(
    *, alias: str | None, content_text: str | None
) -> bytes:
    """Build a minimal .docx whose body carries one ``w:sdt`` content
    control with an optional ``w:sdtPr/w:alias`` title and optional
    ``w:sdtContent`` text."""
    import io as _io

    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    doc = Document()
    # Seed a real paragraph so the document is non-empty even if the sdt
    # sweep were somehow skipped.
    doc.add_paragraph("Cover sheet.")

    sdt = OxmlElement("w:sdt")
    sdt_pr = OxmlElement("w:sdtPr")
    if alias is not None:
        alias_el = OxmlElement("w:alias")
        alias_el.set(qn("w:val"), alias)
        sdt_pr.append(alias_el)
    sdt.append(sdt_pr)

    sdt_content = OxmlElement("w:sdtContent")
    p = OxmlElement("w:p")
    if content_text is not None:
        r = OxmlElement("w:r")
        t = OxmlElement("w:t")
        t.text = content_text
        r.append(t)
        p.append(r)
    sdt_content.append(p)
    sdt.append(sdt_content)

    doc.element.body.insert(len(doc.element.body) - 1, sdt)

    buf = _io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _build_docx_with_highlighted_run(
    *, run_text: str, colour: str = "yellow"
) -> bytes:
    """Build a minimal .docx whose body carries one paragraph containing a
    single highlighted run (``w:rPr/w:highlight``)."""
    import io as _io

    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    doc = Document()
    p = doc.add_paragraph()
    run = p.add_run(run_text)
    highlight = OxmlElement("w:highlight")
    highlight.set(qn("w:val"), colour)
    run._element.get_or_add_rPr().append(highlight)

    buf = _io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


class TestDR058SdtContentControls:
    """``w:sdt`` content-control detection (synthetic — no real fixture)."""

    def test_sdt_with_alias_and_stock_placeholder_emits_field(self) -> None:
        raw = _build_docx_with_sdt(
            alias="Company Name", content_text="Click here to enter text."
        )
        form = asyncio.run(docx_extract(raw, "sdt-synthetic.docx"))
        matches = [f for f in form.fields if f.question_text == "Company Name"]
        assert matches, "expected a field carrying the sdt alias as question_text"
        field = matches[0]
        assert field.placeholder_text == "Click here to enter text."
        assert field.field_type == "placeholder"

    def test_sdt_with_alias_only_and_empty_content_emits_field(self) -> None:
        raw = _build_docx_with_sdt(alias="VAT Number", content_text=None)
        form = asyncio.run(docx_extract(raw, "sdt-synthetic.docx"))
        matches = [f for f in form.fields if f.question_text == "VAT Number"]
        assert matches, "an aliased, empty content control must still emit"
        assert matches[0].field_type == "empty_cell"
        assert matches[0].placeholder_text is None

    def test_sdt_already_filled_with_authored_content_emits_nothing(self) -> None:
        """A content control carrying real (non-stock) authored text is
        FILLED, not an unfilled slot — must not surface as a field."""
        raw = _build_docx_with_sdt(
            alias="Company Name", content_text="Acme Consulting Ltd"
        )
        form = asyncio.run(docx_extract(raw, "sdt-synthetic.docx"))
        assert not any(f.question_text == "Company Name" for f in form.fields)

    def test_sdt_with_no_alias_and_no_content_emits_nothing(self) -> None:
        """No label and no visible placeholder prompt — nothing to anchor
        a field on."""
        raw = _build_docx_with_sdt(alias=None, content_text=None)
        form = asyncio.run(docx_extract(raw, "sdt-synthetic.docx"))
        # The cover-sheet paragraph is the only expected field source (a
        # plain prose paragraph carries no placeholder span, so this is 0).
        assert form.fields == []


class TestDR058HighlightedRuns:
    """Highlighted-run detection (synthetic — no real fixture). Tightened
    to genuinely BLANK highlighted spans only after real-corpus measurement
    (Charnwood: 188 highlighted runs, all non-empty buyer-customisation
    emphasis — see docx.py's ``_highlighted_run_fields`` docstring)."""

    def test_empty_highlighted_run_emits_a_highlighted_field(self) -> None:
        raw = _build_docx_with_highlighted_run(run_text="")
        form = asyncio.run(docx_extract(raw, "highlight-synthetic.docx"))
        highlighted = [f for f in form.fields if f.field_type == "highlighted"]
        assert highlighted, "an empty highlighted run must emit a highlighted field"

    def test_nonempty_highlighted_prose_emits_nothing(self) -> None:
        """Highlighted PROSE is ambiguous emphasis, not reliably a fillable
        field (measured false-positive risk) — must not surface."""
        raw = _build_docx_with_highlighted_run(
            run_text="Charnwood Borough Council"
        )
        form = asyncio.run(docx_extract(raw, "highlight-synthetic.docx"))
        assert not any(f.field_type == "highlighted" for f in form.fields)

    def test_non_highlighted_run_emits_nothing(self) -> None:
        raw = _build_docx_with_highlighted_run(run_text="", colour="none")
        form = asyncio.run(docx_extract(raw, "highlight-synthetic.docx"))
        assert not any(f.field_type == "highlighted" for f in form.fields)
