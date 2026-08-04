"""Pipeline schema-uses visibility pins (re-homed at ast-dataflow extraction).

These lived in the tool's own pytest suite while ast-dataflow was vendored in
this repo. They assert CANONICAL's pipeline write surface stays visible to the
installed analyser — canonical's requirement, not the tool's contract: if
flow.py's write topology changes, these SHOULD fail and be updated
deliberately.

The analyser is imported from the installed @ai-solution-hub/ast-dataflow git
dependency, which keeps its ``tools/`` package layout.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
_PKG_ROOT = REPO_ROOT / "node_modules" / "@ai-solution-hub" / "ast-dataflow"
sys.path.insert(0, str(_PKG_ROOT))

from tools.ast_dataflow_py.declarative_writes import (  # noqa: E402
    collect_source,
    resolve_uses,
)
from tools.ast_dataflow_py.schema_uses import scan_schema_uses  # noqa: E402


class TestFlowPyWriteTopology:
    """Pin the detector against the repo's actual primary write surface."""

    def test_flow_py_mounts_resolve_completely(self):
        source = (REPO_ROOT / "scripts/cocoindex_pipeline/flow.py").read_text()
        index = collect_source(source, "scripts/cocoindex_pipeline/flow.py")
        assert index is not None
        mounted = {m.table for m in index.mounts if m.table}
        assert mounted == {
            "q_a_extractions",
            "source_documents",
            "entity_mentions",
            "entity_relationships",
            "content_chunks",
            "reference_items",
            "record_embeddings",
        }
        uses, unresolved = resolve_uses(index)
        assert unresolved == []
        # The entity_relationships dedup-map payload (row=row) must be
        # recovered via the scope-dict fallback.
        er = {
            u.columnPath
            for u in uses
            if u.table == "entity_relationships" and u.method == "declare_row"
        }
        assert "source_entity" in er and "target_entity" in er


class TestLRecordsConstSqlVisibility:
    def test_l_records_const_sql_reads_are_visible(self):
        # The l_records read layer passes ALL its SQL as module constants —
        # invisible before the analyser's const-resolution hop.
        rows, caveats = scan_schema_uses(REPO_ROOT, ["scripts"], exclude_tests=True)
        lrec = [
            r
            for r in rows
            if r.file == "scripts/cocoindex_pipeline/sources/l_records.py"
        ]
        assert {r.table for r in lrec} >= {"source_documents", "q_a_pairs"}
        # The conditional tuple-assign sites stay dynamic — caveated, small.
        assert caveats.sql_sites_unresolved_dynamic <= 5
