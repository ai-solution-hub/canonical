"""Shared pytest fixtures for KB pipeline tests."""

import contextlib
import json
import os
import sys
from collections.abc import Iterator, Mapping
from types import ModuleType
from unittest.mock import MagicMock

import pytest

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
SNAPSHOT_PATH = os.path.join(FIXTURE_DIR, "taxonomy_snapshot.json")


# ──────────────────────────────────────────────────────────────────────────
# Cross-file stub isolation (ID-44.5)
# ──────────────────────────────────────────────────────────────────────────
#
# Several cocoindex pipeline test files must import their module-under-test
# (e.g. `from cocoindex_pipeline import flow`) with `cocoindex` / `aiohttp` /
# `docling` / connector submodules replaced by `MagicMock` stubs — booting the
# real cocoindex Rust/LMDB engine at test-collection time is both slow and
# requires a disabled sandbox.
#
# The historical pattern installed those stubs via module-scope
# `sys.modules.setdefault(name, MagicMock(...))` and NEVER removed them. Because
# pytest collects every test file into ONE process, the stubs leaked across
# files: cocoindex 1.0.3 keeps a process-global `ContextKey` registry + `@coco.fn`
# stub, so a stub installed by file A was still resident when file B ran. Two
# concrete failure modes resulted:
#
#   * `test_cocoindex_server.py` resolves the REAL `aiohttp` — a leaked
#     `aiohttp` MagicMock stub broke its `make_mocked_request` / `web` imports
#     (previously papered over by a defensive `del sys.modules[...]` block).
#   * `test_cocoindex_flow_context.py::...test_flow_meta_ctx_is_a_coco_context_key`
#     silently downgraded to a weaker assertion whenever a leaked `cocoindex`
#     stub was resident, so its strict `ContextKey.key == "..."` check never ran
#     in the combined suite.
#
# `stubbed_sys_modules()` fixes the root cause: it installs the stubs ONLY for
# the duration of the `with` block (which wraps the module-under-test import),
# then restores `sys.modules` to its prior state — the real module if one was
# present, or absence otherwise. The imported module keeps the stub references
# it captured at import time, so its own tests still run stub-backed; sibling
# files see a clean `sys.modules` and resolve the real packages.


def passthrough_coco_fn(**_kwargs: object):
    """A working stand-in for cocoindex's `@coco.fn(memo=True)` decorator.

    `flow.py` imports `extraction.py`, whose Path-A extractors are decorated
    `@coco.fn(memo=True)`. A bare `MagicMock` `.fn` turns those coroutines into
    un-awaitable MagicMocks. Every cocoindex stub used by a flow-importing test
    file therefore installs THIS pass-through so `extract_classification(...)`
    stays the real awaitable coroutine, regardless of which file triggers the
    (cached) `extraction` import first — making cocoindex residency
    order-independent (ID-44.5).
    """

    def _wrap(func: object) -> object:
        return func

    return _wrap


@contextlib.contextmanager
def stubbed_sys_modules(stubs: Mapping[str, ModuleType]) -> Iterator[None]:
    """Install `stubs` into `sys.modules` for the block, then restore.

    Snapshots each key's prior value (or its absence) on entry and restores it
    on exit — including the exception path — so no stub leaks past the `with`
    block into sibling test modules sharing the pytest process.

    Intended usage wraps the module-under-test import::

        with stubbed_sys_modules({"cocoindex": _coco_stub, ...}):
            from cocoindex_pipeline import flow  # captures the stub at import
    """
    sentinel = object()
    saved: dict[str, object] = {}
    for name, module in stubs.items():
        saved[name] = sys.modules.get(name, sentinel)
        sys.modules[name] = module
    try:
        yield
    finally:
        for name in stubs:
            prior = saved[name]
            if prior is sentinel:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = prior  # type: ignore[assignment]


# ──────────────────────────────────────────────────────────────────────────
# Centralised flow-import isolation (ID-55.1)
# ──────────────────────────────────────────────────────────────────────────
#
# Before ID-55.1 each cocoindex flow-importing test file carried its OWN copy of
# the `_StubContextKey` + `_make_coco_stub()` + stubs-dict + pop-both-keys +
# stubbed-import dance. ID-49.7 applied that pattern INCONSISTENTLY across files,
# so every new flow test re-derived the isolation (and could get it subtly
# wrong — a forgotten key-pop or a missing connector stub leaks state across the
# shared pytest process and makes the suite collection-order sensitive). This
# block is the SINGLE canonical primitive: import it from `conftest` and the
# isolation is identical everywhere.
#
# Namespace note: `flow.py` is imported here under the TOP-LEVEL
# `cocoindex_pipeline.flow` spelling the flow-test corpus uses (its sibling
# `flow_context` / `extraction` imports + `current_flow_meta()` ContextVar reads
# all resolve through the SAME `__package__`). The production runtime loads the
# DISTINCT `scripts.cocoindex_pipeline.flow` object — so `fresh_flow_module()`
# pops BOTH keys to force a clean re-exec regardless of which namespace a sibling
# imported first. Full canonicalisation onto the `scripts.` namespace is bl-185.


class StubContextKey:
    """Hashable ``cocoindex.ContextKey`` stand-in usable as a dict key.

    `flow.py` builds `DB_CTX = coco.ContextKey("kh_pipeline_db")` and provides it
    into the lifespan env as a dict key; a bare `MagicMock` is unhashable in some
    call shapes and cannot round-trip as a key. This minimal class mirrors the
    real `ContextKey`'s `.key` attribute + hashability without booting cocoindex.
    """

    def __init__(self, key: str = "stub") -> None:
        self.key = key


def make_cocoindex_stubs(
    extra: Mapping[str, ModuleType] | None = None,
) -> dict[str, object]:
    """Build the standard `sys.modules` stub set a flow-import needs.

    Covers `cocoindex` (with a `passthrough_coco_fn` `.fn`, a no-op `.lifespan`,
    a `StubContextKey`, and the App/mount/env surfaces flow.py touches at import)
    plus the `connectors` / `connectorkits` / `docling` submodules — booting the
    real cocoindex Rust/LMDB engine at import time is slow and needs a disabled
    sandbox. `extra` overrides/extends the defaults for a specific test.
    """
    coco_stub = MagicMock(name="cocoindex")
    coco_stub.fn = passthrough_coco_fn
    coco_stub.lifespan = lambda fn=None: fn
    coco_stub.ContextKey = StubContextKey
    coco_stub.AppConfig = MagicMock(name="AppConfig")
    coco_stub.App = MagicMock(name="App")
    coco_stub.mount_each = MagicMock(name="mount_each")
    coco_stub.use_context = MagicMock(name="use_context")
    coco_stub.EnvironmentBuilder = MagicMock(name="EnvironmentBuilder")

    pg_stub = MagicMock(name="cocoindex.connectors.postgres")
    pg_stub.ColumnDef = MagicMock(name="ColumnDef")
    pg_stub.TableSchema = MagicMock(name="TableSchema")
    pg_stub.mount_table_target = MagicMock(name="mount_table_target")

    target_stub = MagicMock(name="cocoindex.connectorkits.target")
    target_stub.ManagedBy = MagicMock(name="ManagedBy")

    stubs: dict[str, object] = {
        "cocoindex": coco_stub,
        "cocoindex.connectors": MagicMock(name="cocoindex.connectors"),
        "cocoindex.connectors.localfs": MagicMock(
            name="cocoindex.connectors.localfs"
        ),
        "cocoindex.connectors.postgres": pg_stub,
        "cocoindex.connectorkits": MagicMock(name="cocoindex.connectorkits"),
        "cocoindex.connectorkits.target": target_stub,
        "docling": MagicMock(name="docling"),
        "docling.document_converter": MagicMock(name="docling.document_converter"),
    }
    if extra is not None:
        stubs.update(extra)
    return stubs


# Module attributes a sibling test file may have pinned on the flow module (a
# cooperative stub, e.g. `flow.aiohttp = _StubSession` from the pipeline-run
# webhook test). A fresh import resets them; `fresh_flow_module()` restores any
# MagicMock-typed pin so collection order stays irrelevant (ID-44.5 discipline).
_PRESERVED_FLOW_ATTRS: tuple[str, ...] = ("aiohttp",)


def fresh_flow_module(
    extra_stubs: Mapping[str, ModuleType] | None = None,
    *,
    preserve_attrs: tuple[str, ...] = _PRESERVED_FLOW_ATTRS,
) -> ModuleType:
    """Import a FRESH `cocoindex_pipeline.flow` under cocoindex stubs.

    The canonical replacement for the per-file `_flow_module()` helpers. It:

      1. Snapshots any cooperative MagicMock pins (`preserve_attrs`) a sibling
         set on the resident flow module.
      2. Pops BOTH `cocoindex_pipeline.flow` and `scripts.cocoindex_pipeline.flow`
         from `sys.modules` so flow.py re-executes its module body under THIS
         call's stubs — a stale entry under EITHER key would shortcut the import
         and leave a sibling-stub-captured module resident (the ID-44.5 dual-path
         hazard).
      3. Imports flow inside `stubbed_sys_modules(...)` (stubs auto-restored on
         exit; the module keeps the stub references it captured at import time).
      4. Restores the snapshotted pins.

    Pass `extra_stubs` to add/override stub modules for a specific test.
    """
    resident = sys.modules.get("cocoindex_pipeline.flow") or sys.modules.get(
        "scripts.cocoindex_pipeline.flow"
    )
    snapshot: dict[str, MagicMock] = {}
    for attr in preserve_attrs:
        value = getattr(resident, attr, None) if resident is not None else None
        if isinstance(value, MagicMock):
            snapshot[attr] = value

    sys.modules.pop("cocoindex_pipeline.flow", None)
    sys.modules.pop("scripts.cocoindex_pipeline.flow", None)

    import importlib  # noqa: PLC0415

    with stubbed_sys_modules(make_cocoindex_stubs(extra_stubs)):
        # `import_module` re-EXECUTES flow.py under the active stubs AND
        # re-registers the `cocoindex_pipeline.flow` sys.modules key. A plain
        # `from cocoindex_pipeline import flow` would instead hand back the STALE
        # package `.flow` attribute the pop left behind (the IMPORT_FROM getattr
        # shortcut) WITHOUT re-registering — yielding a sibling-stub-captured
        # module and breaking any downstream `importlib.reload(flow)` with
        # "module not in sys.modules" (the ID-49.7 reload collision this
        # primitive exists to eliminate; verified empirically in ID-55.1).
        flow = importlib.import_module("cocoindex_pipeline.flow")

    for attr, value in snapshot.items():
        setattr(flow, attr, value)
    return flow


@pytest.fixture(scope="session")
def taxonomy_from_snapshot():
    """Load taxonomy from committed snapshot file.

    The snapshot is generated by `bun run sync:taxonomy` and committed to the
    repo. This avoids requiring a live DB connection for unit tests while still
    using current taxonomy data.
    """
    with open(SNAPSHOT_PATH) as f:
        return json.load(f)


@pytest.fixture(scope="session")
def valid_domains(taxonomy_from_snapshot):
    """Active domain names from the taxonomy snapshot."""
    return taxonomy_from_snapshot["domains"]


@pytest.fixture(scope="session")
def valid_subtopics(taxonomy_from_snapshot):
    """Active subtopic names from the taxonomy snapshot."""
    return taxonomy_from_snapshot["subtopics"]
