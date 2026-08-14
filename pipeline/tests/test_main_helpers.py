"""Unit tests for ingest/main.py's pure helpers.

No engine, no DB — `process_file`/`declare_resolved`/`_resolve_type_group`
are `@coco.fn`-wrapped and need a live engine + Postgres pool to exercise
end-to-end; that coverage is `test_ingest_integration.py` (skipped by
default per HARD LIMITS).
"""

from __future__ import annotations

from ingest.main import _DEFAULT_MIME, _MIME_BY_SUFFIX, _clamp01


def test_clamp01_leaves_in_range_value_untouched() -> None:
    assert _clamp01(0.5) == 0.5


def test_clamp01_clamps_above_one() -> None:
    assert _clamp01(1.7) == 1.0


def test_clamp01_clamps_below_zero() -> None:
    assert _clamp01(-0.2) == 0.0


def test_clamp01_boundary_values_pass_through() -> None:
    assert _clamp01(0.0) == 0.0
    assert _clamp01(1.0) == 1.0


def test_mime_by_suffix_resolves_markdown() -> None:
    assert _MIME_BY_SUFFIX[".md"] == "text/markdown"
    assert _MIME_BY_SUFFIX[".markdown"] == "text/markdown"


def test_mime_default_is_markdown_for_phase_one_glob() -> None:
    # Phase 1's path_matcher only admits **/*.md, so every file process_file
    # sees has a matched suffix in practice; the default exists as a safety
    # net, not a dead branch, should that glob widen later.
    assert _DEFAULT_MIME == "text/markdown"
