"""Per-format raw-form extractors for ID-52 Path B (PRODUCT Inv-2).

Each format module (`pdf`, `xlsx`, `docx`) exports an async
``extract(raw_bytes: bytes, filename: str) -> ExtractedForm`` function. The
shared module hosts the Pydantic shapes ``ExtractedField`` / ``ExtractedForm``
and the typed ``FormExtractionError`` exception used across all readers.

Per CLAUDE.md "No barrel re-exports" — callers import directly from the
individual modules (``from scripts.cocoindex_pipeline.form_extractors.shared
import ExtractedField``); this package init intentionally exports nothing.
"""
