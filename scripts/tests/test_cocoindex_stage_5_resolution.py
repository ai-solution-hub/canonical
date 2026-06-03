"""Real-body regression coverage for ``stage_5._run_stage_5_resolution`` (bl-225).

WHY THIS FILE EXISTS (the seam-patch gap that shipped bl-225)
-------------------------------------------------------------
The sibling flow suites (``test_cocoindex_flow_failure_mode.py``,
``test_cocoindex_flow_live_ingest.py``) PATCH ``_run_stage_5_resolution`` OUT
(``monkeypatch.setattr(flow, "_run_stage_5_resolution", _fake_stage_5)``) — so
the REAL post-pass body had ZERO Python unit coverage. That is exactly why
bl-225 reached the live Path-B burn (op ``7af673af``):

    asyncpg.exceptions.UniqueViolationError: duplicate key value violates
    unique constraint
    "entity_mentions_canonical_name_entity_type_content_item_id_key"
    DETAIL: Key (canonical_name, entity_type, content_item_id)=
      (environmental information regulations 2004, regulation, 077b27e7-...)
      already exists.

ROOT CAUSE: ``resolve_entities`` resolves over a NAME SET, agnostic of
``content_item_id``. When TWO DISTINCT per-doc canonicals in the SAME document
(e.g. ``"eir 2004"`` + ``"environmental information regulations 2004"``)
resolve to the SAME canonical, the OLD Step-6 issued TWO row-by-row UPDATEs
setting both rows to that canonical → the second collided with the first on
``UNIQUE(canonical_name, entity_type, content_item_id)`` (migration
20260416102457:4363) and crashed the cocoindex update thread.

THE FIX (this file proves it): Step 5 groups by the POST-resolution natural key
``(content_item_id, entity_type, resolved)`` and collapses each collision group
to a single survivor (highest confidence, then smallest id — mirroring the DB
function ``delete_duplicate_entity_mentions`` ``ORDER BY confidence DESC NULLS
LAST``). Step 6 DELETEs the losers FIRST, then UPDATEs survivors — both
op_id-scoped.

WHAT THIS FILE PROVES
---------------------
The fake asyncpg pool/conn MODELS the unique constraint in memory: an UPDATE
that would create a duplicate ``(canonical_name, entity_type, content_item_id)``
RAISES ``asyncpg.exceptions.UniqueViolationError`` — exactly as production did.
So this is a TRUE regression: run the OLD row-by-row-UPDATE body against this
fixture and the fake raises; run the FIXED collapse body and it completes.

  * ``test_collapse_no_update_needed`` — two distinct canonicals collapse onto
    a target the survivor ALREADY holds → 0 UPDATEs, 1 DELETE, no collision.
  * ``test_collapse_with_survivor_update`` — the survivor must be UPDATEd INTO
    a canonical currently held by the loser → exercises the DELETE-FIRST
    ordering (UPDATE-first would transiently collide) → 1 UPDATE, 1 DELETE.

The resolver chain is stubbed at the SOURCE modules the function lazy-imports
(``_coco_api.resolve_entities`` / ``entity_embedder.KhEntityEmbedder`` /
``pair_resolver.KhPairResolver``) so no faiss / LiteLLM / anthropic / network is
touched.

Async tests follow the repo convention (no pytest-asyncio plugin): drive the
coroutine via ``asyncio.run`` inside a sync test function.

References:
- ``docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md`` — Inv-5, Inv-11,
  Inv-20.
- ``supabase/migrations/20260416102457_pre_squash_reconciliation.sql`` L460-490
  (``delete_duplicate_entity_mentions``) — the survivor policy this mirrors.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest


# ── Inert stub for asyncpg ────────────────────────────────────────────────────
#
# ``stage_5`` references ``asyncpg`` only under ``TYPE_CHECKING`` (module-scope
# annotations), but the fake conn below must RAISE the REAL
# ``asyncpg.exceptions.UniqueViolationError`` to model the DB constraint. asyncpg
# is a transitive runtime dep not installed at test time, so register a minimal
# stub exposing an ``exceptions.UniqueViolationError`` subclass of Exception.


def _install_asyncpg_stub() -> type[Exception]:
    """Register an inert ``asyncpg`` stub carrying a real exception class.

    If a sibling test already installed a bare-MagicMock ``asyncpg`` (e.g.
    ``test_pair_resolver.py`` via ``_stub_module``), its ``.exceptions`` is a
    MagicMock attribute — NOT raisable. We force a concrete exception subclass
    onto whatever ``asyncpg`` object is resident so ``raise`` / ``except`` work.
    """

    class _UniqueViolationError(Exception):
        """Stand-in for ``asyncpg.exceptions.UniqueViolationError``."""

    asyncpg_mod = sys.modules.get("asyncpg")
    if asyncpg_mod is None:
        asyncpg_mod = MagicMock(name="asyncpg")
        sys.modules["asyncpg"] = asyncpg_mod

    exceptions_mod = sys.modules.get("asyncpg.exceptions")
    if exceptions_mod is None or not isinstance(
        getattr(exceptions_mod, "UniqueViolationError", None), type
    ):
        exceptions_mod = MagicMock(name="asyncpg.exceptions")
        exceptions_mod.UniqueViolationError = _UniqueViolationError
        sys.modules["asyncpg.exceptions"] = exceptions_mod
        asyncpg_mod.exceptions = exceptions_mod

    return exceptions_mod.UniqueViolationError  # type: ignore[no-any-return]


_UNIQUE_VIOLATION = _install_asyncpg_stub()


# ── Fixtures: the two colliding rows from the live burn ───────────────────────

_CONTENT_ITEM_ID = uuid.UUID("077b27e7-0000-4000-8000-000000000001")
_ENTITY_TYPE = "regulation"
_PER_DOC_SHORT = "eir 2004"
_PER_DOC_LONG = "environmental information regulations 2004"
# The cross-document canonical both per-doc names resolve to.
_RESOLVED = "environmental information regulations 2004"


@dataclass
class _Row:
    """One in-memory ``entity_mentions`` row the fake conn tracks."""

    id: uuid.UUID
    canonical_name: str
    entity_type: str
    content_item_id: uuid.UUID
    confidence: float | None


# ── Fake asyncpg pool / conn that MODELS the unique constraint ────────────────


class _FakeConn:
    """In-memory ``entity_mentions`` store enforcing the unique constraint.

    Holds rows keyed by id. ``execute`` applies the Stage-6 DELETE / UPDATE to
    the store and RAISES ``UniqueViolationError`` if an UPDATE would create a
    duplicate ``(canonical_name, entity_type, content_item_id)`` — modelling
    ``entity_mentions_canonical_name_entity_type_content_item_id_key``. This is
    what makes the test a TRUE bl-225 regression: the OLD row-by-row body trips
    this raise; the FIXED collapse body never does.
    """

    def __init__(self, rows: list[_Row]) -> None:
        self.rows: dict[uuid.UUID, _Row] = {r.id: r for r in rows}
        self.deleted_ids: list[uuid.UUID] = []
        self.updated: list[tuple[uuid.UUID, str]] = []

    def _natural_key(self, row: _Row) -> tuple[str, str, uuid.UUID]:
        return (row.canonical_name, row.entity_type, row.content_item_id)

    @asynccontextmanager
    async def transaction(self):  # type: ignore[no-untyped-def]
        # The fake applies mutations eagerly (no rollback modelling needed —
        # the production transaction is for atomicity, and the test asserts the
        # FINAL committed state). A raise inside the body propagates out, which
        # is exactly the bl-225 failure surface.
        yield

    async def execute(self, query: str, *args: object) -> str:
        if query.startswith("DELETE FROM public.entity_mentions"):
            # DELETE ... WHERE id = ANY($1::uuid[]) AND op_id = $2
            ids: list[uuid.UUID] = list(args[0])  # type: ignore[arg-type]
            for row_id in ids:
                if row_id in self.rows:
                    del self.rows[row_id]
                    self.deleted_ids.append(row_id)
            return "DELETE"

        if query.startswith("UPDATE public.entity_mentions"):
            # UPDATE ... SET canonical_name = $1 WHERE id = $2 AND op_id = $3
            new_canonical = args[0]
            row_id = args[1]
            assert isinstance(row_id, uuid.UUID), (
                "row id bind must be a native uuid.UUID (asyncpg-strict typing)"
            )
            target = self.rows[row_id]  # type: ignore[index]
            prospective = _Row(
                id=target.id,
                canonical_name=str(new_canonical),
                entity_type=target.entity_type,
                content_item_id=target.content_item_id,
                confidence=target.confidence,
            )
            new_key = self._natural_key(prospective)
            for other_id, other in self.rows.items():
                if other_id != row_id and self._natural_key(other) == new_key:
                    # This is the bl-225 collision: another row already holds
                    # the (canonical_name, entity_type, content_item_id) key.
                    raise _UNIQUE_VIOLATION(
                        "duplicate key value violates unique constraint "
                        '"entity_mentions_canonical_name_entity_type_'
                        'content_item_id_key"'
                    )
            self.rows[row_id] = prospective  # type: ignore[index]
            self.updated.append((target.id, str(new_canonical)))
            return "UPDATE 1"

        raise AssertionError(f"unexpected execute query: {query!r}")


class _FakePool:
    """In-memory ``asyncpg.Pool`` stand-in.

    ``fetch`` answers the read queries the post-pass issues: the
    ``entity_aliases`` preload (returns []), the run's ``entity_mentions``
    SELECT (returns the fixture rows as dict-like records), and — ID-81 PC-6 —
    the op-agnostic existing-canonical roster SELECT
    (``SELECT DISTINCT canonical_name ... WHERE entity_type = $1 AND (...)``).
    ``acquire()`` yields the shared ``_FakeConn`` as an async context manager
    (matching the real pool semantic that all connections back the same
    database).

    ``seed_rows`` (ID-81 Inv-6 / Inv-8) is an in-memory stand-in for the
    op-agnostic body of ``public.entity_mentions`` (prior-run rows AND NULL-op_id
    app-side rows — the stub does NOT model op_id because the PC-6 reader is
    op-agnostic by design). Each entry is ``(canonical_name, entity_type)``. The
    stub MODELS the PC-6 query's two predicates WITHOUT executing SQL (no live
    pg_trgm): ``WHERE entity_type = $1`` (Inv-8 scoping) AND the candidate
    prefilter (exact case-fold OR a trigram-plausibility stand-in). This keeps
    the test honest about entity_type scoping and the membership semantics the
    reader guarantees.
    """

    def __init__(
        self,
        conn: _FakeConn,
        seed_rows: list[tuple[str, str]] | None = None,
    ) -> None:
        self.conn = conn
        # Op-agnostic existing-canonical corpus: (canonical_name, entity_type).
        self.seed_rows: list[tuple[str, str]] = seed_rows or []

    @staticmethod
    def _prefilter_match(canonical: str, probe_lower: list[str]) -> bool:
        """Trigram-plausibility stand-in for the PC-6 prefilter (NO live SQL).

        Models the two SQL arms together: exact case-fold equality
        (``lower(canonical_name) = ANY($3)``) OR a lexical near-match standing
        in for ``canonical_name OPERATOR(extensions.%) ANY($2)``. The trigram
        arm is approximated by case-insensitive substring overlap in EITHER
        direction — sufficient to exercise the reader's set-membership contract
        without a pg_trgm-backed database.
        """
        c_lower = canonical.lower()
        for name in probe_lower:
            if c_lower == name or name in c_lower or c_lower in name:
                return True
        return False

    async def fetch(self, query: str, *args: object) -> list[dict]:
        if "FROM public.entity_aliases" in query:
            return []  # no aliases active
        if "SELECT DISTINCT canonical_name" in query:
            # ID-81 PC-6 reader: op-agnostic existing-canonical roster.
            # Binds: $1 = entity_type, $2 = probe (run names), $3 = lowered probe.
            entity_type = args[0]
            probe_lower = [str(n) for n in args[2]]  # already-lowered in reader
            seen: set[str] = set()
            out: list[dict] = []
            for canonical, seed_type in self.seed_rows:
                if seed_type != entity_type:
                    continue  # Inv-8: entity_type-scoped (WHERE entity_type = $1)
                if not self._prefilter_match(canonical, probe_lower):
                    continue  # candidate prefilter (Inv-1/§4 PERF)
                if canonical in seen:
                    continue  # SELECT DISTINCT
                seen.add(canonical)
                out.append({"canonical_name": canonical})
            return out
        if "FROM public.entity_mentions" in query:
            # Mirror _select_run_entity_mentions: id, canonical_name,
            # entity_type, content_item_id, confidence.
            return [
                {
                    "id": r.id,
                    "canonical_name": r.canonical_name,
                    "entity_type": r.entity_type,
                    "content_item_id": r.content_item_id,
                    "confidence": r.confidence,
                }
                for r in self.conn.rows.values()
            ]
        raise AssertionError(f"unexpected fetch query: {query!r}")

    def acquire(self) -> object:
        conn = self.conn

        @asynccontextmanager
        async def _acquire():  # type: ignore[no-untyped-def]
            yield conn

        return _acquire()


# ── Stubs for the resolver chain (lazy-imported INSIDE the function) ──────────


class _FakeResolved:
    """``ResolvedEntities``-like object: ``canonical_of`` collapses both per-doc
    names onto the single cross-document canonical.

    Mirrors cocoindex 1.0.3 ``ResolvedEntities.canonical_of(name) -> str``
    (raises KeyError for unknown; never returns None)."""

    def __init__(self, mapping: dict[str, str]) -> None:
        self._mapping = mapping

    def canonical_of(self, name: str) -> str:
        return self._mapping[name]


def _stub_resolver_chain(
    monkeypatch: pytest.MonkeyPatch, mapping: dict[str, str]
) -> None:
    """Patch the three resolver collaborators at their SOURCE modules.

    ``_run_stage_5_resolution`` lazy-imports each inside the function body, so
    patching the source-module attribute is what the running code resolves.
    """
    import scripts.cocoindex_pipeline._coco_api as coco_api
    import scripts.cocoindex_pipeline.entity_embedder as entity_embedder
    import scripts.cocoindex_pipeline.pair_resolver as pair_resolver

    async def _fake_resolve_entities(names, *, embedder, resolve_pair):  # type: ignore[no-untyped-def]
        # Agnostic of embedder / resolve_pair (constructed but unused here —
        # the collapse is what we exercise). Returns a resolver mapping every
        # input name to its cross-document canonical.
        return _FakeResolved(mapping)

    monkeypatch.setattr(coco_api, "resolve_entities", _fake_resolve_entities)

    class _StubEmbedder:
        def __init__(self, *a: object, **k: object) -> None: ...

    class _StubPairResolver:
        def __init__(self, *a: object, **k: object) -> None: ...

    monkeypatch.setattr(entity_embedder, "KhEntityEmbedder", _StubEmbedder)
    monkeypatch.setattr(pair_resolver, "KhPairResolver", _StubPairResolver)


# ── Trivial flow-side stand-ins ──────────────────────────────────────────────


class _StubStageCounter:
    """Structural ``_FlowStageCounter`` stand-in (``increment(stage)``)."""

    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    def increment(self, stage: str) -> None:
        self.counts[stage] = self.counts.get(stage, 0) + 1


@dataclass(frozen=True)
class _StubMeta:
    """Structural ``FlowRunMeta`` stand-in exposing ``.op_id``."""

    op_id: uuid.UUID


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_collapse_no_update_needed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two distinct per-doc canonicals in one doc collapse onto a target the
    higher-confidence survivor ALREADY holds → 0 UPDATEs, 1 DELETE, no crash.

    This is the EXACT live-burn fixture (op 7af673af): ``"eir 2004"`` (0.7) +
    ``"environmental information regulations 2004"`` (0.9), same content_item +
    entity_type. The OLD body issued two UPDATEs to the resolved canonical; the
    second collided and raised UniqueViolationError. The FIXED body keeps the
    0.9 survivor (which already holds the target) and DELETEs the 0.7 loser.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    short_id = uuid.UUID("00000000-0000-4000-8000-0000000000aa")
    long_id = uuid.UUID("00000000-0000-4000-8000-0000000000bb")
    rows = [
        _Row(short_id, _PER_DOC_SHORT, _ENTITY_TYPE, _CONTENT_ITEM_ID, 0.7),
        _Row(long_id, _PER_DOC_LONG, _ENTITY_TYPE, _CONTENT_ITEM_ID, 0.9),
    ]
    conn = _FakeConn(rows)
    pool = _FakePool(conn)

    _stub_resolver_chain(
        monkeypatch,
        {_PER_DOC_SHORT: _RESOLVED, _PER_DOC_LONG: _RESOLVED},
    )

    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    # No collision raised — the collapse is the whole point.
    # EXACTLY ONE row survives for (resolved, regulation, content_item).
    assert len(conn.rows) == 1, "exactly one survivor row must remain"
    survivor = next(iter(conn.rows.values()))
    assert survivor.id == long_id, (
        "survivor must be the 0.9-confidence row (highest confidence wins, "
        "mirroring delete_duplicate_entity_mentions ORDER BY confidence DESC)"
    )
    assert survivor.canonical_name == _RESOLVED
    assert survivor.confidence == 0.9

    # The 0.7 loser was DELETEd.
    assert conn.deleted_ids == [short_id]

    # Survivor already held the target canonical → NO UPDATE fired.
    assert conn.updated == []
    # Return value counts survivors whose canonical CHANGED (Inv-11) → 0 here.
    assert changed == 0
    # Counter only bumps per UPDATE → 0 here.
    assert counter.counts.get("entity_resolution", 0) == 0


def test_collapse_with_survivor_update(monkeypatch: pytest.MonkeyPatch) -> None:
    """The survivor must be UPDATEd INTO a canonical the loser currently holds
    → exercises DELETE-FIRST ordering → 1 UPDATE + 1 DELETE, no collision.

    Here the HIGHER-confidence row is the SHORT per-doc canonical
    (``"eir 2004"``, 0.9) and the lower-confidence row already holds the
    resolved long canonical (0.7). Both resolve to the long canonical, so the
    survivor (the 0.9 short row) must UPDATE its canonical_name TO the long
    value — which the loser currently occupies. DELETE-FIRST removes the loser
    before the UPDATE so no transient collision occurs (UPDATE-first would
    raise UniqueViolationError on the fake, mirroring production).
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    survivor_id = uuid.UUID("00000000-0000-4000-8000-0000000000cc")  # 0.9 short
    loser_id = uuid.UUID("00000000-0000-4000-8000-0000000000dd")  # 0.7 long
    rows = [
        _Row(survivor_id, _PER_DOC_SHORT, _ENTITY_TYPE, _CONTENT_ITEM_ID, 0.9),
        _Row(loser_id, _PER_DOC_LONG, _ENTITY_TYPE, _CONTENT_ITEM_ID, 0.7),
    ]
    conn = _FakeConn(rows)
    pool = _FakePool(conn)

    _stub_resolver_chain(
        monkeypatch,
        {_PER_DOC_SHORT: _RESOLVED, _PER_DOC_LONG: _RESOLVED},
    )

    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    # Exactly one survivor — the 0.9 short row, now holding the long canonical.
    assert len(conn.rows) == 1
    survivor = next(iter(conn.rows.values()))
    assert survivor.id == survivor_id, "0.9-confidence row survives"
    assert survivor.canonical_name == _RESOLVED, (
        "survivor's canonical_name UPDATEd to the resolved cross-doc value"
    )

    # The 0.7 loser was DELETEd FIRST (so the survivor's UPDATE did not collide).
    assert conn.deleted_ids == [loser_id]
    # Exactly one UPDATE landed on the survivor.
    assert conn.updated == [(survivor_id, _RESOLVED)]
    # Return value = survivors whose canonical changed = 1.
    assert changed == 1
    # Counter bumped once per UPDATE.
    assert counter.counts.get("entity_resolution", 0) == 1


def test_zero_confidence_survivor_not_treated_as_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A legitimate 0.0 confidence must NOT be treated as missing.

    Survivor selection uses ``-(conf if conf is not None else -1.0)`` — an
    explicit ``is not None`` check, NOT ``conf or``. So a row with confidence
    0.0 still ranks ABOVE a row with confidence None (None → sentinel -1.0).
    This guards the subtle ``0.0`` falsy-trap in the survivor policy.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    zero_conf_id = uuid.UUID("00000000-0000-4000-8000-0000000000ee")  # 0.0
    none_conf_id = uuid.UUID("00000000-0000-4000-8000-0000000000ff")  # None
    rows = [
        _Row(zero_conf_id, _PER_DOC_SHORT, _ENTITY_TYPE, _CONTENT_ITEM_ID, 0.0),
        _Row(none_conf_id, _PER_DOC_LONG, _ENTITY_TYPE, _CONTENT_ITEM_ID, None),
    ]
    conn = _FakeConn(rows)
    pool = _FakePool(conn)

    _stub_resolver_chain(
        monkeypatch,
        {_PER_DOC_SHORT: _RESOLVED, _PER_DOC_LONG: _RESOLVED},
    )

    asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=_StubStageCounter(),  # type: ignore[arg-type]
        )
    )

    # The 0.0-confidence row survives (0.0 > None-as-sentinel -1.0); the
    # None-confidence row is the loser.
    assert len(conn.rows) == 1
    survivor = next(iter(conn.rows.values()))
    assert survivor.id == zero_conf_id, (
        "0.0 confidence must rank above None — explicit is-not-None check"
    )
    assert conn.deleted_ids == [none_conf_id]


# ── ID-81 PC-6: _select_existing_canonical_roster (op-agnostic seed reader) ───


def test_roster_is_op_agnostic_prior_run_and_null_op_canonicals() -> None:
    """Inv-6: the roster for an entity_type includes BOTH a prior-run canonical
    AND a NULL-op_id (app-side) canonical of the matching type.

    The PC-6 reader is op-AGNOSTIC: it reads DISTINCT canonical_name across ALL
    op_ids — prior completed runs AND app-side writes (``classifyContent`` /
    Admin curation, which write NULL ``op_id``). The seed corpus below models
    both provenances; the reader must surface both as eligible chaining targets
    for the in-flight run's near-matching names. Assertion is SET-MEMBERSHIP
    (``in roster``), NOT identity — a name both 'existing' and 'in this run' is
    simply is_existing=True (Inv-7 self-membership caveat).
    """
    from scripts.cocoindex_pipeline.stage_5 import (
        _select_existing_canonical_roster,
    )

    entity_type = "organisation"
    # Seed corpus spans both op provenances (the reader cannot tell them apart —
    # that is the point of op-AGNOSTIC). "Acme Corporation" stands in for a
    # prior-run canonical; "Globex Limited" for a NULL-op_id app-side canonical.
    seed_rows = [
        ("Acme Corporation", "organisation"),  # prior-run canonical
        ("Globex Limited", "organisation"),  # NULL-op_id app-side canonical
        ("Initech", "organisation"),  # existing but NOT near any run name
    ]
    pool = _FakePool(_FakeConn([]), seed_rows=seed_rows)

    # This run mentions near-matches of the two target canonicals (case variant
    # / substring) — both must be recalled by the prefilter and returned.
    run_names = {"acme corporation", "globex limited"}

    roster = asyncio.run(
        _select_existing_canonical_roster(
            pool,  # type: ignore[arg-type]
            entity_type,
            run_names,
        )
    )

    assert isinstance(roster, set), "reader returns a set[str] for O(1) membership"
    # Inv-6: both provenances are eligible chaining targets (set-membership).
    assert "Acme Corporation" in roster, (
        "prior-run canonical must be an eligible chaining target (op-agnostic)"
    )
    assert "Globex Limited" in roster, (
        "NULL-op_id app-side canonical must be an eligible chaining target"
    )
    # The non-near existing is correctly prefiltered OUT (Inv-1/§4 PERF bound).
    assert "Initech" not in roster


def test_roster_empty_run_names_short_circuits() -> None:
    """The reader short-circuits to an empty set for an empty run-name set
    (no DB round-trip) — guards the ``if not run_names: return set()`` arm."""
    from scripts.cocoindex_pipeline.stage_5 import (
        _select_existing_canonical_roster,
    )

    pool = _FakePool(_FakeConn([]), seed_rows=[("Acme Corporation", "organisation")])
    roster = asyncio.run(
        _select_existing_canonical_roster(
            pool,  # type: ignore[arg-type]
            "organisation",
            set(),
        )
    )
    assert roster == set()


def test_roster_is_entity_type_scoped() -> None:
    """Inv-8: the roster is entity_type-scoped — an ``organisation`` "Cisco"
    seed is ABSENT from a ``technology`` batch's roster.

    The PC-6 reader binds ``WHERE entity_type = $1``, so a same-string canonical
    of a DIFFERENT type is never offered as a chaining target. A ``technology``
    "Cisco" mention therefore would not chain under the ``organisation`` "Cisco"
    canonical — the two namespaces stay independent (mirrors the entity_type-keyed
    KhPairResolver cache, ID-53 P-OQ3).
    """
    from scripts.cocoindex_pipeline.stage_5 import (
        _select_existing_canonical_roster,
    )

    # "Cisco" exists as BOTH an organisation and (separately) a technology.
    seed_rows = [
        ("Cisco", "organisation"),  # the company
        ("Cisco", "technology"),  # the product line
        ("Juniper", "organisation"),  # organisation-only — must not leak
    ]
    pool = _FakePool(_FakeConn([]), seed_rows=seed_rows)

    # Resolving a TECHNOLOGY batch whose run names near-match "Cisco".
    tech_roster = asyncio.run(
        _select_existing_canonical_roster(
            pool,  # type: ignore[arg-type]
            "technology",
            {"cisco"},
        )
    )
    # Only the technology "Cisco" is eligible; the organisation "Cisco" is scoped
    # OUT, and the organisation-only "Juniper" never appears in a tech roster.
    assert "Cisco" in tech_roster, "technology Cisco IS in the technology roster"
    assert "Juniper" not in tech_roster, (
        "an organisation-only canonical must never leak into a technology roster"
    )

    # And the converse: resolving an ORGANISATION batch sees the organisation
    # "Cisco" and "Juniper" but the technology rows are scoped out by $1.
    org_roster = asyncio.run(
        _select_existing_canonical_roster(
            pool,  # type: ignore[arg-type]
            "organisation",
            {"cisco", "juniper"},
        )
    )
    assert org_roster == {"Cisco", "Juniper"}
