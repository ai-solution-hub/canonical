"""Inv-17 graceful-vs-strict OQ — semantic record (ID-52.13, escalated S278).

Background
----------

The XLSX extractor (``scripts/cocoindex_pipeline/form_extractors/xlsx.py``)
``extract()`` RAISES ``FormExtractionError`` on the genuinely-broken inputs:

  - empty bytes (``reason='empty_xlsx'``),
  - unreadable / non-XLSX bytes (``reason='unreadable_xlsx'``),
  - a workbook with zero sheets (``reason='empty_xlsx'``).

Those strict paths are already covered by
``TestXlsxFailureSurfacing`` in ``test_form_extractors.py``.

BUT there is a fourth case that is NOT a raise: a structurally VALID
workbook whose sheets match NEITHER the CSP archetype NOR the EFA
scoring-matrix archetype. ``_walk_sheet`` returns ``[]`` for such a
sheet (see the ``return [], sequence_start, 0`` fall-through and its
docstring line "Sheets matching no archetype yield no fields"), and
``extract()`` then returns ``ExtractedForm(fields=[])`` SILENTLY — no
raise, no warning, no log. The {52.12} pipeline write path
(``flow.py::ingest_file``) consequently declares a ``form_templates``
row with ``status='analysed'`` and ``field_count=0`` with no recorded
reason.

This is the GRACEFUL-vs-STRICT tension under PRODUCT Inv-17:

  > "A form is never left in a state where it has an instance record
  >  but silently zero fields with no recorded reason."

A valid-but-zero-archetype XLSX currently produces exactly that state
(an ``analysed`` instance with zero fields and no recorded reason),
because the extractor treats "no archetype matched" as a successful
empty extraction rather than as a surfaced failure.

Disposition
-----------

The Orchestrator empirically confirmed this behaviour and ruled the
disposition ``escalated-to-parent``: this is a PRODUCT Inv-17 semantic
question (should a zero-archetype-but-valid workbook be GRACEFUL-empty
or STRICT-raise?) that only Liam can ratify via a PRODUCT.md Inv-17
amendment. {52.13}'s job is to make the current semantic NON-SILENT and
EXPLICIT — a deliberate, named test record — NOT to unilaterally flip
the behaviour by converting it to a strict raise.

This test therefore ASSERTS + DOCUMENTS the CURRENT behaviour. It is a
forcing function: if a future change converts the zero-archetype path
to a strict raise (the STRICT disposition), this test will fail loudly
and the author will be routed back to this docstring and the pending
PRODUCT.md amendment — at which point the test is updated in lockstep
with the ratified semantic, not silently.

References:
  - docs/specs/id-52-form-extraction/PRODUCT.md Inv-17.
  - scripts/cocoindex_pipeline/form_extractors/xlsx.py
    (``_walk_sheet`` "Sheets matching no archetype yield no fields";
     ``extract`` returns ``ExtractedForm(fields=[])``).
  - docs/reference/test-philosophy.md (real-behaviour: builds a real
    workbook with openpyxl, runs the real extractor — no mocks).
"""

from __future__ import annotations

import asyncio
import io

import openpyxl

from scripts.cocoindex_pipeline.form_extractors.shared import ExtractedForm
from scripts.cocoindex_pipeline.form_extractors.xlsx import extract as xlsx_extract


def _build_zero_archetype_workbook() -> bytes:
    """Construct a structurally VALID XLSX whose single sheet matches
    NEITHER the CSP archetype (``Principle`` in col 3 + ``Implementation``
    in col 5) NOR the EFA scoring-matrix archetype (``Ref`` in col 1 +
    ``Criteria`` in col 2).

    The content is plain freeform prose, so ``_detect_csp_header`` and
    ``_detect_efa_scoring_matrix_header`` both return ``None`` and the
    sheet yields zero fields — but the workbook itself is well-formed
    (openpyxl opens it cleanly, ``sheetnames`` is non-empty), so the
    strict-raise guards in ``extract`` are NOT triggered.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Project Notes"
    # Deliberately avoid both archetype header signatures.
    ws["A1"] = "Internal Project Notes"
    ws["A2"] = "This worksheet is freeform content, not a structured form."
    ws["B2"] = "No 'Ref'/'Criteria' header; no 'Principle'/'Implementation' header."
    ws["A3"] = "Owner"
    ws["B3"] = "Procurement Team"
    ws["A4"] = "Status"
    ws["B4"] = "Draft"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class TestZeroArchetypeXlsxGracefulSemantic:
    """Inv-17 graceful-vs-strict OQ — current GRACEFUL-empty semantic."""

    def test_zero_archetype_xlsx_returns_empty_form_not_error_DOCUMENTED_INV17_GRACEFUL(
        self,
    ) -> None:
        """Inv-17 graceful-vs-strict OQ — graceful-empty semantic; pending
        Liam PRODUCT.md Inv-17 amendment ratification (escalated S278).

        A structurally VALID XLSX whose sheets match no archetype currently
        returns an ``ExtractedForm`` with ``fields == []`` and DOES NOT raise
        ``FormExtractionError``. This test records that semantic deliberately
        so any future flip to a strict-raise disposition fails loudly and is
        reconciled against the ratified PRODUCT.md Inv-17 amendment.
        """
        raw = _build_zero_archetype_workbook()

        # Current semantic: graceful-empty, NOT a raise.
        form = asyncio.run(xlsx_extract(raw, "zero-archetype.xlsx"))

        assert isinstance(form, ExtractedForm)
        # The load-bearing assertion: zero fields, no exception. This is the
        # exact "instance record with silently zero fields and no recorded
        # reason" shape that the pending Inv-17 amendment must rule on.
        assert form.fields == []
        assert len(form.fields) == 0
        # The form-level metadata still constructs (filename fallback title).
        assert form.form_metadata.form_title == "zero-archetype.xlsx"

    def test_workbook_is_genuinely_valid_not_the_strict_raise_path(self) -> None:
        """Guard: prove the fixture is a VALID workbook (openpyxl opens it,
        has >= 1 sheet) so the zero-field outcome is the archetype-miss path,
        NOT one of the already-covered strict-raise paths (empty bytes /
        unreadable bytes / zero-sheet workbook)."""
        raw = _build_zero_archetype_workbook()
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=False)
        assert wb.sheetnames  # non-empty → not the zero-sheet raise path
        assert raw  # non-empty bytes → not the empty_xlsx raise path
