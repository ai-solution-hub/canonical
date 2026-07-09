"""Unit tests for the ID-127.33 self-healing memo (S457 owner ratification).

S456/S457 evidence: 3 staging corpus items failed every re-walk with
`DeserializationError` on `ClassificationExtraction` — their LMDB memo entry
held a pre-2026-07-07 taxonomy-era payload that no longer validates against
the current extraction schema. Incremental re-walks did NOT self-heal;
targeted memo invalidation was infeasible ({66.14}); a full
`fullReprocess=true` re-walk OOM-crashed on staging.

Owner ratification: a memo-HIT deserialize failure must degrade to
RE-EXTRACTION, never an item failure — "self-healing memo". Guardrails:
loud per-fallback logging + a re-extraction/heal count surfaced in the
pipeline-run result.

This file verifies, behaviour-first (no mock-only assertions):

  - a stale/corrupt memo payload (`DeserializationError`) triggers a fresh
    re-extraction via the raw undecorated coroutine, and the item SUCCEEDS;
  - the heal count is recorded on the bound per-flow counter;
  - a loud structured log line is emitted naming rel_path + error class;
  - a VALID memo hit short-circuits unchanged — no spurious re-extraction,
    no heal recorded (the happy path is untouched by this change);
  - scope discipline: a non-deserialization exception (network/LLM-shaped)
    is NOT caught here — it propagates with its existing failure semantics;
  - `_bypass_memo_extractor` — the private/internal `_orig_async_fn` bypass
    — resolves the raw coroutine when present and fails loudly when absent;
  - `_FlowMemoHealCounter` (flow.py) and `bind_memo_heal_counter` /
    `current_memo_heal_counter` (flow_context.py) — the counter substrate
    itself, mirroring the existing retry / taxonomy-miss / item-failure
    counter test patterns.

Reference: docs/reference/task-list.json → ID-127 → Subtask 33
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

import pytest

# ── Path setup ──────────────────────────────────────────────────────────────
#
# Canonical absolute `scripts.cocoindex_pipeline.*` namespace (ID-67.2) — the
# path the on-prem sidecar runs under (`python3 -m scripts.cocoindex_pipeline`)
# and the one `flow.py` / `extraction.py` import each other through. The repo
# ROOT (not `scripts/`) must be on sys.path for the `scripts.` prefix to
# resolve.

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.cocoindex_pipeline import flow  # noqa: E402
from scripts.cocoindex_pipeline.extraction import (  # noqa: E402
    _bypass_memo_extractor,
    _resolve_coco_deserialization_error,
    extract_with_memo_self_heal,
)
from scripts.cocoindex_pipeline.flow_context import (  # noqa: E402
    bind_memo_heal_counter,
    current_memo_heal_counter,
)


# ── Test doubles ─────────────────────────────────────────────────────────────


class _RecordingMemoHealCounter:
    """Lightweight stand-in for the production `_FlowMemoHealCounter`.

    Satisfies the `MemoHealCounter` structural protocol (flow_context.py) so
    `extract_with_memo_self_heal` can bump it inside a `bind_memo_heal_counter`
    scope without depending on flow.py.
    """

    def __init__(self) -> None:
        self.recorded: list[str] = []

    def record(self, *, extractor: str) -> None:
        self.recorded.append(extractor)

    def get(self, *, extractor: str) -> int:
        return self.recorded.count(extractor)

    def tally(self) -> dict[str, int]:
        tally: dict[str, int] = {}
        for extractor in self.recorded:
            tally[extractor] = tally.get(extractor, 0) + 1
        return tally


class _StaleThenRawSucceedsExtractor:
    """Models a `@coco.fn(memo=True)` AsyncFunction whose memo-HIT deserialize
    ALWAYS raises (a permanently stale LMDB entry — matches the S457
    evidence, where a second incremental walk hits the identical stale
    entry) but whose raw undecorated coroutine (`_orig_async_fn`, the
    production bypass target) always succeeds — i.e. a fresh LLM call would
    work fine; only the CACHED bytes are unreadable."""

    def __init__(self, error_cls: type[BaseException], success_value: object) -> None:
        self._error_cls = error_cls
        self._success_value = success_value
        self.memo_call_count = 0
        self.raw_call_count = 0
        self._orig_async_fn = self._raw

    async def __call__(self, content_text: str) -> object:
        self.memo_call_count += 1
        raise self._error_cls(f"stale memo payload for {content_text!r}")

    async def _raw(self, content_text: str) -> object:
        self.raw_call_count += 1
        return self._success_value


class _HealthyMemoExtractor:
    """Models a memo-HIT (or genuine cache-miss) that succeeds outright — the
    happy path this change must leave completely unchanged. `_orig_async_fn`
    raises if ever invoked, proving the bypass is never reached."""

    def __init__(self, success_value: object) -> None:
        self._success_value = success_value
        self.memo_call_count = 0
        self._orig_async_fn = self._raw

    async def __call__(self, content_text: str) -> object:
        self.memo_call_count += 1
        return self._success_value

    async def _raw(self, content_text: str) -> object:
        raise AssertionError(
            "the memo self-heal bypass must NEVER fire on a healthy memo hit"
        )


class _NoOrigAsyncFnExtractor:
    """Always raises the resolved DeserializationError; has NO `_orig_async_fn`
    attribute — models an unexpected/incompatible object shape so
    `_bypass_memo_extractor` fails loudly instead of silently."""

    def __init__(self, error_cls: type[BaseException]) -> None:
        self._error_cls = error_cls

    async def __call__(self, content_text: str) -> object:
        raise self._error_cls("stale memo payload")


class _NetworkFailingExtractor:
    """A non-deserialization failure (network/LLM-shaped) — scope discipline
    requires this propagate UNCHANGED, never routed through the memo
    self-heal fallback."""

    async def __call__(self, content_text: str) -> object:
        raise TimeoutError("simulated transient network failure")


# ============================================================================
# extract_with_memo_self_heal — behaviour-first contract
# ============================================================================


class TestExtractWithMemoSelfHealDeserializationFailure:
    """A stale/corrupt memo payload re-extracts and the item SUCCEEDS."""

    def test_stale_memo_falls_back_to_raw_extraction_and_succeeds(self) -> None:
        error_cls = _resolve_coco_deserialization_error()
        extractor = _StaleThenRawSucceedsExtractor(error_cls, success_value="OK")

        result = asyncio.run(
            extract_with_memo_self_heal(
                extractor,
                "some content",
                extractor_name="classification",
                rel_path="content/synthetic-capability-statement.pdf",
            )
        )

        assert result == "OK", (
            "the item must succeed via the raw-coroutine fallback, not fail"
        )
        assert extractor.memo_call_count == 1, "memo path must be tried first"
        assert extractor.raw_call_count == 1, (
            "exactly one fallback (raw, un-memoised) extraction must run"
        )

    def test_heal_is_recorded_on_the_bound_counter(self) -> None:
        error_cls = _resolve_coco_deserialization_error()
        extractor = _StaleThenRawSucceedsExtractor(error_cls, success_value="OK")
        counter = _RecordingMemoHealCounter()

        async def _exercise() -> object:
            async with bind_memo_heal_counter(counter):
                return await extract_with_memo_self_heal(
                    extractor,
                    "some content",
                    extractor_name="classification",
                    rel_path="content/synthetic-capability-statement.pdf",
                )

        asyncio.run(_exercise())

        assert counter.tally() == {"classification": 1}

    def test_no_bound_counter_still_heals_gracefully(self) -> None:
        """Graceful degradation (mirrors the retry / taxonomy-miss counters):
        outside any `bind_memo_heal_counter` scope, the fallback still fires
        and the item still succeeds — only the count is not recorded."""
        error_cls = _resolve_coco_deserialization_error()
        extractor = _StaleThenRawSucceedsExtractor(error_cls, success_value="OK")

        assert current_memo_heal_counter() is None

        result = asyncio.run(
            extract_with_memo_self_heal(
                extractor,
                "some content",
                extractor_name="classification",
                rel_path="content/synthetic-capability-statement.pdf",
            )
        )

        assert result == "OK"
        assert extractor.raw_call_count == 1

    def test_loud_log_line_names_rel_path_and_error_class(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        error_cls = _resolve_coco_deserialization_error()
        extractor = _StaleThenRawSucceedsExtractor(error_cls, success_value="OK")

        with caplog.at_level(logging.WARNING, logger="scripts.cocoindex_pipeline.extraction"):
            asyncio.run(
                extract_with_memo_self_heal(
                    extractor,
                    "some content",
                    extractor_name="classification",
                    rel_path="content/synthetic-capability-statement.pdf",
                )
            )

        assert len(caplog.records) == 1, "exactly one loud log line per fallback"
        message = caplog.records[0].message
        assert caplog.records[0].levelno == logging.WARNING
        assert "content/synthetic-capability-statement.pdf" in message
        assert error_cls.__name__ in message
        assert "re-extracting" in message
        assert "stale memo" in message

    def test_multiple_stale_items_heal_independently(self) -> None:
        """Each call is independent — the counter accumulates per extractor
        across multiple healed items (burn-observability tally semantics)."""
        error_cls = _resolve_coco_deserialization_error()
        counter = _RecordingMemoHealCounter()

        async def _exercise() -> None:
            async with bind_memo_heal_counter(counter):
                for rel_path in ("a.pdf", "b.md", "c.md"):
                    extractor = _StaleThenRawSucceedsExtractor(
                        error_cls, success_value=rel_path
                    )
                    result = await extract_with_memo_self_heal(
                        extractor,
                        "content",
                        extractor_name="classification",
                        rel_path=rel_path,
                    )
                    assert result == rel_path

        asyncio.run(_exercise())

        assert counter.tally() == {"classification": 3}


class TestExtractWithMemoSelfHealHappyPath:
    """A valid memo hit (or genuine cache miss) is left COMPLETELY unchanged
    — no spurious re-extraction, no heal recorded."""

    def test_healthy_memo_short_circuits_without_invoking_bypass(self) -> None:
        extractor = _HealthyMemoExtractor(success_value="cached-result")

        result = asyncio.run(
            extract_with_memo_self_heal(
                extractor,
                "some content",
                extractor_name="classification",
                rel_path="content/some-doc.md",
            )
        )

        assert result == "cached-result"
        assert extractor.memo_call_count == 1
        # `_raw` would raise AssertionError if ever invoked — reaching this
        # line without one proves the bypass path never fired.

    def test_healthy_memo_records_no_heal(self) -> None:
        extractor = _HealthyMemoExtractor(success_value="cached-result")
        counter = _RecordingMemoHealCounter()

        async def _exercise() -> object:
            async with bind_memo_heal_counter(counter):
                return await extract_with_memo_self_heal(
                    extractor,
                    "some content",
                    extractor_name="classification",
                    rel_path="content/some-doc.md",
                )

        result = asyncio.run(_exercise())

        assert result == "cached-result"
        assert counter.tally() == {}, "no heal must be recorded on a memo hit"

    def test_healthy_memo_emits_no_warning_log(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        extractor = _HealthyMemoExtractor(success_value="cached-result")

        with caplog.at_level(logging.WARNING, logger="scripts.cocoindex_pipeline.extraction"):
            asyncio.run(
                extract_with_memo_self_heal(
                    extractor,
                    "some content",
                    extractor_name="classification",
                    rel_path="content/some-doc.md",
                )
            )

        assert caplog.records == []


class TestExtractWithMemoSelfHealScopeDiscipline:
    """The fallback is narrowed to deserialization failures ONLY — network /
    LLM errors keep their existing failure semantics unchanged (per the
    ID-127.33 brief's explicit scope boundary)."""

    def test_non_deserialization_exception_propagates_unchanged(self) -> None:
        extractor = _NetworkFailingExtractor()

        with pytest.raises(TimeoutError, match="simulated transient network failure"):
            asyncio.run(
                extract_with_memo_self_heal(
                    extractor,
                    "some content",
                    extractor_name="classification",
                    rel_path="content/some-doc.md",
                )
            )

    def test_non_deserialization_exception_records_no_heal(self) -> None:
        extractor = _NetworkFailingExtractor()
        counter = _RecordingMemoHealCounter()

        async def _exercise() -> None:
            async with bind_memo_heal_counter(counter):
                await extract_with_memo_self_heal(
                    extractor,
                    "some content",
                    extractor_name="classification",
                    rel_path="content/some-doc.md",
                )

        with pytest.raises(TimeoutError):
            asyncio.run(_exercise())

        assert counter.tally() == {}


# ============================================================================
# _bypass_memo_extractor — the private `_orig_async_fn` bypass
# ============================================================================


class TestBypassMemoExtractor:
    def test_returns_orig_async_fn_when_present(self) -> None:
        async def _raw(content_text: str) -> str:
            return "raw"

        class _Fake:
            _orig_async_fn = staticmethod(_raw)

        assert _bypass_memo_extractor(_Fake()) is _raw

    def test_raises_runtime_error_with_clear_message_when_absent(self) -> None:
        class _Fake:
            pass

        with pytest.raises(RuntimeError, match="_orig_async_fn"):
            _bypass_memo_extractor(_Fake())


# ============================================================================
# _resolve_coco_deserialization_error — lazy, best-effort resolution
# ============================================================================


class TestResolveCocoDeserializationError:
    def test_resolves_the_real_cocoindex_exception_class(self) -> None:
        from cocoindex._internal.serde import DeserializationError

        assert _resolve_coco_deserialization_error() is DeserializationError

    def test_resolved_type_is_a_baseexception_subclass(self) -> None:
        assert issubclass(_resolve_coco_deserialization_error(), BaseException)


# ============================================================================
# _FlowMemoHealCounter (flow.py) — per-flow per-extractor tally
# ============================================================================


class TestFlowMemoHealCounter:
    """`_FlowMemoHealCounter` — per-flow per-extractor memo-self-heal tally.

    Mirrors the `_FlowItemFailureCounter` / `_FlowTaxonomyMissCounter` test
    pattern (test_cocoindex_flow_failure_mode.py).
    """

    def test_helper_class_is_exposed(self) -> None:
        assert hasattr(flow, "_FlowMemoHealCounter")

    def test_new_counter_tallies_empty(self) -> None:
        # Unlike `_FlowItemFailureCounter` (fixed 'content'/'url' branch
        # vocabulary), the extractor vocabulary is open-ended — an unused
        # counter tallies empty, not zeroed-per-key.
        counter = flow._FlowMemoHealCounter()
        assert counter.tally() == {}

    def test_record_bumps_named_extractor_only(self) -> None:
        counter = flow._FlowMemoHealCounter()
        counter.record(extractor="classification")
        assert counter.tally() == {"classification": 1}

    def test_record_is_repeatable_and_per_extractor(self) -> None:
        counter = flow._FlowMemoHealCounter()
        counter.record(extractor="classification")
        counter.record(extractor="classification")
        counter.record(extractor="qa_form")
        assert counter.tally() == {"classification": 2, "qa_form": 1}

    def test_get_reads_a_single_extractor(self) -> None:
        counter = flow._FlowMemoHealCounter()
        counter.record(extractor="classification")
        counter.record(extractor="classification")
        assert counter.get(extractor="classification") == 2
        assert counter.get(extractor="qa_form") == 0

    def test_tally_returns_a_copy_not_internal_state(self) -> None:
        counter = flow._FlowMemoHealCounter()
        counter.record(extractor="classification")
        snapshot = counter.tally()
        snapshot["classification"] = 99
        assert counter.tally() == {"classification": 1}

    def test_counter_instances_are_independent(self) -> None:
        first = flow._FlowMemoHealCounter()
        second = flow._FlowMemoHealCounter()
        first.record(extractor="classification")
        assert second.tally() == {}


# ============================================================================
# bind_memo_heal_counter / current_memo_heal_counter (flow_context.py)
# ============================================================================


class TestBindMemoHealCounter:
    """`bind_memo_heal_counter()` exposes a counter to the wrapped block —
    mirrors `TestBindRetryCounter` (test_cocoindex_flow_context.py)."""

    def test_module_exposes_bind_and_current(self) -> None:
        from scripts.cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "bind_memo_heal_counter")
        assert hasattr(flow_context, "current_memo_heal_counter")

    def test_unbound_default_is_none(self) -> None:
        assert current_memo_heal_counter() is None

    def test_binding_exposes_counter_to_wrapped_block(self) -> None:
        counter = _RecordingMemoHealCounter()

        async def _exercise() -> object | None:
            async with bind_memo_heal_counter(counter):
                return current_memo_heal_counter()

        result = asyncio.run(_exercise())
        assert result is counter

    def test_binding_restored_on_exit(self) -> None:
        counter = _RecordingMemoHealCounter()

        async def _exercise() -> tuple[object | None, object | None]:
            async with bind_memo_heal_counter(counter):
                inside = current_memo_heal_counter()
            outside = current_memo_heal_counter()
            return (inside, outside)

        inside, outside = asyncio.run(_exercise())
        assert inside is counter
        assert outside is None

    def test_concurrent_tasks_see_independent_counters(self) -> None:
        """Per-asyncio-task isolation: concurrent flows must see independent
        memo-heal counters even though they share the same module-level
        ContextVar storage (mirrors the retry-counter isolation guarantee)."""

        async def _run_with(label: str, delay: float) -> tuple[str, object]:
            counter = _RecordingMemoHealCounter()
            async with bind_memo_heal_counter(counter):
                await asyncio.sleep(delay)
                counter.record(extractor=label)
                await asyncio.sleep(delay)
                seen = current_memo_heal_counter()
                return (label, seen)

        async def _exercise() -> list[tuple[str, object]]:
            return await asyncio.gather(
                _run_with("classification", 0.01),
                _run_with("qa_form", 0.0),
            )

        results = dict(asyncio.run(_exercise()))
        assert results["classification"].tally() == {"classification": 1}
        assert results["qa_form"].tally() == {"qa_form": 1}
        assert results["classification"] is not results["qa_form"]
