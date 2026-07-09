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
import uuid
from pathlib import Path

import pytest

from cocoindex import ComponentSubpath, component_subpath

# sys.path.insert(0, _SCRIPTS_DIR) removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts", "scripts/tests"] already makes both the canonical
# `scripts.cocoindex_pipeline.*` namespace and bare `conftest` importable; the
# per-file insert only re-enabled the bare `cocoindex_pipeline` alias.
from conftest import fresh_flow_module  # noqa: E402

# ID-101 §{101.7}: neutralise the relationship-extraction Path-A seam so
# ingest_file tests make no live Anthropic call (mirrors the
# extract_entity_mentions stubs alongside).
async def _fake_relationships_empty(content_text: str) -> list:
    return []



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


class _SdPool:
    """Raw-pool double resolved via ``coco.use_context(DB_CTX)`` for BOTH:

      - the {75.11} URL-source ledger snapshot (``fetch`` — this file stays a
        pure localfs-branch harness, so it always returns an empty ledger);
      - the S438 (id-131 follow-on) content-branch ``source_documents`` PARENT
        raw-pool ``_upsert_source_document`` autocommit UPSERT (``acquire`` —
        S437's fix extended to localfs), capturing every ``execute`` call.

    Both resolve on the SAME worker thread as ``declare_row`` — list.append
    stays atomic under the GIL for this single-writer harness, same reasoning
    as ``_FakeTarget`` above.
    """

    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple]] = []

    async def fetch(self, sql: str) -> list[dict]:
        return []

    def acquire(self) -> object:
        pool = self

        class _Conn:
            async def fetchrow(self, sql: str, *args: object) -> dict:
                # ID-138 {138.10}: the M2 identity resolver — the content branch
                # resolves the source_document_id off the raw pool before the
                # `_upsert_source_document` write. Mirror the resolver's MINT
                # formula (keyed on the rel_path arg).
                return {
                    "source_document_id": uuid.uuid5(
                        uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1"),
                        f"sd:{args[1]}",
                    ),
                    "was_minted": True,
                }

            async def execute(self, sql: str, *args: object) -> str:
                pool.executed.append((sql, args))
                return "INSERT 0 1"

        class _Acquire:
            async def __aenter__(self) -> "_Conn":
                return _Conn()

            async def __aexit__(self, *exc: object) -> None:
                return None

        return _Acquire()


class _SdTarget:
    """Duck-types ``_FakeTarget`` (``.table_name`` / ``.rows``) for the
    ``source_documents`` slot, but reads ``.rows`` from the S438 raw-pool
    capture — the content branch no longer flushes the sd row through the
    engine target's ``declare_row``. This file drives ONLY the content route
    (no forms / qa_sidecar tests), so ``declare_row`` is a tripwire: if a
    future test routes a file through ``_ingest_qa_sidecar_branch`` (the one
    surviving ``sd_target.declare_row`` caller) it must fail loudly here
    rather than silently landing on the wrong capture.
    """

    table_name = "source_documents"

    def __init__(self, pool: _SdPool) -> None:
        self._pool = pool

    def declare_row(self, *, row: dict) -> None:
        raise AssertionError(
            "source_documents must land via the S438 raw-pool UPSERT, not "
            "sd_target.declare_row, on the localfs content branch"
        )

    @property
    def rows(self) -> list[dict]:
        rows: list[dict] = []
        for sql, args in self._pool.executed:
            if "INSERT INTO public.source_documents" not in sql:
                continue
            cols = [c.strip() for c in sql.split("(", 1)[1].split(")", 1)[0].split(",")]
            rows.append(dict(zip(cols, args)))
        return rows


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

    async def size(self) -> int:
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


async def _thread_dispatch_mount_each(*pos_args):
    """Faithful stand-in for ``coco.mount_each`` (1.0.3) that reproduces the
    engine's DAEMON-THREAD dispatch boundary.

    Also enforces the engine's positional-arg + subpath-derivation CONTRACT
    (``_internal/api.py`` ``mount_each``): an optional ``ComponentSubpath`` may
    lead the positional args; when omitted the engine auto-derives the subpath
    from ``Symbol(fn.__name__)`` and RAISES ``TypeError`` if the callable has no
    ``__name__`` (e.g. a bare ``functools.partial``). Enforcing it here is what
    makes the suite catch the {66.16} live-boot crash a lenient stub let through.

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
    args = list(pos_args)
    if args and isinstance(args[0], ComponentSubpath):
        # Explicit subpath provided — the engine consumes it and does NOT need
        # ``fn.__name__`` (this is the fixed call site).
        args.pop(0)
    elif getattr(args[0], "__name__", None) is None:
        raise TypeError(
            "mount_each() requires a ComponentSubpath when the function has no "
            "__name__. Provide an explicit subpath as the first argument."
        )
    fn = args[0]
    items = args[1]
    extra_args = tuple(args[2:])

    # Per item the engine calls `mount(ComponentSubpath(key), fn, ...)` →
    # `create_core_component_processor` → `core.ComponentProcessorInfo(fn.__qualname__)`
    # (api.py:394 / function.py:2031). A bare `functools.partial` has no
    # `__qualname__` either — enforce it UNCONDITIONALLY (independent of the subpath
    # branch above) so the suite catches the DEEPER layer that an explicit-subpath-
    # only fix slips past. ({66.16} surfaced both layers; the named-closure fix
    # satisfies both.)
    if not hasattr(fn, "__qualname__"):
        raise AttributeError(
            f"'{type(fn).__name__}' object has no attribute '__qualname__'"
        )

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
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

    # ── Spy the ID-80.8 fork's workspace resolution: this .md resolves to a
    # workspace via the manifest (default route:"content" → the content
    # branch). The fork's `resolve_route` call is the proof the manifest
    # reached the worker thread (pre-{80.8} this spied `resolve_workspace`
    # inside the form-write block; the fork now resolves ONCE, up front).
    resolve_calls: list[str] = []
    real_resolve = flow.resolve_route

    def _spy_resolve(manifest, rel_path):
        resolve_calls.append(rel_path)
        return real_resolve(manifest, rel_path)

    monkeypatch.setattr(flow, "resolve_route", _spy_resolve)
    targets.setdefault("_resolve_calls", resolve_calls)  # type: ignore[arg-type]

    # ID-136 {136.5} removed the Path-B form branch (and `extract_form_structure`
    # with it) entirely — the defensive `_fake_form_structure` stub guarding
    # against a route:"content" file reaching the form branch is now
    # structurally impossible, so the branch (and its monkeypatch) is retired.

    # ── Capture the run op_id minted at flow start.
    real_uuid4 = uuid.uuid4

    def _capture_uuid4() -> uuid.UUID:
        value = real_uuid4()
        captured_op_id.setdefault("op_id", value)
        return value

    monkeypatch.setattr(flow.uuid, "uuid4", _capture_uuid4)

    # ── Engine-dispatch stand-in: run ingest_file on a separate thread+loop.
    monkeypatch.setattr(flow.coco, "mount_each", _thread_dispatch_mount_each)
    # The conftest cocoindex stub makes `coco` a MagicMock, so `coco.component_subpath`
    # would return a child mock the stubbed mount_each cannot recognise as a subpath.
    # Point it at the REAL pure-Python helper (a ComponentSubpath builder — no engine)
    # so the {66.16} fixed call site `coco.component_subpath("ingest_file")` yields a
    # genuine ComponentSubpath the faithful stub accepts.
    monkeypatch.setattr(flow.coco, "component_subpath", component_subpath)

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

    # {75.11}: app_main also builds `FeedUrlSource(pool=coco.use_context(...))`
    # and iterates its snapshot on a second mount_each — return an EMPTY
    # passed-URL ledger so this file stays a pure localfs-branch harness (the
    # URL branch has its own suite in test_cocoindex_flow_failure_mode.py).
    #
    # S438 (id-131 follow-on): the SAME pool now also backs the content
    # branch's raw-pool `_upsert_source_document` sd write — swap
    # `targets["source_documents"]` for the `_SdTarget` duck-type so every
    # existing `targets["source_documents"].rows` read in this file resolves
    # against the pool capture instead of an unused `declare_row` list.
    sd_pool = _SdPool()
    targets["source_documents"] = _SdTarget(sd_pool)
    monkeypatch.setattr(flow.coco, "use_context", lambda key: sd_pool)

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
    """``app_main`` lands a correctly-stamped row + non-zero stage_counts + the
    ID-80.8 fork's workspace resolution when ``ingest_file`` runs on the
    engine's daemon thread.

    This is the regression that bites the ID-66.19 bug: the per-item component
    runs on a SEPARATE thread+loop, so contextvar bindings set by ``app_main``
    do NOT reach ``ingest_file`` unless the run context is threaded explicitly
    (Option A: functools.partial args + local re-bind)."""

    def test_app_main_live_lands_row_with_op_id_and_fork_resolution(
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
            "q_a_extractions": _FakeTarget("q_a_extractions"),
            "source_documents": _FakeTarget("source_documents"),
            "entity_mentions": _FakeTarget("entity_mentions"),
            "entity_relationships": _FakeTarget("entity_relationships"),
            "form_templates": _FakeTarget("form_templates"),
            "form_template_fields": _FakeTarget("form_template_fields"),
            "content_chunks": _FakeTarget("content_chunks"),
            # {75.11}: the URL source's write target — mounted on every walk.
            "reference_items": _FakeTarget("reference_items"),
            # ID-131 {131.11}: the polymorphic embedding store app_main now mounts.
            "record_embeddings": _FakeTarget("record_embeddings"),
        }

        run_op_id, stage_counter = _run_app_main_over_dir(
            flow, source_dir, targets, monkeypatch
        )

        sd = targets["source_documents"]
        resolve_calls = targets["_resolve_calls"]  # type: ignore[index]

        # (a) {127.25} DR-034: content_items is RETIRED — structurally
        # absent, never re-pointed (the table is dropped both envs and no
        # ci_target mount exists in app_main any more). The row-landed-with
        # -op_id proof this leg used to make now lives on source_documents
        # (the sole remaining stable per-document identity): a row landed
        # with the CORRECT op_id — NOT None, and equal to the run's op_id.
        # On current main (pre-{66.19} fix): 0 rows (ingest_file raised
        # RuntimeError on the worker thread because current_flow_meta() was
        # None).
        assert len(sd.rows) == 1 and sd.rows[0]["op_id"] == run_op_id, (
            "expected exactly one source_documents row landed with the run's "
            f"op_id in live mode; got {len(sd.rows)} rows (current main: "
            "ingest_file raised on the worker thread because "
            "current_flow_meta() returned None across the daemon-thread "
            "dispatch boundary)"
        )

        # (b) The ID-80.8 fork's workspace resolution RAN on the worker thread
        # — proven by resolve_route being called with the .md rel_path (only
        # reachable when the manifest was non-None there). On current main
        # ingest_file never reaches the fork (it raised earlier).
        assert "doc-one.md" in resolve_calls, (
            "the fork's workspace resolution must run (resolve_route called) — "
            "proves the workspace manifest reached ingest_file across the "
            "daemon-thread boundary"
        )

        # (c) NON-ZERO stage_counts — the third leg of the {66.19} testStrategy.
        # ingest_file's _bump("source_walk") / _bump("chunking") run on the
        # worker thread; a non-zero count on the SAME counter instance app_main
        # constructed proves the stage_counter crossed the daemon-thread boundary
        # via the functools.partial fix. On current main the counter rode the
        # broken ContextVar path (like op_id) and stayed 0 — _run's stage_counter
        # was None there, so every _bump was skipped by the "is not None" guard.
        #
        # {127.25} DR-034 re-point: this leg used to probe `_bump("embedding")`
        # — the whole-document embedding stage. That stage (and its bump) was
        # DELETED alongside the content_items mount (flow.py's Stage-4 comment:
        # "the content_items-era coverage feature is RETIRED, not re-pointed");
        # per-CHUNK embeddings are unaffected and still bump `"chunking"` once
        # per chunk (flow.py `_bump("chunking")` inside the `cc_target is not
        # None` chunking block), so this leg now probes THAT late-pipeline
        # stage instead — same daemon-thread-boundary regression guard, on a
        # bump call site that still exists.
        assert stage_counter.get("source_walk") >= 1, (
            "stage_counts['source_walk'] must be non-zero — the per-item "
            "_bump('source_walk') must reach the flow-scope counter across the "
            "daemon-thread boundary; on current main it stays 0 (counter None on "
            "the worker thread, like op_id)"
        )
        assert stage_counter.get("chunking") >= 1, (
            "stage_counts['chunking'] must be non-zero — the per-chunk "
            "_bump('chunking') (late in the per-item pipeline, after Stage-4 "
            "chunk embedding) must reach the flow-scope counter across the "
            "daemon-thread boundary"
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
        from scripts.cocoindex_pipeline.flow_context import current_flow_meta

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
            # {127.25} DR-034: no "content_items" key — the table is dropped
            # both envs and app_main no longer mounts a ci_target.
            "q_a_extractions": _FakeTarget("q_a_extractions"),
            "source_documents": _FakeTarget("source_documents"),
            "entity_mentions": _FakeTarget("entity_mentions"),
            "entity_relationships": _FakeTarget("entity_relationships"),
            "form_templates": _FakeTarget("form_templates"),
            "form_template_fields": _FakeTarget("form_template_fields"),
            "content_chunks": _FakeTarget("content_chunks"),
            # {75.11}: the URL source's write target — mounted on every walk.
            "reference_items": _FakeTarget("reference_items"),
            # ID-131 {131.11}: the polymorphic embedding store app_main now mounts.
            "record_embeddings": _FakeTarget("record_embeddings"),
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
