"""Producer post-walk chaining — ID-132 {132.16} G-TRIGGER.

S436 D4 board ratification (owner note, `s436-spec-state-audit.md` Q2):
concepts are the MAP over the knowledge, so it is NEW/UPDATED
`source_documents` rows that should drive new/updated OKF concept files —
not a separately-pinned cadence. This module closes that trigger/cadence
gap: a successful ingest walk that touched (created/updated) one or more
`source_documents` rows chains ONE producer run; a walk that touched none
is a no-op (delta-only, v3 §7.2 — `declare_file`/`@coco.fn(memo=True)`
memoisation then scopes any triggered run to only the affected concepts,
so this module does not need to compute per-concept affectedness itself).

**Hook point (decided in-subtask): in-server, NOT the pipeline-runs
webhook chain.** `flow.py`'s `app_main()` calls `trigger_producer_post_walk`
directly from its own `finally` block, in the SAME Python process, using
the SAME `run_op_id` + asyncpg pool already in scope there (see
`flow._fetch_source_document_deltas`). The alternative — chaining off the
`pipeline_runs` webhook — would require the Vercel `POST
/api/internal/pipeline-runs/record` route to make a NEW outbound call back
into this Python service (a second network hop + a new inbound-auth
surface on the pipeline side), and the webhook payload only carries
aggregate `stage_counts`, not which `source_documents` rows changed. The
in-server hook needs neither: `op_id`-scoped `source_documents` rows ARE
the precise delta signal, and they're one lightweight read query away
inside `app_main` itself.

**Manual operator invocation retained.** `run_producer_now()` is the
TECH-original "discrete `producer` command" surface (TECH.md §"Where the
producer runs") — it calls the SAME `entry_point` unconditionally,
bypassing both the delta gate and the reentrancy guard, so an operator can
always force a run. The post-walk hook is ADDITIVE, never a replacement.

**The full producer flow is composed in `producer/flow_def.py` ({132.23}
G-FLOWDEF).** {132.16} shipped `default_producer_entry_point` as a
deliberately MINIMAL Pass-1-only stand-in and left `entry_point` as an
injection seam for exactly this. {132.23} closed the gap: the FULL chain —
`LRecordsSource.list_concepts()` -> `enrich_concept` (Pass-1) -> optional
`run_web_pass` (Pass-2) -> `write_bundle(...)` -> `declare_concept_embedding`
(embed) -> `publish_bundle` / `git_sync.sync_bundle` (publish-gate) — now
lives in `producer/flow_def.run_producer_flow`, and
`default_producer_entry_point` below DELEGATES to it (superseding the
Pass-1-only stand-in). `flow_def.py` preserves both this module's
disciplines: the OKF_BUNDLE_DIR idle-mode safety gate, and the
collection-safety / lazy-function-local-import property (it imports no
`cocoindex` at module scope, so `trigger.py` and the dispatch-logic unit
tests stay importable with no cocoindex stub).

**Idle-mode safety (mirrors `app_main`'s `COCOINDEX_SOURCE_PATH` gate,
flow.py ~line 4008).** `default_producer_entry_point` no-ops whenever
`OKF_BUNDLE_DIR` is unset or does not point at an existing directory —
true in every environment today, since nothing sets this env var yet
(the client-owned bundle repo is still to be provisioned per {132.11}'s
S453 journal note). So wiring this hook into `app_main` cannot spend
Anthropic tokens or touch the filesystem until an operator deliberately
configures the bundle location.

**Collection safety.** This module must NOT import `cocoindex` (or any
producer module that transitively does — `producer/enrich.py`,
`producer/bundle_writer.py`, `sources/l_records.py`) at module scope, so
the dispatch logic (`trigger_producer_post_walk` / `run_producer_now`) is
importable and unit-testable with no cocoindex stub. `default_producer_
entry_point` imports those modules LAZILY, inside its own body, only when
actually invoked with a configured `OKF_BUNDLE_DIR`.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Awaitable, Callable, Sequence

_logger = logging.getLogger(__name__)

# A producer entry point takes the walk's source_document deltas (whatever
# shape the caller supplies — flow.py's `_fetch_source_document_deltas`
# returns a list of asyncpg `Record`-like mappings) and does the (partial or
# full) producer run. Returns whatever the concrete entry point returns
# (`flow_def.ProducerRunReport` for the default full-flow entry point) — or
# `None` in idle mode; callers that only care about "did it fire" should read
# `trigger_producer_post_walk`'s own bool return instead.
ProducerEntryPoint = Callable[[Sequence[Any]], Awaitable[Any]]


async def default_producer_entry_point(
    deltas: Sequence[Any],
    *,
    pool: Any = None,
    bundle_dir: "str | Path | None" = None,
    **flow_kwargs: Any,
) -> Any | None:
    """The default producer entry point — the FULL producer flow (G-FLOWDEF).

    Delegates to `producer/flow_def.run_producer_flow`, which composes the
    ALREADY-LANDED pieces (`LRecordsSource.list_concepts()` -> `enrich_concept`
    Pass-1 -> optional `run_web_pass` Pass-2 -> `write_bundle` -> embed ->
    publish-gate/git-sync) into ONE chain — superseding {132.16}'s Pass-1-only
    stand-in ({132.23}). Idle-mode no-op (returns `None`) unless `OKF_BUNDLE_DIR`
    (or the explicit `bundle_dir` override) resolves to an existing directory
    AND a `pool` is supplied. Extra `flow_kwargs` (`re_target`, `repo_path`,
    `overrides`, `embedder`, `gated_corpus`, ...) are the downstream-stage
    injection seams `run_producer_flow` documents — each gates its own stage,
    so the default call (`entry_point(deltas)` from flow.py, no kwargs) stays a
    safe Pass-1+write-only run until an operator wires the rest.

    `deltas` is consumed by THIS dispatch layer only (the post-walk delta
    gate / reentrancy guard in `trigger_producer_post_walk`, and the manual
    `run_producer_now` bypass) — `run_producer_flow` itself has no `deltas`
    parameter (dead since {132.23}; removed as a {132.27} PASS_WITH_NOTES
    remediation, ID-132 {132.29} fix-forward), so it is never forwarded
    downstream.

    The `run_producer_flow` import is function-local (`flow_def.py` is itself
    collection-safe, but keeping it lazy preserves trigger.py's own
    zero-module-scope-dependency property its dispatch-logic unit tests rely on).
    """
    from scripts.cocoindex_pipeline.producer.flow_def import (  # noqa: PLC0415
        run_producer_flow,
    )

    return await run_producer_flow(pool=pool, bundle_dir=bundle_dir, **flow_kwargs)


# Reentrancy guard (module-level default) — the "no double-fire" contract:
# calling `trigger_producer_post_walk` twice with the SAME op_id (e.g. a
# caller bug re-invoking the hook) only actually calls `entry_point` once.
# Callers that want an isolated guard (tests; a future multi-worker
# deployment) can pass their own `fired_op_ids` set.
_FIRED_OP_IDS: "set[Any]" = set()


async def trigger_producer_post_walk(
    op_id: Any,
    deltas: Sequence[Any],
    *,
    entry_point: ProducerEntryPoint = default_producer_entry_point,
    fired_op_ids: "set[Any] | None" = None,
    **entry_point_kwargs: Any,
) -> bool:
    """The post-walk hook. No-ops (returns False, never calls
    `entry_point`) when `deltas` is empty — the walk touched zero
    `source_documents` rows, so there is nothing for the producer to react
    to (delta-only, v3 §7.2). Otherwise calls `entry_point(deltas, ...)`
    exactly once per `op_id` and returns True.
    """
    if not deltas:
        return False

    guard = _FIRED_OP_IDS if fired_op_ids is None else fired_op_ids
    if op_id in guard:
        _logger.info(
            "producer trigger: op_id=%s already chained a producer run — "
            "skipping duplicate fire.",
            op_id,
        )
        return False

    guard.add(op_id)
    await entry_point(deltas, **entry_point_kwargs)
    return True


async def run_producer_now(
    deltas: Sequence[Any] = (),
    *,
    entry_point: ProducerEntryPoint = default_producer_entry_point,
    **entry_point_kwargs: Any,
) -> Any:
    """Manual operator invocation (retained, additive to the automatic
    post-walk hook — see module docstring). Bypasses BOTH the delta gate
    and the reentrancy guard: an operator can always force a run, with or
    without a fresh delta, regardless of whether this op_id already fired.
    """
    return await entry_point(deltas, **entry_point_kwargs)
