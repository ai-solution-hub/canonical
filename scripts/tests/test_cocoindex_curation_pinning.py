"""id-400 Inv-9 RESHAPE under the id-434 two-phase shape: curation-pinned rows
the walk may never touch.

Pre-id-434, pin protection was smeared across three mechanisms (the per-doc
em-declare preload, the Stage-5 write-back-domain exclusion, and the ID-80.14
cross-op survivor rule). id-434 deleted Stage-5 whole — nothing mutates a
declared row any more — so the pin contract now has exactly TWO surfaces:

1. **The one pin read** (`_fetch_all_curation_pinned_mentions`, D7/DR-105):
   corpus-wide, carries the ratified EFFECTIVE-TYPE predicate
   (`COALESCE(entity_type_override, entity_type)`) so no consumer re-derives
   it. A pin-read fault PROPAGATES (reds the run): under phase 2b's
   declare-everything shape, a best-effort degrade would let engine
   reconciliation DELETE every pinned row — PI-4 ("curation survives every
   run") + PI-8 (fail-loud) outrank the old per-doc best-effort. The
   historical `curation_pin_read_failed` warning stays as the audit trail.

2. **The phase-2b carry-forward** (`_declare_entity_mentions`): a candidate
   row whose id matches a pinned id re-declares the STORED row verbatim (no
   re-stamp under full_reprocess); an unconsumed pin is re-declared anyway
   (declared-state reconciliation must never orphan-clean a curated row); on
   a natural-key clash the pin wins and the candidate is dropped, with
   `curation_pin_won_natural_key` logged.

Plus the resolution-time half (PI-4's second clause): pinned canonicals seed
`is_existing_canonical` in the phase-2a resolve subcomponent, so a pin is
honoured at resolution time as well as declare time.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import uuid

import pytest

from scripts.tests.conftest import fresh_flow_module
from scripts.tests.test_cocoindex_flow_write_path import _FakeTarget

_KH_PIPELINE_DOC_NS = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


# ── SQL-layer contract (the SQL text IS the contract to the DB) ──────────────


class TestPinFetchSqlContract:
    def test_pin_fetch_carries_the_d7_effective_type_predicate(self) -> None:
        flow = fresh_flow_module()
        src = inspect.getsource(flow._fetch_all_curation_pinned_mentions)
        assert "COALESCE(entity_type_override, entity_type)" in src, (
            "D7/DR-105: the one pin read must compute the EFFECTIVE type — "
            "no consumer may re-derive its own pin predicate"
        )
        assert "(metadata->>'curation_pinned') = 'true'" in src, (
            "the pin predicate must match the admin merge route's stamp"
        )
        assert "source_document_id = $" not in src, (
            "the fetch is CORPUS-WIDE (the per-doc preload is retired) — the "
            "phase-2b plan spans documents"
        )


# ── helpers ──────────────────────────────────────────────────────────────────


def _candidate(
    flow: object,
    name: str,
    entity_type: str = "organisation",
    confidence: float = 0.8,
    sd_id: uuid.UUID | None = None,
    op_id: uuid.UUID | None = None,
):
    per_doc_key = flow.canonicalise_entity_name(name)
    return flow.EntityMentionCandidate(
        source_document_id=sd_id or uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:doc.md"),
        entity_type=entity_type,
        entity_name=name,
        per_doc_key=per_doc_key,
        context_snippet=f"…{name} holds ISO 27001…",
        confidence=confidence,
        source_span_start=2,
        source_span_end=2 + len(name),
        op_id=op_id or uuid.uuid4(),
    )


def _pin_row(
    *,
    pin_id: uuid.UUID,
    sd_id: uuid.UUID,
    entity_type: str = "organisation",
    entity_name: str = "Acme Security",
    canonical_name: str = "acme corporation",
    confidence: float = 0.7,
    op_id: uuid.UUID,
) -> dict:
    return {
        "id": pin_id,
        "source_document_id": sd_id,
        "entity_type": entity_type,
        "effective_type": entity_type,
        "entity_name": entity_name,
        "canonical_name": canonical_name,
        "confidence": confidence,
        "context_snippet": "…curated snippet…",
        "metadata": {"curation_pinned": True},
        "op_id": op_id,
    }


def _declare(
    flow: object,
    candidates: list,
    pinned_rows: list[dict],
    resolved_by_type: dict | None = None,
) -> _FakeTarget:
    em = _FakeTarget("entity_mentions")
    asyncio.run(
        flow._declare_entity_mentions(
            em, candidates, resolved_by_type or {}, pinned_rows, None
        )
    )
    return em


# ── phase-2b: pin carry-forward ──────────────────────────────────────────────


class TestPhase2bPinCarryForward:
    def test_matched_pin_redeclared_verbatim(self) -> None:
        """A candidate whose id matches a pinned row declares the STORED
        values — admin-merged canonical_name, pin metadata, and the stored
        op_id (no re-stamp) — not the fresh resolution outcome."""
        flow = fresh_flow_module()
        sd_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:doc.md")
        candidate = _candidate(flow, "Acme Security", sd_id=sd_id)
        # With no resolver entry the candidate's canonical falls back to its
        # per_doc_key, so its id computes on that key — matching the pin.
        pinned_id = uuid.uuid5(
            _KH_PIPELINE_DOC_NS,
            f"em:{sd_id}:{candidate.per_doc_key}:organisation",
        )
        stored_op = uuid.uuid4()
        pinned = _pin_row(pin_id=pinned_id, sd_id=sd_id, op_id=stored_op)

        em = _declare(flow, [candidate], [pinned])

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
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When the fresh candidate resolves onto the pinned row's NATURAL
        key under a different id, the pin wins: the candidate is dropped, the
        pinned row is re-declared verbatim (it must survive engine
        declared-state reconciliation), and the clash is logged."""
        flow = fresh_flow_module()
        sd_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:doc.md")
        candidate = _candidate(flow, "Acme Corporation", confidence=0.9, sd_id=sd_id)
        fresh_canonical = candidate.per_doc_key
        # Pinned row minted from an EARLIER extraction ('Acme Security') —
        # different id — but admin-merged to the SAME canonical the fresh
        # candidate now carries.
        earlier_canonical = flow.canonicalise_entity_name("Acme Security")
        pinned_id = uuid.uuid5(
            _KH_PIPELINE_DOC_NS, f"em:{sd_id}:{earlier_canonical}:organisation"
        )
        stored_op = uuid.uuid4()
        pinned = _pin_row(
            pin_id=pinned_id,
            sd_id=sd_id,
            canonical_name=fresh_canonical,
            op_id=stored_op,
        )

        infos: list[str] = []
        monkeypatch.setattr(
            flow._logger, "info", lambda msg, *a: infos.append(str(msg))
        )
        em = _declare(flow, [candidate], [pinned])

        assert len(em.rows) == 1, (
            "exactly one row for the natural key — the pin wins, the fresh "
            f"candidate is dropped: {em.rows!r}"
        )
        row = em.rows[0]
        assert row["id"] == pinned_id
        assert row["canonical_name"] == fresh_canonical
        assert row["metadata"].get("curation_pinned") is True
        assert row["op_id"] == stored_op
        assert any("curation_pin_won_natural_key" in m for m in infos), (
            f"the clash must be logged: {infos!r}"
        )

    def test_unconsumed_pin_from_another_document_is_redeclared(self) -> None:
        """The plan spans documents: a pin on a document with NO candidates
        this run is still re-declared — reconciliation may never orphan-clean
        a curated row."""
        flow = fresh_flow_module()
        sd_a = uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:doc.md")
        sd_b = uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:other.md")
        candidate = _candidate(flow, "Acme Security", sd_id=sd_a)
        pinned = _pin_row(pin_id=uuid.uuid4(), sd_id=sd_b, op_id=uuid.uuid4())

        em = _declare(flow, [candidate], [pinned])

        assert len(em.rows) == 2, f"candidate row + pinned row: {em.rows!r}"
        by_sd = {row["source_document_id"]: row for row in em.rows}
        assert by_sd[sd_b]["canonical_name"] == "acme corporation"
        assert by_sd[sd_b]["metadata"].get("curation_pinned") is True


# ── the one pin read: fail-loud contract ─────────────────────────────────────


class TestPinReadFailureIsLoud:
    def test_pin_read_failure_logs_and_propagates(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """id-434 deliberate change from the per-doc best-effort: under the
        declare-everything shape, degrading to "no pins" would let engine
        reconciliation DELETE every pinned row — so the fault propagates
        (routing to entity_resolution_failed at the app_main re-wrap) and the
        historical warning event stays as the audit trail."""
        flow = fresh_flow_module()

        class _BrokenPool:
            async def fetch(self, query: str, *args: object) -> list[dict]:
                raise RuntimeError("boom — pin read unavailable")

        monkeypatch.setattr(flow.coco, "use_context", lambda key: _BrokenPool())
        warnings: list[str] = []
        monkeypatch.setattr(
            flow._logger, "warning", lambda msg, *a: warnings.append(str(msg))
        )

        with pytest.raises(RuntimeError, match="pin read unavailable"):
            asyncio.run(flow._fetch_all_curation_pinned_mentions())
        assert any("curation_pin_read_failed" in w for w in warnings), (
            f"the audit-trail warning must still fire: {warnings!r}"
        )


# ── phase-2a: pins seed resolution (PI-4's second clause) ────────────────────


class TestPinsSeedResolution:
    def test_pinned_canonicals_seed_is_existing_and_join_the_input(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """DR-147 clause 2 seeding: established canonicals (from the table)
        and pinned canonicals (passed in per effective type) join the resolver
        INPUT as members (PC-14 — a seed can only be chained UNDER if it is
        IN the collection) and back `is_existing_canonical` under PINNED."""
        flow = fresh_flow_module()

        class _SeedPool:
            async def fetch(self, query: str, *args: object) -> list[dict]:
                assert "SELECT DISTINCT canonical_name" in query
                return [{"canonical_name": "acme corporation"}]

        monkeypatch.setattr(flow.coco, "use_context", lambda key: _SeedPool())

        captured: dict = {}

        async def _fake_resolve_entities(entities, **kwargs):
            captured["entities"] = list(entities)
            captured["is_existing"] = kwargs["is_existing_canonical"]
            captured["policy"] = kwargs["existing_policy"]
            return "RESOLVED"

        import scripts.cocoindex_pipeline._coco_api as coco_api
        import scripts.cocoindex_pipeline.entity_embedder as embedder_mod
        import scripts.cocoindex_pipeline.pair_resolver as resolver_mod

        monkeypatch.setattr(
            coco_api, "resolve_entities", _fake_resolve_entities, raising=False
        )
        monkeypatch.setattr(
            embedder_mod, "KhEntityEmbedder", lambda db_pool=None: object()
        )
        monkeypatch.setattr(
            resolver_mod,
            "KhPairResolver",
            lambda db_pool=None, op_id=None, entity_type=None: object(),
        )

        entity_type, resolved = asyncio.run(
            flow._resolve_type_group(
                "organisation",
                ["acme security"],
                ["pinned canonical co"],
                uuid.uuid4(),
            )
        )

        assert entity_type == "organisation"
        assert resolved == "RESOLVED"
        assert captured["entities"] == sorted(
            {"acme security", "acme corporation", "pinned canonical co"}
        ), "seeds must be MEMBERS of the resolver input (PC-14)"
        assert captured["is_existing"]("acme corporation") is True
        assert captured["is_existing"]("pinned canonical co") is True
        assert captured["is_existing"]("acme security") is False, (
            "an in-flight name is not 'existing' — it must stay chainable"
        )


# ── phase-2b: the collapse survivor rule honours confidence ──────────────────


class TestCollapseNotCollision:
    def test_two_forms_in_one_document_collapse_to_one_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Both surface forms of one entity in ONE document is the normal
        case (PRODUCT §5 probe 6): a build-time collapse to the deterministic
        highest-confidence survivor — never a collision, never a DELETE."""
        flow = fresh_flow_module()
        sd_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, "sd:doc.md")
        low = _candidate(flow, "CYE 14001", "certification", 0.6, sd_id=sd_id)
        high = _candidate(flow, "CYE14001", "certification", 0.9, sd_id=sd_id)

        class _Resolved:
            def canonical_of(self, name: str) -> str:
                return "cye 14001"

        infos: list[str] = []
        monkeypatch.setattr(
            flow._logger, "info", lambda msg, *a: infos.append(str(msg))
        )
        em = _declare(
            flow, [low, high], [], resolved_by_type={"certification": _Resolved()}
        )

        assert len(em.rows) == 1, f"one row per natural key: {em.rows!r}"
        row = em.rows[0]
        assert row["canonical_name"] == "cye 14001"
        assert row["entity_name"] == "CYE14001", (
            "survivor is the highest-confidence candidate"
        )
        collapse_events = [
            json.loads(m) for m in infos if "mention_collapsed" in m
        ]
        assert collapse_events and collapse_events[0]["collapsed_count"] == 1, (
            "the collapse must be observable (bl-225 honesty rule)"
        )
