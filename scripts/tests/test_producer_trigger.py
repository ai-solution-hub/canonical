"""Tests for producer/trigger.py — ID-132 {132.16} G-TRIGGER: producer
post-walk chaining.

Per the {132.16} testStrategy: post-walk hook fires the producer when
source_documents change; manual invocation still works; no double-fire;
the hook is a no-op when nothing changed (delta-only, v3 §7.2).

`trigger.py` deliberately does not import `cocoindex` at module scope (see
its own docstring) — these dispatch-logic tests import it directly, no
`stubbed_sys_modules` needed. `default_producer_entry_point` now DELEGATES
to `producer/flow_def.run_producer_flow` ({132.23}); its idle-mode gate and
delegation are exercised here (both hit `flow_def`'s early idle return / a
patched spy, so neither triggers a lazy cocoindex import). The FULL composed
flow's behaviour is tested in `test_producer_flow_def.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

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
# default_producer_entry_point — delegates to flow_def.run_producer_flow
# ({132.23} superseded {132.16}'s Pass-1-only stand-in). The FULL composed
# flow's behaviour is tested in test_producer_flow_def.py; here we prove only
# that the trigger's default entry point forwards kwargs intact — and, per
# the {132.27} PASS_WITH_NOTES remediation ({132.29} fix-forward), does NOT
# forward `deltas` (a dead `run_producer_flow` param since {132.23}, removed
# here; `deltas` is consumed by the dispatch layer — trigger_producer_
# post_walk's delta gate / run_producer_now — only).
# ============================================================================


class TestDefaultEntryPointDelegatesToFlowDef:
    def test_forwards_kwargs_to_run_producer_flow_without_deltas(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # flow_def.py imports no cocoindex at module scope, so it is
        # importable here with no stub; patching run_producer_flow means no
        # lazy composed-module import is triggered at all.
        from scripts.cocoindex_pipeline.producer import flow_def

        calls: "list[dict[str, Any]]" = []

        async def _spy(**kwargs: Any) -> str:
            calls.append(kwargs)
            return "report"

        monkeypatch.setattr(flow_def, "run_producer_flow", _spy)

        import asyncio

        result = asyncio.run(
            trigger.default_producer_entry_point(
                [{"id": "sd-1"}],
                pool="POOL",
                bundle_dir="BUNDLE",
                re_target="RE_TARGET",
                repo_path="REPO",
                overrides=("OVERRIDE",),
            )
        )

        assert result == "report"
        assert len(calls) == 1
        kwargs = calls[0]
        # `deltas` is the trigger dispatch layer's own concern — never
        # forwarded into `run_producer_flow` (it has no such parameter).
        assert "deltas" not in kwargs
        assert kwargs["pool"] == "POOL"
        assert kwargs["bundle_dir"] == "BUNDLE"
        # Downstream-stage injection seams pass straight through.
        assert kwargs["re_target"] == "RE_TARGET"
        assert kwargs["repo_path"] == "REPO"
        assert kwargs["overrides"] == ("OVERRIDE",)

    def test_default_entry_point_is_the_trigger_and_manual_run_default(self) -> None:
        """Both dispatch surfaces default to the (now full-flow) entry point —
        so a real post-walk chain / manual run exercises the composed flow, not
        a Pass-1-only stand-in."""
        import inspect

        assert (
            inspect.signature(trigger.trigger_producer_post_walk)
            .parameters["entry_point"]
            .default
            is trigger.default_producer_entry_point
        )
        assert (
            inspect.signature(trigger.run_producer_now)
            .parameters["entry_point"]
            .default
            is trigger.default_producer_entry_point
        )
