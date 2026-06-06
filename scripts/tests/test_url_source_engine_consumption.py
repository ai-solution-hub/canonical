"""ID-75.16 — REAL-ENGINE probe of the mount_each consumption contract.

S319 live discovery: staging walks completed cleanly with the seeded
passed-URL ledger row DSN-visible, yet the url branch tallied ZERO items —
``mount_each(..., FeedUrlSource(pool).items(), ...)`` never enumerated the
snapshot. The TECH.md D-2 comment claimed "the engine consumes the snapshot
per walk via ``__aiter__``" — this probe proves that claim FALSE on the
installed ``cocoindex==1.0.3`` engine and pins the REAL contract:

Under ``update_blocking(live=False)``, ``mount_each`` wraps ANY source
satisfying the runtime-checkable ``LiveMapFeed`` protocol (i.e. anything
with a ``watch`` method — ``api.py``: ``isinstance(items, LiveMapFeed)``)
in an internal ``_MountEachLiveComponent`` and consumes it EXCLUSIVELY via
``process_live(operator)`` → ``items.watch(subscriber)``. ``__aiter__`` is
reached ONLY through ``subscriber.update_all()`` → ``operator.update_full()``
→ ``process()`` → ``async for`` over the view. A ``mark_ready()``-only
``watch()`` therefore feeds ZERO items — zero enumeration, zero errors,
exactly the observed staging tally ``{url: 0}``.

The proven fix mirrors the localfs ``_LiveDirItems`` twin (which is ALSO how
FILE items reach the engine under live=False — ``app_main`` builds
``localfs.walk_dir(..., live=True)``, so files flow through the same
watch-path): ``watch()`` awaits ``subscriber.update_all()`` THEN
``subscriber.mark_ready()``.

Probe mechanics follow the bl-218 precedent in ``test_cocoindex_server.py``:
the real engine boots in a SUBPROCESS (cannot pollute cocoindex's
process-global App/env registries or leak ``_LoopRunner`` daemon threads into
the shared pytest process) and the whole module self-skips where the engine
cannot boot (EPERM under sandboxed agent worktrees). Keepable-artefact spike
per the {56.18} precedent — this is the executable record of the ID-75.16
engine-semantics finding.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]

# ──────────────────────────────────────────────────────────────────────────
# Engine-availability guard (bl-218 shape, module-local copy)
# ──────────────────────────────────────────────────────────────────────────

_COCOINDEX_ENGINE_AVAILABLE: bool | None = None

_ENGINE_PROBE_SRC = """
import sys, tempfile, os
try:
    from cocoindex._internal import setting
    from cocoindex._internal.environment import Environment
    d = tempfile.mkdtemp(prefix='id75-16-engine-probe-')
    Environment(settings=setting.Settings(db_path=os.path.join(d, 'lmdb')))
except (PermissionError, OSError) as exc:
    sys.stderr.write('ENGINE_BOOT_DENIED:%r\\n' % (exc,))
    sys.exit(3)
except Exception as exc:
    sys.stderr.write('ENGINE_BOOT_ERROR:%r\\n' % (exc,))
    sys.exit(4)
sys.exit(0)
"""


def _cocoindex_engine_available() -> bool:
    """True iff the cocoindex Rust engine can boot here (see bl-218)."""
    global _COCOINDEX_ENGINE_AVAILABLE
    if _COCOINDEX_ENGINE_AVAILABLE is not None:
        return _COCOINDEX_ENGINE_AVAILABLE

    try:
        proc = subprocess.run(
            [sys.executable, "-c", _ENGINE_PROBE_SRC],
            capture_output=True,
            timeout=60,
        )
        _COCOINDEX_ENGINE_AVAILABLE = proc.returncode == 0
    except (OSError, subprocess.SubprocessError):
        _COCOINDEX_ENGINE_AVAILABLE = False
    return _COCOINDEX_ENGINE_AVAILABLE


# ──────────────────────────────────────────────────────────────────────────
# Consumption probes (run in a subprocess; print a JSON list of consumed keys)
# ──────────────────────────────────────────────────────────────────────────

# Shared scaffolding: temp LMDB state dir, a recording component, mount_each
# over the supplied items view, one update_blocking(live=False) walk — the
# bl-221 one-shot posture app_main runs in production.
_PROBE_PRELUDE = """
import asyncio, json, os, sys, tempfile

os.environ["COCOINDEX_DB"] = tempfile.mkdtemp(prefix="id75-16-consumption-")
sys.path.insert(0, {repo_root!r})

import cocoindex as coco
from scripts.cocoindex_pipeline.url_source import FeedUrlSource

CONSUMED = []


@coco.fn()
async def probe_component(value) -> None:
    CONSUMED.append(getattr(value, "url", value))


class FakePool:
    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, query, *args):
        return self._rows


ROWS = [
    # Two ledger rows for ONE URL (BI-8 grouping exercised through the
    # engine: raw values differ, normalise identically) + one distinct URL.
    {{
        "external_url": "https://example.com/article?utm_source=feed",
        "title": "Older title",
        "ai_summary": None,
        "published_at": None,
        "ingested_at": "2026-06-01T08:00:00+00:00",
        "workspace_id": "11111111-1111-4111-8111-111111111111",
    }},
    {{
        "external_url": "https://example.com/article",
        "title": "Newer title",
        "ai_summary": "Latest summary.",
        "published_at": None,
        "ingested_at": "2026-06-03T12:30:00+00:00",
        "workspace_id": "22222222-2222-4222-8222-222222222222",
    }},
    {{
        "external_url": "https://other.example.org/post",
        "title": "Other",
        "ai_summary": None,
        "published_at": None,
        "ingested_at": "2026-06-02T00:00:00+00:00",
        "workspace_id": "11111111-1111-4111-8111-111111111111",
    }},
]


async def _root(items) -> None:
    handle = await coco.mount_each(
        coco.component_subpath("probe"), probe_component, items
    )
    await handle.ready()
"""

# CASE A — PRODUCTION class: FeedUrlSource.items() consumed by mount_each
# under update_blocking(live=False) must enumerate the grouped snapshot.
_PRODUCTION_PROBE_SRC = (
    _PROBE_PRELUDE
    + """
app = coco.App("id75_16_production", _root, FeedUrlSource(FakePool(ROWS)).items())
app.update_blocking()
print(json.dumps(sorted(CONSUMED)))
"""
)

# CASE B — ENGINE-CONTRACT CONTROL: a mark_ready()-only watch (the pre-fix
# _PassedUrlItems shape) feeds NOTHING, even though __aiter__ would yield.
# Pins the engine semantics the fix depends on: if a future cocoindex
# version starts consuming __aiter__ directly under live=False, this control
# flips and the D-2 contract must be re-verified.
_NOOP_WATCH_PROBE_SRC = (
    _PROBE_PRELUDE
    + """
class NoopWatchSnapshot:
    def __aiter__(self):
        return self._impl()

    async def _impl(self):
        yield ("k1", "v1")
        yield ("k2", "v2")

    async def watch(self, subscriber):
        await subscriber.mark_ready()


app = coco.App("id75_16_noop_watch", _root, NoopWatchSnapshot())
app.update_blocking()
print(json.dumps(sorted(CONSUMED)))
"""
)

# CASE C — FIX-SHAPE CONTROL, decoupled from the production class: a minimal
# update_all-then-mark_ready watch (the _LiveDirItems twin shape the fix
# adopts) DOES feed the snapshot — update_all() -> update_full() ->
# _MountEachLiveComponent.process() -> __aiter__. Isolates the engine
# contract from FeedUrlSource's grouping/SQL seam, so a CASE-A failure can
# be attributed: engine drift (C also red) vs production-class regression
# (C still green).
_UPDATE_ALL_WATCH_PROBE_SRC = (
    _PROBE_PRELUDE
    + """
class UpdateAllWatchSnapshot:
    def __aiter__(self):
        return self._impl()

    async def _impl(self):
        yield ("k1", "v1")
        yield ("k2", "v2")

    async def watch(self, subscriber):
        await subscriber.update_all()
        await subscriber.mark_ready()


app = coco.App("id75_16_update_all_watch", _root, UpdateAllWatchSnapshot())
app.update_blocking()
print(json.dumps(sorted(CONSUMED)))
"""
)

# CASE D — PLAIN ASYNC GENERATOR (the localfs DirWalker.items() live=False
# catch-up shape): no watch attribute -> fails mount_each's LiveMapFeed
# isinstance routing -> consumed DIRECTLY via `async for`. The alternative
# consumption path, pinned so this executable D-2 record covers the engine's
# full mount_each routing matrix.
_PLAIN_ASYNC_GEN_PROBE_SRC = (
    _PROBE_PRELUDE
    + """
async def plain_items():
    yield ("k1", "v1")
    yield ("k2", "v2")


app = coco.App("id75_16_plain_async_gen", _root, plain_items())
app.update_blocking()
print(json.dumps(sorted(CONSUMED)))
"""
)


def _run_probe(src: str) -> list[str]:
    proc = subprocess.run(
        [sys.executable, "-c", src.format(repo_root=str(_REPO_ROOT))],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=_REPO_ROOT,
    )
    assert proc.returncode == 0, (
        f"engine probe subprocess failed (exit {proc.returncode}):\n{proc.stderr}"
    )
    return json.loads(proc.stdout.strip().splitlines()[-1])


@pytest.mark.skipif(
    not _cocoindex_engine_available(),
    reason="cocoindex Rust engine cannot boot here (EPERM under sandboxed "
    "worktrees — bl-218); runs in non-sandboxed CI and on dev machines",
)
class TestMountEachConsumption:
    """The ID-75.16 engine-semantics contract, executable."""

    def test_production_snapshot_is_enumerated_under_one_shot_walk(self):
        # CASE A — the landing-path acceptance: one update_blocking(live=False)
        # walk over FeedUrlSource.items() mounts ONE component per grouped URL.
        consumed = _run_probe(_PRODUCTION_PROBE_SRC)
        assert consumed == [
            "https://example.com/article",
            "https://other.example.org/post",
        ], (
            "FeedUrlSource snapshot must be enumerated by the engine under "
            f"update_blocking(live=False); consumed={consumed!r}"
        )

    def test_mark_ready_only_watch_feeds_nothing(self):
        # CASE B — the S319 defect, pinned: a watch() that only signals
        # readiness starves mount_each — __aiter__ is NEVER consulted
        # directly.
        consumed = _run_probe(_NOOP_WATCH_PROBE_SRC)
        assert consumed == [], (
            "engine contract changed: a mark_ready-only watch now feeds "
            f"items ({consumed!r}) — re-verify the D-2 consumption contract"
        )

    def test_update_all_then_mark_ready_watch_feeds_snapshot(self):
        # CASE C — the fix shape, decoupled from FeedUrlSource: an
        # update_all-then-mark_ready watch feeds the full snapshot through
        # update_full() -> process() -> __aiter__.
        consumed = _run_probe(_UPDATE_ALL_WATCH_PROBE_SRC)
        assert consumed == ["v1", "v2"], (
            "engine contract changed: the update_all-then-mark_ready watch "
            f"shape no longer feeds the snapshot ({consumed!r}) — re-verify "
            "the D-2 consumption contract"
        )

    def test_plain_async_generator_is_consumed_directly(self):
        # CASE D — a watch-less plain async generator (the localfs
        # live=False catch-up shape) bypasses the live-component wrapper and
        # is iterated directly by mount_each.
        consumed = _run_probe(_PLAIN_ASYNC_GEN_PROBE_SRC)
        assert consumed == ["v1", "v2"], (
            "engine contract changed: mount_each no longer iterates a plain "
            f"AsyncIterable directly ({consumed!r}) — re-verify the D-2 "
            "consumption contract"
        )
