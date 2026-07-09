"""Tests for producer/trigger.py — ID-132 {132.16} G-TRIGGER: producer
post-walk chaining.

Per the {132.16} testStrategy: post-walk hook fires the producer when
source_documents change; manual invocation still works; no double-fire;
the hook is a no-op when nothing changed (delta-only, v3 §7.2).

`trigger.py` deliberately does not import `cocoindex` at module scope (see
its own docstring) — these dispatch-logic tests import it directly, no
`stubbed_sys_modules` needed. Only `TestDefaultProducerEntryPointSmoke`
exercises the lazily-imported real composition, and stubs `cocoindex` for
that one scenario, mirroring `test_producer_enrich.py`'s pattern.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from conftest import stubbed_sys_modules  # noqa: E402

from scripts.cocoindex_pipeline.producer import trigger  # noqa: E402


# ============================================================================
# Dispatch logic — trigger_producer_post_walk
# ============================================================================


class TestTriggerFiresOnDelta:
    def test_fires_when_deltas_present(self) -> None:
        calls: "list[Any]" = []

        async def fake_entry_point(deltas: Any, **_kwargs: Any) -> str:
            calls.append(deltas)
            return "ran"

        deltas = [{"id": "sd-1", "logical_path": "a.pdf"}]
        import asyncio

        result = asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-1",
                deltas,
                entry_point=fake_entry_point,
                fired_op_ids=set(),
            )
        )

        assert result is True
        assert calls == [deltas]

    def test_no_op_when_no_deltas(self) -> None:
        calls: "list[Any]" = []

        async def fake_entry_point(deltas: Any, **_kwargs: Any) -> str:
            calls.append(deltas)
            return "ran"

        import asyncio

        result = asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-2",
                [],
                entry_point=fake_entry_point,
                fired_op_ids=set(),
            )
        )

        assert result is False
        assert calls == []

    def test_no_double_fire_for_same_op_id(self) -> None:
        calls: "list[Any]" = []

        async def fake_entry_point(deltas: Any, **_kwargs: Any) -> str:
            calls.append(deltas)
            return "ran"

        import asyncio

        deltas = [{"id": "sd-1"}]
        guard: "set[Any]" = set()

        first = asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-3", deltas, entry_point=fake_entry_point, fired_op_ids=guard
            )
        )
        second = asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-3", deltas, entry_point=fake_entry_point, fired_op_ids=guard
            )
        )

        assert first is True
        assert second is False
        assert len(calls) == 1, "entry_point must fire exactly once for op-3"

    def test_different_op_ids_each_fire(self) -> None:
        calls: "list[Any]" = []

        async def fake_entry_point(deltas: Any, **_kwargs: Any) -> str:
            calls.append(deltas)
            return "ran"

        import asyncio

        guard: "set[Any]" = set()
        deltas = [{"id": "sd-1"}]

        first = asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-a", deltas, entry_point=fake_entry_point, fired_op_ids=guard
            )
        )
        second = asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-b", deltas, entry_point=fake_entry_point, fired_op_ids=guard
            )
        )

        assert first is True
        assert second is True
        assert len(calls) == 2


# ============================================================================
# Manual operator invocation — run_producer_now
# ============================================================================


class TestRunProducerNowRetainsManualInvocation:
    def test_manual_invocation_calls_entry_point_with_no_deltas(self) -> None:
        calls: "list[Any]" = []

        async def fake_entry_point(deltas: Any, **_kwargs: Any) -> str:
            calls.append(deltas)
            return "ran"

        import asyncio

        result = asyncio.run(
            trigger.run_producer_now(entry_point=fake_entry_point)
        )

        assert result == "ran"
        assert calls == [()], "manual invocation must call entry_point even with zero deltas"

    def test_manual_invocation_ignores_the_fired_op_ids_guard(self) -> None:
        """A prior automatic fire for an op_id must never block a LATER
        manual override — run_producer_now takes no op_id/guard at all."""
        calls: "list[Any]" = []

        async def fake_entry_point(deltas: Any, **_kwargs: Any) -> str:
            calls.append(deltas)
            return "ran"

        import asyncio

        guard: "set[Any]" = set()
        asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-already-fired",
                [{"id": "sd-1"}],
                entry_point=fake_entry_point,
                fired_op_ids=guard,
            )
        )
        asyncio.run(
            trigger.trigger_producer_post_walk(
                "op-already-fired",
                [{"id": "sd-1"}],
                entry_point=fake_entry_point,
                fired_op_ids=guard,
            )
        )
        assert len(calls) == 1  # automatic path double-fire guard held

        asyncio.run(trigger.run_producer_now(entry_point=fake_entry_point))
        assert len(calls) == 2, "manual invocation must still fire despite the guard"


# ============================================================================
# default_producer_entry_point — idle-mode safety
# ============================================================================


class TestDefaultEntryPointIdleMode:
    def test_idle_when_okf_bundle_dir_unset(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("OKF_BUNDLE_DIR", raising=False)
        import asyncio

        result = asyncio.run(trigger.default_producer_entry_point([{"id": "sd-1"}]))
        assert result is None

    def test_idle_when_okf_bundle_dir_points_at_missing_folder(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        missing = tmp_path / "does-not-exist"
        monkeypatch.setenv("OKF_BUNDLE_DIR", str(missing))
        import asyncio

        result = asyncio.run(trigger.default_producer_entry_point([{"id": "sd-1"}]))
        assert result is None

    def test_idle_when_no_pool_supplied_even_with_valid_bundle_dir(
        self, tmp_path: Path
    ) -> None:
        import asyncio

        result = asyncio.run(
            trigger.default_producer_entry_point(
                [{"id": "sd-1"}], bundle_dir=tmp_path, pool=None
            )
        )
        assert result is None


# ============================================================================
# default_producer_entry_point — real composition smoke test (stubbed
# cocoindex, fake pool; mirrors test_producer_enrich.py's stub pattern)
# ============================================================================


def _make_coco_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex")

    def _fn_decorator(**_kwargs: object):
        def _wrap(func: object) -> object:
            return func

        return _wrap

    stub.fn = _fn_decorator
    return stub


def _coco_stubs() -> dict:
    """`bundle_writer.py` imports `_coco_api.localfs` at module scope
    (which lazily resolves `cocoindex.connectors.localfs`) — mirrors
    `test_producer_bundle_writer.py`'s stub set. This smoke test patches
    `bundle_writer.write_bundle` wholesale, so `declare_file` is never
    actually called — the stub only needs to make the import succeed."""
    return {
        "cocoindex": _make_coco_stub(),
        "cocoindex.connectors.localfs": MagicMock(name="cocoindex.connectors.localfs"),
    }


class TestDefaultProducerEntryPointSmoke:
    def test_composes_source_enrich_and_write_bundle(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Proves the wiring — NOT enrich_concept/write_bundle's own
        behaviour (that's {132.8}/{132.10}'s test suites' job). Patches
        the three lazily-imported symbols and asserts they were called
        with the right arguments in the right order."""
        with stubbed_sys_modules(_coco_stubs()):
            from scripts.cocoindex_pipeline.producer import (
                bundle_writer,
                enrich,
            )
            from scripts.cocoindex_pipeline.sources import l_records

        fake_key = object()
        fake_draft = object()

        class _FakeSource:
            def __init__(self, pool: Any) -> None:
                self.pool = pool

            async def list_concepts(self):
                return [fake_key]

        enrich_calls: "list[Any]" = []

        async def _fake_enrich_concept(key: Any, source: Any) -> Any:
            enrich_calls.append((key, source))
            return fake_draft

        write_bundle_calls: "list[Any]" = []

        def _fake_write_bundle(bundle_dir: Path, drafts: Any) -> str:
            write_bundle_calls.append((bundle_dir, list(drafts)))
            return "run-summary"

        monkeypatch.setattr(l_records, "LRecordsSource", _FakeSource)
        monkeypatch.setattr(enrich, "enrich_concept", _fake_enrich_concept)
        monkeypatch.setattr(bundle_writer, "write_bundle", _fake_write_bundle)

        fake_pool = object()

        import asyncio

        result = asyncio.run(
            trigger.default_producer_entry_point(
                [{"id": "sd-1"}], pool=fake_pool, bundle_dir=tmp_path
            )
        )

        assert result == "run-summary"
        assert enrich_calls == [(fake_key, enrich_calls[0][1])]
        assert enrich_calls[0][1].pool is fake_pool
        assert write_bundle_calls == [(tmp_path, [fake_draft])]

    def test_one_bad_concept_does_not_abort_the_run(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        with stubbed_sys_modules(_coco_stubs()):
            from scripts.cocoindex_pipeline.producer import (
                bundle_writer,
                enrich,
            )
            from scripts.cocoindex_pipeline.sources import l_records

        good_key = SimpleNamespace(rel_path="topics/good.md")
        bad_key = SimpleNamespace(rel_path="topics/bad.md")

        class _FakeSource:
            def __init__(self, pool: Any) -> None:
                self.pool = pool

            async def list_concepts(self):
                return [bad_key, good_key]

        async def _fake_enrich_concept(key: Any, _source: Any) -> Any:
            if key is bad_key:
                raise RuntimeError("boom")
            return "good-draft"

        write_bundle_calls: "list[Any]" = []

        def _fake_write_bundle(bundle_dir: Path, drafts: Any) -> str:
            write_bundle_calls.append(list(drafts))
            return "run-summary"

        monkeypatch.setattr(l_records, "LRecordsSource", _FakeSource)
        monkeypatch.setattr(enrich, "enrich_concept", _fake_enrich_concept)
        monkeypatch.setattr(bundle_writer, "write_bundle", _fake_write_bundle)

        import asyncio

        result = asyncio.run(
            trigger.default_producer_entry_point(
                [{"id": "sd-1"}], pool=object(), bundle_dir=tmp_path
            )
        )

        assert result == "run-summary"
        assert write_bundle_calls == [["good-draft"]], (
            "the bad concept must be skipped, not abort the whole run"
        )
