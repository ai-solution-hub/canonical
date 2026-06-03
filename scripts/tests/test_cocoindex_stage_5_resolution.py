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
import json
import sys
import uuid
from contextlib import asynccontextmanager, contextmanager
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
        alias_rows: list[dict[str, str]] | None = None,
    ) -> None:
        self.conn = conn
        # Op-agnostic existing-canonical corpus: (canonical_name, entity_type).
        self.seed_rows: list[tuple[str, str]] = seed_rows or []
        # Active legacy `entity_aliases` rows answering the Inv-10/Inv-12 preload
        # (`SELECT alias, canonical FROM public.entity_aliases WHERE is_active`).
        # The three bl-225 tests + the {81.6}/{81.7} tests default to [] (no
        # aliases active); the Inv-12 test supplies a non-empty list so the
        # alias-preload path is genuinely exercised, not stubbed-away.
        self.alias_rows: list[dict[str, str]] = alias_rows or []

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
            # Active legacy alias rows (default [] — most tests run no aliases).
            # Each row is {"alias": ..., "canonical": ...}; the production
            # `_preload_entity_aliases` builds {alias: canonical} from these.
            return list(self.alias_rows)
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


# ── Op_id-ENFORCING fake conn (Inv-7 runtime strengthening) ───────────────────
#
# The base `_FakeConn` above does NOT model op_id at all: its DELETE/UPDATE
# handlers ignore the `op_id` bind, so a missing `AND op_id` guard in production
# would NOT be caught by a test using it (the guard would only be source-read).
# The Inv-7 strengthening below seeds a REAL foreign-op ROW carrying a DIFFERENT
# op_id and ENFORCES the `op_id = $current` predicate in the handlers, so a
# production regression that dropped `AND op_id` would let the foreign-op row be
# DELETEd/UPDATEd — and the byte-identity assertion would then FAIL. This makes
# the op_id guard runtime-verified, not just source-read (TECH §5 Inv-7).


@dataclass
class _OpRow:
    """An ``entity_mentions`` row that ALSO carries its owning ``op_id``."""

    id: uuid.UUID
    canonical_name: str
    entity_type: str
    content_item_id: uuid.UUID
    confidence: float | None
    op_id: uuid.UUID


class _OpScopedFakeConn:
    """In-memory store whose DELETE/UPDATE ENFORCE the ``op_id = $current`` guard.

    Mirrors ``_FakeConn`` but every row carries an ``op_id`` and the mutation
    handlers honour the production binds: DELETE binds ``(ids, op_id)`` and only
    deletes ids whose row ``op_id`` equals the bound current op; UPDATE binds
    ``(canonical, id, op_id)`` and only mutates when the row's ``op_id`` equals
    the bound op. A foreign-op row (different ``op_id``) is therefore physically
    unreachable — exactly the by-construction Inv-5/Inv-7 guarantee. Also
    enforces the same UNIQUE(canonical_name, entity_type, content_item_id) the
    base conn models, so seeding-induced collapses still cannot collide.
    """

    def __init__(self, rows: list[_OpRow]) -> None:
        self.rows: dict[uuid.UUID, _OpRow] = {r.id: r for r in rows}
        self.deleted_ids: list[uuid.UUID] = []
        self.updated: list[tuple[uuid.UUID, str]] = []

    def _natural_key(self, row: _OpRow) -> tuple[str, str, uuid.UUID]:
        return (row.canonical_name, row.entity_type, row.content_item_id)

    @asynccontextmanager
    async def transaction(self):  # type: ignore[no-untyped-def]
        yield

    async def execute(self, query: str, *args: object) -> str:
        if query.startswith("DELETE FROM public.entity_mentions"):
            # DELETE ... WHERE id = ANY($1::uuid[]) AND op_id = $2
            ids: list[uuid.UUID] = list(args[0])  # type: ignore[arg-type]
            current_op = args[1]
            assert isinstance(current_op, uuid.UUID), (
                "DELETE op_id bind must be a native uuid.UUID (asyncpg-strict)"
            )
            for row_id in ids:
                row = self.rows.get(row_id)
                # ENFORCE `AND op_id = $2`: a row whose op_id differs from the
                # bound current op is NOT matched by the production predicate.
                if row is not None and row.op_id == current_op:
                    del self.rows[row_id]
                    self.deleted_ids.append(row_id)
            return "DELETE"

        if query.startswith("UPDATE public.entity_mentions"):
            # UPDATE ... SET canonical_name = $1 WHERE id = $2 AND op_id = $3
            new_canonical = args[0]
            row_id = args[1]
            current_op = args[2]
            assert isinstance(row_id, uuid.UUID), (
                "row id bind must be a native uuid.UUID (asyncpg-strict typing)"
            )
            assert isinstance(current_op, uuid.UUID), (
                "UPDATE op_id bind must be a native uuid.UUID (asyncpg-strict)"
            )
            target = self.rows.get(row_id)  # type: ignore[arg-type]
            # ENFORCE `AND op_id = $3`: a foreign-op row is never updated.
            if target is None or target.op_id != current_op:
                return "UPDATE 0"
            prospective = _OpRow(
                id=target.id,
                canonical_name=str(new_canonical),
                entity_type=target.entity_type,
                content_item_id=target.content_item_id,
                confidence=target.confidence,
                op_id=target.op_id,
            )
            new_key = self._natural_key(prospective)
            for other_id, other in self.rows.items():
                if other_id != row_id and self._natural_key(other) == new_key:
                    raise _UNIQUE_VIOLATION(
                        "duplicate key value violates unique constraint "
                        '"entity_mentions_canonical_name_entity_type_'
                        'content_item_id_key"'
                    )
            self.rows[row_id] = prospective  # type: ignore[index]
            self.updated.append((target.id, str(new_canonical)))
            return "UPDATE 1"

        raise AssertionError(f"unexpected execute query: {query!r}")


class _OpScopedFakePool(_FakePool):
    """``_FakePool`` whose run-mentions SELECT is itself op_id-scoped.

    ``_FakePool`` returns ALL ``conn.rows`` for the run-mentions SELECT, modelling
    a conn that only ever held in-flight rows. The op-scoped store holds a FOREIGN
    op row too, so this subclass overrides the ``FROM public.entity_mentions``
    (run-mentions) branch to honour the production ``WHERE op_id = $1`` bind —
    so ``_select_run_entity_mentions`` returns ONLY the in-flight rows, exactly
    as production does. The roster SELECT stays op-AGNOSTIC (it reads the seed
    corpus, which may include the foreign-op canonical as a chaining target).
    """

    def __init__(
        self,
        conn: _OpScopedFakeConn,
        seed_rows: list[tuple[str, str]] | None = None,
        alias_rows: list[dict[str, str]] | None = None,
    ) -> None:
        super().__init__(conn, seed_rows=seed_rows, alias_rows=alias_rows)
        self.op_conn = conn

    async def fetch(self, query: str, *args: object) -> list[dict]:
        if (
            "FROM public.entity_mentions" in query
            and "WHERE op_id = $1" in query
            and "SELECT DISTINCT canonical_name" not in query
        ):
            # _select_run_entity_mentions: op_id-scoped (Inv-5). Return ONLY rows
            # belonging to the bound op — the foreign-op row is invisible here.
            current_op = args[0]
            return [
                {
                    "id": r.id,
                    "canonical_name": r.canonical_name,
                    "entity_type": r.entity_type,
                    "content_item_id": r.content_item_id,
                    "confidence": r.confidence,
                }
                for r in self.op_conn.rows.values()
                if r.op_id == current_op
            ]
        return await super().fetch(query, *args)


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

    async def _fake_resolve_entities(  # type: ignore[no-untyped-def]
        names,
        *,
        embedder,
        resolve_pair,
        is_existing_canonical=None,
        existing_policy=None,
    ):
        # Agnostic of embedder / resolve_pair (constructed but unused here —
        # the collapse is what we exercise). Returns a resolver mapping every
        # input name to its cross-document canonical.
        #
        # ID-81 PC-1: `_run_stage_5_resolution` now passes `is_existing_canonical`
        # and `existing_policy=ExistingCanonicalPolicy.PINNED` unconditionally, so
        # this stub MUST absorb them (TECH §5 prerequisite — without it the three
        # bl-225 tests + the seeding tests break at call time). The bl-225 tests
        # supply a fixed `mapping`, so they are agnostic to the predicate; the
        # PINNED-aware seeding tests use `_stub_pinned_resolver_chain` below.
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


@contextmanager
def _capture_stage5_logs():  # type: ignore[no-untyped-def]
    """Capture ``logging`` records emitted by the stage_5 module logger.

    Used to assert the ``cocoindex.stage_5.collapsed`` structured log fires on a
    bl-225 collapse (Inv-10). Attaches a transient handler to the module logger
    (`scripts.cocoindex_pipeline.stage_5`) and yields the collected records.
    Restores the prior level/handlers on exit (no global state leak).
    """
    import logging

    logger = logging.getLogger("scripts.cocoindex_pipeline.stage_5")
    records: list[logging.LogRecord] = []

    class _Collector(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = _Collector()
    prior_level = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        yield records
    finally:
        logger.removeHandler(handler)
        logger.setLevel(prior_level)


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

    # "Cisco" exists as BOTH an organisation and (separately) a technology — a
    # same-string-different-type pair. But a same-string pair alone cannot
    # ISOLATE entity_type-scoping from the lexical prefilter: "Cisco" passes the
    # prefilter under EITHER type, so its presence/absence is confounded by the
    # prefilter arm. To make entity_type-scoping INDEPENDENTLY falsifiable, we
    # add UNIQUE per-type canonicals — a name that exists under ONE type only —
    # and assert it is excluded from the OTHER type's batch even though that
    # batch's run names lexically near-match it. Only the $1 entity_type bind can
    # account for that exclusion (the prefilter would otherwise admit it).
    seed_rows = [
        ("Cisco", "organisation"),  # the company (same-string pair, lower value)
        ("Cisco", "technology"),  # the product line (same-string pair)
        ("Juniper", "organisation"),  # organisation-only — must not leak to tech
        ("Kubernetes", "technology"),  # technology-only — must not leak to org
    ]
    pool = _FakePool(_FakeConn([]), seed_rows=seed_rows)

    # Resolving a TECHNOLOGY batch whose run names near-match BOTH "Cisco" and
    # the organisation-only "Juniper" — so the prefilter WOULD admit "Juniper"
    # if entity_type were not scoped. Only the $1 = 'technology' bind excludes it.
    tech_roster = asyncio.run(
        _select_existing_canonical_roster(
            pool,  # type: ignore[arg-type]
            "technology",
            {"cisco", "juniper"},  # 'juniper' present so prefilter is NOT the gate
        )
    )
    # The technology "Cisco" and "Kubernetes" are eligible; the organisation-only
    # "Juniper" is scoped OUT by $1 = 'technology' DESPITE being lexically present
    # in the run names — entity_type-scoping is the sole reason it is absent.
    assert "Cisco" in tech_roster, "technology Cisco IS in the technology roster"
    assert "Juniper" not in tech_roster, (
        "an organisation-only canonical must never leak into a technology roster, "
        "even when a run name lexically matches it (entity_type-scoping, not the "
        "prefilter, is the gate)"
    )

    # And the converse: resolving an ORGANISATION batch whose run names near-match
    # the technology-only "Kubernetes" — the prefilter would admit it, but the
    # $1 = 'organisation' bind scopes it out. The org "Cisco" + "Juniper" remain.
    org_roster = asyncio.run(
        _select_existing_canonical_roster(
            pool,  # type: ignore[arg-type]
            "organisation",
            {"cisco", "juniper", "kubernetes"},  # 'kubernetes' present as a probe
        )
    )
    assert org_roster == {"Cisco", "Juniper"}, (
        "the technology-only 'Kubernetes' is scoped OUT of the organisation "
        "roster despite lexically matching a run name — entity_type-scoping is "
        "independently falsifiable"
    )


# ── ID-81 PC-1/PC-7/PC-11/PC-14: PINNED seeding wired into resolve_entities ───
#
# These tests prove the WIRING slice ({81.7}): the seed roster from
# `_select_existing_canonical_roster` (PC-6, {81.6}) is merged into
# `names_by_type[entity_type]` and fed to `resolve_entities` as a MEMBER of the
# `entities` iterable (PC-14, Inv-14 determinism), alongside an
# `is_existing_canonical` predicate + `existing_policy=PINNED` (PC-1). The
# resolver stub below is PINNED-AWARE: it captures the ACTUAL `names` iterable and
# `is_existing_canonical` predicate production passes, and models cocoindex 1.0.3
# PINNED semantics — an existing pins as its own canonical; a lexical near-match
# chains UNDER the seeded existing. This makes the tests prove the real wiring
# (seed merged into `names`, correct predicate, PINNED policy), NOT just the stub.


class _PinnedResolvedEntities:
    """PINNED-aware ``ResolvedEntities`` stand-in (cocoindex 1.0.3 ``:262-353``).

    Built from the ACTUAL `names` iterable + `is_existing_canonical` predicate the
    production wiring passed. Models the PINNED contract for these unit tests:

      * every name where ``is_existing_canonical(name)`` is True PINS as its own
        canonical (pass_1; never resolved against another — Inv-3/Inv-4);
      * a name that is NOT existing chains UNDER the lexically-closest seeded
        existing in the same batch (case-fold equal, else substring overlap in
        either direction — a deterministic stand-in for the faiss near-match);
      * a non-existing name with no near seeded existing resolves to ITSELF
        (Inv-13 — unresolved retains its per-document canonical).

    ``canonical_of`` mirrors cocoindex: returns ``str`` (never None), raises
    ``KeyError`` for a name never offered to the resolver — which is exactly the
    assertion that a seeded foreign-op canonical (a MEMBER of ``names``) IS
    present in the dedup map, while a name never merged in is absent.
    """

    def __init__(self, names, is_existing_canonical) -> None:  # type: ignore[no-untyped-def]
        self._names = list(names)
        pred = is_existing_canonical or (lambda _n: False)
        self._existing = {n for n in self._names if pred(n)}
        self._mapping: dict[str, str] = {}
        for name in self._names:
            if name in self._existing:
                self._mapping[name] = name  # pinned as own canonical
                continue
            target = self._nearest_existing(name)
            self._mapping[name] = target if target is not None else name

    def _nearest_existing(self, name: str) -> str | None:
        n_lower = name.lower()
        # Exact case-fold first (the dominant "same string, different casing").
        for existing in self._existing:
            if existing.lower() == n_lower:
                return existing
        # Then substring overlap in either direction (trigram-near stand-in).
        for existing in self._existing:
            e_lower = existing.lower()
            if n_lower in e_lower or e_lower in n_lower:
                return existing
        return None

    def canonical_of(self, name: str) -> str:
        return self._mapping[name]  # KeyError for never-offered names (cocoindex parity)


def _stub_pinned_resolver_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, object]:
    """Patch the resolver chain with a PINNED-aware fake that RECORDS its inputs.

    Returns a ``capture`` dict the test inspects to assert the WIRING: the actual
    ``names`` iterable fed to ``resolve_entities`` (must include the merged seed
    roster — PC-14), the ``is_existing_canonical`` predicate (PC-1), and the
    ``existing_policy`` value (must be ``PINNED`` — PC-1). The ``_FakeResolved``
    is built from those captured inputs, so a test that the seed is NOT merged
    would surface as a KeyError / wrong mapping — a real-behaviour proof.
    """
    import scripts.cocoindex_pipeline._coco_api as coco_api
    import scripts.cocoindex_pipeline.entity_embedder as entity_embedder
    import scripts.cocoindex_pipeline.pair_resolver as pair_resolver

    capture: dict[str, object] = {"calls": []}

    async def _fake_resolve_entities(  # type: ignore[no-untyped-def]
        names,
        *,
        embedder,
        resolve_pair,
        is_existing_canonical=None,
        existing_policy=None,
    ):
        names_list = list(names)
        existing_names = {
            n for n in names_list if (is_existing_canonical or (lambda _n: False))(n)
        }
        cast = capture["calls"]
        assert isinstance(cast, list)
        cast.append(
            {
                "names": names_list,
                "existing_names": existing_names,
                "existing_policy": existing_policy,
            }
        )
        return _PinnedResolvedEntities(names_list, is_existing_canonical)

    monkeypatch.setattr(coco_api, "resolve_entities", _fake_resolve_entities)

    class _StubEmbedder:
        def __init__(self, *a: object, **k: object) -> None: ...

    class _StubPairResolver:
        def __init__(self, *a: object, **k: object) -> None: ...

    monkeypatch.setattr(entity_embedder, "KhEntityEmbedder", _StubEmbedder)
    monkeypatch.setattr(pair_resolver, "KhPairResolver", _StubPairResolver)
    return capture


def test_new_mention_chains_under_seeded_existing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Inv-1 / PC-1: a new in-flight mention near a SEEDED existing canonical
    chains UNDER the existing — the in-flight row resolves to the seeded value.

    Seed roster supplies the existing canonical ``"ISO 27001"`` (a prior-run /
    NULL-op_id canonical of type ``standard``). This run's only mention is the
    per-document canonical ``"iso 27001"`` (lower-cased — a near-match: the
    dominant "same string, different casing, ingested in a prior run" case the
    case-fold prefilter arm targets). After the pass, the in-flight row's
    ``canonical_name`` is the SEEDED ``"ISO 27001"``, NOT its own ``"iso 27001"``
    — the new mention chained under the existing.

    This proves the wiring end-to-end: the seed string was merged into
    ``names_by_type`` (so the resolver saw it), the ``is_existing_canonical``
    predicate marked it existing (so PINNED pinned it), and the near-match
    resolved to it. Production also records the call so we assert the seed is a
    MEMBER of the resolver's ``names`` (PC-14) and the policy is PINNED.
    """
    from scripts.cocoindex_pipeline._coco_api import ExistingCanonicalPolicy
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    entity_type = "standard"
    content_item_id = uuid.UUID("077b27e7-0000-4000-8000-0000000000a1")
    mention_id = uuid.UUID("00000000-0000-4000-8000-000000000101")
    rows = [_Row(mention_id, "iso 27001", entity_type, content_item_id, 0.8)]
    conn = _FakeConn(rows)
    # The seeded existing canonical (op-agnostic — prior-run or NULL-op_id).
    pool = _FakePool(conn, seed_rows=[("ISO 27001", entity_type)])

    capture = _stub_pinned_resolver_chain(monkeypatch)
    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    # The in-flight row chained UNDER the seeded existing canonical.
    assert len(conn.rows) == 1, "the single in-flight row survives (no collapse)"
    survivor = next(iter(conn.rows.values()))
    assert survivor.id == mention_id
    assert survivor.canonical_name == "ISO 27001", (
        "new mention 'iso 27001' must chain UNDER the seeded existing 'ISO 27001'"
    )
    assert conn.updated == [(mention_id, "ISO 27001")]
    assert changed == 1
    assert counter.counts.get("entity_resolution", 0) == 1

    # WIRING proof: the seed was a MEMBER of the resolver's `names` (PC-14), was
    # flagged existing by the predicate (PC-1), and the policy was PINNED (PC-1).
    calls = capture["calls"]
    assert isinstance(calls, list) and len(calls) == 1
    call = calls[0]
    assert "ISO 27001" in call["names"], (
        "seed roster must be MERGED into names_by_type (PC-14: seed is a member "
        "of the resolve_entities `entities` iterable, not passed out-of-band)"
    )
    assert "iso 27001" in call["names"], "the in-flight per-doc canonical is present too"
    assert call["names"] == sorted(call["names"]), (
        "names passed as sorted(...) — Inv-14 determinism (PC-14)"
    )
    assert call["existing_names"] == {"ISO 27001"}, (
        "is_existing_canonical marks ONLY the seeded existing (PC-1 predicate)"
    )
    assert call["existing_policy"] is ExistingCanonicalPolicy.PINNED, (
        "existing_policy must be PINNED (PC-1)"
    )


def test_foreign_op_seed_row_never_written(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Inv-7 / PC-7: a foreign-op canonical READ as a chaining target is byte-for-
    byte unchanged — its ROW is physically unreachable by any DELETE/UPDATE.

    The seed roster supplies ``"ISO 27001"`` (a foreign-op / NULL-op_id canonical
    used as a chaining target). The in-flight run's mention chains under it. We
    assert the write-back NEVER touched the seed: the seed string never appears in
    ``conn.deleted_ids`` (there is no seed ROW in the in-flight store at all — the
    seed is a STRING from the op-agnostic roster, never a ``name_pairs`` member),
    and the DELETE/UPDATE the fake conn executed retain their ``AND op_id`` guards
    (the fake enforces the UUID-typed op_id-scoped bind, ``:177-182``).

    This is the by-construction Inv-5 guarantee (PC-7): seeds merge into
    ``names_by_type`` ONLY, never ``name_pairs`` — so a foreign-op canonical is
    READ but never WRITTEN.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    entity_type = "standard"
    content_item_id = uuid.UUID("077b27e7-0000-4000-8000-0000000000a2")
    mention_id = uuid.UUID("00000000-0000-4000-8000-000000000201")
    rows = [_Row(mention_id, "iso 27001", entity_type, content_item_id, 0.8)]
    conn = _FakeConn(rows)
    pool = _FakePool(conn, seed_rows=[("ISO 27001", entity_type)])

    _stub_pinned_resolver_chain(monkeypatch)

    asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=_StubStageCounter(),  # type: ignore[arg-type]
        )
    )

    # The in-flight store only ever held the ONE in-flight row — the seed was
    # never a row here (it is a foreign-op canonical, read as a string). Only the
    # in-flight row was UPDATEd; nothing was DELETEd; the seed contributed NO row.
    assert conn.deleted_ids == [], "no DELETE — single mention, no collision"
    assert conn.updated == [(mention_id, "ISO 27001")], (
        "only the in-flight row was UPDATEd; the foreign-op seed row is untouched"
    )
    # The only id that the write-back touched is the in-flight mention id — never
    # a seed-derived id (seeds are strings, not name_pairs members → no id).
    touched_ids = {mention_id}
    assert {u[0] for u in conn.updated} <= touched_ids
    # The seed canonical string never became a writable row id in this store.
    assert "ISO 27001" not in {str(rid) for rid in conn.deleted_ids}


def test_only_in_flight_op_rows_written_with_seed_roster(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Inv-11 / PC-11: every id in ``deletes``/``updates`` was selected by
    ``_select_run_entity_mentions(op_id=current)``; the seed roster (foreign-op
    strings) contributes NO row id to either write list.

    Two in-flight per-doc canonicals in one document both chain under a SEEDED
    existing (``"EIR 2004"``). The collapse picks one survivor (UPDATEd to the
    seed value) and DELETEs the loser. We assert BOTH the survivor id AND the
    loser id are in-flight ids (the ids the fixture rows carry — i.e. the ids
    ``_select_run_entity_mentions`` returned), and that the foreign-op seed
    contributed no id to ``deleted_ids`` or ``updated``.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    entity_type = "regulation"
    content_item_id = uuid.UUID("077b27e7-0000-4000-8000-0000000000a3")
    in_flight_short = uuid.UUID("00000000-0000-4000-8000-000000000301")  # 0.9 survivor
    in_flight_long = uuid.UUID("00000000-0000-4000-8000-000000000302")  # 0.7 loser
    rows = [
        _Row(in_flight_short, "eir 2004", entity_type, content_item_id, 0.9),
        _Row(in_flight_long, "eir 2004 regs", entity_type, content_item_id, 0.7),
    ]
    conn = _FakeConn(rows)
    # Seeded existing canonical (foreign-op). Both in-flight names chain under it
    # (substring overlap with "EIR 2004" — case-fold + substring near-match).
    pool = _FakePool(conn, seed_rows=[("EIR 2004", entity_type)])

    _stub_pinned_resolver_chain(monkeypatch)
    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    in_flight_ids = {in_flight_short, in_flight_long}

    # Every written/deleted id is an in-flight op id (Inv-11) — and exactly the
    # ids the fixture (i.e. _select_run_entity_mentions) produced.
    assert set(conn.deleted_ids) <= in_flight_ids, "every DELETEd id is in-flight"
    assert {u[0] for u in conn.updated} <= in_flight_ids, "every UPDATEd id is in-flight"

    # The seed contributed NO row id: the total ids the write-back saw equals the
    # in-flight set exactly — never grew by a seed-derived id.
    all_written = set(conn.deleted_ids) | {u[0] for u in conn.updated}
    assert all_written <= in_flight_ids
    assert in_flight_long in conn.deleted_ids, "the 0.7 loser was collapsed"
    assert len(conn.rows) == 1, "one survivor remains"
    survivor = next(iter(conn.rows.values()))
    assert survivor.id == in_flight_short, "0.9 survivor wins"
    assert survivor.canonical_name == "EIR 2004", (
        "survivor chained under the seeded existing canonical (Inv-1) and the "
        "collapse landed it without a UniqueViolation (Inv-10)"
    )
    assert changed == 1
    assert counter.counts.get("entity_resolution", 0) == 1


# ── ID-81.8 — remaining per-invariant real-body units (TECH §5 table) ─────────
#
# These extend the {81.7} wiring coverage with the invariants TECH §5 lists but
# which were not yet covered: Inv-4 (two existings never merged), Inv-5 (seeded
# existing with no match → no event), Inv-10 (seeded-target bl-225 collapse —
# REQUIRED regression), Inv-12 (alias applied pre-resolution + roster NOT
# aliased), Inv-13 (unresolved mention retains per-doc canonical with a non-empty
# seed roster). All drive the REAL `_run_stage_5_resolution` body with the
# resolver chain stubbed at source via `_stub_pinned_resolver_chain`.


def test_two_existing_seeds_never_merged(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inv-4 / PC-4: two DISTINCT existing canonicals of one type, with NO
    matching new mention, are never merged — neither is touched by the run.

    The seed roster supplies TWO distinct existings of type ``organisation``
    (``"Acme Corporation"`` + ``"Globex Limited"``). This run's only mention is
    an UNRELATED per-doc canonical (``"Stark Industries"``) that near-matches
    NEITHER seed. Under PINNED, each existing pins as its own canonical and the
    resolver is never run existing-against-existing, so the run produces ZERO
    updates (the single in-flight mention resolves to itself) and ZERO deletes,
    and NEITHER seed string ever appears in a write-back.

    Falsifiability: were the policy PREFERRED (or were the two existings compared
    against each other), one existing could be collapsed into the other and
    appear in ``deletes`` — this asserts that does not happen. The unrelated
    in-flight mention also proves the seeds are not spuriously chained.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    entity_type = "organisation"
    content_item_id = uuid.UUID("077b27e7-0000-4000-8000-0000000000b1")
    mention_id = uuid.UUID("00000000-0000-4000-8000-000000000401")
    # The single in-flight mention is UNRELATED to either seed (no near-match).
    rows = [_Row(mention_id, "Stark Industries", entity_type, content_item_id, 0.8)]
    conn = _FakeConn(rows)
    pool = _FakePool(
        conn,
        seed_rows=[
            ("Acme Corporation", entity_type),
            ("Globex Limited", entity_type),
        ],
    )

    capture = _stub_pinned_resolver_chain(monkeypatch)
    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    # No merge: the single in-flight mention resolved to itself; no UPDATE/DELETE.
    assert conn.updated == [], "no UPDATE — the unrelated mention chains nowhere"
    assert conn.deleted_ids == [], "no DELETE — two existings are never merged"
    assert changed == 0
    assert counter.counts.get("entity_resolution", 0) == 0
    # The in-flight row keeps its per-doc canonical.
    assert len(conn.rows) == 1
    assert next(iter(conn.rows.values())).canonical_name == "Stark Industries"

    # WIRING proof: the roster prefilter near-matches NOTHING here (the seeds are
    # not lexically close to "Stark Industries"), so the resolver's `names` is the
    # in-flight name only — neither seed was offered. This is itself the Inv-4
    # guarantee: with no near in-flight mention, the existings never enter the
    # resolver batch, so they cannot be merged. Both existings remain untouched.
    calls = capture["calls"]
    assert isinstance(calls, list) and len(calls) == 1
    names = calls[0]["names"]
    assert "Acme Corporation" not in names and "Globex Limited" not in names, (
        "no in-flight mention near-matched either seed, so the prefilter admitted "
        "neither into the resolver batch — they are never compared/merged (Inv-4)"
    )


def test_seeded_existing_no_match_no_event(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inv-5 / PC-5: a seeded existing with no matching new mention produces NO
    resolution event — ``updates == []`` AND ``deletes == []``.

    Seed an existing canonical (``"ISO 27001"``, type ``standard``); the run's
    ONLY mention is unrelated (``"GDPR"``, same type but lexically distant). The
    existing sits in the candidate corpus but, matched by no in-flight mention,
    forms no collision group (the group key is built ONLY from ``name_pairs``,
    `stage_5.py`), so it appears in neither write list. The unrelated mention
    resolves to itself.

    Falsifiability: if a seeded existing emitted a resolution event merely by
    being read, ``updates``/``deletes`` would be non-empty — this asserts they
    are both empty.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    entity_type = "standard"
    content_item_id = uuid.UUID("077b27e7-0000-4000-8000-0000000000b2")
    mention_id = uuid.UUID("00000000-0000-4000-8000-000000000501")
    rows = [_Row(mention_id, "GDPR", entity_type, content_item_id, 0.8)]
    conn = _FakeConn(rows)
    pool = _FakePool(conn, seed_rows=[("ISO 27001", entity_type)])

    _stub_pinned_resolver_chain(monkeypatch)
    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    assert conn.updated == [], "seeded existing with no matching mention → no UPDATE"
    assert conn.deleted_ids == [], "seeded existing with no matching mention → no DELETE"
    assert changed == 0
    assert counter.counts.get("entity_resolution", 0) == 0
    # The unrelated mention retains its per-doc canonical and is the only row.
    assert len(conn.rows) == 1
    assert next(iter(conn.rows.values())).canonical_name == "GDPR"


def test_seeded_target_bl225_collapse(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inv-10 / PC-10 (REQUIRED regression): seeding induces a same-document
    collision — TWO same-doc per-doc canonicals both chain under a SEEDED
    existing — and the bl-225 collapse absorbs it identically.

    Mirrors ``test_collapse_with_survivor_update`` but the resolution TARGET is a
    SEEDED existing canonical rather than a same-run name. Two in-flight per-doc
    canonicals in ONE document (``"eir 2004"`` @0.9 + ``"environmental
    information regulations 2004"`` @0.7) both chain under the seeded existing
    ``"EIR 2004 regs"``. The collapse must: pick the 0.9 survivor (highest
    confidence, smallest id tie-break), UPDATE it into the seeded canonical,
    DELETE the 0.7 loser FIRST (so the survivor's UPDATE does not transiently
    collide on UNIQUE(canonical_name, entity_type, content_item_id)), raise NO
    UniqueViolation, and emit the ``cocoindex.stage_5.collapsed`` structured log.

    Falsifiability: were the collapse skipped (old row-by-row body), the second
    UPDATE would raise ``UniqueViolationError`` on the fake conn (it models the
    constraint) — the test would error. Were DELETE-first dropped, the survivor's
    UPDATE into a value the loser still holds would also collide.
    """
    import logging

    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    entity_type = "regulation"
    content_item_id = uuid.UUID("077b27e7-0000-4000-8000-0000000000b3")
    survivor_id = uuid.UUID("00000000-0000-4000-8000-000000000601")  # 0.9 survivor
    loser_id = uuid.UUID("00000000-0000-4000-8000-000000000602")  # 0.7 loser
    seeded_target = "EIR 2004"  # the existing both per-doc canonicals chain under
    rows = [
        # Both per-doc canonicals lexically near-match the seed "EIR 2004":
        #   "eir 2004"       — case-fold equal to the seed;
        #   "eir 2004 regs"  — contains the lowered seed as a substring.
        # So BOTH chain under the seeded existing under the PINNED stub → they
        # collapse to ONE group keyed (content_item_id, entity_type, "EIR 2004").
        _Row(survivor_id, "eir 2004", entity_type, content_item_id, 0.9),
        _Row(loser_id, "eir 2004 regs", entity_type, content_item_id, 0.7),
    ]
    conn = _FakeConn(rows)
    # Seeded existing canonical (foreign-op chaining target).
    pool = _FakePool(conn, seed_rows=[(seeded_target, entity_type)])

    _stub_pinned_resolver_chain(monkeypatch)
    counter = _StubStageCounter()

    with _capture_stage5_logs() as records:
        changed = asyncio.run(
            _run_stage_5_resolution(
                meta=_StubMeta(op_id=op_id),
                db_pool=pool,  # type: ignore[arg-type]
                flow_stage_counter=counter,  # type: ignore[arg-type]
            )
        )

    # Exactly one survivor — the 0.9 row, now holding the SEEDED canonical.
    assert len(conn.rows) == 1, "collapse to a single survivor (no UniqueViolation)"
    survivor = next(iter(conn.rows.values()))
    assert survivor.id == survivor_id, "0.9-confidence row survives (smallest-id n/a)"
    assert survivor.canonical_name == seeded_target, (
        "survivor UPDATEd INTO the seeded existing canonical — the new mentions "
        "chained under the existing (Inv-1), and the collapse landed it (Inv-10)"
    )

    # DELETE-first ordering: the 0.7 loser was DELETEd; the survivor UPDATEd once.
    assert conn.deleted_ids == [loser_id], "the 0.7 loser was collapsed (DELETEd)"
    assert conn.updated == [(survivor_id, seeded_target)], (
        "exactly one UPDATE landed the seeded canonical on the survivor"
    )
    assert changed == 1
    assert counter.counts.get("entity_resolution", 0) == 1

    # The structured collapse log fired (bl-225 observability obligation).
    collapse_logs = [
        json.loads(r.getMessage())
        for r in records
        if r.getMessage().startswith("{")
        and json.loads(r.getMessage()).get("event") == "cocoindex.stage_5.collapsed"
    ]
    assert len(collapse_logs) == 1, "exactly one cocoindex.stage_5.collapsed log fired"
    assert collapse_logs[0]["op_id"] == str(op_id)
    assert collapse_logs[0]["collapsed_count"] == 1, "one loser was collapsed"
    # Keep the logging import referenced (the helper uses the logging module).
    assert logging.getLogger("scripts.cocoindex_pipeline.stage_5") is not None


def test_alias_applied_pre_resolution_and_roster_not_aliased(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Inv-12 / PC-12: the legacy ``entity_aliases`` rewrite is applied to the
    per-doc canonical BEFORE resolution, and the seed roster source is
    ``entity_mentions.canonical_name`` ONLY (NOT a UNION with ``entity_aliases``).

    A NON-empty active alias row (``"eir 2004" → "EIR 2004"``) is supplied via
    ``_FakePool.alias_rows`` — the ``FROM public.entity_aliases`` fetch branch now
    genuinely returns it (the other tests return ``[]``, so this exercises the
    preload path for real). The in-flight per-doc canonical is the alias KEY
    ``"eir 2004"``. After alias application, the row's canonical becomes
    ``"EIR 2004"`` BEFORE the resolver sees it; the resolver then receives
    ``"EIR 2004"`` (the alias VALUE), NOT the raw ``"eir 2004"``.

    Roster-not-aliased proof: the roster reader is invoked with the ALIAS-APPLIED
    name set, and the only roster SELECT issued is against
    ``public.entity_mentions`` (the ``_FakePool.fetch`` `SELECT DISTINCT
    canonical_name` branch); the alias map is NEVER unioned into the roster. We
    assert the resolver's ``names`` contain the alias VALUE and NOT the alias KEY.

    Falsifiability: if the alias were applied AFTER resolution (or not at all),
    the resolver's ``names`` would contain the raw ``"eir 2004"`` key and the
    final row canonical would not be the alias value — this asserts the opposite.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    entity_type = "regulation"
    content_item_id = uuid.UUID("077b27e7-0000-4000-8000-0000000000b4")
    mention_id = uuid.UUID("00000000-0000-4000-8000-000000000701")
    # The per-doc canonical is the ALIAS KEY; the active alias rewrites it.
    rows = [_Row(mention_id, "eir 2004", entity_type, content_item_id, 0.8)]
    conn = _FakeConn(rows)
    pool = _FakePool(
        conn,
        # No seed roster — this test isolates the alias path; the roster reader
        # still runs (over the alias-applied name) and returns [] (no seeds).
        seed_rows=[],
        # NON-EMPTY active alias row → exercises `_preload_entity_aliases`.
        alias_rows=[{"alias": "eir 2004", "canonical": "EIR 2004"}],
    )

    capture = _stub_pinned_resolver_chain(monkeypatch)
    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    # The alias was applied BEFORE resolution: the resolver saw the alias VALUE.
    calls = capture["calls"]
    assert isinstance(calls, list) and len(calls) == 1
    names = calls[0]["names"]
    assert "EIR 2004" in names, (
        "resolver received the ALIAS-APPLIED canonical 'EIR 2004' (alias applied "
        "BEFORE resolution — Inv-12)"
    )
    assert "eir 2004" not in names, (
        "the raw alias KEY 'eir 2004' must NOT reach the resolver — the rewrite "
        "happens before resolution, not after"
    )

    # ROSTER-NOT-ALIASED proof: the seed-roster read is NOT a UNION with the
    # alias map. The roster reader ran over the alias-applied name set and the
    # ONLY SELECT it issued was against `public.entity_mentions` (the `_FakePool`
    # roster branch); the alias map ("eir 2004"→"EIR 2004") was never offered as a
    # roster candidate. With an empty seed corpus the roster is empty, so the
    # alias VALUE is the ONLY name in the resolver batch (no aliased seed leaked).
    assert names == ["EIR 2004"], (
        "the resolver batch is the single alias-applied name — the roster is NOT "
        "unioned with entity_aliases (Inv-12: roster source is entity_mentions "
        "canonical_name only)"
    )

    # WRITE-BACK NOTE (real production behaviour, asserted honestly): the
    # write-back compares the ALIAS-APPLIED canonical against the RESOLVED value
    # (`survivor_alias_applied != resolved`, stage_5.py). Here the alias-applied
    # name "EIR 2004" resolves to ITSELF (empty roster, single mention), so
    # alias-applied == resolved → NO UPDATE fires, and the stored row retains its
    # raw per-doc "eir 2004". Inv-12's obligation is that the alias is applied
    # BEFORE resolution (proven above by the resolver seeing the alias VALUE) and
    # that the roster is not aliased — NOT that the alias is persisted to the row
    # absent a resolution move. (Persisting the alias rewrite itself is ID-53
    # Inv-10's app-side `resolveAlias`, not the Stage-5 write-back.)
    assert len(conn.rows) == 1
    survivor = next(iter(conn.rows.values()))
    assert survivor.canonical_name == "eir 2004", (
        "no UPDATE fires when the alias-applied canonical resolves to itself — "
        "the write-back skip-condition is `alias_applied != resolved` (Inv-12 "
        "concerns the PRE-resolution alias rewrite, not row persistence)"
    )
    assert conn.updated == [], "alias-applied == resolved → no canonical_name UPDATE"
    assert changed == 0
    assert counter.counts.get("entity_resolution", 0) == 0


def test_unresolved_mention_retains_canonical_with_seed_roster(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Inv-13 / PC-13: an obscure mention with no near-match among run names OR
    the seed roster retains its per-document canonical and is absent from
    ``updates`` — even with a NON-empty seed roster present.

    A NON-empty seed roster (``"ISO 27001"``, type ``standard``) is supplied, but
    the in-flight mention (``"Zphqx Protocol"``) near-matches NEITHER the seed NOR
    any other run name. Seeding only ADDS candidate targets; it never forces a
    match — so the obscure mention resolves to ITSELF (``canonical_of(name) ==
    name``), keeps its per-doc canonical, and Stage-5 issues no UPDATE for it.

    Falsifiability: if seeding spuriously chained the obscure mention under the
    unrelated seed, the row's canonical would change and it would appear in
    ``updates`` — this asserts it does not.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    entity_type = "standard"
    content_item_id = uuid.UUID("077b27e7-0000-4000-8000-0000000000b5")
    mention_id = uuid.UUID("00000000-0000-4000-8000-000000000801")
    rows = [_Row(mention_id, "Zphqx Protocol", entity_type, content_item_id, 0.8)]
    conn = _FakeConn(rows)
    # NON-empty seed roster, but lexically distant from the obscure mention.
    pool = _FakePool(conn, seed_rows=[("ISO 27001", entity_type)])

    _stub_pinned_resolver_chain(monkeypatch)
    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    # The obscure mention resolved to itself — retained its per-doc canonical.
    assert len(conn.rows) == 1
    survivor = next(iter(conn.rows.values()))
    assert survivor.id == mention_id
    assert survivor.canonical_name == "Zphqx Protocol", (
        "an unresolved mention retains its per-document canonical (Inv-13) even "
        "with a non-empty seed roster present — seeding never forces a match"
    )
    assert conn.updated == [], "no UPDATE — the mention is absent from `updates`"
    assert conn.deleted_ids == []
    assert changed == 0
    assert counter.counts.get("entity_resolution", 0) == 0


# ── ID-81.8 (B1) — Inv-7 op_id-guard RUNTIME strengthening ────────────────────


def test_foreign_op_row_byte_for_byte_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Inv-7 / PC-7 (RUNTIME-verified op_id guard): a foreign-op ROW supplied as a
    chaining target is byte-for-byte unchanged because the DELETE/UPDATE enforce
    ``AND op_id = $current`` — a regression that dropped the guard would let the
    foreign-op row be touched, FAILING this test.

    Unlike the existing foreign-op test (which models the seed as a STRING only,
    with a conn that ignores op_id), this seeds a REAL foreign-op ROW into an
    op-ENFORCING conn carrying a DIFFERENT ``op_id``, snapshots ALL its columns
    before the pass, and asserts byte-identity after. The op-agnostic ROSTER
    reader still surfaces the foreign-op canonical (``"ISO 27001"``) as a chaining
    target (the roster is op-AGNOSTIC by design — Inv-6), and the in-flight
    mention chains under it. But the write-back is op_id-SCOPED: the
    ``_OpScopedFakeConn`` only mutates rows whose ``op_id`` equals the bound
    current op, so the foreign-op row is physically unreachable.

    Falsifiability (the load-bearing point): the conn's handlers ENFORCE the
    ``op_id`` predicate, so if production dropped ``AND op_id`` from the
    DELETE/UPDATE binds, the foreign-op row could match a write and its snapshot
    would change — this assertion would then FAIL. The guard is RUNTIME-verified,
    not merely source-read.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    current_op = uuid.uuid4()
    foreign_op = uuid.uuid4()
    assert current_op != foreign_op
    entity_type = "standard"
    in_flight_cid = uuid.UUID("077b27e7-0000-4000-8000-0000000000c1")
    foreign_cid = uuid.UUID("077b27e7-0000-4000-8000-0000000000c2")
    in_flight_id = uuid.UUID("00000000-0000-4000-8000-000000000901")
    foreign_id = uuid.UUID("00000000-0000-4000-8000-000000000902")

    # The foreign-op ROW: a prior-run canonical "ISO 27001" used as a chaining
    # target. Its op_id differs from the in-flight op → write-back must not touch.
    foreign_row = _OpRow(
        id=foreign_id,
        canonical_name="ISO 27001",
        entity_type=entity_type,
        content_item_id=foreign_cid,
        confidence=0.95,
        op_id=foreign_op,
    )
    # The in-flight mention: a near-match of the foreign-op canonical (case-fold).
    in_flight_row = _OpRow(
        id=in_flight_id,
        canonical_name="iso 27001",
        entity_type=entity_type,
        content_item_id=in_flight_cid,
        confidence=0.8,
        op_id=current_op,
    )
    conn = _OpScopedFakeConn([in_flight_row, foreign_row])
    # The op-AGNOSTIC roster surfaces the foreign-op canonical as a chaining
    # target (Inv-6) — supplied here as a seed string so the in-flight mention
    # chains under it. The op-scoped pool keeps the run-mentions SELECT op-scoped.
    pool = _OpScopedFakePool(conn, seed_rows=[("ISO 27001", entity_type)])

    # Snapshot ALL columns of the foreign-op row BEFORE the pass (byte-identity).
    before = (
        foreign_row.id,
        foreign_row.canonical_name,
        foreign_row.entity_type,
        foreign_row.content_item_id,
        foreign_row.confidence,
        foreign_row.op_id,
    )

    _stub_pinned_resolver_chain(monkeypatch)
    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=current_op),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    # The foreign-op row STILL EXISTS and is byte-for-byte identical.
    assert foreign_id in conn.rows, "the foreign-op row was not DELETEd"
    after_row = conn.rows[foreign_id]
    after = (
        after_row.id,
        after_row.canonical_name,
        after_row.entity_type,
        after_row.content_item_id,
        after_row.confidence,
        after_row.op_id,
    )
    assert after == before, (
        "the foreign-op row is byte-for-byte unchanged — the op_id guard made it "
        "physically unreachable by the write-back (Inv-7 RUNTIME-verified)"
    )

    # The foreign-op id never appeared in any write list (op_id-scoped write).
    assert foreign_id not in conn.deleted_ids
    assert foreign_id not in {u[0] for u in conn.updated}

    # The in-flight mention DID chain under the foreign-op canonical (Inv-1): it
    # was UPDATEd to "ISO 27001". This proves the foreign-op canonical was READ
    # (a string, op-agnostic roster) while its ROW stayed untouched (op-scoped).
    assert in_flight_id in conn.rows
    assert conn.rows[in_flight_id].canonical_name == "ISO 27001", (
        "the in-flight mention chained UNDER the foreign-op canonical (READ side "
        "is op-agnostic) — yet the foreign-op ROW was never written (WRITE side "
        "is op_id-scoped)"
    )
    assert conn.updated == [(in_flight_id, "ISO 27001")]
    assert changed == 1


# ── ID-81.9 — REGRESSION: roster includes the run's OWN in-flight rows ─────────
#
# THE FIDELITY GAP THAT SHIPPED THE INERT-SEEDING DEFECT
# ------------------------------------------------------
# Every roster-aware fake above (`_FakePool`) models the existing-canonical roster
# as a SEPARATE `seed_rows` corpus that EXCLUDES the in-flight run's own rows. But
# `_select_existing_canonical_roster` reads OP-AGNOSTICALLY
# (`SELECT DISTINCT canonical_name FROM entity_mentions WHERE entity_type = $1
# AND (... near-match ...)`) — and by Stage-5 time the in-flight run's OWN rows
# are ALREADY in `entity_mentions` (the per-item `ingest_file` phase wrote them
# before this post-pass runs). So the REAL roster contains the in-flight run's own
# canonical names, and each in-flight name matches ITSELF in the roster.
#
# Consequence (the defect): with `roster_by_type |= roster`, the in-flight name
# becomes a member of the roster, the `is_existing_canonical` set-membership
# predicate flags it `True`, and under PINNED it self-pins in pass_1 — it NEVER
# enters pass_2 (faiss-search-and-chain), so a run-2 near-match can never chain
# under a run-1 (foreign) canonical. Seeding is INERT cross-run.
#
# `_RealisticRosterFakePool` below faithfully models the real op-agnostic SELECT:
# its roster branch reads the UNION of the prior/foreign `seed_rows` corpus AND
# the in-flight `conn.rows` (the run's own rows, already in the table). The fix
# subtracts the run's own names (`names_by_type[entity_type]`) from the roster
# BEFORE the `|=` merge, so only FOREIGN canonicals remain `is_existing` and the
# in-flight name re-enters pass_2 to chain.


class _RealisticRosterFakePool(_FakePool):
    """`_FakePool` whose roster SELECT is OP-AGNOSTIC over the WHOLE table.

    The base `_FakePool` answers the roster `SELECT DISTINCT canonical_name`
    branch from the `seed_rows` corpus ONLY (a separate body that excludes the
    in-flight rows). That fidelity gap is exactly why the inert-seeding defect
    shipped green. This subclass restores fidelity: the roster branch reads the
    op-agnostic UNION of the prior/foreign `seed_rows` corpus AND the in-flight
    ``conn.rows`` (the run's OWN canonicals, which are physically present in
    ``entity_mentions`` by Stage-5 time) — modelling the real
    ``SELECT DISTINCT canonical_name FROM entity_mentions WHERE entity_type = $1``
    that does NOT (and cannot) filter the in-flight op out.

    The run-mentions SELECT (`FROM public.entity_mentions ... WHERE op_id = $1`)
    is left to the base `_FakePool`, which returns all `conn.rows` — modelling a
    conn that only holds the in-flight run's rows (the prior/foreign canonical is
    a seed STRING here, not a conn row, so it never becomes a `name_pairs` member,
    preserving the op_id write-scope by construction).
    """

    async def fetch(self, query: str, *args: object) -> list[dict]:
        if "SELECT DISTINCT canonical_name" in query:
            entity_type = args[0]
            probe_lower = [str(n) for n in args[2]]  # already-lowered in reader
            seen: set[str] = set()
            out: list[dict] = []
            # OP-AGNOSTIC corpus = prior/foreign seed_rows UNION the in-flight
            # rows already written to entity_mentions (the run's own canonicals).
            corpus: list[tuple[str, str]] = list(self.seed_rows) + [
                (r.canonical_name, r.entity_type) for r in self.conn.rows.values()
            ]
            for canonical, seed_type in corpus:
                if seed_type != entity_type:
                    continue  # Inv-8: entity_type-scoped (WHERE entity_type = $1)
                if not self._prefilter_match(canonical, probe_lower):
                    continue  # candidate prefilter (Inv-1/§4 PERF)
                if canonical in seen:
                    continue  # SELECT DISTINCT
                seen.add(canonical)
                out.append({"canonical_name": canonical})
            return out
        return await super().fetch(query, *args)


def test_roster_excludes_in_flight_names_so_run2_chains(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ID-81.9 REGRESSION: a run-2 near-match chains under a prior-run (foreign)
    canonical EVEN THOUGH the op-agnostic roster SELECT also surfaces the run's
    OWN in-flight name.

    Scenario (one `_run_stage_5_resolution` call modelling run 2): a prior run 1
    materialised the canonical ``"ISO 27001"`` (type ``standard``) — present in
    the table as a foreign-op canonical (here a `seed_rows` string). Run 2's only
    in-flight mention is the per-doc canonical ``"iso 27001"`` (lower-cased — a
    case-fold near-match). The roster reader is op-AGNOSTIC, so its
    ``SELECT DISTINCT canonical_name`` returns BOTH ``"ISO 27001"`` (foreign) AND
    the in-flight ``"iso 27001"`` (the run's own row, already in the table).

    EXPECTED (post-fix): the fix subtracts the run's own names from the roster, so
    only the FOREIGN ``"ISO 27001"`` is flagged ``is_existing``; the in-flight
    ``"iso 27001"`` re-enters pass_2 and chains UNDER ``"ISO 27001"`` →
    ``changed == 1`` and the in-flight row's canonical becomes ``"ISO 27001"``.

    DEFECT (pre-fix): the op-agnostic roster also contains the in-flight
    ``"iso 27001"`` (self-membership), so the ``|=`` merge flags it
    ``is_existing`` → it self-pins in pass_1 and NEVER chains → ``changed == 0``
    and TWO distinct canonicals (``"ISO 27001"`` + ``"iso 27001"``) survive. This
    is the inert cross-run seeding the fix repairs.
    """
    from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

    op_id = uuid.uuid4()
    entity_type = "standard"
    content_item_id = uuid.UUID("077b27e7-0000-4000-8000-0000000000d1")
    mention_id = uuid.UUID("00000000-0000-4000-8000-000000000a01")
    # Run 2's single in-flight mention — a case-fold near-match of run 1's
    # canonical. By Stage-5 time this row is ALREADY in entity_mentions, so the
    # op-agnostic roster SELECT will surface "iso 27001" as a self-match too.
    rows = [_Row(mention_id, "iso 27001", entity_type, content_item_id, 0.8)]
    conn = _FakeConn(rows)
    # The foreign/prior-run canonical "ISO 27001" lives in the table (op-agnostic
    # corpus). The realistic pool UNIONs this with the in-flight conn.rows.
    pool = _RealisticRosterFakePool(conn, seed_rows=[("ISO 27001", entity_type)])

    # Sanity-check the fidelity restoration: the op-agnostic roster the reader
    # sees genuinely INCLUDES the in-flight name (the gap the old fake hid).
    from scripts.cocoindex_pipeline.stage_5 import (
        _select_existing_canonical_roster,
    )

    raw_roster = asyncio.run(
        _select_existing_canonical_roster(
            pool,  # type: ignore[arg-type]
            entity_type,
            {"iso 27001"},
        )
    )
    assert raw_roster == {"ISO 27001", "iso 27001"}, (
        "the op-agnostic roster SELECT surfaces BOTH the foreign canonical AND the "
        "run's own in-flight name (self-membership) — the real-table fidelity the "
        "old separate-corpus fake hid"
    )

    capture = _stub_pinned_resolver_chain(monkeypatch)
    counter = _StubStageCounter()

    changed = asyncio.run(
        _run_stage_5_resolution(
            meta=_StubMeta(op_id=op_id),
            db_pool=pool,  # type: ignore[arg-type]
            flow_stage_counter=counter,  # type: ignore[arg-type]
        )
    )

    # Fail LOUD + EARLY if the stubbed resolver was never invoked (a monkeypatch
    # miss): otherwise the canonical-name assertion below masks it as a confusing
    # value mismatch rather than a clear "stub not called" (ID-81.9 Checker note).
    assert capture["calls"], (
        "the stubbed PINNED resolver was never called — monkeypatch did not "
        "intercept the lazy `_coco_api.resolve_entities` import in "
        "_run_stage_5_resolution"
    )

    # POST-FIX: the in-flight name was SUBTRACTED from the roster, so only the
    # foreign "ISO 27001" is flagged existing; the in-flight "iso 27001" chained
    # under it. PRE-FIX: "iso 27001" self-pinned (is_existing via self-membership)
    # and never chained → this assertion FAILS (changed == 0, two canonicals).
    assert len(conn.rows) == 1, "the single in-flight row survives (no collapse)"
    survivor = next(iter(conn.rows.values()))
    assert survivor.id == mention_id
    assert survivor.canonical_name == "ISO 27001", (
        "the run-2 near-match must chain UNDER the prior-run canonical 'ISO 27001' "
        "— NOT self-pin to its own 'iso 27001'. The op-agnostic roster's "
        "self-membership of the in-flight name must be SUBTRACTED before the merge "
        "so the in-flight name re-enters pass_2 (ID-81.9 inert-seeding fix)."
    )
    assert conn.updated == [(mention_id, "ISO 27001")]
    assert changed == 1, (
        "exactly one canonical_name UPDATE landed (the cross-run chain). A "
        "`changed == 0` here is the inert-seeding defect: the in-flight name "
        "self-pinned because the op-agnostic roster flagged it existing."
    )
    assert counter.counts.get("entity_resolution", 0) == 1

    # WIRING proof: the predicate flagged ONLY the foreign canonical existing —
    # NOT the in-flight name (which the roster also contained, pre-subtraction).
    calls = capture["calls"]
    assert isinstance(calls, list) and len(calls) == 1
    call = calls[0]
    assert call["existing_names"] == {"ISO 27001"}, (
        "is_existing_canonical must flag ONLY the foreign canonical — the run's "
        "OWN in-flight name must be subtracted from the roster (the fix). If "
        "'iso 27001' is also flagged existing, seeding is inert cross-run."
    )
    # Both names are still MEMBERS of the resolver `entities` iterable (PC-14):
    # the foreign canonical is a pinned chaining target, the in-flight name a
    # pass_2 candidate. Subtraction affects the PREDICATE, not the input set.
    assert "ISO 27001" in call["names"] and "iso 27001" in call["names"], (
        "the foreign canonical stays a resolver-input chain target (the `|=` merge "
        "is kept); only its `is_existing` flagging of the in-flight name is removed"
    )
