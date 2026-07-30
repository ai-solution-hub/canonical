"""id-400 — Inv-9 RESHAPE: curation-pinned rows the walk may never UPDATE.

TRIAGE §3.1.4 (D-397-A Option C co-mint, owner-ratified S513): id-53 Inv-9's
op_id-scoping protection collapses on `full_reprocess` paths, which
legitimately re-stamp every row and put admin-merged `entity_mentions` back in
Stage-5 scope — census #41 failure #1 (admin merge reverted) is the live
symptom. The co-mint: rows carrying `metadata.curation_pinned = true`
(stamped by `app/api/entities/merge/route.ts` post-`merge_entities`) are
untouchable by the walk:

1. em-declare (flow.py `_ingest_content_branch`): a re-extraction re-declares
   a pinned row VERBATIM (stored canonical_name / metadata / op_id) — never
   clobbers curated values; an unmatched pinned row still survives the walk,
   and WINS its natural key against a fresh candidate.
2. Stage-5 write-back domain (`_select_run_entity_mentions`): pinned rows are
   excluded at the SQL layer.
3. Stage-5 cross-op collision (ID-80.14): a pinned key-holder wins
   UNCONDITIONALLY (never deleted, whatever the confidence rank), and the
   widened-predicate DELETE re-asserts the pin at the SQL layer
   (defence-in-depth).
"""

from __future__ import annotations

import asyncio
import inspect
import json
import uuid
from pathlib import Path

import pytest

from scripts.cocoindex_pipeline import stage_5
from scripts.tests.conftest import fresh_flow_module
from scripts.tests.test_cocoindex_flow_write_path import (
    _FakeFile,
    _FakePool,
    _FakeTarget,
    _fake_relationships_empty,
)

_KH_PIPELINE_DOC_NS = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


# ── SQL-layer contracts (the SQL text IS the contract to the DB) ─────────────


class TestStage5PinSqlContracts:
    def test_run_mentions_select_excludes_pinned_rows(self) -> None:
        src = inspect.getsource(stage_5._select_run_entity_mentions)
        assert "(metadata->>'curation_pinned') IS DISTINCT FROM 'true'" in src, (
            "id-400 Inv-9: the Stage-5 write-back domain read must exclude "
            "curation-pinned rows at the SQL layer"
        )

    def test_prior_op_key_holder_probe_selects_pin_flag(self) -> None:
        src = inspect.getsource(stage_5._select_prior_op_key_holders)
        assert "curation_pinned" in src, (
            "id-400 Inv-9: the ID-80.14 cross-op probe must SELECT the pin "
            "flag so the survivor rule can honour it"
        )

    def test_cross_op_delete_reasserts_pin_predicate(self) -> None:
        src = inspect.getsource(stage_5._run_stage_5_resolution)
        assert src.count(
            "(metadata->>'curation_pinned') IS DISTINCT FROM 'true'"
        ) >= 1, (
            "id-400 defence-in-depth: the widened-predicate cross-op DELETE "
            "must re-assert the pin predicate at the SQL layer"
        )


# ── Stage-5 behavioural: pinned key-holder wins unconditionally ──────────────


class _RecordingConn:
    """Minimal conn double recording DELETE/UPDATE executes."""

    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple]] = []

    def transaction(self):  # type: ignore[no-untyped-def]
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _tx():
            yield

        return _tx()

    async def execute(self, query: str, *args: object) -> str:
        self.executed.append((query, args))
        return "OK"


class _PinProbePool:
    """Pool double: run rows + a PINNED cross-op key-holder.

    Drives `_run_stage_5_resolution` far enough to reach the ID-80.14
    cross-op comparison with a pinned prior holder of LOWER confidence than
    the current-op survivor — the exact case where the pre-id-400 rank rule
    would have DELETEd the curated row.
    """

    def __init__(self, run_rows: list[dict], pinned_holder: dict) -> None:
        self.run_rows = run_rows
        self.pinned_holder = pinned_holder
        self.conn = _RecordingConn()

    async def fetch(self, query: str, *args: object) -> list[dict]:
        if "FROM public.entity_aliases" in query:
            return []
        if "op_id IS DISTINCT FROM $4" in query:
            return [self.pinned_holder]
        if "SELECT DISTINCT canonical_name" in query:
            return []
        if "FROM public.entity_mentions" in query:
            return list(self.run_rows)
        raise AssertionError(f"unexpected fetch query: {query!r}")

    def acquire(self):  # type: ignore[no-untyped-def]
        from contextlib import asynccontextmanager

        conn = self.conn

        @asynccontextmanager
        async def _acquire():
            yield conn

        return _acquire()


def test_pinned_cross_op_key_holder_wins_over_higher_confidence_survivor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A curation-pinned prior-op key-holder is NEVER deleted: the current-op
    survivor collapses into it (op-scoped DELETE) even though the survivor
    out-ranks it on confidence — the pre-id-400 rule would have deleted the
    curated row via the widened-predicate DELETE."""
    from scripts.cocoindex_pipeline.flow_context import FlowRunMeta

    op_id = uuid.uuid4()
    sd_id = uuid.uuid4()
    run_row_id = uuid.uuid4()

    # The current-op row resolves to the pinned holder's canonical.
    run_rows = [
        {
            "id": run_row_id,
            "canonical_name": "acme corp",
            "entity_type": "organisation",
            "source_document_id": sd_id,
            "confidence": 0.99,  # OUT-RANKS the pinned holder
        }
    ]
    pinned_holder = {
        "id": uuid.uuid4(),
        "canonical_name": "acme corporation",
        "entity_type": "organisation",
        "source_document_id": sd_id,
        "confidence": 0.10,  # lower — rank alone would lose
        "curation_pinned": True,
    }
    pool = _PinProbePool(run_rows, pinned_holder)

    # Resolver stub: the run row resolves to the pinned canonical.
    class _Resolved:
        def canonical_of(self, name: str) -> str:
            return "acme corporation"

    async def _fake_resolve_entities(names, **kwargs):  # type: ignore[no-untyped-def]
        return _Resolved()

    from scripts.cocoindex_pipeline import _coco_api

    monkeypatch.setattr(_coco_api, "resolve_entities", _fake_resolve_entities)

    class _Counter:
        def __init__(self) -> None:
            self.counts: dict[str, int] = {}

        def increment(self, stage: str) -> None:
            self.counts[stage] = self.counts.get(stage, 0) + 1

        def get(self, stage: str) -> int:
            return self.counts.get(stage, 0)

    updated = asyncio.run(
        stage_5._run_stage_5_resolution(
            meta=FlowRunMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=_Counter(),  # type: ignore[arg-type]
        )
    )

    executed = pool.conn.executed
    delete_queries = [q for q, _ in executed if q.startswith("DELETE")]
    update_queries = [q for q, _ in executed if q.startswith("UPDATE")]

    # No UPDATE landed (the pinned holder already carries the canonical) and
    # the ONLY delete is the OP-SCOPED collapse of the current-op survivor —
    # never the widened-predicate cross-op DELETE of the pinned row.
    assert updated == 0
    assert not update_queries, f"no UPDATE may land: {update_queries!r}"
    assert len(delete_queries) == 1, f"exactly one delete: {executed!r}"
    assert "AND op_id = $2" in delete_queries[0], (
        "the one DELETE must be the op-scoped current-op collapse — the "
        f"pinned cross-op holder is untouchable: {delete_queries!r}"
    )
    deleted_ids = executed[0][1][0]
    assert deleted_ids == [run_row_id], (
        "the current-op survivor (not the pinned holder) collapses"
    )


def test_pinned_rows_excluded_from_run_domain_never_updated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pinned row re-stamped into the current op (full_reprocess path) is
    OUT of the write-back domain: with the run read honouring the pin
    predicate, Stage-5 plans nothing for it."""
    from scripts.cocoindex_pipeline.flow_context import FlowRunMeta

    op_id = uuid.uuid4()
    # The pool models the SQL contract: the run read already excludes pinned
    # rows, so Stage-5 sees an EMPTY run domain and issues no writes.
    pool = _PinProbePool(run_rows=[], pinned_holder={})

    class _Counter:
        def increment(self, stage: str) -> None: ...

        def get(self, stage: str) -> int:
            return 0

    updated = asyncio.run(
        stage_5._run_stage_5_resolution(
            meta=FlowRunMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=_Counter(),  # type: ignore[arg-type]
        )
    )
    assert updated == 0
    assert pool.conn.executed == []


# ── flow.py em-declare: pin carry-forward ────────────────────────────────────


class _PinAwarePool(_FakePool):
    """Write-path fake pool that ALSO answers the pin preload fetch."""

    def __init__(self, pinned_rows: list[dict]) -> None:
        super().__init__()
        self.pinned_rows = pinned_rows
        self.fetch_queries: list[str] = []

    async def fetch(self, query: str, *args: object) -> list[dict]:
        self.fetch_queries.append(query)
        if "curation_pinned" in query:
            return list(self.pinned_rows)
        return []


def _stub_content_seams(
    flow: object, monkeypatch: pytest.MonkeyPatch, mentions: list
) -> None:
    async def _conv(file: object) -> str:
        return "# Doc\n\nAcme Security holds ISO 27001."

    async def _cls(content_text: str):
        return {
            "content_type": "case_study",
            "primary_domain": "procurement",
            "primary_subtopic": "tender_evaluation",
            "suggested_title": "Doc Title",
        }

    async def _qa(content_text: str):
        return {"qa_pairs": []}

    async def _ent(content_text: str):
        return mentions

    async def _emb(content_text: str):
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _conv)
    monkeypatch.setattr(flow, "extract_classification", _cls)
    monkeypatch.setattr(flow, "extract_qa_form", _qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _ent)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
    monkeypatch.setattr(flow, "embed_content_text", _emb)


def _mention(flow: object, name: str, entity_type: str, confidence: float):
    """Build a mention via the flow module's own extraction model when
    available; fall back to a structural stand-in mirroring the fields the
    declare loop reads."""

    class _M:
        def __init__(self) -> None:
            self.entity_name = name
            self.entity_type = entity_type
            self.mention_confidence = confidence
            self.source_span_start = 2
            self.source_span_end = 2 + len(name)

    return _M()


def _drive_ingest(
    flow: object,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    mentions: list,
    pinned_rows: list[dict],
) -> tuple[_FakeTarget, _PinAwarePool]:
    _stub_content_seams(flow, monkeypatch, mentions)
    src = tmp_path / "doc.md"
    src.write_text("# Doc\n\nAcme Security holds ISO 27001.")
    qa = _FakeTarget("q_a_extractions")
    sd = _FakeTarget("source_documents")
    em = _FakeTarget("entity_mentions")

    pool = _PinAwarePool(pinned_rows)
    monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)

    async def _exercise() -> None:
        async with flow.bind_flow_meta(op_id=uuid.uuid4()):
            await flow.ingest_file(
                _FakeFile(src),
                qa,
                sd,
                em,
                None,
                None,
                None,
                flow_source_path=tmp_path,
            )

    asyncio.run(_exercise())
    return em, pool


def _expected_em_id(sd_rows_pool: _PinAwarePool, canonical: str, etype: str):
    """Recompute the registry-keyed em uuid5 for the (single) sd row the fake
    resolver minted (keyed on rel_path 'doc.md')."""
    sd_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:doc.md")
    return uuid.uuid5(_KH_PIPELINE_DOC_NS, f"em:{sd_id}:{canonical}:{etype}")


class TestEmDeclarePinCarryForward:
    def test_matched_pin_redeclared_verbatim(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A re-extraction whose candidate id matches a pinned row declares
        the STORED values — admin-merged canonical_name, pin metadata, and
        the stored op_id (no re-stamp) — not the fresh per-doc canonical."""
        flow = fresh_flow_module()
        # The LLM emits 'Acme Security' (organisation) — per-doc canonical
        # 'acme security' — while the admin merged the row's canonical to
        # 'acme corporation' and pinned it.
        mentions = [_mention(flow, "Acme Security", "organisation", 0.8)]
        sd_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:doc.md")
        canonical = flow.canonicalise_entity_name("Acme Security", "organisation")
        pinned_id = uuid.uuid5(
            _KH_PIPELINE_DOC_NS, f"em:{sd_id}:{canonical}:organisation"
        )
        stored_op = uuid.uuid4()
        pinned_rows = [
            {
                "id": pinned_id,
                "entity_type": "organisation",
                "entity_name": "Acme Security",
                "canonical_name": "acme corporation",
                "confidence": 0.8,
                "context_snippet": "…curated snippet…",
                "metadata": {"curation_pinned": True, "source_span_start": 2},
                "op_id": stored_op,
            }
        ]
        em, _pool = _drive_ingest(flow, tmp_path, monkeypatch, mentions, pinned_rows)

        assert len(em.rows) == 1
        row = em.rows[0]
        assert row["id"] == pinned_id
        assert row["canonical_name"] == "acme corporation", (
            "the walk must NEVER clobber an admin-merged canonical"
        )
        assert row["metadata"].get("curation_pinned") is True, (
            "the pin must survive the re-declare"
        )
        assert row["op_id"] == stored_op, (
            "a pinned row keeps its stored op_id — no re-stamp, even on the "
            "re-extraction paths"
        )

    def test_unmatched_pin_survives_and_wins_natural_key(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When tier variance changes the per-doc canonical (different id) but
        the fresh candidate resolves to the pinned row's NATURAL key, the pin
        wins: the candidate is dropped and the pinned row is re-declared
        verbatim (it must survive engine declared-state reconciliation)."""
        flow = fresh_flow_module()
        mentions = [_mention(flow, "Acme Corporation", "organisation", 0.9)]
        sd_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:doc.md")
        fresh_canonical = flow.canonicalise_entity_name(
            "Acme Corporation", "organisation"
        )
        # Pinned row minted from an EARLIER extraction ('Acme Security') —
        # different id — but admin-merged to the SAME canonical the fresh
        # candidate now carries.
        earlier_canonical = flow.canonicalise_entity_name(
            "Acme Security", "organisation"
        )
        pinned_id = uuid.uuid5(
            _KH_PIPELINE_DOC_NS, f"em:{sd_id}:{earlier_canonical}:organisation"
        )
        stored_op = uuid.uuid4()
        pinned_rows = [
            {
                "id": pinned_id,
                "entity_type": "organisation",
                "entity_name": "Acme Security",
                "canonical_name": fresh_canonical,
                "confidence": 0.7,
                "context_snippet": "…curated snippet…",
                "metadata": {"curation_pinned": True},
                "op_id": stored_op,
            }
        ]
        em, _pool = _drive_ingest(flow, tmp_path, monkeypatch, mentions, pinned_rows)

        assert len(em.rows) == 1, (
            "exactly one row for the natural key — the pin wins, the fresh "
            f"candidate is dropped: {em.rows!r}"
        )
        row = em.rows[0]
        assert row["id"] == pinned_id
        assert row["canonical_name"] == fresh_canonical
        assert row["metadata"].get("curation_pinned") is True
        assert row["op_id"] == stored_op

    def test_pin_read_failure_degrades_with_warning_not_abort(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A pin-preload fault must never abort the doc: declares proceed
        unpinned and the degradation is LOGGED (the audit trail)."""
        flow = fresh_flow_module()
        mentions = [_mention(flow, "Acme Security", "organisation", 0.8)]

        class _BrokenPool(_PinAwarePool):
            async def fetch(self, query: str, *args: object) -> list[dict]:
                raise RuntimeError("boom — pin preload unavailable")

        _stub_content_seams(flow, monkeypatch, mentions)
        src = tmp_path / "doc.md"
        src.write_text("# Doc\n\nAcme Security holds ISO 27001.")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        pool = _BrokenPool([])
        monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)

        warnings: list[str] = []
        monkeypatch.setattr(
            flow._logger, "warning", lambda msg, *a: warnings.append(str(msg))
        )

        async def _exercise() -> None:
            async with flow.bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(_FakeFile(src), qa, sd, em, None, None)

        asyncio.run(_exercise())

        assert len(em.rows) == 1, "the declare must still land"
        assert any(
            "curation_pin_read_failed" in w for w in warnings
        ), f"the degradation must be logged: {warnings!r}"
