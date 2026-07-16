"""Form-structure orchestrator — the analyse_form worker's Plane-2 entry
point (DR-058, ID-145.10; TECH §3.1/§3.2; supersedes the retired id-52
cocoindex-flow Path B this module was recovered from).

``extract_form_structure`` is the single public entry point: a plain async
dispatcher that routes raw file bytes to the matching per-format reader by
filename suffix and returns the reader's ``ExtractedForm``. It performs NO
LLM call — extraction is fully deterministic (every cell / merged-block
decision is reproducible from the raw bytes). Form type classification
arrives via the per-reader ``FormMetadata`` (reused from ``extraction.py``),
not a re-classification here.

RE-HOMING NOTE (ID-145.10 / DR-058): this dispatcher previously ran as a
``@coco.fn(memo=True)`` cocoindex flow component taking a cocoindex
``FileLike`` (id-52 Path B, wired into ``flow.py``'s corpus walk). id-136
retired that wiring per DR-014 (forms enter the system via app-side manual
upload, never the corpus walk) and deleted this package outright. TECH §3.2
recovery instruction is explicit that the per-format readers were coupled to
the walk BY WIRING, not by nature — each already took plain ``(raw_bytes,
filename)``, not the flow's ``FileLike``. Only this orchestrator's dispatch
wrapper carried the cocoindex coupling (the ``@coco.fn`` decorator, the
``FileLike`` parameter, and the ``coerce_extracted_form`` memo-serde
reconstruction helper — all cocoindex-memo-specific, all removed here). The
re-homed shape below is a plain ``(raw_bytes, filename) -> ExtractedForm |
None`` function — the same signature the three per-format readers already
use — so the {145.13} analyse_form worker lane can call it directly on the
bytes it reads from storage, with no cocoindex dependency at all.

Dispatch contract:
  - ``.xlsx`` / ``.docx`` → the matching reader's ``extract(raw, name)``.
  - ``.pdf`` → {145.11}'s commonforms detector (``detect_pdf_fields``),
    shape-adapted to ``ExtractedForm`` via ``_pdf_result_to_extracted_form``
    (see the PDF WIRING note below). Falls back to ``None`` + a structured
    ``form_extractor.skip`` log only when the heavy Plane-2 stack is not
    installed in the running environment (S467 dev/test fallback).
  - ``.xls`` → ``None`` + a structured ``form_extractor.skip`` log (Inv-3: legacy
    ``.xls`` is out of automated scope here; {145.13} converts .doc/.xls via
    LibreOffice headless BEFORE this dispatcher sees them — DR-059).
  - any other suffix (``.md``, ``.txt``, …) → ``None`` (not a form-bearing file).

Reader failures raise ``FormExtractionError`` (defined in ``shared``); the
{145.13} worker catches it per-file (Inv-17) so one form's failure never
halts the queue consumer.

PDF WIRING (ID-145.13, journal 2026-07-12T03:05:44Z — supersedes the
former "not yet wired" PDF NOTE): {145.11}'s commonforms-based detector
(``PdfFieldDetectionResult`` / ``detect_pdf_fields``, this package's
``pdf.py``) is now wired into the ``.pdf`` branch below via
``_pdf_result_to_extracted_form`` — a pure shape-adapter, kept separate
from the ``detect_pdf_fields`` call itself so the {145.13} worker can
call ``detect_pdf_fields`` ONCE (it needs BOTH the field rows AND the
``fillable_pdf_bytes`` artefact for Storage — the artefact is not part
of this dispatcher's ``ExtractedForm`` return contract) and reuse this
same adapter for its ``form_instance_fields`` rows, rather than paying
for a second, redundant commonforms detection pass through this
dispatcher. See ``_pdf_result_to_extracted_form``'s docstring for the
GEOMETRY-PERSISTENCE decision (``table_index``/``row_index`` repurposed
for page/reading-order; the DISPLAYED-space ``geometry`` dict — carried
through since ID-147 {147.9}, TECH §3/DR-064 Option A — rides alongside
on ``ExtractedField.geometry``; the fillable-PDF artefact's own
``/Rect`` entries remain the fill-time source of truth for the {145.15}
fill step).

The commonforms/pypdf/pdfplumber stack is heavyweight (torch closure)
and only installed where ``requirements.txt`` is applied — the import
below is guarded (module import stays collection-safe with the stack
absent, mirroring the ``pytest.importorskip`` convention
``test_pdf_field_detection.py`` already uses for the same stack, S467).
A ``.pdf`` input reaching this dispatcher with the stack unavailable
logs ``form_extractor.skip``/``pdf_dependencies_unavailable`` and
returns ``None`` rather than raising an ``ImportError`` mid-dispatch.

References:
- TECH.md §3.1 (Plane 2), §3.2 (per-format producer + recovery instruction).
- PRODUCT.md (id-52 predecessor) Inv-2, Inv-3, Inv-6, Inv-17 — the
  strict-raise / graceful-empty / skip semantics these readers still honour.
"""

from __future__ import annotations

import json
import logging

from scripts.cocoindex_pipeline.form_extractors.docx import extract as _extract_docx
from scripts.cocoindex_pipeline.form_extractors.shared import (
    ExtractedField,
    ExtractedForm,
    FormExtractionError,
    FormMetadata,
)
from scripts.cocoindex_pipeline.form_extractors.xlsx import extract as _extract_xlsx

# The commonforms/pypdf/pdfplumber stack (torch closure) is only installed
# where requirements.txt is applied (S467) — guard the import so this module
# stays collection-safe (importable, unit-testable) in environments without
# it, e.g. this repo's default sandboxed dev shell. `_detect_pdf_fields is
# None` is the runtime signal the `.pdf` branch below checks.
try:
    from scripts.cocoindex_pipeline.form_extractors.pdf import (
        PdfFieldDetectionError,
        PdfFieldDetectionResult,
    )
    from scripts.cocoindex_pipeline.form_extractors.pdf import (
        detect_pdf_fields as _detect_pdf_fields,
    )
except ImportError:  # pragma: no cover - heavy Plane-2 stack absent (S467)
    PdfFieldDetectionError = Exception  # type: ignore[assignment,misc]
    PdfFieldDetectionResult = None  # type: ignore[assignment,misc]
    _detect_pdf_fields = None

_logger = logging.getLogger(__name__)


def _pdf_result_to_extracted_form(
    result: "PdfFieldDetectionResult", filename: str
) -> ExtractedForm:
    """Shape-adapt {145.11}'s mechanical PDF detection output to this
    package's ``ExtractedForm`` (ID-145.13 wiring).

    GEOMETRY-PERSISTENCE DECISION ({145.13}, journal 2026-07-12):
    ``form_instance_fields`` has no bbox/page columns (TECH §2 M3 keeps
    the docx/xlsx slot model unchanged) and this Subtask authors no DDL
    (W1 is authored-not-pushed). Rather than lose the detected page /
    reading-order entirely, the existing ``table_index`` / ``row_index``
    slots are REPURPOSED for PDF rows only:
      - ``table_index`` <- 0-indexed page number (``field.page_number``).
      - ``row_index`` <- the document-wide reading-order index
        (``field.sequence`` — identical to the row's own ``sequence``,
        duplicated here so a caller sorting by ``(table_index,
        row_index)`` alone, the docx/xlsx convention, still recovers
        correct page-major reading order for PDF rows).
      - ``col_index`` stays unused (``None``) — flat-PDF detection has
        no column concept the way an OOXML table cell does.
    GEOMETRY CARRY-THROUGH (ID-147 {147.9}, TECH §3 / DR-064 Option A):
    ``field.geometry`` — pdf.py's ``_normalise_geometry`` DISPLAYED
    (post-rotation) top-left page-fraction dict, or ``None`` when the
    field's page rotation could not be normalised — is carried straight
    through onto ``ExtractedField.geometry`` unchanged (a pure
    passthrough, no re-derivation here). This is in ADDITION to, not a
    replacement for, the raw acroform widget type / bbox still living
    only on ``PdfFieldDetectionResult`` — the {145.13} worker still
    separately persists ``result.fillable_pdf_bytes`` (the commonforms
    fillable-PDF artefact) to Storage for the {145.15} fill step, which
    reads that artefact's own AcroForm ``/Rect`` entries directly rather
    than reconstructing them from a DB row.

    ``field_type`` is the constant ``'empty_cell'`` (PDF-sourced fields
    carry no placeholder/highlight distinction — pdf.py's own
    precedent). ``form_type`` follows the docx/xlsx readers' own fixed
    default (``'questionnaire'`` — no LLM classification happens at
    this mechanical Plane-2 layer, matching ``docx.py``/``xlsx.py``).
    """
    fields = [
        ExtractedField(
            question_text=field.question_text or None,
            field_type="empty_cell",
            fill_status="pending",
            table_index=field.page_number,
            row_index=field.sequence,
            sequence=field.sequence,
            geometry=field.geometry,
        )
        for field in result.fields
    ]
    metadata = FormMetadata(
        form_type="questionnaire",
        form_format="pdf",
        form_title=filename,
    )
    return ExtractedForm(form_metadata=metadata, fields=fields)


async def extract_form_structure(
    raw_bytes: bytes, filename: str
) -> ExtractedForm | None:
    """Dispatch one uploaded form document to its per-format reader.

    Args:
        raw_bytes: The file's bytes (read by the caller — the {145.13}
            analyse_form worker — from storage).
        filename: The file's name, used for suffix dispatch and passed
            through into each reader's ``FormExtractionError.rel_path`` /
            ``FormMetadata.form_title`` fallback.

    Returns:
        An ``ExtractedForm`` when ``filename`` carries a recognised
        form-bearing suffix and the reader succeeds; ``None`` when the file
        is not form-relevant (e.g. ``.md`` content), an out-of-scope
        legacy ``.xls`` (Inv-3 — logged, not raised), or a ``.pdf`` and the
        heavy Plane-2 stack is not installed in this environment (S467 —
        logged, not raised).

    Raises:
        FormExtractionError: propagated unchanged from the per-format
            reader (Inv-17 — never silently swallowed here).
    """
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    suffix = f".{suffix}" if suffix else ""

    if suffix == ".xlsx":
        return await _extract_xlsx(raw_bytes, filename)
    if suffix == ".docx":
        return await _extract_docx(raw_bytes, filename)
    if suffix == ".pdf":
        if _detect_pdf_fields is None:
            # Heavy Plane-2 stack (commonforms/pypdf/pdfplumber) not
            # installed in this environment (S467) — logged, not raised;
            # the real deploy image installs requirements.txt, so this
            # branch is a dev/test-environment fallback only.
            _logger.warning(
                json.dumps(
                    {
                        "event": "form_extractor.skip",
                        "reason": "pdf_dependencies_unavailable",
                        "rel_path": filename,
                    }
                )
            )
            return None
        try:
            result = _detect_pdf_fields(raw_bytes, filename)
        except PdfFieldDetectionError as exc:
            # Inv-17 — never silently swallow a real read failure; wrap in
            # this package's own typed error so callers only ever catch
            # FormExtractionError, matching the docx/xlsx reader contract.
            raise FormExtractionError(
                "corrupt_pdf", filename, str(exc)
            ) from exc
        return _pdf_result_to_extracted_form(result, filename)
    if suffix == ".xls":
        # Inv-3: legacy .xls is out of automated scope for THIS dispatcher —
        # log + return None (NOT a FormExtractionError — there is no
        # failure to surface). {145.13} converts .xls to .xlsx via
        # LibreOffice headless BEFORE calling this dispatcher (DR-059); a
        # bare .xls reaching here means that conversion step was skipped.
        _logger.info(
            json.dumps(
                {
                    "event": "form_extractor.skip",
                    "reason": "xls_out_of_scope",
                    "rel_path": filename,
                }
            )
        )
        return None

    # Any other suffix is not a form-bearing file (markdown content, etc.).
    return None


__all__ = ["extract_form_structure"]
