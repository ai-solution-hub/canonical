"""Unit tests for ingest/main.py's pure helpers.

No engine, no DB — `process_file` is `@coco.fn`-wrapped and needs a live
engine + Postgres pool to exercise end-to-end; that coverage is
`test_ingest_integration.py` (skipped by default per HARD LIMITS).
Entity-resolution helpers (`_clamp01`, `_resolve_type_group`,
`declare_resolved`) live in `ingest.resolve` — see `test_resolve.py`.
"""

from __future__ import annotations

from ingest.main import _DEFAULT_MIME, _MIME_BY_SUFFIX


def test_mime_by_suffix_resolves_markdown() -> None:
    assert _MIME_BY_SUFFIX[".md"] == "text/markdown"
    assert _MIME_BY_SUFFIX[".markdown"] == "text/markdown"


def test_mime_default_is_markdown_for_phase_one_glob() -> None:
    # Phase 1's path_matcher only admits **/*.md, so every file process_file
    # sees has a matched suffix in practice; the default exists as a safety
    # net, not a dead branch, should that glob widen later.
    assert _DEFAULT_MIME == "text/markdown"
