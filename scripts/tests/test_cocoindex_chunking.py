"""Deterministic smoke-test for the cocoindex chunking stage (ID-56.8).

Proves the SHAPE of the `content_chunks` chunk-row declares produced by the
budget-driven chunking stage wired into `ingest_file` — WITHOUT the cocoindex
Rust engine, a postgres target, or an OpenAI key. Mirrors the deterministic
write-path harness in `test_cocoindex_flow_write_path.py` (stubbed `coco`,
`passthrough_coco_fn`, a `FakeTableTarget` recording `declare_row(*, row)`).

WHAT THIS PROVES (56.8 — chunking stage):
  - A `cc_target` `FakeTableTarget` passed as the 8th positional arg receives
    N `declare_row` calls for a ~5000-byte sample (2 <= N <= 6 — RecursiveSplitter
    respects min_chunk_size + recursive boundaries, so the bound is loose).
  - Every recorded chunk row stamps the bound flow op_id, the parent
    `content_item_id` (the `ci:` uuid5), a monotonic 0-indexed `position`, and a
    `content`/`char_count`/`word_count` triple consistent with the chunk text.
  - NO heading-derived keys (`heading_text` / `heading_level` / `heading_path` /
    `parent_chunk_id`) are present in any chunk row dict — they fall to NULL (the
    3 nullable cols) / the DB default `'{}'` (`heading_path`) per PRODUCT C-13 +
    [GAP-CMI-004] disposition (a). The OMIT-from-row-dict mechanism mirrors the
    existing `content_text_hash` GENERATED-ALWAYS omission.
  - When `cc_target` is None (the 7-arg legacy callers) the chunking block is
    skipped entirely — proven implicitly by the unchanged sibling write-path /
    embedding suites (run alongside this file in the {56.8} regression command).

Uses the REAL `cocoindex.ops.text.RecursiveSplitter` (the {56.5} spike proves it
imports + runs sandbox-disabled), so the chunk shaping is genuinely exercised —
NOT stubbed. The embedder seam (`embed_content_text`) IS monkeypatched to a fixed
length-1024 vector so the smoke needs no OPENAI_API_KEY (embedding correctness is
covered by the Stage-4 tests; this smoke proves chunk shaping + row payloads).

Reference: docs/specs/id-56-content-model-invariants/PRODUCT.md C-10..C-13, C-21,
C-30, C-31; docs/reference/test-philosophy.md (behaviour-not-implementation).
"""

from __future__ import annotations

import asyncio
import math
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest


_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from conftest import passthrough_coco_fn, stubbed_sys_modules  # noqa: E402


# ── Variant-B chunk config (Liam-ratified {56.5}) ─────────────────────────────
CHUNK_SIZE = 2000
CHUNK_OVERLAP = 200
MIN_CHUNK_SIZE = 1000


# ── cocoindex stub install (mirrors test_cocoindex_flow_write_path.py) ─────────
# We stub the cocoindex registration surfaces (App / lifespan / ContextKey /
# mount_each) so importing flow does not leak process-global registrations, BUT
# we DELIBERATELY DO NOT stub `cocoindex.ops.text` — flow.py imports
# `RecursiveSplitter` from there at module top, and this smoke must exercise the
# REAL splitter ({56.5} spike + V-1 trap: cocoindex.functions.SplitRecursively is
# ABSENT in 1.0.3). Leaving `cocoindex.ops.text` unstubbed lets the real submodule
# resolve through the stubbed parent package.


class _StubContextKey:
    """Hashable ContextKey stand-in — usable as a dict key (lifespan provide)."""

    def __init__(self, key: str = "stub") -> None:
        self.key = key


def _make_coco_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex")
    stub.fn = passthrough_coco_fn  # keep @coco.fn(memo=True) a real passthrough
    stub.lifespan = lambda fn=None: fn
    stub.ContextKey = _StubContextKey
    stub.AppConfig = MagicMock(name="AppConfig")
    stub.App = MagicMock(name="App")
    stub.mount_each = MagicMock(name="mount_each")
    stub.use_context = MagicMock(name="use_context")
    stub.EnvironmentBuilder = MagicMock(name="EnvironmentBuilder")
    return stub


def _flow_module():
    """Load flow under this file's stubbed cocoindex (per-file reload isolation).

    Mirrors `test_cocoindex_flow_write_path.py:_flow_module` exactly, with ONE
    deliberate difference: `cocoindex.ops` / `cocoindex.ops.text` are NOT stubbed,
    so flow's module-top `from cocoindex.ops.text import RecursiveSplitter` binds
    the REAL splitter. The registration surfaces (App / lifespan / ContextKey) are
    still stubbed via the `cocoindex` parent stub to avoid global contamination.
    """
    import importlib  # noqa: PLC0415

    coco_stub = _make_coco_stub()
    localfs_stub = MagicMock(name="cocoindex.connectors.localfs")
    pg_stub = MagicMock(name="cocoindex.connectors.postgres")
    pg_stub.ColumnDef = MagicMock(name="ColumnDef")
    pg_stub.TableSchema = MagicMock(name="TableSchema")
    pg_stub.mount_table_target = MagicMock(name="mount_table_target")
    target_stub = MagicMock(name="cocoindex.connectorkits.target")
    target_stub.ManagedBy = MagicMock(name="ManagedBy")
    stubs = {
        "cocoindex": coco_stub,
        "cocoindex.connectors": MagicMock(name="cocoindex.connectors"),
        "cocoindex.connectors.localfs": localfs_stub,
        "cocoindex.connectors.postgres": pg_stub,
        "cocoindex.connectorkits": MagicMock(name="cocoindex.connectorkits"),
        "cocoindex.connectorkits.target": target_stub,
        "docling": MagicMock(name="docling"),
        "docling.document_converter": MagicMock(name="docling.document_converter"),
    }
    with stubbed_sys_modules(stubs):
        from cocoindex_pipeline import flow  # noqa: PLC0415

    _prior_aiohttp = getattr(flow, "aiohttp", None)
    with stubbed_sys_modules(stubs):
        # A sibling test file may have popped the flow module out of sys.modules
        # (several use `sys.modules.pop("cocoindex_pipeline.flow")` for their own
        # re-import isolation). `importlib.reload` raises ImportError ("module
        # ... not in sys.modules") in that case, so re-seat the captured module
        # under its own spec name before reloading — keeps this loader robust to
        # any pytest collection ordering (ID-56.8 finding).
        spec_name = getattr(getattr(flow, "__spec__", None), "name", flow.__name__)
        sys.modules.setdefault(spec_name, flow)
        importlib.reload(flow)
    if _prior_aiohttp is not None and isinstance(_prior_aiohttp, MagicMock):
        flow.aiohttp = _prior_aiohttp
    return flow


# ── Fakes ──────────────────────────────────────────────────────────────────


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeFile:
    """Minimal localfs.File stand-in: async read / read_text + file_path."""

    class _FilePath:
        def __init__(self, path: Path) -> None:
            self.path = path

    def __init__(self, path: Path) -> None:
        self.file_path = _FakeFile._FilePath(path)
        self._path = path

    @property
    def size(self) -> int:
        return self._path.stat().st_size

    async def read(self) -> bytes:
        return self._path.read_bytes()

    async def read_text(self) -> str:
        return self._path.read_text()

    async def content_fingerprint(self) -> bytes:
        import hashlib

        return hashlib.sha256(self._path.read_bytes()).digest()


# A ~5000-byte genuine-shape UK-procurement prose sample (NOT lorem). Repeated
# clauses keep it deterministic while exceeding `chunk_size` enough to force a
# multi-row split well inside the 2..6 bound.
_CLAUSE = (
    "The supplier shall provide quarterly performance reports detailing the "
    "service levels achieved against the agreed key performance indicators, "
    "and shall notify the contracting authority promptly of any anticipated "
    "shortfall. "
)
_SAMPLE_TEXT = (_CLAUSE * 18).strip() + "\n"


def _stub_path_a(flow: object, monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the Path-A adapter + extractors + embedder so chunking is exercised
    in isolation (no Docling / anthropic / OpenAI / network). The adapter returns
    the ~5000-byte sample so the chunking stage genuinely splits it."""

    async def _fake_convert(file: object) -> str:
        return _SAMPLE_TEXT

    async def _fake_classification(content_text: str):
        return {"content_type": "case_study", "primary_domain": "procurement"}

    async def _fake_qa(content_text: str):
        return {"qa_pairs": []}

    async def _fake_entities(content_text: str):
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        # Fixed length-1024 vector — chunk-embedding correctness is covered by
        # the Stage-4 embedding tests; this smoke proves chunk shaping + payload.
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


def _ingest_with_cc(
    flow: object,
    fake_file: object,
    *,
    cc_target: object,
    monkeypatch: pytest.MonkeyPatch,
) -> uuid.UUID:
    """Drive one ingest_file with the chunk target as the 8th positional arg.

    Returns the bound run op_id so callers can assert it is stamped on rows.
    """
    from cocoindex_pipeline.flow_context import bind_flow_meta

    ci = _FakeTarget("content_items")
    qa = _FakeTarget("q_a_extractions")
    sd = _FakeTarget("source_documents")
    em = _FakeTarget("entity_mentions")

    run_op_id = uuid.uuid4()

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=run_op_id):
            await flow.ingest_file(
                fake_file, ci, qa, sd, em, None, None, cc_target
            )

    asyncio.run(_exercise())
    return run_op_id


class TestChunkingStageWritePath:
    """The chunking stage declares N content_chunks rows with the C-13 shape."""

    def test_long_doc_declares_budget_bounded_chunk_rows(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)

        src = tmp_path / "long-doc.md"
        src.write_text(_SAMPLE_TEXT)
        fake_file = _FakeFile(src)

        cc = _FakeTarget("content_chunks")
        run_op_id = _ingest_with_cc(
            flow, fake_file, cc_target=cc, monkeypatch=monkeypatch
        )

        # C-11: a ~5000-byte doc splits into multiple rows. The bound is loose
        # (RecursiveSplitter respects min_chunk_size + recursive boundaries), so
        # assert a range rather than an exact count.
        sample_bytes = len(_SAMPLE_TEXT.encode("utf-8"))
        approx = math.ceil(sample_bytes / (CHUNK_SIZE - CHUNK_OVERLAP))
        assert 2 <= len(cc.rows) <= 6, (
            f"expected 2..6 chunk rows for a {sample_bytes}-byte sample "
            f"(approx {approx}); got {len(cc.rows)}"
        )

        # Stable per-document parent id (the ci: uuid5) the chunk rows attach to.
        rel_path = src.as_posix()
        content_item_id = uuid.uuid5(flow._KH_PIPELINE_DOC_NS, f"ci:{rel_path}")

        for position, row in enumerate(cc.rows):
            # C-21 / C-13: op_id stamped == bound flow op_id.
            assert row["op_id"] == run_op_id
            # C-13: FK to the parent content_items row.
            assert row["content_item_id"] == content_item_id
            # C-13: position is 0-indexed and monotonic.
            assert row["position"] == position
            # content / char_count / word_count are internally consistent.
            assert isinstance(row["content"], str)
            assert row["char_count"] == len(row["content"])
            assert row["word_count"] == len(row["content"].split())
            # C-30: embedding is a length-1024 vector.
            assert len(row["embedding"]) == 1024
            # Stable deterministic PK (chunk: uuid5) so re-ingest UPSERTs.
            assert row["id"] == uuid.uuid5(
                flow._KH_PIPELINE_DOC_NS, f"chunk:{rel_path}:{position}"
            )
            # C-13 + [GAP-CMI-004] disposition (a): heading-derived columns are
            # OMITTED from the row dict (fall to NULL / DB default '{}'), exactly
            # like content_text_hash (GENERATED ALWAYS) is omitted elsewhere.
            for omitted in (
                "heading_text",
                "heading_level",
                "heading_path",
                "parent_chunk_id",
            ):
                assert omitted not in row, (
                    f"{omitted} must be OMITTED from the chunk row dict "
                    "(NULL / DB default), not written"
                )

    def test_chunk_positions_are_a_contiguous_monotonic_run(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        src = tmp_path / "positions.md"
        src.write_text(_SAMPLE_TEXT)
        cc = _FakeTarget("content_chunks")
        _ingest_with_cc(flow, _FakeFile(src), cc_target=cc, monkeypatch=monkeypatch)

        positions = [row["position"] for row in cc.rows]
        assert positions == list(range(len(cc.rows))), (
            "chunk positions must be a contiguous 0,1,2... run"
        )

    def test_no_chunk_target_skips_chunking(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The 8th arg defaults to None — when omitted/None the chunking block is
        skipped entirely (the 7-arg legacy callers stay untouched). Proves the
        guard `if cc_target is not None:`."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        from cocoindex_pipeline.flow_context import bind_flow_meta

        src = tmp_path / "no-cc.md"
        src.write_text(_SAMPLE_TEXT)
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                # 7-arg legacy form — no cc_target supplied.
                await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # The parent content_items row still lands (chunking is additive).
        assert len(ci.rows) == 1

    def test_ingest_file_accepts_defaulted_cc_target(self) -> None:
        """ingest_file takes a defaulted 8th positional `cc_target=None` so the
        7-arg callers (write-path / embedding suites) keep working untouched."""
        import inspect

        flow = _flow_module()
        sig = inspect.signature(flow.ingest_file)
        # ID-66.19 appended keyword-only run-context params after a bare `*`; the
        # cc_target positional contract is the LAST positional, so inspect the
        # positional slice rather than every parameter.
        params = [
            name
            for name, p in sig.parameters.items()
            if p.kind
            in (
                inspect.Parameter.POSITIONAL_ONLY,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
            )
        ]
        assert params[-1] == "cc_target", (
            f"the 8th positional must be cc_target; got {params}"
        )
        assert sig.parameters["cc_target"].default is None, (
            "cc_target must default to None so 7-arg callers stay valid"
        )
