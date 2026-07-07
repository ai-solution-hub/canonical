"""Deterministic smoke-test for the cocoindex chunking stage (ID-56.8).

Proves the SHAPE of the `content_chunks` chunk-row declares produced by the
budget-driven chunking stage wired into `ingest_file` — WITHOUT the cocoindex
Rust engine, a postgres target, or an OpenAI key. Mirrors the deterministic
write-path harness in `test_cocoindex_flow_write_path.py` (stubbed `coco`,
`passthrough_coco_fn`, a `FakeTableTarget` recording `declare_row(*, row)`).

WHAT THIS PROVES (56.8 — chunking stage):
  - A `cc_target` `FakeTableTarget` passed as the 6th positional arg (ID-136
    removed `ft_target`/`ftf_target`, so `cc_target` moved from the 8th to the
    6th positional slot) receives N `declare_row` calls for a ~5000-byte
    sample (2 <= N <= 6 — RecursiveSplitter
    respects min_chunk_size + recursive boundaries, so the bound is loose).
  - Every recorded chunk row stamps the bound flow op_id, the parent
    `source_document_id` (the `sd:` uuid5), a monotonic 0-indexed `position`, and a
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


# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.

from conftest import passthrough_coco_fn, stubbed_sys_modules  # noqa: E402

# ID-101 §{101.7}: neutralise the relationship-extraction Path-A seam so
# ingest_file tests make no live Anthropic call (mirrors the
# extract_entity_mentions stubs alongside).
async def _fake_relationships_empty(content_text: str) -> list:
    return []



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
        from scripts.cocoindex_pipeline import flow  # noqa: PLC0415

    _prior_aiohttp = getattr(flow, "aiohttp", None)
    with stubbed_sys_modules(stubs):
        # A sibling test file may have popped the flow module out of sys.modules
        # (several use `sys.modules.pop("scripts.cocoindex_pipeline.flow")` for
        # their own re-import isolation). `importlib.reload` raises ImportError ("module
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


class _ResolverPool:
    """ID-138 {138.10}: the content branch resolves the source_document_id off
    the raw pool (M2 resolver) before writing, then re-keys chunk PKs onto it.
    This double answers ``fetchrow`` with the resolver's MINT formula
    (``uuid5(NS, "sd:"+rel_path)``, keyed on the rel_path arg) so the chunk uuid5
    oracle stays a deterministic frozen-literal target; ``execute`` (the sd
    upsert) is accepted and ignored."""

    def acquire(self) -> object:
        class _Conn:
            async def fetchrow(self, sql: str, *args: object) -> dict:
                return {
                    "source_document_id": uuid.uuid5(
                        uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1"),
                        f"sd:{args[1]}",
                    ),
                    "was_minted": True,
                }

            async def execute(self, sql: str, *args: object) -> str:
                return "INSERT 0 1"

        class _Acquire:
            async def __aenter__(self) -> "_Conn":
                return _Conn()

            async def __aexit__(self, *exc: object) -> None:
                return None

        return _Acquire()


class _FakeFile:
    """Minimal localfs.File stand-in: async read / read_text + file_path.

    Decouples the LOGICAL ``file_path.path`` (the source-relative identity prod
    derives the ``ci:`` / ``chunk:`` uuid5 PKs from) from the on-disk staged file
    the bytes are actually read from. This mirrors ``_FakeFormFile`` in
    ``test_cocoindex_flow_write_path.py`` and is what makes the uuid5 oracle a
    DETERMINISTIC frozen-literal target: prod calls ``ingest_file`` here with
    ``flow_source_path=None``, so ``_to_source_relative`` returns
    ``file_path.path.as_posix()`` verbatim — passing a FIXED logical rel_path
    (rather than the non-deterministic pytest ``tmp_path``) freezes the seed.

    When ``logical_path`` is omitted the disk path doubles as the logical path
    (the legacy behaviour the non-oracle tests still rely on).
    """

    class _FilePath:
        def __init__(self, path: Path) -> None:
            self.path = path

    def __init__(self, disk_path: Path, logical_path: "str | None" = None) -> None:
        self.file_path = _FakeFile._FilePath(
            Path(logical_path) if logical_path is not None else disk_path
        )
        self._path = disk_path

    async def size(self) -> int:
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
        return {"content_type": "document", "primary_domain": "procurement"}

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
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


def _ingest_with_cc(
    flow: object,
    fake_file: object,
    *,
    cc_target: object,
    re_target: object = None,
    monkeypatch: pytest.MonkeyPatch,
) -> uuid.UUID:
    """Drive one ingest_file with the chunk target as the 6th positional arg.

    Returns the bound run op_id so callers can assert it is stamped on rows.

    ID-131 {131.11}: `re_target` (the polymorphic `record_embeddings` write
    target) is the 8th positional (after cc_target, er_target); defaulting it
    to None keeps the existing chunk-shape callers untouched while the
    record-embeddings dual-write tests pass a `_FakeTarget`.

    ID-136 {136.5} removed the `ft_target`/`ftf_target` positionals, so
    `cc_target`/`er_target`/`re_target` shifted from the 8th/9th/10th to the
    6th/7th/8th positional slots.
    """
    from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

    # ID-138 {138.10}: wire the resolver pool so the content branch resolves a
    # DETERMINISTIC source_document_id (not a MagicMock) — the chunk PK re-keys
    # onto it, so the uuid5 oracle stays a frozen-literal target.
    monkeypatch.setattr(flow.coco, "use_context", lambda key: _ResolverPool())

    ci = _FakeTarget("content_items")
    qa = _FakeTarget("q_a_extractions")
    sd = _FakeTarget("source_documents")
    em = _FakeTarget("entity_mentions")

    run_op_id = uuid.uuid4()

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=run_op_id):
            await flow.ingest_file(
                fake_file, ci, qa, sd, em, cc_target, None, re_target
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
        # FIXED logical rel_path (decoupled from the non-deterministic pytest
        # tmp_path) so the uuid5 oracle below is a frozen-literal target — the
        # S398 "17 frozen-literal uuid-oracle" pattern. prod calls ingest_file
        # here with flow_source_path=None, so _to_source_relative returns
        # file_path.path.as_posix() verbatim → this exact string is the seed.
        _REL_PATH = "test/long-doc.md"
        fake_file = _FakeFile(src, logical_path=_REL_PATH)

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

        # ID-131 {131.8} M2 (BI-14): chunks re-parented onto source_documents —
        # the stable per-document parent id is now the `sd:` uuid5 the chunk rows
        # attach to. FROZEN uuid5 literal over _KH_PIPELINE_DOC_NS
        # ("fbfaf1ff-1ee4-583c-9757-1674465b2ec1") for rel_path "test/long-doc.md"
        # — transcribed, not re-derived from flow, so a drifted namespace or seed
        # string is caught (S398 frozen-literal oracle discipline).
        rel_path = _REL_PATH
        source_document_id = uuid.UUID("2e350d1e-6e2e-5ac2-b90b-08c5847b9d5b")
        assert source_document_id == uuid.uuid5(
            flow._KH_PIPELINE_DOC_NS, f"sd:{rel_path}"
        ), "frozen sd: uuid5 literal drifted from the live namespace+seed derivation"

        for position, row in enumerate(cc.rows):
            # C-21 / C-13: op_id stamped == bound flow op_id.
            assert row["op_id"] == run_op_id
            # C-13: FK to the parent source_documents row (re-parented, M2).
            assert row["source_document_id"] == source_document_id
            # C-13: position is 0-indexed and monotonic.
            assert row["position"] == position
            # content / char_count / word_count are internally consistent.
            assert isinstance(row["content"], str)
            assert row["char_count"] == len(row["content"])
            assert row["word_count"] == len(row["content"].split())
            # C-30: embedding is a length-1024 vector.
            assert len(row["embedding"]) == 1024
            # Stable deterministic PK (chunk: uuid5) so re-ingest UPSERTs.
            # ID-138 {138.10} P3: the chunk PK re-keys onto the STORED
            # source_document_id (`chunk:{sd_id}:{position}`), NOT `chunk:{rel_path}`
            # — a rename no longer re-mints the chunk. The seed is now the stable
            # identity, so the uuid5 stays deterministic across runs; the first two
            # positions are pinned to FROZEN literals (recomputed on the new
            # formula) to catch namespace/seed drift, the tail cross-checks the
            # live derivation.
            assert row["id"] == uuid.uuid5(
                flow._KH_PIPELINE_DOC_NS, f"chunk:{source_document_id}:{position}"
            )
            _FROZEN_CHUNK_IDS = {
                0: uuid.UUID("8ca83be9-590d-5fbd-8e91-295c3a6ab75e"),  # chunk:{sd_id}:0
                1: uuid.UUID("18cb5bda-c1c0-55ed-af74-09f4d5347fee"),  # chunk:{sd_id}:1
            }
            if position in _FROZEN_CHUNK_IDS:
                assert row["id"] == _FROZEN_CHUNK_IDS[position], (
                    f"frozen chunk: uuid5 literal for position {position} drifted "
                    "from the live namespace+seed derivation"
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
        """The 6th arg (`cc_target`) defaults to None — when omitted/None the
        chunking block is skipped entirely. Proves the guard
        `if cc_target is not None:`. (ID-136 removed `ft_target`/`ftf_target`,
        so `cc_target` is now the 6th positional, not the 8th.)"""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        src = tmp_path / "no-cc.md"
        src.write_text(_SAMPLE_TEXT)
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                # cc_target/er_target explicitly None — no chunk target supplied.
                await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # The parent content_items row still lands (chunking is additive).
        assert len(ci.rows) == 1

    def test_ingest_file_accepts_defaulted_cc_target(self) -> None:
        """ingest_file takes a defaulted 8th positional `cc_target=None` so the
        7-arg callers (write-path / embedding suites) keep working untouched.

        ID-101 §{101.7} (RULING 1) appended a 9th defaulted positional
        `er_target=None` AFTER cc_target, so cc_target is now the SECOND-to-last
        positional (er_target is last); both default to None so the 7-arg callers
        stay valid."""
        import inspect

        flow = _flow_module()
        sig = inspect.signature(flow.ingest_file)
        # ID-66.19 appended keyword-only run-context params after a bare `*`; the
        # cc_target/er_target positional contract is the LAST positional pair, so
        # inspect the positional slice rather than every parameter.
        params = [
            name
            for name, p in sig.parameters.items()
            if p.kind
            in (
                inspect.Parameter.POSITIONAL_ONLY,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
            )
        ]
        # ID-131 {131.11}: `re_target` (the record_embeddings write target) is
        # appended as a DEFAULTED 10th positional AFTER er_target (RULING 1
        # trailing-positional idiom), so the last THREE positionals are now
        # cc_target, er_target, re_target — all defaulting to None so the
        # 7-/8-/9-arg legacy callers stay valid.
        assert params[-3:] == ["cc_target", "er_target", "re_target"], (
            f"the 8th/9th/10th positionals must be cc_target, er_target, "
            f"re_target; got {params}"
        )
        assert sig.parameters["cc_target"].default is None, (
            "cc_target must default to None so 7-arg callers stay valid"
        )
        assert sig.parameters["er_target"].default is None, (
            "er_target must default to None so 7-/8-arg callers stay valid"
        )
        assert sig.parameters["re_target"].default is None, (
            "re_target must default to None so 7-/8-/9-arg callers stay valid"
        )


class TestChunkRecordEmbeddingsWrite:
    """ID-131 {131.11}: each chunk's embedding is ALSO written to the
    polymorphic `record_embeddings` store (owner_kind='content_chunk'), keyed
    on the chunk's OWN deterministic PK so a re-ingest UPSERTs (S429 F3 fold-in).
    """

    def test_each_chunk_declares_a_record_embeddings_row(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)

        src = tmp_path / "re-doc.md"
        src.write_text(_SAMPLE_TEXT)
        _REL_PATH = "test/re-doc.md"
        fake_file = _FakeFile(src, logical_path=_REL_PATH)

        cc = _FakeTarget("content_chunks")
        re = _FakeTarget("record_embeddings")
        _ingest_with_cc(
            flow, fake_file, cc_target=cc, re_target=re, monkeypatch=monkeypatch
        )

        # One record_embeddings row per chunk row — the dual-write is 1:1.
        assert len(re.rows) == len(cc.rows) > 0, (
            "expected exactly one record_embeddings row per content_chunks row"
        )

        rel_path = _REL_PATH
        # ID-138 {138.10} P3: chunk PKs re-key onto the STORED source_document_id
        # (the resolver mints sd on the SEED-CONTRACT formula), NOT rel_path.
        source_document_id = uuid.uuid5(
            flow._KH_PIPELINE_DOC_NS, f"sd:{rel_path}"
        )
        for position, (cc_row, re_row) in enumerate(zip(cc.rows, re.rows)):
            # owner_kind is the chunk grain's polymorphic tag.
            assert re_row["owner_kind"] == "content_chunk"
            # owner_id MUST be the chunk's OWN PK (the same uuid5 the inline
            # content_chunks row carries) so re-ingest UPSERTs, not duplicates.
            assert re_row["owner_id"] == cc_row["id"]
            assert re_row["owner_id"] == uuid.uuid5(
                flow._KH_PIPELINE_DOC_NS, f"chunk:{source_document_id}:{position}"
            )
            # model is the shared embedding-model constant (not a literal).
            assert re_row["model"] == flow.EMBEDDING_MODEL
            # the embedding vector is the SAME length-1024 vector.
            assert re_row["embedding"] == cc_row["embedding"]
            assert len(re_row["embedding"]) == 1024
            # the row carries ONLY the record_embeddings natural key + vector —
            # no synthetic `id` (PG-defaulted) and no per-run op_id (which would
            # mint duplicates on re-ingest — the _KH_PIPELINE_DOC_NS warning).
            assert set(re_row) == {"owner_kind", "owner_id", "model", "embedding"}

    def test_no_re_target_skips_record_embeddings_write(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """re_target defaults to None — the chunk row still lands but no
        record_embeddings row is declared (guard `if re_target is not None`)."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        src = tmp_path / "no-re.md"
        src.write_text(_SAMPLE_TEXT)
        cc = _FakeTarget("content_chunks")
        # re_target omitted → defaults None.
        _ingest_with_cc(flow, _FakeFile(src), cc_target=cc, monkeypatch=monkeypatch)
        assert len(cc.rows) > 0, "chunk rows still land without a re_target"
