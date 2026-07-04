"""ID-59 {59.32} — Q&A sidecar round-trip + N-time idempotency golden fixture
(walk leg) + INV-20 path-stability. Folds bl-324 (the idempotency assertion).

This is the PYTHON half of the {59.32} golden fixture. The TypeScript half
(``__tests__/lib/q-a-pairs/sidecar-roundtrip.golden.test.ts``) proves the
serialisation round-trip and the N-time fixpoint on the carried-set markdown;
THIS file proves the WALK leg that the round-trip depends on:

  - **N>=3 fixpoint (INV-17 / COCO.10 / bl-324):** re-walking the SAME `__qa__/`
    sidecar bytes N times mints IDENTICAL deterministic ``sd:`` / ``qa:`` uuid5
    PKs and identical row payloads every run, so ``declare_row`` UPSERTs the same
    rows rather than minting duplicates — no oscillation, no churn, no drift. The
    only per-run difference is the ``op_id`` ROW FIELD (it identifies the RUN, not
    the row — ratified OQ-A re-stamps the same row's op_id). This is the
    metadata-only-touch memo contract (05-qa-flow.md §5.2) made testable at the
    walk level: stable PKs == the UPSERT short-circuits to the same projection.

  - **INV-20 path stability (05-qa-flow.md §5.5):** the linkage anchor is derived
    from the rel_path (``uuid5("sd:"+rel_path)`` / ``uuid5("qa:"+rel_path+":"+idx)``)
    and the rel_path travels into ``source_documents.storage_path``. A rename
    WITHIN the reserved prefix (``__qa__/foo.md`` -> ``__qa__/sub/foo.md``) re-keys
    on the NEW uuid5 (the keying is genuinely path-derived, proven by inequality
    of the two paths' PKs), and the on-disk path stays traceable via storage_path.
    The pair-non-duplication on a rename is the PROMOTION layer's
    ``promoted_to_pair_id`` anchor (asserted in the promote-corpus suite, not the
    walk) — the walk's contribution is the deterministic re-key proven here.

REAL-BODY discipline (test-philosophy §5.3, mirrors the {59.26} fork-routing
suite): the real ``_ingest_qa_sidecar_branch`` fork body runs UNPATCHED. Only
the outside-world seams (Docling conversion + the Anthropic extraction passes)
are touched, as RECORDING observers — the inner ``extract_qa_form`` is faked to
a deterministic fixed payload so the walk's row-minting is exercised on stable
bytes without a live LLM call.

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference:
  specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-sidecar-canonical.md
  T1 (round-trip + N-time fixpoint, folds bl-324) + R3 (INV-20 path stability);
  PRODUCT-qa-sidecar-canonical.md INV-16/INV-17/INV-20.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from pathlib import Path

import pytest

from conftest import fresh_flow_module  # noqa: E402


def _flow_module():
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive)."""
    return fresh_flow_module()


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB (keyword-only
    ``declare_row(*, row)``), mirroring the {59.26} fork-routing double."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeFile:
    """File stand-in with a RELATIVE ``file_path.path`` (production shape post
    ``_to_source_relative``) whose ``read()`` returns the given literal bytes."""

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str, *, data: bytes = b"") -> None:
        self.file_path = _FakeFile._FilePath(Path(rel_path))
        self._data = data

    async def size(self) -> int:
        return len(self._data)

    async def read(self) -> bytes:
        return self._data

    async def read_text(self) -> str:
        return self._data.decode("utf-8")

    async def content_fingerprint(self) -> bytes:
        return hashlib.sha256(self._data).digest()


def _make_qa_manifest(workspace_id: uuid.UUID, *, prefix: str = "__qa__/"):
    """A real WorkspaceManifest mapping ``prefix`` -> the qa_sidecar route."""
    from scripts.cocoindex_pipeline.workspace_resolver import (
        WorkspaceManifest,
        WorkspaceMapping,
    )

    return WorkspaceManifest(
        schema_version=1,
        mappings=[
            WorkspaceMapping(
                path_prefix=prefix, workspace_id=workspace_id, route="qa_sidecar"
            )
        ],
    )


async def _fake_relationships_empty(content_text: str) -> list:
    return []


# ── SEED-CONTRACT namespace (pinned to flow._KH_PIPELINE_DOC_NS). ────────────
_NS = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


# ── content_hash-first resolver pool double (ID-138 {138.10}) ───────────────
# The sidecar sd row now lands OFF the engine, via the raw-pool
# `_upsert_source_document`, and its identity is resolved by the M2
# `resolve_or_mint_source_identity` fn (content_hash-first). This double stands
# in for both: `fetchrow` answers the resolver (mirroring its MINT formula
# `uuid5(NS, "sd:"+rel_path)` on first admission, and RESOLVING to the stored id
# on a content_hash it has already seen — so a rename of the same bytes keeps the
# id); `execute` captures the sd INSERT so `out["sd"].rows` still works.


class _ResolverConn:
    def __init__(self, registry: dict) -> None:
        self._registry = registry
        self.executed: list[tuple[str, tuple]] = []

    async def fetchrow(self, sql: str, *args: object) -> dict:
        content_hash, rel_path = args[0], args[1]
        existing = self._registry.get(content_hash)
        if existing is not None:
            return {"source_document_id": existing, "was_minted": False}
        sd_id = uuid.uuid5(_NS, f"sd:{rel_path}")
        self._registry[content_hash] = sd_id
        return {"source_document_id": sd_id, "was_minted": True}

    async def execute(self, sql: str, *args: object) -> str:
        self.executed.append((sql, args))
        return "INSERT 0 1"


class _ResolverPool:
    def __init__(self, registry: dict) -> None:
        self.conn = _ResolverConn(registry)

    def acquire(self) -> object:
        conn = self.conn

        class _Acquire:
            async def __aenter__(self) -> _ResolverConn:
                return conn

            async def __aexit__(self, *exc: object) -> None:
                return None

        return _Acquire()


class _SdView:
    """Duck-types ``_FakeTarget`` (`.table_name` / `.rows`) but sources `.rows`
    from the raw-pool sd UPSERT capture — the sidecar sd row lands via
    `_upsert_source_document` ({138.10}), not `sd_target.declare_row`."""

    table_name = "source_documents"

    def __init__(self, conn: _ResolverConn) -> None:
        self._conn = conn

    @property
    def rows(self) -> list[dict]:
        rows: list[dict] = []
        for sql, args in self._conn.executed:
            if "INSERT INTO public.source_documents" not in sql:
                continue
            cols = [c.strip() for c in sql.split("(", 1)[1].split(")", 1)[0].split(",")]
            rows.append(dict(zip(cols, args)))
        return rows


def _observe_seams(flow: object, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Replace the outside-world seams with recording observers. The inner
    ``extract_qa_form`` returns a FIXED deterministic payload so the walk mints
    stable rows on stable bytes (no live LLM). The content-only passes
    (classification / entities / embed) must stay at ZERO for a sidecar."""
    calls = {"convert": 0, "classification": 0, "qa": 0, "entities": 0, "embed": 0}

    async def _fake_convert(file: object) -> str:
        calls["convert"] += 1
        # The sidecar IS markdown; the conversion is the identity-ish text read.
        return await file.read_text()

    async def _fake_classification(content_text: str):
        calls["classification"] += 1
        return {"content_type": "case_study"}

    async def _fake_qa(content_text: str):
        calls["qa"] += 1
        # FIXED deterministic two-pair payload — the golden walk fixture's
        # carried set. Stable across every re-walk (no LLM nondeterminism).
        return {
            "extraction_kind": "q_a_form",
            "qa_pairs": [
                {
                    "question_text": "What is the maximum contract value?",
                    "answer_text": "The maximum contract value is £5m.",
                    "question_phrasings": ["How much can the contract be worth?"],
                },
                {
                    "question_text": "Which regions are in scope?",
                    "answer_text": "England, Scotland, Wales and Northern Ireland.",
                    "question_phrasings": [],
                },
            ],
        }

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


def _drive_ingest(
    flow: object,
    fake_file: object,
    *,
    manifest: object,
    registry: dict | None = None,
    monkeypatch: pytest.MonkeyPatch | None = None,
) -> dict:
    """Drive one real ``ingest_file`` with all seven targets recording. The
    qa_sidecar branch only writes sd + qa; the other five targets are asserted
    empty (the INV-5 structural guarantee carries through the round-trip).

    ID-138 {138.10}: the sd anchor now lands via the off-engine raw-pool
    `_upsert_source_document` and its identity is resolved content_hash-first.
    Pass a shared ``registry`` across drives to exercise rename-tolerance (same
    bytes at a new path resolve to the STORED id); omit it for an independent
    walk (the mint formula is deterministic on rel_path, so a re-walk of the same
    path is stable regardless). ``out["sd"]`` reads back from the raw-pool
    capture via ``_SdView``.
    """
    from scripts.cocoindex_pipeline.flow_context import (
        bind_flow_meta,
        bind_workspace_manifest,
    )

    pool = _ResolverPool(registry if registry is not None else {})
    # `flow.coco.use_context` is monkeypatched to the resolver pool. When a
    # `monkeypatch` fixture is supplied it is used (auto-reverts); otherwise fall
    # back to a direct attribute set (the observer seams reset per drive anyway).
    if monkeypatch is not None:
        monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)
    else:
        flow.coco.use_context = lambda key: pool  # type: ignore[attr-defined]

    targets = {
        "ci": _FakeTarget("content_items"),
        "qa": _FakeTarget("q_a_extractions"),
        "sd": _FakeTarget("source_documents"),
        "em": _FakeTarget("entity_mentions"),
        "ft": _FakeTarget("form_templates"),
        "ftf": _FakeTarget("form_template_fields"),
        "cc": _FakeTarget("content_chunks"),
    }
    run_op_id = uuid.uuid4()

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=run_op_id):
            async with bind_workspace_manifest(manifest):
                await flow.ingest_file(
                    fake_file,
                    targets["ci"],
                    targets["qa"],
                    targets["sd"],
                    targets["em"],
                    targets["ft"],
                    targets["ftf"],
                    targets["cc"],
                )

    asyncio.run(_exercise())
    # The sd row lands off-engine now — expose it via the raw-pool view so the
    # existing `out["sd"].rows` assertions keep working.
    targets["sd"] = _SdView(pool.conn)  # type: ignore[assignment]
    targets["op_id"] = run_op_id  # type: ignore[assignment]
    return targets


def _strip_op_id(rows: list[dict]) -> list[dict]:
    """Drop the per-RUN op_id field so two runs' row payloads compare equal on
    everything that defines the ROW (op_id is re-stamped per run by design)."""
    return [{k: v for k, v in r.items() if k != "op_id"} for r in rows]


class TestQaSidecarNTimeFixpoint:
    """INV-17 / COCO.10 / bl-324: N>=3 re-walks of the SAME sidecar bytes mint
    IDENTICAL deterministic PKs + identical row payloads every run — a stable
    fixpoint with no oscillation, churn, or drift."""

    def test_three_rewalks_same_bytes_mint_identical_pks_and_payloads(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        ws = uuid.uuid4()
        manifest = _make_qa_manifest(ws)
        rel_path = "__qa__/11111111-1111-4111-8111-111111111111.md"
        same_bytes = (
            b"---\nscope_tag: null\nanti_scope_tag: null\n"
            b"alternate_question_phrasings: []\n---\n\n"
            b"## Question\n\nWhat is the maximum contract value?\n\n"
            b"## Answer (standard)\n\nThe maximum contract value is \xc2\xa35m.\n"
        )

        # Walk the SAME bytes N = 3 times. Re-seed the observer each run (the
        # fresh fork body resolves the same deterministic PKs every time).
        runs = []
        for _ in range(3):
            calls = _observe_seams(flow, monkeypatch)
            out = _drive_ingest(
                flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
            )
            runs.append((out, calls))

        # Hard-coded uuid5 oracles over _KH_PIPELINE_DOC_NS
        # ("fbfaf1ff-1ee4-583c-9757-1674465b2ec1") for the pinned rel_path
        # "__qa__/11111111-1111-4111-8111-111111111111.md" — frozen literals so a
        # namespace or seed-string drift fails loudly (not re-derived from flow).
        # ID-138 {138.10}: sd keeps the sd:{rel} MINT formula (content_hash-first
        # resolver mints it on first admission); the qa PKs re-key onto the STORED
        # source_document_id (`qa:{sd_id}:{idx}`, P3) — recomputed literals below.
        sd_pk = uuid.UUID("bcb1e7b4-38e9-5ff9-9a6b-f0b16b391105")  # sd:{rel}
        expected_qa_pks = [
            uuid.UUID("f06d8591-5594-533f-a264-9244e7a01a65"),  # qa:{sd_id}:0
            uuid.UUID("62e974a8-bede-595f-9307-080fa4385573"),  # qa:{sd_id}:1
        ]

        # ── source_documents: ONE row per run, the SAME sd: uuid5 PK. ──────────
        for out, _ in runs:
            assert len(out["sd"].rows) == 1, "one source_documents row per walk"
            assert out["sd"].rows[0]["id"] == sd_pk, (
                "source_documents PK is the stable sd:-seeded uuid5 — a re-walk "
                "UPSERTs the SAME row (INV-17 fixpoint, INV-20 path-derived)"
            )

        # ── q_a_extractions: N rows per run, identical ordered qa: uuid5 PKs. ──
        for out, _ in runs:
            assert len(out["qa"].rows) == 2, "one q_a_extractions row per Q&A pair"
        qa_pks_per_run = [[r["id"] for r in out["qa"].rows] for out, _ in runs]
        for qa_pks in qa_pks_per_run:
            assert qa_pks == expected_qa_pks, (
                "q_a_extractions PKs are the stable qa:-seeded uuid5 list — "
                "identical every re-walk (no duplicate rows)"
            )

        # ── FIXPOINT: the full row payloads (minus the per-run op_id) are
        # byte-identical run-for-run — no churn, no drift. ────────────────────
        sd_payloads = [_strip_op_id(out["sd"].rows) for out, _ in runs]
        qa_payloads = [_strip_op_id(out["qa"].rows) for out, _ in runs]
        assert sd_payloads[0] == sd_payloads[1] == sd_payloads[2], (
            "source_documents payload is a stable fixpoint across N re-walks"
        )
        assert qa_payloads[0] == qa_payloads[1] == qa_payloads[2], (
            "q_a_extractions payloads are a stable fixpoint across N re-walks "
            "(bl-324 idempotency assertion)"
        )

        # ── INV-5 carried through the fixpoint: ZERO content rows every run. ──
        for out, _ in runs:
            assert out["ci"].rows == [], "ZERO content_items every re-walk (INV-5)"
            assert out["cc"].rows == [], "ZERO content_chunks every re-walk (INV-5)"
            assert out["em"].rows == [], "ZERO entity_mentions every re-walk (INV-5)"
            for qa_row in out["qa"].rows:
                assert qa_row["source_document_id"] is None, (
                    "source_document_id stays NULL across re-walks (INV-5)"
                )

        # ── COCO.10: no content-only LLM pass ever runs for a sidecar, on ANY
        # of the N walks (the metadata-touch memo discipline at the call seam). ─
        for _, calls in runs:
            assert calls["classification"] == 0
            assert calls["entities"] == 0
            assert calls["embed"] == 0

    def test_op_id_is_the_only_per_run_difference(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Two walks of identical bytes differ ONLY in the op_id row field (the
        per-RUN stamp) — every other row field is byte-identical (the row is the
        same logical row, UPSERTed, not a fresh insert)."""
        flow = _flow_module()
        ws = uuid.uuid4()
        manifest = _make_qa_manifest(ws)
        rel_path = "__qa__/22222222-2222-4222-8222-222222222222.md"
        same_bytes = b"# QA\n\nidentical bytes both runs"

        _observe_seams(flow, monkeypatch)
        out_a = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )
        _observe_seams(flow, monkeypatch)
        out_b = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )

        # Genuinely distinct runs (distinct op_id).
        assert out_a["op_id"] != out_b["op_id"]
        # The sd row's op_id field tracks the run; everything else matches.
        assert out_a["sd"].rows[0]["op_id"] == out_a["op_id"]
        assert out_b["sd"].rows[0]["op_id"] == out_b["op_id"]
        assert _strip_op_id(out_a["sd"].rows) == _strip_op_id(out_b["sd"].rows)
        assert _strip_op_id(out_a["qa"].rows) == _strip_op_id(out_b["qa"].rows)


class TestQaSidecarPathStability:
    """ID-138 {138.10} R(id) / DR-024 clause i — SUPERSEDES the old INV-20
    path-derived keying. The linkage anchor is now resolved content_hash-FIRST,
    NOT re-derived from the mutable `rel_path`: a rename of the SAME bytes within
    the reserved prefix resolves to the SAME stored identity (the anchor and its
    derived qa rows are NOT re-minted), and the mutable `logical_path` tracks the
    current path while the frozen `storage_path` records the admission key. Its
    complement — the SAME path is stable across re-walks — still holds."""

    def test_rename_of_same_bytes_resolves_same_identity(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        ws = uuid.uuid4()
        manifest = _make_qa_manifest(ws)
        same_bytes = b"# QA\n\nsame content, renamed file"

        old_path = "__qa__/foo.md"
        new_path = "__qa__/sub/foo.md"

        # A SHARED registry across the two drives simulates the DB persisting the
        # first admission — so the rename walk RESOLVES the stored id by
        # content_hash rather than re-minting on the new path.
        registry: dict = {}
        _observe_seams(flow, monkeypatch)
        out_old = _drive_ingest(
            flow, _FakeFile(old_path, data=same_bytes), manifest=manifest,
            registry=registry,
        )
        _observe_seams(flow, monkeypatch)
        out_new = _drive_ingest(
            flow, _FakeFile(new_path, data=same_bytes), manifest=manifest,
            registry=registry,
        )

        # ── R(id): the rename resolves to the SAME admission-minted identity —
        # the anchor is content_hash-first, NOT re-derived from the path. ───────
        sd_old = out_old["sd"].rows[0]["id"]
        sd_new = out_new["sd"].rows[0]["id"]
        assert sd_old == uuid.UUID("42c08615-f8d1-5acd-9da7-a046e414837e")  # sd:{old}
        assert sd_new == sd_old, (
            "a rename of the same bytes must RESOLVE the STORED identity, not "
            "re-mint on the new path (R(id)/DR-024 i — supersedes INV-20)"
        )

        # q_a_extractions PKs are keyed on the stored id, so they too are NOT
        # re-minted by the rename (the derived graph is stable, {138.10} P3).
        qa_old = [r["id"] for r in out_old["qa"].rows]
        qa_new = [r["id"] for r in out_new["qa"].rows]
        assert qa_old == [
            uuid.UUID("2cfcd692-a092-5dad-8091-510677d47974"),  # qa:{sd_id}:0
            uuid.UUID("26542bf7-e00b-5c41-8648-266dc8775c39"),  # qa:{sd_id}:1
        ]
        assert qa_new == qa_old, "a rename must not re-mint the derived qa rows"

        # logical_path is the MUTABLE path attribute — it tracks the current path
        # on each walk (storage_path is the FROZEN admission key, verified by the
        # ON CONFLICT contract in test_cocoindex_identity_core.py).
        assert out_old["sd"].rows[0]["logical_path"] == old_path
        assert out_new["sd"].rows[0]["logical_path"] == new_path

    def test_same_path_is_stable_across_rewalk(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The complement of the rename test: the SAME path re-keys to the SAME
        uuid5 across re-walks (path stability is what makes the linkage durable
        when nothing moves) — the INV-20 'stable when unchanged' half."""
        flow = _flow_module()
        ws = uuid.uuid4()
        manifest = _make_qa_manifest(ws)
        rel_path = "__qa__/sub/nested/stable.md"
        same_bytes = b"# QA\n\nunchanged"

        _observe_seams(flow, monkeypatch)
        out_a = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )
        _observe_seams(flow, monkeypatch)
        out_b = _drive_ingest(
            flow, _FakeFile(rel_path, data=same_bytes), manifest=manifest
        )

        # Hard-coded sd: uuid5 oracle for the pinned rel_path
        # "__qa__/sub/nested/stable.md" — a frozen literal (not re-derived from
        # flow) so a namespace/seed drift fails this stability assertion loudly.
        assert (
            out_a["sd"].rows[0]["id"]
            == out_b["sd"].rows[0]["id"]
            == uuid.UUID("df714f7e-e608-524b-8b64-8b28369dc388")  # sd:{rel}
        )
        assert [r["id"] for r in out_a["qa"].rows] == [
            r["id"] for r in out_b["qa"].rows
        ]
