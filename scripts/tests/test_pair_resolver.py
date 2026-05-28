"""Tests for cocoindex_pipeline/pair_resolver.py — `KhPairResolver`.

Verifies the KH-owned PairResolver implementation per PRODUCT.md Inv-14 +
TECH.md §P-8:

  - **cache-hit path** — when `entity_pair_resolutions` has a row for the
    (name_a, name_b, entity_type) triple, `_resolve_one_pair` returns the
    cached decision and does NOT invoke the LLM.
  - **cache-miss path** — when no cached row exists, `_resolve_one_pair`
    invokes the LLM exactly once, parses its response (thin string-parser
    per T-OQ2 ratification), and writes the decision back to the cache
    table via `INSERT ... ON CONFLICT (name_a, name_b, entity_type) DO
    NOTHING`.
  - **concurrent INSERT race-safety** — two concurrent `_resolve_one_pair`
    invocations on the same triple result in exactly one cache row
    (the `ON CONFLICT DO NOTHING` clause swallows the second INSERT) and
    no UNIQUE-violation exception surfaces to the caller.

Subtask ID-53.12 — TECH.md §P-8 + PRODUCT.md Inv-14 + T-OQ2 thin
string-parser ratification.

Both the Anthropic SDK and asyncpg are stubbed at the import boundary so
the test runs without the real packages — `asyncpg` is registered as an
inert MagicMock via `_stub_module()`, and the anthropic client is
monkeypatched per test to return controlled responses.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── Path setup ──────────────────────────────────────────────────────────────

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))


# ── Inert stubs for unavailable packages ───────────────────────────────────
#
# asyncpg is a transitive runtime dep (not installed at test time); the
# resolver only references its type annotation `asyncpg.Pool` at module
# scope, so a MagicMock stub is sufficient for import resolution. The
# Anthropic client is constructed inside `_invoke_llm` per call, so we
# stub it per test via `patch.object` rather than at module level.


def _stub_module(name: str) -> MagicMock:
    if name not in sys.modules:
        sys.modules[name] = MagicMock(name=name)
    return sys.modules[name]


_stub_module("asyncpg")


# ── Fake asyncpg pool / connection ────────────────────────────────────────


class FakeConnection:
    """In-memory stand-in for asyncpg.Connection.

    Stores cached pair decisions as a dict keyed by `(name_a, name_b,
    entity_type)`. `fetchval` returns the cached `decision` string (or
    None for cache miss); `execute` records INSERTs with `ON CONFLICT
    DO NOTHING` semantics — a second INSERT on the same triple is a
    silent no-op (matches the migration's UNIQUE constraint behaviour).

    Tracks `fetchval_calls` and `execute_calls` so tests can assert
    cache lookup + writeback paths fired the expected number of times.
    """

    def __init__(self, seed: dict[tuple[str, str, str], str] | None = None) -> None:
        # (name_a, name_b, entity_type) -> decision string ("same" / "different").
        self._cache: dict[tuple[str, str, str], str] = dict(seed or {})
        self.fetchval_calls: list[tuple[str, tuple[object, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchval(self, query: str, *args: object) -> object:
        self.fetchval_calls.append((query, args))
        # Cache lookup by (name_a, name_b, entity_type); args order matches
        # the resolver's $1/$2/$3 binding sequence.
        if "SELECT decision FROM public.entity_pair_resolutions" in query:
            key = (args[0], args[1], args[2])
            return self._cache.get(key)
        return None

    async def execute(self, query: str, *args: object) -> str:
        self.execute_calls.append((query, args))
        # INSERT ... ON CONFLICT (name_a, name_b, entity_type) DO NOTHING:
        # only insert if the triple is not already present.
        if "INSERT INTO public.entity_pair_resolutions" in query:
            key = (args[0], args[1], args[2])
            if key not in self._cache:
                self._cache[key] = args[3]  # decision arg
        return "OK"


class FakePool:
    """In-memory stand-in for asyncpg.Pool.

    `acquire()` returns an async context manager yielding the shared
    `FakeConnection` — concurrent acquires share state (matching the
    real pool semantic that all connections back the same database).
    """

    def __init__(self, seed: dict[tuple[str, str, str], str] | None = None) -> None:
        self.conn = FakeConnection(seed=seed)

    def acquire(self) -> object:
        connection = self.conn

        @asynccontextmanager
        async def _acquire():
            yield connection

        return _acquire()


# ── Anthropic response builder ────────────────────────────────────────────


def _make_anthropic_response(text: str) -> MagicMock:
    """Build a MagicMock matching the anthropic SDK's `Message` shape
    (`response.content[0].text`)."""
    block = MagicMock()
    block.text = text
    response = MagicMock()
    response.content = [block]
    return response


# ── Test cases ────────────────────────────────────────────────────────────


def test_cache_hit_skips_llm_invocation() -> None:
    """Cache-hit path: pre-seeded cache row is returned without LLM call.

    Verifies Inv-14 determinism: re-running Stage-5 against a populated
    cache replays the prior decision byte-for-byte without re-invoking
    the model.
    """
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    pool = FakePool(seed={("alpha", "beta", "organisation"): "same"})

    resolver = KhPairResolver(db_pool=pool, op_id=op_id, entity_type="organisation")

    # Patch the LLM invocation surface to assert it is NEVER called on hit.
    with patch.object(resolver, "_invoke_llm", new=AsyncMock()) as llm_mock:
        decision = asyncio.run(resolver._resolve_one_pair("alpha", "beta"))

    assert decision == "same"
    assert llm_mock.await_count == 0, "LLM must NOT be invoked on cache hit"
    # Exactly one cache lookup happened; no INSERT followed.
    assert len(pool.conn.fetchval_calls) == 1
    assert len(pool.conn.execute_calls) == 0


def test_cache_hit_with_reversed_arg_order() -> None:
    """Lexicographic ordering: `(beta, alpha)` and `(alpha, beta)` hit
    the same cache row."""
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    pool = FakePool(seed={("alpha", "beta", "organisation"): "different"})

    resolver = KhPairResolver(db_pool=pool, op_id=op_id, entity_type="organisation")

    # Passing arguments in reverse order — resolver must sort to (alpha, beta).
    with patch.object(resolver, "_invoke_llm", new=AsyncMock()) as llm_mock:
        decision = asyncio.run(resolver._resolve_one_pair("beta", "alpha"))

    assert decision == "different"
    assert llm_mock.await_count == 0


def test_cache_miss_invokes_llm_once_and_writes_back() -> None:
    """Cache-miss path: LLM is invoked exactly once, then the decision
    is INSERTed into the cache table with op_id audit-trail."""
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    pool = FakePool()  # empty cache

    resolver = KhPairResolver(db_pool=pool, op_id=op_id, entity_type="technology")

    # Mock LLM to return "same" — bypass the Anthropic SDK call entirely.
    llm_mock = AsyncMock(return_value="same")
    with patch.object(resolver, "_invoke_llm", new=llm_mock):
        decision = asyncio.run(resolver._resolve_one_pair("foo", "bar"))

    assert decision == "same"
    assert llm_mock.await_count == 1
    # LLM was called with lexicographically-ordered key (bar, foo).
    assert llm_mock.await_args.args == ("bar", "foo")

    # Cache lookup happened first, then INSERT writeback.
    assert len(pool.conn.fetchval_calls) == 1
    assert len(pool.conn.execute_calls) == 1
    insert_query, insert_args = pool.conn.execute_calls[0]
    assert "INSERT INTO public.entity_pair_resolutions" in insert_query
    assert "ON CONFLICT (name_a, name_b, entity_type) DO NOTHING" in insert_query
    # (name_a, name_b, entity_type, decision, op_id) per resolver's binding order.
    assert insert_args == ("bar", "foo", "technology", "same", op_id)

    # Cache row materialised post-call.
    assert pool.conn._cache[("bar", "foo", "technology")] == "same"


def test_invoke_llm_thin_string_parser_same() -> None:
    """T-OQ2 thin string-parser: response 'same\\n' parses to 'same'."""
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    pool = FakePool()
    resolver = KhPairResolver(db_pool=pool, op_id=op_id, entity_type="organisation")

    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(return_value=_make_anthropic_response("same"))

    with patch(
        "cocoindex_pipeline.pair_resolver.anthropic.AsyncAnthropic",
        return_value=fake_client,
    ):
        decision = asyncio.run(resolver._invoke_llm("Acme Corp", "Acme Corporation"))

    assert decision == "same"
    # Verify the prompt + model + max_tokens shape per TECH §P-8 / T-OQ2.
    call_kwargs = fake_client.messages.create.await_args.kwargs
    assert call_kwargs["max_tokens"] == 4
    assert call_kwargs["temperature"] == 0
    prompt_text = call_kwargs["messages"][0]["content"]
    assert "Acme Corp" in prompt_text
    assert "Acme Corporation" in prompt_text
    assert 'exactly "same" or "different"' in prompt_text


def test_invoke_llm_thin_string_parser_different() -> None:
    """T-OQ2 thin string-parser: response ' Different\\n' parses to 'different'."""
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    pool = FakePool()
    resolver = KhPairResolver(db_pool=pool, op_id=op_id, entity_type="organisation")

    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(
        return_value=_make_anthropic_response(" Different\n")
    )

    with patch(
        "cocoindex_pipeline.pair_resolver.anthropic.AsyncAnthropic",
        return_value=fake_client,
    ):
        decision = asyncio.run(resolver._invoke_llm("Foo", "Bar"))

    assert decision == "different"


def test_invoke_llm_thin_string_parser_unexpected_response_defaults_to_different() -> None:
    """T-OQ2 fail-safe: parse failure or unexpected response defaults to 'different'.

    Protects the canonicalisation surface from LLM hallucination — any
    response that does NOT start with 'same' (case-insensitive, whitespace-
    stripped, first whitespace-delimited token) is treated as 'different'.
    """
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    pool = FakePool()
    resolver = KhPairResolver(db_pool=pool, op_id=op_id, entity_type="organisation")

    fake_client = MagicMock()
    fake_client.messages.create = AsyncMock(
        return_value=_make_anthropic_response("I'm not sure, perhaps?")
    )

    with patch(
        "cocoindex_pipeline.pair_resolver.anthropic.AsyncAnthropic",
        return_value=fake_client,
    ):
        decision = asyncio.run(resolver._invoke_llm("X", "Y"))

    assert decision == "different"


def test_concurrent_invocations_race_safe() -> None:
    """Concurrent INSERT race-safety: two simultaneous `_resolve_one_pair`
    calls on the same triple result in exactly one cache row and no
    UNIQUE-violation exception surfaces.

    The `ON CONFLICT (name_a, name_b, entity_type) DO NOTHING` clause is
    the race-safety mechanism per TECH §P-8 (P-OQ2 narrow race window
    documented + accepted).
    """
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    pool = FakePool()  # empty cache, shared connection across acquires

    resolver = KhPairResolver(db_pool=pool, op_id=op_id, entity_type="organisation")

    # Track how many times the LLM was invoked — both concurrent calls must
    # see the empty cache and proceed to LLM (race condition simulation).
    # The LLM mock yields control via `asyncio.sleep(0)` so the scheduler
    # genuinely interleaves both coroutines past their cache-miss SELECTs
    # BEFORE either reaches the INSERT writeback.
    llm_invocations: list[tuple[str, str]] = []

    async def _slow_llm(name_a: str, name_b: str) -> str:
        llm_invocations.append((name_a, name_b))
        await asyncio.sleep(0)  # yield to the scheduler
        return "same"

    async def _race() -> list[str]:
        # Patch the LLM inside the async block so both coroutines share the mock.
        with patch.object(resolver, "_invoke_llm", new=_slow_llm):
            return await asyncio.gather(
                resolver._resolve_one_pair("foo", "bar"),
                resolver._resolve_one_pair("bar", "foo"),  # reverse order → same key
            )

    results = asyncio.run(_race())

    # Both calls returned the same decision (asyncio.gather returns a list).
    assert results == ["same", "same"]
    # Exactly one cache row exists for the triple — proves `ON CONFLICT
    # (name_a, name_b, entity_type) DO NOTHING` made the second INSERT a
    # no-op (or, equivalently, that the first INSERT's row was visible
    # to the second-attempt INSERT and the conflict clause swallowed it).
    assert pool.conn._cache == {("bar", "foo", "organisation"): "same"}
    # Two LLM invocations happened (both coroutines saw empty cache and
    # proceeded to LLM before either reached the INSERT writeback).
    assert len(llm_invocations) == 2, (
        f"expected both coroutines to invoke LLM, saw {llm_invocations}"
    )
    # Two INSERTs were ATTEMPTED (one per concurrent invocation); the
    # second was swallowed by ON CONFLICT DO NOTHING — exactly one row
    # materialised and no UNIQUE-violation exception surfaced.
    assert len(pool.conn.execute_calls) == 2


def test_call_returns_pair_decision_on_first_match() -> None:
    """`__call__` iterates candidates and returns PairDecision on first 'same'.

    Per TECH §P-8: longer name wins as canonical (the longer / more-
    disambiguating name is preferred). The brief specifies
    `canonical=max((entity, candidate), key=len)` literally.
    """
    from cocoindex.ops.entity_resolution import PairDecision  # noqa: F401

    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    # Seed cache hits for BOTH candidates — the first ("FooStandard") must
    # also be a cache hit so we never reach the LLM. Sorted-key order:
    # ("FooStandard", "ISO27001") and ("ISO 27001", "ISO27001") — space
    # sorts before digits so "ISO 27001" < "ISO27001".
    pool = FakePool(
        seed={
            ("FooStandard", "ISO27001", "certification"): "different",
            ("ISO 27001", "ISO27001", "certification"): "same",
        }
    )

    resolver = KhPairResolver(
        db_pool=pool, op_id=op_id, entity_type="certification"
    )

    decision = asyncio.run(resolver("ISO27001", ["FooStandard", "ISO 27001"]))

    # Found a match — matched is the candidate string.
    assert decision.matched == "ISO 27001"
    # Canonical pick is the LONGER of (entity, candidate) per brief.
    # entity="ISO27001" (8 chars), candidate="ISO 27001" (9 chars) — candidate wins.
    assert decision.canonical == "ISO 27001"


def test_call_returns_no_match_when_all_candidates_different() -> None:
    """`__call__` returns PairDecision(matched=None, canonical=None) when
    no candidate matches."""
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    pool = FakePool(
        seed={
            ("CandidateA", "Foo", "organisation"): "different",
            ("CandidateB", "Foo", "organisation"): "different",
        }
    )

    resolver = KhPairResolver(
        db_pool=pool, op_id=op_id, entity_type="organisation"
    )

    decision = asyncio.run(resolver("Foo", ["CandidateA", "CandidateB"]))

    assert decision.matched is None
    assert decision.canonical is None


def test_entity_type_scopes_cache_key() -> None:
    """Per P-OQ3 ratification: same (name_a, name_b) under different
    entity_type values resolve to independent cache rows.

    e.g. 'Cisco' as organisation vs technology — the two entity_type
    groups must NOT cross-contaminate each other's resolution decisions.
    """
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    op_id = uuid.uuid4()
    # Same (name_a, name_b) but different entity_type — independent decisions.
    pool = FakePool(
        seed={
            ("Cisco", "Cisco Systems", "organisation"): "same",
            ("Cisco", "Cisco Systems", "technology"): "different",
        }
    )

    resolver_org = KhPairResolver(
        db_pool=pool, op_id=op_id, entity_type="organisation"
    )
    resolver_tech = KhPairResolver(
        db_pool=pool, op_id=op_id, entity_type="technology"
    )

    decision_org = asyncio.run(resolver_org._resolve_one_pair("Cisco", "Cisco Systems"))
    decision_tech = asyncio.run(
        resolver_tech._resolve_one_pair("Cisco", "Cisco Systems")
    )

    assert decision_org == "same"
    assert decision_tech == "different"


def test_constructor_uses_keyword_only_args() -> None:
    """`KhPairResolver(*, db_pool, op_id, entity_type)` — positional args
    are forbidden per TECH §P-8 signature contract."""
    from cocoindex_pipeline.pair_resolver import KhPairResolver

    pool = FakePool()
    op_id = uuid.uuid4()

    # Positional args should raise TypeError.
    with pytest.raises(TypeError):
        KhPairResolver(pool, op_id, "organisation")  # type: ignore[misc]

    # Keyword args succeed.
    resolver = KhPairResolver(db_pool=pool, op_id=op_id, entity_type="organisation")
    assert resolver._op_id == op_id
    assert resolver._entity_type == "organisation"
