"""Path B deterministic form-structure orchestrator (TECH §2.4, PRODUCT Inv-2/Inv-3).

``extract_form_structure`` is the single public Path-B entry point: a
``@coco.fn(memo=True)`` dispatcher that routes a cocoindex ``FileLike`` to the
matching per-format reader by file suffix and returns the reader's
``ExtractedForm``. It performs NO LLM call — Path B is fully deterministic
(every cell / merged-block decision is reproducible from the raw bytes). Form
type classification arrives via the per-reader ``FormMetadata`` (reused from
``extraction.py``), not a re-classification here.

``@coco.fn(memo=True)`` lets cocoindex's content-fingerprint cache skip
re-extraction on unchanged file bytes — the substrate for Inv-16 idempotency
(TECH §2.8).

Dispatch contract:
  - ``.pdf`` / ``.xlsx`` / ``.docx`` → the matching reader's ``extract(raw, name)``.
  - ``.xls`` → ``None`` + a structured ``form_extractor.skip`` log (Inv-3: legacy
    ``.xls`` is out of automated scope; manual pre-convert). NO raise.
  - any other suffix (``.md``, ``.txt``, …) → ``None`` (not a form-bearing file).

Reader failures raise ``FormExtractionError`` (defined in ``shared``); the
caller in ``flow.py::ingest_file`` catches it per-file (Inv-17) so one form's
failure never halts the batch.

References:
- ``docs/specs/id-52-form-extraction/TECH.md`` §2.4 (this shape), §2.2 (reader
  matrix), §2.8 (memo idempotency substrate).
- ``docs/specs/id-52-form-extraction/PRODUCT.md`` Inv-2, Inv-3, Inv-6, Inv-17.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

import cocoindex as coco

from scripts.cocoindex_pipeline.form_extractors.docx import extract as _extract_docx
from scripts.cocoindex_pipeline.form_extractors.pdf import extract as _extract_pdf
from scripts.cocoindex_pipeline.form_extractors.shared import ExtractedForm
from scripts.cocoindex_pipeline.form_extractors.xlsx import extract as _extract_xlsx

if TYPE_CHECKING:  # pragma: no cover - typing only
    import cocoindex.resources.file  # noqa: F401

_logger = logging.getLogger(__name__)


@coco.fn(memo=True)
async def extract_form_structure(
    file: "coco.resources.file.FileLike",  # type: ignore[name-defined]
) -> ExtractedForm | None:
    """Path B Stage-3a — deterministic raw-format extraction (TECH §2.4).

    Returns an ``ExtractedForm`` when ``file`` is a recognised form-bearing
    format and the reader succeeds; returns ``None`` when the file is not
    form-relevant (e.g. ``.md`` content) or is an out-of-scope legacy ``.xls``
    (Inv-3 — logged, not raised). Reader failures raise ``FormExtractionError``,
    caught per-file by ``ingest_file`` (Inv-17).
    """
    suffix = file.file_path.path.suffix.lower()
    name = file.file_path.path.name

    if suffix == ".pdf":
        return await _extract_pdf(await file.read(), name)
    if suffix == ".xlsx":
        return await _extract_xlsx(await file.read(), name)
    if suffix == ".docx":
        return await _extract_docx(await file.read(), name)
    if suffix == ".xls":
        # Inv-3: legacy .xls is out of automated scope. Log + return None
        # (NOT a FormExtractionError — there is no failure to surface).
        _logger.info(
            json.dumps(
                {
                    "event": "form_extractor.skip",
                    "reason": "xls_out_of_scope",
                    "rel_path": file.file_path.path.as_posix(),
                }
            )
        )
        return None

    # Any other suffix is not a form-bearing file (markdown content, etc.).
    return None


__all__ = ["extract_form_structure"]
