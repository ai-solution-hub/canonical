"""Per-format raw-form extractors for ID-52 Path B (PRODUCT Inv-2).

Each format module (`pdf`, `xlsx`, `docx`) exports an async
``extract(raw_bytes: bytes, filename: str) -> ExtractedForm`` function. The
shared module hosts the Pydantic shapes ``ExtractedField`` / ``ExtractedForm``
and the typed ``FormExtractionError`` exception used across all readers.

Per CLAUDE.md "No barrel re-exports" — callers import the per-format readers
and the shared shapes directly from the individual modules (``from
scripts.cocoindex_pipeline.form_extractors.shared import ExtractedField``).

The SINGLE exception is the Path-B orchestrator ``extract_form_structure``
(TECH §2.4): it is re-exported here as the one public Path-B entry point the
cocoindex flow (``flow.py``) wires in, mirroring how the spec / {52.12} brief
nominate the package init as that symbol's home. All other symbols stay
direct-import only.
"""

from scripts.cocoindex_pipeline.form_extractors.orchestrator import (
    extract_form_structure,
)

__all__ = ["extract_form_structure"]
