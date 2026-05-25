"""Idle-mode load test for cocoindex_pipeline/flow.py.

Verifies the contract that the flow module is importable in any
environment WITHOUT triggering:

  - LMDB / cocoindex Rust engine boot
  - Anthropic API key requirement
  - Postgres connection attempt
  - HTTP webhook emission

This contract underpins the O-Q8 idle-mode design (per
`docs/specs/cocoindex-flow-scaffolding/TECH.md` §P-2): the Cloud Run
Service binary boots via `python3 -m scripts.cocoindex_pipeline` and
stays running in idle mode until `COCOINDEX_SOURCE_PATH` is set. CI
must be able to import the module to exercise `KH_PIPELINE_APP` static
checks even when ANTHROPIC_API_KEY is unset.

This is also the safety net for the Path A WP4 extraction wiring
(S256): the `@coco.fn(memo=True)` decorator-time evaluation of
`extract_classification` / `extract_qa_form` / `extract_entity_mentions`
must complete without an Anthropic client connection — only the
extractor *body* (i.e. `await client.messages.create(...)`) requires
the API key, which is exercised only when cocoindex actually runs the
flow on a real source-binding.

Test strategy: ID-28.12 WP4 — idle-mode load with no env / API key.
Reference: docs/specs/cocoindex-flow-scaffolding/TECH.md §P-2
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest


# ── Path setup ──────────────────────────────────────────────────────────────

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))


# ============================================================================
# IDLE-MODE LOAD CONTRACT
# ============================================================================


class TestFlowModuleIdleLoad:
    """Verify flow.py imports cleanly in an idle environment."""

    def test_flow_module_imports_without_anthropic_api_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`from cocoindex_pipeline.flow import KH_PIPELINE_APP` must succeed
        with NO ANTHROPIC_API_KEY env var set.

        The 3 Path A extractors call `anthropic.AsyncAnthropic()` only
        at runtime (inside the function body), not at import time. The
        decorator-time `@coco.fn(memo=True)` evaluation must NOT
        construct a client.
        """
        # Strip the API key — exercising the idle-load contract.
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        # Force a fresh import to ensure we hit the cold-path.
        # If KH_PIPELINE_APP is already cached from a previous test, force
        # re-evaluation by purging the module entry.
        sys.modules.pop("cocoindex_pipeline.flow", None)
        sys.modules.pop("cocoindex_pipeline.extraction", None)
        # Re-import — should succeed without raising.
        from cocoindex_pipeline.flow import KH_PIPELINE_APP

        assert KH_PIPELINE_APP is not None, (
            "KH_PIPELINE_APP must be defined at module load"
        )

    def test_flow_module_exposes_kh_pipeline_app(self) -> None:
        """flow.py exposes KH_PIPELINE_APP — the cocoindex App handle used
        by __main__.py + the Cloud Run Service GOOGLE_ENTRYPOINT."""
        from cocoindex_pipeline.flow import KH_PIPELINE_APP

        # KH_PIPELINE_APP is assembled via coco.App(coco.AppConfig(...), app_main)
        # at module scope — its concrete type is cocoindex._internal.app.App
        # but we don't introspect the private internals; the public contract
        # is "must be non-None and callable into via cocoindex.start_blocking()".
        assert KH_PIPELINE_APP is not None
        # Pipeline name is the canonical 'kh_pipeline' per S254 / 28.8.
        # The AppConfig stores this; the App handle should expose access
        # paths consistent with cocoindex 1.0.3 — but the public assertion
        # we make is on the import-time landing of the symbol.

    def test_flow_module_exposes_app_main_coroutine(self) -> None:
        """flow.app_main is an async function — the cocoindex App update cycle
        invokes it per the §P-2 contract."""
        from cocoindex_pipeline import flow

        assert hasattr(flow, "app_main"), "flow.py must expose app_main"
        # inspect.iscoroutinefunction is the canonical check (asyncio.* is
        # deprecated for removal in Python 3.16).
        import inspect

        assert inspect.iscoroutinefunction(flow.app_main), (
            "flow.app_main must be an async function (cocoindex's main_fn contract)"
        )

    def test_flow_module_exposes_path_a_extractors(self) -> None:
        """flow.py imports the 3 Path A extractors from extraction.py per
        S256 W1 / WP4 — these symbols MUST be present on the flow module
        post-import (Stage 3 wiring relies on them at app_main() body).

        Asserting awaitability (rather than `type.__name__ == "AsyncFunction"`)
        keeps this test robust to sibling tests that stub cocoindex at the
        `sys.modules` boundary (which reduces `@coco.fn` to a passthrough
        in those test sessions)."""
        import inspect

        from cocoindex_pipeline import flow

        for name in (
            "extract_classification",
            "extract_qa_form",
            "extract_entity_mentions",
        ):
            assert hasattr(flow, name), (
                f"flow.py must import {name!r} for Stage 3 Path A wiring"
            )
            extractor = getattr(flow, name)
            # Per S256 W1 stub-pattern verification: decorated symbol must
            # be callable + return an awaitable when called. (Real cocoindex
            # → AsyncFunction instance; stubbed cocoindex → plain async fn.)
            assert callable(extractor), f"flow.{name} must be callable"
            coro = extractor("test content")
            try:
                assert inspect.isawaitable(coro), (
                    f"flow.{name}() must return an awaitable; "
                    f"got type {type(coro).__name__!r}"
                )
            finally:
                if hasattr(coro, "close"):
                    coro.close()

    def test_flow_module_exposes_stamp_extraction_base(self) -> None:
        """flow.py imports stamp_extraction_base — even though v1 cannot
        wire it at flow scope yet (per 28.12 WP4 stamp_extraction_base
        integration gap), the helper MUST be at hand for 28.13's
        per-row stamping wiring."""
        from cocoindex_pipeline import flow

        assert hasattr(flow, "stamp_extraction_base"), (
            "flow.py must import stamp_extraction_base — needed for the "
            "28.13 per-row stamping wiring (28.12 WP4 documents the "
            "integration gap)"
        )
        assert callable(flow.stamp_extraction_base), (
            "stamp_extraction_base must be callable"
        )

    def test_anthropic_model_constant_is_canonical(self) -> None:
        """flow.ANTHROPIC_MODEL == 'claude-opus-4-6' per cocoindex-extraction-
        contract TECH §3.1 + lib/anthropic.ts:29 + scripts/kb_pipeline/config.py:29,
        AND it is the *same object* re-exported from extraction.py — proving a
        single source of truth (ID-44.3 dedup), not two equal literals that can
        silently drift on a model upgrade."""
        from cocoindex_pipeline import extraction, flow

        assert flow.ANTHROPIC_MODEL == "claude-opus-4-6", (
            f"flow.ANTHROPIC_MODEL must be 'claude-opus-4-6' (production "
            f"drafting tier per Q-EX2 §3.1 + lib/anthropic.ts); got "
            f"{flow.ANTHROPIC_MODEL!r}"
        )
        assert flow.ANTHROPIC_MODEL is extraction.ANTHROPIC_MODEL, (
            "flow.ANTHROPIC_MODEL must be the canonical constant re-exported "
            "from extraction.py (single source of truth per ID-44.3), not an "
            "independent literal that can drift on a model upgrade"
        )


class TestExtractionModuleIdleLoad:
    """Verify extraction.py imports cleanly without external dependencies."""

    def test_extraction_imports_without_api_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """extraction.py module load is side-effect-free (no anthropic
        client construction; no network call).

        Asserts behavioural awaitability rather than internal type name
        per the test-isolation note on `test_flow_module_exposes_path_a_extractors`.
        """
        import inspect

        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        sys.modules.pop("cocoindex_pipeline.extraction", None)
        from cocoindex_pipeline.extraction import (
            extract_classification,
            extract_entity_mentions,
            extract_qa_form,
        )

        # All 3 extractors are decorated by @coco.fn(memo=True); the
        # decorator runs at import time but does NOT instantiate any
        # anthropic client (verified by no API key in env).
        for fn in (
            extract_classification,
            extract_qa_form,
            extract_entity_mentions,
        ):
            assert callable(fn)
            coro = fn("test")
            try:
                assert inspect.isawaitable(coro), (
                    f"extractor must return an awaitable; "
                    f"got type {type(coro).__name__!r}"
                )
            finally:
                if hasattr(coro, "close"):
                    coro.close()

    def test_no_extractbyllm_in_active_code(self) -> None:
        """extraction.py has zero active references to ExtractByLlm / LlmSpec /
        LlmApiType — these symbols are ABSENT in cocoindex 1.0.3 (Path A
        canonical pattern post-S256 W1).

        Comments / docstrings may reference them as historical context,
        but `import` statements MUST NOT.
        """
        from cocoindex_pipeline import extraction

        # extraction module dict — these names must NOT be defined.
        for sym in ("ExtractByLlm", "LlmSpec", "LlmApiType"):
            assert sym not in dir(extraction), (
                f"extraction.py must NOT import {sym!r} — Path A pattern "
                f"(see cocoindex-extraction-contract TECH §3.1 + S256 W1 amendment)"
            )
