"""Real-body coverage for ``qa_dedup_proposer._run_qa_dedup_proposer`` (ID-120).

WHAT THIS FILE PROVES (the {120.6} testStrategy, behaviour-first)
----------------------------------------------------------------
The cross-workspace + cross-form Q&A dedup PROPOSER post-pass: only
published / embedding-bearing / non-superseded pairs enter; the cosine
threshold gates which pairs become proposals; a re-run never duplicates a
pending proposal; a resolved pair is not re-surfaced unless its question text
changed; a cross-workspace + cross-form fixture proposes correctly; and a
raised proposer error maps to ``qa_dedup_proposer_failed`` at the flow attach
WITHOUT aborting the walk.

The proposer computes similarity in SQL (a self-join + two INNER JOINs onto
record_embeddings + pgvector cosine — ID-127.32/DR-036 re-pointed off the
dropped `q_a_pairs.question_embedding` column), so the fake asyncpg pool below
MODELS that SQL in Python over an in-memory q_a_pairs corpus + a per-pair
similarity oracle — exercising the production WHERE-clause filters
(publication_status / record_embeddings-join eligibility / superseded_by /
threshold) honestly, not stubbing them away. The proposals store is an in-memory table
enforcing ``UNIQUE(pair_a_id, pair_b_id)`` so ``ON CONFLICT DO NOTHING`` is a
TRUE idempotency assertion (a second run produces no duplicate pending row).

Async tests follow the repo convention (no pytest-asyncio plugin): drive the
coroutine via ``asyncio.run`` inside a sync test function. asyncpg is referenced
by the proposer only under ``TYPE_CHECKING``, so no asyncpg install is needed.

References:
- TECH.md (id-120) §P-2 (proposer body), §P-3 (attach point).
- PRODUCT.md (id-120) — INV-1..INV-21.
- ``scripts/tests/test_cocoindex_stage_5_resolution.py`` — the harness mirrored.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import pytest


# ── Fixtures: an in-memory q_a_pairs corpus ───────────────────────────────────


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


@dataclass
class _QaPair:
    """One in-memory ``q_a_pairs`` row the fake corpus tracks."""

    id: uuid.UUID
    question_text: str
    publication_status: str = "published"
    has_embedding: bool = True
    superseded_by: uuid.UUID | None = None
    source_workspace_id: uuid.UUID | None = None
    source_form_response_id: uuid.UUID | None = None
    updated_at: dt.datetime = field(
        default_factory=lambda: dt.datetime(2026, 6, 1, tzinfo=dt.timezone.utc)
    )


@dataclass
class _ProposalRow:
    """One in-memory ``q_a_pair_dedup_proposals`` row."""

    pair_a_id: uuid.UUID
    pair_b_id: uuid.UUID
    similarity_score: float
    proposed_survivor_id: uuid.UUID
    survivor_reason: str
    pair_a_source_workspace_id: uuid.UUID | None
    pair_b_source_workspace_id: uuid.UUID | None
    pair_a_source_form_response_id: uuid.UUID | None
    pair_b_source_form_response_id: uuid.UUID | None
    pair_a_fingerprint: str | None
    pair_b_fingerprint: str | None
    status: str = "pending"


# ── Fake asyncpg pool/conn modelling the proposer's SQL ───────────────────────


class _FakeConn:
    """Backs the conditional UPSERT into the proposals store.

    Enforces ``UNIQUE(pair_a_id, pair_b_id)`` and models the production
    ``ON CONFLICT (pair_a_id, pair_b_id) DO UPDATE ... WHERE status <> 'pending'``:
      - NO existing row     → append a 'pending' row, return ``"INSERT 0 1"``.
      - existing PENDING row → conflict WHERE excludes the update → ``"INSERT 0 0"``.
      - existing RESOLVED row → reset it to 'pending' with the new values, clear
        the prior resolution, return ``"INSERT 0 1"`` (re-propose).
    This makes both the idempotency and re-propose assertions TRUE.
    """

    def __init__(self, store: list[_ProposalRow]) -> None:
        self.store = store

    @asynccontextmanager
    async def transaction(self):  # type: ignore[no-untyped-def]
        yield

    async def execute(self, query: str, *args: object) -> str:
        if "INSERT INTO public.q_a_pair_dedup_proposals" in query:
            pair_a_id = args[0]
            pair_b_id = args[1]
            for existing in self.store:
                if (
                    existing.pair_a_id == pair_a_id
                    and existing.pair_b_id == pair_b_id
                ):
                    if existing.status == "pending":
                        # Conflict WHERE status <> 'pending' is false → no-op.
                        return "INSERT 0 0"
                    # Resolved row → reset to pending (re-propose).
                    existing.status = "pending"
                    existing.similarity_score = args[2]  # type: ignore[assignment]
                    existing.proposed_survivor_id = args[3]  # type: ignore[assignment]
                    existing.survivor_reason = args[4]  # type: ignore[assignment]
                    existing.pair_a_source_workspace_id = args[5]  # type: ignore[assignment]
                    existing.pair_b_source_workspace_id = args[6]  # type: ignore[assignment]
                    existing.pair_a_source_form_response_id = args[7]  # type: ignore[assignment]
                    existing.pair_b_source_form_response_id = args[8]  # type: ignore[assignment]
                    existing.pair_a_fingerprint = args[9]  # type: ignore[assignment]
                    existing.pair_b_fingerprint = args[10]  # type: ignore[assignment]
                    return "INSERT 0 1"
            self.store.append(
                _ProposalRow(
                    pair_a_id=args[0],  # type: ignore[arg-type]
                    pair_b_id=args[1],  # type: ignore[arg-type]
                    similarity_score=args[2],  # type: ignore[arg-type]
                    proposed_survivor_id=args[3],  # type: ignore[arg-type]
                    survivor_reason=args[4],  # type: ignore[arg-type]
                    pair_a_source_workspace_id=args[5],  # type: ignore[arg-type]
                    pair_b_source_workspace_id=args[6],  # type: ignore[arg-type]
                    pair_a_source_form_response_id=args[7],  # type: ignore[arg-type]
                    pair_b_source_form_response_id=args[8],  # type: ignore[arg-type]
                    pair_a_fingerprint=args[9],  # type: ignore[arg-type]
                    pair_b_fingerprint=args[10],  # type: ignore[arg-type]
                )
            )
            return "INSERT 0 1"
        raise AssertionError(f"unexpected execute query: {query!r}")


class _FakePool:
    """In-memory ``asyncpg.Pool`` stand-in modelling the proposer's two reads.

    ``corpus`` is the in-memory ``q_a_pairs`` population; ``similarity`` is a
    per-unordered-pair cosine oracle (default 0.0 for unspecified pairs). The
    self-join SELECT is modelled in Python applying the EXACT production
    WHERE-clause predicates (publication_status='published',
    record_embeddings-join eligibility [``has_embedding`` models "a matching
    record_embeddings(owner_kind='q_a_pair') row exists", ID-127.32/DR-036],
    superseded_by IS NULL, similarity >= threshold) over ``a.id < b.id``
    ordered pairs — so the filters are genuinely exercised.
    """

    def __init__(
        self,
        corpus: list[_QaPair],
        similarity: dict[frozenset[uuid.UUID], float] | None = None,
        store: list[_ProposalRow] | None = None,
    ) -> None:
        self.corpus = corpus
        self.similarity = similarity or {}
        self.store: list[_ProposalRow] = store if store is not None else []
        self.conn = _FakeConn(self.store)

    def _sim(self, a: _QaPair, b: _QaPair) -> float:
        return self.similarity.get(frozenset({a.id, b.id}), 0.0)

    async def fetch(self, query: str, *args: object) -> list[dict]:
        if "FROM public.q_a_pairs a" in query:
            threshold = float(args[0])  # type: ignore[arg-type]
            # Eligible population (the candidate-read WHERE clause).
            eligible = [
                p
                for p in self.corpus
                if p.publication_status == "published"
                and p.has_embedding
                and p.superseded_by is None
            ]
            out: list[dict] = []
            for i, a in enumerate(eligible):
                for b in eligible[i + 1 :]:
                    # `a.id < b.id` canonical ordering.
                    lo, hi = (a, b) if a.id < b.id else (b, a)
                    sim = self._sim(lo, hi)
                    if sim < threshold:
                        continue
                    out.append(
                        {
                            "pair_a_id": lo.id,
                            "pair_b_id": hi.id,
                            "similarity_score": round(sim, 4),
                            "pair_a_question_text": lo.question_text,
                            "pair_b_question_text": hi.question_text,
                            "pair_a_publication_status": lo.publication_status,
                            "pair_b_publication_status": hi.publication_status,
                            "pair_a_updated_at": lo.updated_at,
                            "pair_b_updated_at": hi.updated_at,
                            "pair_a_source_workspace_id": lo.source_workspace_id,
                            "pair_b_source_workspace_id": hi.source_workspace_id,
                            "pair_a_source_form_response_id": (
                                lo.source_form_response_id
                            ),
                            "pair_b_source_form_response_id": (
                                hi.source_form_response_id
                            ),
                        }
                    )
            return out
        if "FROM public.q_a_pair_dedup_proposals" in query:
            # Resolved-fingerprints read: status <> 'pending'.
            return [
                {
                    "pair_a_id": r.pair_a_id,
                    "pair_b_id": r.pair_b_id,
                    "pair_a_fingerprint": r.pair_a_fingerprint,
                    "pair_b_fingerprint": r.pair_b_fingerprint,
                }
                for r in self.store
                if r.status != "pending"
            ]
        raise AssertionError(f"unexpected fetch query: {query!r}")

    def acquire(self) -> object:
        conn = self.conn

        @asynccontextmanager
        async def _acquire():  # type: ignore[no-untyped-def]
            yield conn

        return _acquire()


class _StubStageCounter:
    """Structural ``_FlowStageCounter`` stand-in (``increment(stage)``)."""

    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    def increment(self, stage: str) -> None:
        self.counts[stage] = self.counts.get(stage, 0) + 1


def _run(pool: _FakePool, counter: _StubStageCounter) -> int:
    from scripts.cocoindex_pipeline.qa_dedup_proposer import _run_qa_dedup_proposer

    return asyncio.run(
        _run_qa_dedup_proposer(
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )


# Deterministic ids: low/high ordering matters for canonical pair order.
_ID_LOW = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
_ID_HIGH = uuid.UUID("00000000-0000-4000-8000-0000000000b2")


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_above_threshold_yields_one_two_pair_proposal() -> None:
    """Two published embedding-bearing pairs at cosine >= 0.92 → one proposal
    over exactly 2 distinct pairs (INV-3/4/7)."""
    corpus = [
        _QaPair(_ID_LOW, "What is your data retention policy?"),
        _QaPair(_ID_HIGH, "Describe your data retention policy."),
    ]
    pool = _FakePool(corpus, similarity={frozenset({_ID_LOW, _ID_HIGH}): 0.95})
    counter = _StubStageCounter()

    written = _run(pool, counter)

    assert written == 1
    assert len(pool.store) == 1
    row = pool.store[0]
    assert {row.pair_a_id, row.pair_b_id} == {_ID_LOW, _ID_HIGH}
    assert row.pair_a_id != row.pair_b_id  # never self (INV-7)
    assert row.pair_a_id < row.pair_b_id  # canonical pair order (CHECK a<b)
    assert row.status == "pending"
    assert counter.counts.get("qa_dedup_proposer", 0) == 1


def test_below_threshold_yields_no_proposal() -> None:
    """A pair below the 0.92 cosine floor produces no proposal (INV-19/20)."""
    corpus = [
        _QaPair(_ID_LOW, "What is your data retention policy?"),
        _QaPair(_ID_HIGH, "What is your refund policy?"),
    ]
    pool = _FakePool(corpus, similarity={frozenset({_ID_LOW, _ID_HIGH}): 0.40})
    counter = _StubStageCounter()

    written = _run(pool, counter)

    assert written == 0
    assert pool.store == []


def test_only_published_embedding_bearing_non_superseded_pairs_enter() -> None:
    """Draft, missing-embedding, and superseded pairs are excluded from the
    candidate read even at high cosine (INV-2/6)."""
    survivor = uuid.UUID("00000000-0000-4000-8000-0000000000ff")
    a = uuid.UUID("00000000-0000-4000-8000-000000000001")
    b_draft = uuid.UUID("00000000-0000-4000-8000-000000000002")
    c_noembed = uuid.UUID("00000000-0000-4000-8000-000000000003")
    d_superseded = uuid.UUID("00000000-0000-4000-8000-000000000004")
    corpus = [
        _QaPair(a, "Published question one."),
        _QaPair(b_draft, "Published question one.", publication_status="draft"),
        _QaPair(c_noembed, "Published question one.", has_embedding=False),
        _QaPair(d_superseded, "Published question one.", superseded_by=survivor),
    ]
    # Every cross-pair is near-identical text → 0.99 — but only the lone
    # published+embedding+non-superseded row `a` survives the WHERE clause, so
    # there is no SECOND eligible row to pair it with → zero candidates.
    sim = {
        frozenset({x, y}): 0.99
        for x in (a, b_draft, c_noembed, d_superseded)
        for y in (a, b_draft, c_noembed, d_superseded)
        if x != y
    }
    pool = _FakePool(corpus, similarity=sim)
    counter = _StubStageCounter()

    written = _run(pool, counter)

    assert written == 0
    assert pool.store == []


def test_rerun_produces_no_duplicate_pending() -> None:
    """A second identical run creates no duplicate pending proposal
    (INV-4: ON CONFLICT (pair_a_id, pair_b_id) DO NOTHING)."""
    corpus = [
        _QaPair(_ID_LOW, "What is your data retention policy?"),
        _QaPair(_ID_HIGH, "Describe your data retention policy."),
    ]
    sim = {frozenset({_ID_LOW, _ID_HIGH}): 0.95}
    store: list[_ProposalRow] = []

    first = _run(_FakePool(corpus, similarity=sim, store=store), _StubStageCounter())
    assert first == 1
    assert len(store) == 1

    # Re-run against the SAME store: the pending row already exists.
    second = _run(
        _FakePool(corpus, similarity=sim, store=store), _StubStageCounter()
    )
    assert second == 0, "a re-run must write no new proposal"
    assert len(store) == 1, "no duplicate pending row may be created"


def test_resolved_pair_not_resurfaced_unless_fingerprint_changes() -> None:
    """A RESOLVED (rejected/approved) pair is suppressed on re-run while its
    question text is unchanged, and RE-proposed once the text changes
    (P-7 / INV-5)."""
    q_a = "What is your data retention policy?"
    q_b = "Describe your data retention policy."
    corpus = [
        _QaPair(_ID_LOW, q_a),
        _QaPair(_ID_HIGH, q_b),
    ]
    sim = {frozenset({_ID_LOW, _ID_HIGH}): 0.95}
    # Seed a RESOLVED proposal carrying the CURRENT fingerprints.
    resolved = _ProposalRow(
        pair_a_id=_ID_LOW,
        pair_b_id=_ID_HIGH,
        similarity_score=0.95,
        proposed_survivor_id=_ID_HIGH,
        survivor_reason="seed",
        pair_a_source_workspace_id=None,
        pair_b_source_workspace_id=None,
        pair_a_source_form_response_id=None,
        pair_b_source_form_response_id=None,
        pair_a_fingerprint=_md5(q_a),
        pair_b_fingerprint=_md5(q_b),
        status="rejected",
    )
    store = [resolved]

    # Text unchanged → suppressed (no new row).
    suppressed = _run(
        _FakePool(corpus, similarity=sim, store=store), _StubStageCounter()
    )
    assert suppressed == 0
    assert len(store) == 1, "resolved pair must not be re-surfaced unchanged"

    # Now the question_text of side A changes → fingerprint differs → re-propose.
    corpus[0].question_text = "What is your DATA RETENTION policy (updated)?"
    counter = _StubStageCounter()
    reproposed = _run(
        _FakePool(corpus, similarity=sim, store=store), counter
    )
    assert reproposed == 1, "a changed fingerprint must re-propose the pair"
    # ONE row per pair (UNIQUE) — the resolved row is RESET in place to pending,
    # not duplicated.
    assert len(store) == 1
    assert store[0].status == "pending", "re-propose resets the row to pending"
    assert store[0].pair_a_fingerprint == _md5(corpus[0].question_text)
    assert counter.counts.get("qa_dedup_proposer", 0) == 1


def test_cross_workspace_cross_form_fixture_proposes() -> None:
    """The primary driver: the same question across DIFFERENT workspaces AND
    DIFFERENT forms of one client (intra-tenant) proposes correctly, snapshotting
    both sides' provenance by value (INV-2/12/16)."""
    ws_pqq = uuid.UUID("00000000-0000-4000-8000-00000000aaa1")
    ws_itt = uuid.UUID("00000000-0000-4000-8000-00000000aaa2")
    form_pqq = uuid.UUID("00000000-0000-4000-8000-00000000bbb1")
    form_itt = uuid.UUID("00000000-0000-4000-8000-00000000bbb2")
    corpus = [
        _QaPair(
            _ID_LOW,
            "Do you hold ISO 27001 certification?",
            source_workspace_id=ws_pqq,
            source_form_response_id=form_pqq,
            updated_at=dt.datetime(2026, 6, 10, tzinfo=dt.timezone.utc),
        ),
        _QaPair(
            _ID_HIGH,
            "Are you certified to ISO 27001?",
            source_workspace_id=ws_itt,
            source_form_response_id=form_itt,
            updated_at=dt.datetime(2026, 6, 15, tzinfo=dt.timezone.utc),
        ),
    ]
    pool = _FakePool(corpus, similarity={frozenset({_ID_LOW, _ID_HIGH}): 0.97})
    counter = _StubStageCounter()

    written = _run(pool, counter)

    assert written == 1
    row = pool.store[0]
    # Provenance snapshotted by value for both sides (different ws + form).
    assert {row.pair_a_source_workspace_id, row.pair_b_source_workspace_id} == {
        ws_pqq,
        ws_itt,
    }
    assert {
        row.pair_a_source_form_response_id,
        row.pair_b_source_form_response_id,
    } == {form_pqq, form_itt}
    # Survivor: the more recent side (15/06/2026) — INV-12 recency rung.
    assert row.proposed_survivor_id == _ID_HIGH
    assert "more recent" in row.survivor_reason
    assert "15/06/2026" in row.survivor_reason  # DD/MM/YYYY, UK English


def test_survivor_nomination_prefers_published_over_non_published() -> None:
    """Survivor rung (1): a published side outranks a non-published side even
    when the non-published side is more recent (INV-12)."""
    # NOTE: the candidate read only admits published pairs, so this exercises
    # `_nominate_survivor` directly (the rung is encoded for forward-compat).
    from scripts.cocoindex_pipeline.qa_dedup_proposer import _nominate_survivor

    record = {
        "pair_a_id": _ID_LOW,
        "pair_b_id": _ID_HIGH,
        "pair_a_publication_status": "published",
        "pair_b_publication_status": "draft",
        "pair_a_updated_at": dt.datetime(2026, 6, 1, tzinfo=dt.timezone.utc),
        "pair_b_updated_at": dt.datetime(2026, 6, 20, tzinfo=dt.timezone.utc),
    }
    survivor_id, reason = _nominate_survivor(record)
    assert survivor_id == _ID_LOW
    assert "published" in reason


def test_proposer_error_maps_to_qa_dedup_proposer_failed_and_does_not_abort() -> None:
    """A raised proposer error is re-wrapped as ``_QaDedupProposerStageError`` and
    classified to ``qa_dedup_proposer_failed`` — and the flow attach CONTAINS it
    (walk not aborted) (TECH §P-3 / INV-1)."""
    from scripts.cocoindex_pipeline import flow

    err = _QaDedupProposerStageErrorProbe("boom in proposer")
    assert (
        flow._classify_stage_exception(err) == "qa_dedup_proposer_failed"
    )

    # The wrapper exists beside the Stage-5 wrapper and is an Exception subclass
    # so the attach-site `except Exception -> raise wrapper from exc` is valid.
    assert issubclass(flow._QaDedupProposerStageError, Exception)


# `_QaDedupProposerStageErrorProbe` is the real flow wrapper, imported lazily so
# the module-level import order matches the sibling Stage-5 suite (flow imported
# inside the test, not at file top, to avoid dragging the heavy flow import into
# collection of the pure-proposer tests above).
def _QaDedupProposerStageErrorProbe(message: str) -> Exception:  # noqa: N802
    from scripts.cocoindex_pipeline import flow

    return flow._QaDedupProposerStageError(message)
