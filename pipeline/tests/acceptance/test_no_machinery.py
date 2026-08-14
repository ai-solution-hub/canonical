"""DR-152 negative space — the old tree's machinery layer does NOT port.

AC (id-465): "No mock LLM server, writer fence, fault injector, or op_id
stamping in the new tree." Plus the load-bearing safety property flagged in
the W2 review: every postgres target is mounted `managed_by=USER` so the
flow can never issue DDL against migration-owned tables.

These are structural assertions over the pipeline/ sources — cheap, loud,
and they turn an architecture ruling into a regression gate.
"""

from __future__ import annotations

import pathlib
import re

_PIPELINE_ROOT = pathlib.Path(__file__).resolve().parents[2]
_SOURCE_DIRS = (_PIPELINE_ROOT / "ingest", _PIPELINE_ROOT / "produce")

# Markers of the retired machinery layer. Word-boundary matched, source
# files only (tests may name them — e.g. this file - and the docstring duty
# falls on prose, not identifiers).
_FORBIDDEN = {
    "mock LLM server": re.compile(r"mock_llm|MockLLM|MOCK_LLM"),
    "writer fence": re.compile(r"writer_fence|WriterFence"),
    "fault injector": re.compile(r"fault_inject|FaultInject|COCOINDEX_FAULT"),
    "op_id stamping": re.compile(r"\bop_id\s*=(?!\s*None)|p_op_id\s*(?::|=)(?!\s*None)"),
}


def _source_files() -> list[pathlib.Path]:
    files = [p for d in _SOURCE_DIRS for p in sorted(d.rglob("*.py"))]
    assert files, "acceptance scan found no pipeline sources — path drift?"
    return files


def test_no_retired_machinery_markers() -> None:
    offences: list[str] = []
    for path in _source_files():
        text = path.read_text(encoding="utf-8")
        for label, pattern in _FORBIDDEN.items():
            if pattern.search(text):
                offences.append(f"{path.relative_to(_PIPELINE_ROOT)}: {label}")
    assert not offences, f"retired machinery re-appeared: {offences}"


def test_every_postgres_mount_is_managed_by_user() -> None:
    """Each `postgres.mount_table_target(` call site must carry
    `managed_by=ManagedBy.USER` — row upserts only, never DDL, against
    migration-owned tables."""
    mounts_seen = 0
    for path in _source_files():
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"postgres\.mount_table_target\(", text):
            mounts_seen += 1
            call_window = text[match.start() : match.start() + 600]
            assert "managed_by=ManagedBy.USER" in call_window, (
                f"{path.relative_to(_PIPELINE_ROOT)}: mount_table_target at "
                f"offset {match.start()} lacks managed_by=ManagedBy.USER"
            )
    assert mounts_seen >= 6, f"expected >=6 postgres mounts, saw {mounts_seen}"
