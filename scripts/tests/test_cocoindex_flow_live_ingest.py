"""Engine-level live-ingest regression for the cocoindex daemon-thread
ContextVar non-propagation bug (ID-66.19).

WHY THIS FILE EXISTS — the gap no sibling test covers
─────────────────────────────────────────────────────
Every existing cocoindex flow test (``test_cocoindex_flow_write_path.py``,
``test_cocoindex_flow_stage_counts.py``, the form-write suite) either calls
``ingest_file`` DIRECTLY on the test's own asyncio task, or drives a
``_faithful_mount_each`` that ``await``s ``fn(...)`` on that SAME task. In both
shapes the ``contextvars.ContextVar`` bindings ``app_main`` sets via
``bind_flow_meta`` / ``bind_stage_counter`` / ``bind_workspace_manifest`` are
INTACT when ``ingest_file`` reads them back — because a coroutine awaited on the
binding task inherits the caller's contextvar snapshot.

Production does NOT work that way. cocoindex 1.0.3's engine does not invoke the
per-item ``ingest_file`` component inline on the binding asyncio task: it
schedules it on its OWN ``_LoopRunner`` daemon thread, which runs a SEPARATE
event loop and does NOT copy the binder task's ContextVar values across the
dispatch boundary. So in production every ``current_*()`` read inside
``ingest_file`` returned the ContextVar DEFAULT (``None``):

  * ``current_flow_meta()`` → None → ``ingest_file`` raised "invoked without an
    active FLOW_META_CTX binding" → ZERO rows landed in live mode.
  * ``current_workspace_manifest()`` → None → the Path-B folder→workspace
    form-write block was silently skipped → form rows never written.
  * ``current_stage_counter()`` → None → ``stage_counts`` stayed 0 even when the
    stages actually ran.

This file reproduces the engine's dispatch boundary FAITHFULLY without booting
the real cocoindex Rust/LMDB engine (which would leak process-global App /
ContextKey / lifespan registrations and break the idle-mode re-import contract):
``_thread_dispatch_mount_each`` runs ``ingest_file`` on a fresh OS thread with a
fresh event loop — the SAME contextvar-isolation the ``_LoopRunner`` daemon
thread imposes. A ``contextvars.ContextVar`` set on the binding thread is NOT
visible on that worker thread+loop, so this harness surfaces the bug the inline
harnesses hide.

TEST STRATEGY (ID-66.19 testStrategy contract):
  ``app_main`` over a temp dir (1 .md + .kh-workspace-map.json) lands a row with
  the CORRECT op_id + non-zero stage_counts + a Path-B form write; the test
  fails on current main (None op_id / 0 rows / skipped form write — the
  daemon-thread ContextVar bug) and passes after the Option-A fix (functools
  .partial explicit args onto ingest_file + local re-bind inside ingest_file).

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference: docs/reference/task-list.json → ID-66 → Subtask 19.
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

import pytest


_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from conftest import fresh_flow_module  # noqa: E402


def _flow_module():
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive).

    Same isolation primitive the write-path / stage-count suites use: imports
    flow behind ``stubbed_sys_modules`` so flow captures STUB references for the
    process-global registration surfaces (App / ContextKey / lifespan) while
    ``passthrough_coco_fn`` keeps ``@coco.fn`` extractors real + awaitable.
    """
    return fresh_flow_module()


# ── Fakes ─────────────────────────────────────────────────────────────────────


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB.

    ``declare_row`` is invoked from the worker thread (where the engine runs the
    component), so the list append must be thread-safe enough for this single
    -writer harness — CPython list.append is atomic under the GIL, which is all a
    one-worker-thread dispatch needs.
    """

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)

    def declare_vector_index(self, **kwargs: object) -> None:  # pragma: no cover
        pass


class _FakeFile:
    """localfs.File stand-in with a RELATIVE ``file_path.path`` (the production
    shape: localfs paths are relative to ``COCOINDEX_SOURCE_PATH`` so the
    manifest path-prefix match works). Reads bytes from a real on-disk file."""

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str, disk_path: Path) -> None:
        self.file_path = _FakeFile._FilePath(Path(rel_path))
        self._disk = disk_path

    @property
    def size(self) -> int:
        return self._disk.stat().st_size

    async def read(self) -> bytes:
        return self._disk.read_bytes()

    async def read_text(self) -> str:
        return self._disk.read_text()

    async def content_fingerprint(self) -> bytes:
        import hashlib

        return hashlib.sha256(self._disk.read_bytes()).digest()


class _KeyedItemsFeed:
    """Async iterable of ``(relative_path: str, File)`` pairs — mirrors
    ``localfs.walk_dir(...).items()`` (yields ``(rel_posix, File)``)."""

    def __init__(self, pairs: list[tuple[str, object]]) -> None:
        self._pairs = pairs

    async def __aiter__(self):  # type: ignore[no-untyped-def]
        for pair in self._pairs:
            yield pair


async def _thread_dispatch_mount_each(fn, items, *extra_args):
    """Faithful stand-in for ``coco.mount_each`` (1.0.3) that reproduces the
    engine's DAEMON-THREAD dispatch boundary.

    The installed engine runs each per-item ``fn(value, *extra_args)`` on its own
    ``_LoopRunner`` daemon thread (a SEPARATE event loop), NOT inline on the
    binder's asyncio task. ``contextvars`` are per-(thread, task), so a
    ``ContextVar`` set on the binder task is NOT visible inside ``fn`` when the
    engine runs it on that worker thread. This harness reproduces exactly that:
    each item's ``fn`` runs via ``asyncio.run`` on a fresh worker thread with a
    fresh loop, so the binder's contextvar snapshot does NOT cross over.

    This is an ``async def`` so it matches the real ``mount_each`` coroutine
    contract (``app_main`` does ``handle = await coco.mount_each(...)``). It must
    NOT call ``asyncio.run`` on the binder loop (that raises "cannot be called
    from a running event loop"); instead each worker thread runs its OWN
    ``asyncio.run`` on a fresh loop, and the binder coroutine drives the threads
    via ``run_in_executor`` so the binder loop is never blocked.

    A handle exposing ``ready()`` is returned to mirror the
    ``handle = await coco.mount_each(...); await handle.ready()`` shape. The
    per-item work completes before this coroutine returns, so ``ready()`` is a
    no-op await.

    The key (relative path) is consumed for subpath routing and NOT forwarded to
    ``fn`` — matching cocoindex ``_internal/api.py`` ``_mount_one``:
    ``fn(item, *extra_args)``.
    """
    errors: list[BaseException] = []
    loop = asyncio.get_running_loop()

    def _run_on_worker_thread(item) -> None:
        # Fresh event loop on a fresh OS thread → the binder task's ContextVar
        # snapshot is NOT inherited here (the production _LoopRunner daemon-thread
        # reality this whole file exists for). asyncio.run is SAFE here because it
        # runs on a DISTINCT thread with no running loop of its own.
        try:
            asyncio.run(fn(item, *extra_args))
        except BaseException as exc:  # noqa: BLE001 — surfaced on the binder below
            errors.append(exc)

    async for key, value in items:
        assert isinstance(key, str), "mount_each keys are relative-path strings"
        # Drive the worker thread from the binder loop WITHOUT blocking it and
        # WITHOUT a nested asyncio.run on the binder loop.
        await loop.run_in_executor(None, _run_on_worker_thread, value)

    if errors:
        # Surface the first worker-thread failure on the binder task so
        # app_main's try/except classifies it (matches engine propagation).
        raise errors[0]

    class _Handle:
        async def ready(self) -> None:
            return None

    return _Handle()


def _run_app_main_over_dir(
    flow,
    source_dir: Path,
    targets: dict[str, _FakeTarget],
    monkeypatch: pytest.MonkeyPatch,
    *,
    classification=None,
) -> tuple[uuid.UUID, object]:
    """Drive the REAL ``flow.app_main`` over ``source_dir`` in live mode, with
    the engine's daemon-thread dispatch reproduced via
    ``_thread_dispatch_mount_each`` and all external services stubbed.

    ``classification`` optionally overrides the default classification extractor
    stub (used by the caveat test to read ``current_flow_meta()`` on the worker
    thread). Returns ``(op_id, stage_counter)``:

      * ``op_id`` — the run's op_id (captured from ``uuid.uuid4`` at flow start)
        so the caller can assert the declared rows carry the SAME op_id.
      * ``stage_counter`` — the EXACT ``_FlowStageCounter`` instance ``app_main``
        constructs and threads into ``ingest_file`` via the ID-66.19
        ``functools.partial`` mechanism. The per-item ``_bump`` calls inside
        ``ingest_file`` (``"source_walk"``, ``"embedding"``, …) run on the worker
        thread, so a non-zero count on THIS instance proves the counter crossed
        the daemon-thread boundary — exactly the third leg of the {66.19}
        testStrategy (op_id + non-zero stage_counts + Path-B form write). On
        current main the counter rode the broken ContextVar path (like op_id) and
        stayed 0 because ``_run``'s ``stage_counter`` was None and every ``_bump``
        was skipped by the ``if stage_counter is not None`` guard.
    """
    captured_op_id: dict[str, uuid.UUID] = {}
    captured_stage_counter: dict[str, object] = {}

    # ── Stub Stage 2/3/4 so no Docling / anthropic / OpenAI / network fires.
    async def _fake_convert(file: object) -> str:
        return "# Heading\n\nLive ingest body text."

    async def _default_classification(content_text: str):
        return {
            "content_type": "case_study",
            "primary_domain": "procurement",
            "primary_subtopic": "tender_evaluation",
        }

    async def _fake_qa(content_text: str):
        return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

    async def _fake_entities(content_text: str):
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(
        flow, "extract_classification", classification or _default_classification
    )
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

    # ── Stub the Path-B form-write boundary: this .md resolves to a workspace
    # via the manifest but is NOT a form-bearing file, so extract_form_structure
    # returns None and the form-write block returns AFTER proving it RAN (i.e.
    # current_workspace_manifest() was non-None on the worker thread). We assert
    # the form-write path executed by spying on resolve_workspace.
    resolve_calls: list[str] = []
    real_resolve = flow.resolve_workspace

    def _spy_resolve(manifest, rel_path):
        resolve_calls.append(rel_path)
        return real_resolve(manifest, rel_path)

    monkeypatch.setattr(flow, "resolve_workspace", _spy_resolve)
    targets.setdefault("_resolve_calls", resolve_calls)  # type: ignore[arg-type]

    async def _fake_form_structure(file: object):
        # Not a form-bearing file — the form-write block resolves the workspace
        # (proving the manifest reached the worker thread) then returns None.
        return None

    monkeypatch.setattr(flow, "extract_form_structure", _fake_form_structure)

    # ── Capture the run op_id minted at flow start.
    real_uuid4 = uuid.uuid4

    def _capture_uuid4() -> uuid.UUID:
        value = real_uuid4()
        captured_op_id.setdefault("op_id", value)
        return value

    monkeypatch.setattr(flow.uuid, "uuid4", _capture_uuid4)

    # ── Engine-dispatch stand-in: run ingest_file on a separate thread+loop.
    monkeypatch.setattr(flow.coco, "mount_each", _thread_dispatch_mount_each)

    # ── Capture the EXACT stage counter app_main constructs + threads into
    # ingest_file (ID-66.19 functools.partial). _bump("source_walk") /
    # _bump("embedding") fire on the worker thread; a non-zero count on THIS
    # instance proves the counter crossed the daemon-thread boundary — the
    # non-zero stage_counts leg of the {66.19} testStrategy. Wrap the real class
    # (do not subclass) so production increment/get semantics are exercised
    # verbatim.
    real_stage_counter_cls = flow._FlowStageCounter

    def _capturing_stage_counter():
        counter = real_stage_counter_cls()
        captured_stage_counter.setdefault("counter", counter)
        return counter

    monkeypatch.setattr(flow, "_FlowStageCounter", _capturing_stage_counter)

    # ── mount_table_target returns our recording fakes (no real Postgres).
    async def _fake_mount_table_target(db_ctx, table_name, schema, *, managed_by):
        return targets[table_name]

    monkeypatch.setattr(flow, "mount_table_target", _fake_mount_table_target)

    # ── Stage 1 source walk: yield exactly the .md under the source dir as a
    # keyed (rel_path, File) feed; .kh-workspace-map.json is the manifest, not a
    # walked item. Stub localfs.walk_dir to return an object whose .items()
    # yields our feed (mirrors the production walk_dir(...).items() shape).
    md_files = [p for p in source_dir.iterdir() if p.suffix == ".md"]

    class _FakeWalk:
        def items(self):
            return _KeyedItemsFeed(
                [(p.name, _FakeFile(p.name, p)) for p in md_files]
            )

    def _fake_walk_dir(path, *, live, recursive):
        return _FakeWalk()

    monkeypatch.setattr(flow.localfs, "walk_dir", _fake_walk_dir)

    # ── Stage-5 cross-document resolution needs a real DB pool; stub it out (the
    # bug under test is the per-item fan-out, not Stage 5).
    async def _fake_stage_5(*args, **kwargs):
        return 0

    monkeypatch.setattr(flow, "_run_stage_5_resolution", _fake_stage_5)
    monkeypatch.setattr(flow.coco, "use_context", lambda key: None)

    # ── Silence the flow-start / flow-end webhook emission.
    async def _fake_webhook(**kwargs):
        return None

    monkeypatch.setattr(flow, "_emit_pipeline_run_webhook", _fake_webhook)

    # ── Live mode: point COCOINDEX_SOURCE_PATH at the temp dir.
    monkeypatch.setenv("COCOINDEX_SOURCE_PATH", str(source_dir))

    asyncio.run(flow.app_main())

    return captured_op_id["op_id"], captured_stage_counter["counter"]


def _write_workspace_manifest(source_dir: Path, prefix: str, workspace_id: uuid.UUID):
    """Write a .kh-workspace-map.json mapping ``prefix`` → ``workspace_id``."""
    manifest = {
        "schema_version": 1,
        "mappings": [{"path_prefix": prefix, "workspace_id": str(workspace_id)}],
    }
    (source_dir / ".kh-workspace-map.json").write_text(json.dumps(manifest))


class TestLiveIngestAcrossDaemonThreadBoundary:
    """``app_main`` lands a correctly-stamped row + non-zero stage_counts + a
    Path-B form write when ``ingest_file`` runs on the engine's daemon thread.

    This is the regression that bites the ID-66.19 bug: the per-item component
    runs on a SEPARATE thread+loop, so contextvar bindings set by ``app_main``
    do NOT reach ``ingest_file`` unless the run context is threaded explicitly
    (Option A: functools.partial args + local re-bind)."""

    def test_app_main_live_lands_row_with_op_id_and_form_write(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        # Stage exactly one .md under a manifest-mapped prefix. The on-disk file
        # name doubles as the relative path the manifest matches (prefix "").
        source_dir = tmp_path
        (source_dir / "doc-one.md").write_text("# Heading\n\nLive ingest body.")
        workspace_id = uuid.uuid4()
        # Empty prefix matches every rel_path so the single .md resolves.
        _write_workspace_manifest(source_dir, "", workspace_id)

        targets = {
            "content_items": _FakeTarget("content_items"),
            "q_a_extractions": _FakeTarget("q_a_extractions"),
            "source_documents": _FakeTarget("source_documents"),
            "entity_mentions": _FakeTarget("entity_mentions"),
            "form_templates": _FakeTarget("form_templates"),
            "form_template_fields": _FakeTarget("form_template_fields"),
            "content_chunks": _FakeTarget("content_chunks"),
        }

        run_op_id, stage_counter = _run_app_main_over_dir(
            flow, source_dir, targets, monkeypatch
        )

        ci = targets["content_items"]
        sd = targets["source_documents"]
        resolve_calls = targets["_resolve_calls"]  # type: ignore[index]

        # (a) A content_items row landed with the CORRECT op_id — NOT None, and
        # equal to the run's op_id. On current main: 0 rows (ingest_file raised
        # RuntimeError on the worker thread because current_flow_meta() was None).
        assert len(ci.rows) == 1, (
            "expected exactly one content_items row to land in live mode; "
            f"got {len(ci.rows)} (current main: ingest_file raised on the worker "
            "thread because current_flow_meta() returned None across the "
            "daemon-thread dispatch boundary)"
        )
        assert ci.rows[0]["op_id"] is not None, (
            "content_items row op_id must not be None — it must carry the run op_id"
        )
        assert ci.rows[0]["op_id"] == run_op_id, (
            "content_items row op_id must equal the run's op_id (threaded across "
            "the daemon-thread boundary via the explicit-arg fix, not read from a "
            "ContextVar that does not propagate)"
        )
        assert len(sd.rows) == 1 and sd.rows[0]["op_id"] == run_op_id

        # (b) The Path-B form-write block RAN on the worker thread — proven by
        # resolve_workspace being called with the .md rel_path (only reachable
        # when current_workspace_manifest() was non-None there). On current main
        # ingest_file never reaches the form-write block (it raised earlier).
        assert "doc-one.md" in resolve_calls, (
            "the Path-B form-write block must run (resolve_workspace called) — "
            "proves the workspace manifest reached ingest_file across the "
            "daemon-thread boundary"
        )

        # (c) NON-ZERO stage_counts — the third leg of the {66.19} testStrategy.
        # ingest_file's _bump("source_walk") / _bump("embedding") run on the
        # worker thread; a non-zero count on the SAME counter instance app_main
        # constructed proves the stage_counter crossed the daemon-thread boundary
        # via the functools.partial fix. On current main the counter rode the
        # broken ContextVar path (like op_id) and stayed 0 — _run's stage_counter
        # was None there, so every _bump was skipped by the "is not None" guard.
        assert stage_counter.get("source_walk") >= 1, (
            "stage_counts['source_walk'] must be non-zero — the per-item "
            "_bump('source_walk') must reach the flow-scope counter across the "
            "daemon-thread boundary; on current main it stays 0 (counter None on "
            "the worker thread, like op_id)"
        )
        assert stage_counter.get("embedding") >= 1, (
            "stage_counts['embedding'] must be non-zero — the per-item "
            "_bump('embedding') after the Stage-4 vector must reach the "
            "flow-scope counter across the daemon-thread boundary"
        )

    def test_extraction_reads_rebound_flow_meta_on_worker_thread(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The CAVEAT: extraction.py reads current_flow_meta() INSIDE the
        per-item extractor (same daemon thread as ingest_file). The fix must
        RE-BIND flow_meta locally inside ingest_file, not merely consume the
        passed arg — otherwise stamp_extraction_base / the retry + taxonomy-miss
        recorders in extraction.py read None on the worker thread.

        This asserts an extractor invoked DURING ingest_file (on the worker
        thread) sees a non-None current_flow_meta() carrying the run op_id."""
        flow = _flow_module()
        from cocoindex_pipeline.flow_context import current_flow_meta

        source_dir = tmp_path
        (source_dir / "doc-meta.md").write_text("# H\n\nbody")
        _write_workspace_manifest(source_dir, "", uuid.uuid4())

        seen: dict[str, object] = {}

        async def _classification_reads_meta(content_text: str):
            # Runs on the worker thread, inside ingest_file. Reads the contextvar
            # the way stamp_extraction_base in extraction.py does — through the
            # flow_context module's current_flow_meta().
            meta = current_flow_meta()
            seen["meta_op_id"] = None if meta is None else meta.op_id
            return {"content_type": "case_study"}

        targets = {
            "content_items": _FakeTarget("content_items"),
            "q_a_extractions": _FakeTarget("q_a_extractions"),
            "source_documents": _FakeTarget("source_documents"),
            "entity_mentions": _FakeTarget("entity_mentions"),
            "form_templates": _FakeTarget("form_templates"),
            "form_template_fields": _FakeTarget("form_template_fields"),
            "content_chunks": _FakeTarget("content_chunks"),
        }

        run_op_id, _stage_counter = _run_app_main_over_dir(
            flow,
            source_dir,
            targets,
            monkeypatch,
            classification=_classification_reads_meta,
        )

        assert seen.get("meta_op_id") is not None, (
            "current_flow_meta() must be non-None inside the extractor running on "
            "the worker thread — the fix must RE-BIND flow_meta locally inside "
            "ingest_file (the caveat); on current main it is None there"
        )
        assert seen["meta_op_id"] == run_op_id, (
            "the re-bound flow_meta must carry the run op_id so "
            "stamp_extraction_base stamps the correct op_id on extracted rows"
        )
