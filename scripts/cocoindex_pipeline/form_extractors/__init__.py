"""Per-format raw-form extractors — Plane-2 (fillable structure) producer
for the {145.13} analyse_form worker lane (DR-058, ID-145.10; TECH §3.1/§3.2).

Recovered from the retired id-52 cocoindex Path B (deleted at {136.5} per
DR-014 — forms enter via app-side manual upload, never the corpus walk) and
generalised past its original two-archetype-per-format ceiling
(FORM-EXTRACTION-SPIKE.md §5): the DOCX/XLSX readers now layer a generic
labelled-cell -> empty/placeholder-cell detector UNDER their original
archetype fast-paths, rather than requiring an exact archetype match.

Each format module (`xlsx`, `docx`) exports an async
``extract(raw_bytes: bytes, filename: str) -> ExtractedForm`` function. The
shared module hosts the Pydantic shapes ``ExtractedField`` / ``ExtractedForm``
and the typed ``FormExtractionError`` exception used across all readers.

PDF NOTE: this package's ``pdf.py`` is {145.11}'s commonforms-based Plane-2
PDF field detector (DR-057) — a DIFFERENT module than the id-52 pdfplumber
reader {145.10} originally recovered (superseded; removed post-Checker
ruling once {145.11} landed at the identical path). It exports its own
``PdfFieldDetectionResult`` shape, not this package's ``ExtractedForm``;
the orchestrator does not yet dispatch ``.pdf`` to it — {145.13} owns that
shape-adaptation + wiring.

Per CLAUDE.md "No barrel re-exports" — callers import the per-format readers
and the shared shapes directly from the individual modules (``from
scripts.cocoindex_pipeline.form_extractors.shared import ExtractedField``).

The SINGLE exception is the orchestrator ``extract_form_structure``: it is
re-exported here as the one public entry point, now a plain
``(raw_bytes, filename) -> ExtractedForm | None`` dispatcher with no
cocoindex dependency — the {145.13} analyse_form worker calls it directly on
the bytes it reads from storage. All other symbols stay direct-import only.
"""

from scripts.cocoindex_pipeline.form_extractors.orchestrator import (
    extract_form_structure,
)

__all__ = ["extract_form_structure"]
