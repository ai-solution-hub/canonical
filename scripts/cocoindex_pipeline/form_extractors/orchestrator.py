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
  - ``.pdf`` / ``.xlsx`` / ``.docx`` → the matching reader's ``extract(raw, name)``.
  - ``.xls`` → ``None`` + a structured ``form_extractor.skip`` log (Inv-3: legacy
    ``.xls`` is out of automated scope here; {145.13} converts .doc/.xls via
    LibreOffice headless BEFORE this dispatcher sees them — DR-059).
  - any other suffix (``.md``, ``.txt``, …) → ``None`` (not a form-bearing file).

Reader failures raise ``FormExtractionError`` (defined in ``shared``); the
{145.13} worker catches it per-file (Inv-17) so one form's failure never
halts the queue consumer.

References:
- TECH.md §3.1 (Plane 2), §3.2 (per-format producer + recovery instruction).
- PRODUCT.md (id-52 predecessor) Inv-2, Inv-3, Inv-6, Inv-17 — the
  strict-raise / graceful-empty / skip semantics these readers still honour.
"""

from __future__ import annotations

import json
import logging

from scripts.cocoindex_pipeline.form_extractors.docx import extract as _extract_docx
from scripts.cocoindex_pipeline.form_extractors.pdf import extract as _extract_pdf
from scripts.cocoindex_pipeline.form_extractors.shared import ExtractedForm
from scripts.cocoindex_pipeline.form_extractors.xlsx import extract as _extract_xlsx

_logger = logging.getLogger(__name__)


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
        is not form-relevant (e.g. ``.md`` content) or is an out-of-scope
        legacy ``.xls`` (Inv-3 — logged, not raised).

    Raises:
        FormExtractionError: propagated unchanged from the per-format
            reader (Inv-17 — never silently swallowed here).
    """
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    suffix = f".{suffix}" if suffix else ""

    if suffix == ".pdf":
        return await _extract_pdf(raw_bytes, filename)
    if suffix == ".xlsx":
        return await _extract_xlsx(raw_bytes, filename)
    if suffix == ".docx":
        return await _extract_docx(raw_bytes, filename)
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
