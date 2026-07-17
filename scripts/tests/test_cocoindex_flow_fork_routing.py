"""ID-80.8 — historical fork routing; ID-127.37 retired the fork entirely.

RATIFIED OQ-80.2-A (Liam, S314, 05/06/2026): forms land ZERO content rows — no
content_items / source_documents / content_chunks / q_a_extractions /
entity_mentions. The minimal-provenance-row fallback is DROPPED. RATIFIED
OQ-80.2-B: the manifest per-prefix ``route`` tag was THE fork point, computed
once in ``_ingest_file_body`` immediately after ``rel_path``, BEFORE either
write path ran.

ID-136 (forms-route retirement, DR-014): ``RouteKind`` narrowed to
``Literal["content", "qa_sidecar"]`` — a manifest tagging a prefix
``route:"forms"`` failed LOUDLY at load (``ManifestLoadError``), so the
forms branch and its ``extract_form_structure`` seam were gone from this
module entirely. The forms-specific branch coverage this file used to carry
(``route:"forms"`` .docx → ft/ftf-only; the suffix-guard mis-wire) retired
alongside it — see git history / ID-136 TECH.md §4.3 for the
pre-retirement contract.

ID-127.37 (DR-038/056/061): the folder→workspace manifest premise itself is
now retired — workspace is the wrong scope for a per-client single-tenant DB
(no in-DB scoping predicate). `scripts/cocoindex_pipeline/workspace_resolver.py`
no longer exists; `_ingest_file_body` no longer forks on a manifest ``route``;
the ``qa_sidecar`` route + its dedicated branch function
(``_ingest_qa_sidecar_branch``) are DELETED; `ingest_file` no longer accepts a
``flow_workspace_manifest`` kwarg; `flow_context.bind_workspace_manifest` /
``current_workspace_manifest`` no longer exist. Every file now runs the SOLE
remaining branch (``_ingest_content_branch``) unconditionally. This retired
ALL of this file's manifest/ambiguous-resolution/route-less-backward-compat/
qa_sidecar coverage — see git history for the pre-retirement contract. What
survives here is the "content lands content rows, no manifest required"
baseline, which is now the WHOLE story: there is no more fork to route.

Reference: docs/specs/ID-80-forms-path-b/80.2-forms-content-separation.md
§B.1/§B.3/§B.6; docs/reference/test-philosophy.md §1/§5.3; ID-136 TECH.md §4.3.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid

import pytest

from conftest import fresh_flow_module  # noqa: E402

# ID-101 §{101.7}: neutralise the relationship-extraction Path-A seam so
# ingest_file tests make no live Anthropic call (mirrors the
# extract_entity_mentions stubs alongside).
async def _fake_relationships_empty(content_text: str) -> list:
    return []


def _flow_module():
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive)."""
    return fresh_flow_module()


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB (mirrors the
    write-path suite's double — keyword-only ``declare_row(*, row)``)."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeFile:
    """File stand-in with a RELATIVE ``file_path.path`` (production shape post
    ``_to_source_relative``) whose ``read()`` returns on-disk bytes when a disk
    path is supplied, else the given literal bytes."""

    class _FilePath:
        def __init__(self, rel_path) -> None:
            self.path = rel_path

    def __init__(
        self, rel_path: str, *, disk_path=None, data: bytes = b""
    ) -> None:
        from pathlib import Path

        self.file_path = _FakeFile._FilePath(Path(rel_path))
        self._disk = disk_path
        self._data = data

    def _bytes(self) -> bytes:
        return self._disk.read_bytes() if self._disk is not None else self._data

    async def size(self) -> int:
        return len(self._bytes())

    async def read(self) -> bytes:
        return self._bytes()

    async def read_text(self) -> str:
        return self._bytes().decode("utf-8")

    async def content_fingerprint(self) -> bytes:
        return hashlib.sha256(self._bytes()).digest()


def _observe_path_a_seams(flow: object, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Replace the outside-world Path-A seams (Docling / Anthropic / OpenAI)
    with RECORDING observers returning benign values, so a test can assert
    exactly which passes ran."""
    calls = {
        "convert": 0,
        "classification": 0,
        "qa": 0,
        "entities": 0,
        "embed": 0,
    }

    async def _fake_convert(file: object) -> str:
        calls["convert"] += 1
        return "# Doc\n\nbody"

    async def _fake_classification(content_text: str):
        calls["classification"] += 1
        return {"content_type": "case_study"}

    async def _fake_qa(content_text: str):
        calls["qa"] += 1
        return {"qa_pairs": []}

    async def _fake_entities(content_text: str):
        calls["entities"] += 1
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        calls["embed"] += 1
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)
    return calls


class _SdPool:
    """Minimal raw-pool double capturing every ``execute`` call.

    S438 (id-131 follow-on): the content branch writes the sd PARENT via the
    raw-pool `_upsert_source_document` autocommit UPSERT (S437's fix extended
    to localfs), resolved via `coco.use_context(DB_CTX)`.
    """

    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple]] = []

    def acquire(self) -> object:
        pool = self

        class _Conn:
            async def fetchrow(self, sql: str, *args: object) -> dict:
                # ID-138 {138.10}: the M2 identity resolver — the content
                # branch resolves the source_document_id off the raw pool
                # BEFORE writing. Mirror the resolver's MINT formula so a
                # re-walk of the SAME path returns the SAME id.
                return {
                    "source_document_id": uuid.uuid5(
                        uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1"),
                        f"sd:{args[1]}",
                    ),
                    "was_minted": True,
                }

            async def execute(self, sql: str, *args: object) -> str:
                pool.executed.append((sql, args))
                return "INSERT 0 1"

        class _Acquire:
            async def __aenter__(self) -> "_Conn":
                return _Conn()

            async def __aexit__(self, *exc: object) -> None:
                return None

        return _Acquire()


class _SdTarget:
    """Duck-types ``_FakeTarget`` (``.table_name`` / ``.rows``) for the
    ``source_documents`` slot, reading ``.rows`` from the S438 raw-pool
    capture — the content branch writes the sd PARENT via the S438 raw-pool
    ``_upsert_source_document`` UPSERT, not ``sd_target.declare_row``."""

    table_name = "source_documents"

    def __init__(self, pool: _SdPool) -> None:
        self._pool = pool

    @property
    def rows(self) -> list[dict]:
        rows: list[dict] = []
        for sql, args in self._pool.executed:
            if "INSERT INTO public.source_documents" not in sql:
                continue
            cols = [c.strip() for c in sql.split("(", 1)[1].split(")", 1)[0].split(",")]
            rows.append(dict(zip(cols, args)))
        return rows


def _drive_ingest(flow: object, fake_file: object) -> dict:
    """Drive one real ``ingest_file`` under bind_flow_meta, with the four
    targets recording. {127.25} DR-034: content_items no longer exists (table
    dropped both envs) — the content-branch discriminator is content_chunks
    (``cc``). ID-127.37 (DR-038/056/061): the folder→workspace manifest fork
    is retired — `ingest_file` no longer accepts (or needs) a manifest arg;
    every file runs the single content branch unconditionally.

    ID-136 (forms-route retirement, T8): ``ft_target``/``ftf_target`` were
    dropped from ``ingest_file``'s positional signature. {127.25} (DR-034)
    dropped ``ci_target`` too — the 6-arg shape is now
    (file, qa, sd, em, cc, er, re) with ``cc_target`` the 5th positional
    (``er_target``/``re_target`` stay defaulted None, the documented
    "4-/5-arg legacy caller" shape)."""
    from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

    # S438: `coco.use_context(DB_CTX)` now also backs the content branch's
    # raw-pool sd write — `flow.coco` is a FRESH MagicMock per `_flow_module()`
    # call, so direct assignment (no monkeypatch) is safe and self-contained.
    pool = _SdPool()
    flow.coco.use_context = lambda key: pool  # type: ignore[attr-defined]

    targets = {
        "qa": _FakeTarget("q_a_extractions"),
        "sd": _SdTarget(pool),
        "em": _FakeTarget("entity_mentions"),
        "cc": _FakeTarget("content_chunks"),
    }
    run_op_id = uuid.uuid4()

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=run_op_id):
            await flow.ingest_file(
                fake_file,
                targets["qa"],
                targets["sd"],
                targets["em"],
                targets["cc"],
            )

    asyncio.run(_exercise())
    targets["op_id"] = run_op_id  # type: ignore[assignment]
    return targets


class TestContentBranchIsTheOnlyBranch:
    """ID-127.37 (DR-038/056/061): with the manifest fork retired,
    ``ingest_file`` unconditionally runs the content branch for every file —
    no route, no manifest, no fork. This class is what remains of this
    file's pre-retirement branch-selection coverage (see the module
    docstring + git history for the full pre-retirement contract)."""

    def test_any_file_lands_content_rows_no_manifest_required(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A plain .md file lands content rows with NO manifest bound at
        all — proving the fork's removal, not merely a manifest-optional
        default."""
        flow = _flow_module()
        calls = _observe_path_a_seams(flow, monkeypatch)

        fake_file = _FakeFile("acme/notes.md", data=b"# H\n\nbody")

        out = _drive_ingest(flow, fake_file)

        # {127.25} DR-034: content_items is gone — content_chunks is the
        # content-branch discriminator.
        assert len(out["sd"].rows) == 1
        assert len(out["cc"].rows) == 1
        # The content branch performed its Stage-2 conversion + LLM passes.
        assert calls["convert"] == 1
        assert calls["classification"] == 1

    def test_ingest_file_no_longer_accepts_a_workspace_manifest_kwarg(self) -> None:
        """Structural regression guard: `flow_workspace_manifest` was REMOVED
        from `ingest_file`'s keyword-only signature (ID-127.37) — passing it
        must raise `TypeError`, not silently no-op. Prevents a caller from
        believing manifest-based routing still exists."""
        import inspect

        flow = _flow_module()
        params = inspect.signature(flow.ingest_file).parameters
        assert "flow_workspace_manifest" not in params, (
            "ingest_file must not carry a flow_workspace_manifest param — "
            "ID-127.37 retired the manifest fork entirely"
        )
        # flow_source_path is NOT manifest-related (S297 BUG-A rel_path
        # normalisation) and must survive this retirement (the #1 trap).
        assert "flow_source_path" in params
