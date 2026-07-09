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

**No full producer flow exists yet (Task-level gap, not this Subtask's
job).** As of {132.16}, no Subtask has assembled
`LRecordsSource.list_concepts()` -> `mount_each(enrich_concept, ...)` ->
`write_bundle(...)` into one cocoindex flow (`producer/bundle_writer.py`'s
own docstring calls that "{132.13}'s job"; the CURRENT {132.13} is
G-PUBLISH-GATE / `producer/publish.py`, so the actual owner of that
full-flow assembly is unclear — flagged back to the Orchestrator).
`default_producer_entry_point` below is a deliberately MINIMAL stand-in
composing ONLY the already-landed pieces (`LRecordsSource`, Pass-1
`enrich_concept`, `bundle_writer.write_bundle`) as a plain async call
chain — NOT a cocoindex flow_def/mount_each. It does not embed (id 11:
`producer/embed.py`), does not git-sync (id 12: `producer/git_sync.py`),
and does not run Pass-2 web enrichment or the first-publish gate (id 13:
`producer/publish.py`). Those Subtasks are expected to EXTEND or SUPERSEDE
this composition — `entry_point` is an explicit injection seam for exactly
that.

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
import os
from pathlib import Path
from typing import Any, Awaitable, Callable, Sequence

_logger = logging.getLogger(__name__)

# A producer entry point takes the walk's source_document deltas (whatever
# shape the caller supplies — flow.py's `_fetch_source_document_deltas`
# returns a list of asyncpg `Record`-like mappings) and does the (partial or
# full) producer run. Returns whatever the concrete entry point returns
# (e.g. bundle_writer.RunSummary) — callers that only care about "did it
# fire" should read `trigger_producer_post_walk`'s own bool return instead.
ProducerEntryPoint = Callable[[Sequence[Any]], Awaitable[Any]]


async def default_producer_entry_point(
    deltas: Sequence[Any], *, pool: Any = None, bundle_dir: "str | Path | None" = None
) -> Any | None:
    """Minimal real composition of the ALREADY-LANDED producer pieces —
    Pass-1 only, no embeddings/git-sync/publish-gate (see module
    docstring). Idle-mode no-op unless `OKF_BUNDLE_DIR` (or the explicit
    `bundle_dir` override) resolves to an existing directory AND a `pool`
    is supplied (the Source adapter's asyncpg-pool-shaped dependency).
    """
    bundle_dir_str = str(bundle_dir) if bundle_dir is not None else os.environ.get(
        "OKF_BUNDLE_DIR", ""
    )
    if not bundle_dir_str:
        _logger.info(
            "OKF_BUNDLE_DIR not set — concept producer running in idle mode. "
            "Set OKF_BUNDLE_DIR to the client-owned bundle checkout to enable "
            "chained producer runs."
        )
        return None

    resolved_bundle_dir = Path(bundle_dir_str)
    if not resolved_bundle_dir.is_dir():
        _logger.info(
            "OKF_BUNDLE_DIR folder missing — concept producer running in idle "
            "mode. path=%s",
            resolved_bundle_dir,
        )
        return None

    if pool is None:
        _logger.warning(
            "default_producer_entry_point called with a configured "
            "OKF_BUNDLE_DIR but no `pool` — cannot run the Source adapter, "
            "skipping this chained run."
        )
        return None

    # Lazy imports — see the module docstring's Collection-safety note.
    from scripts.cocoindex_pipeline.producer.bundle_writer import write_bundle
    from scripts.cocoindex_pipeline.producer.enrich import enrich_concept
    from scripts.cocoindex_pipeline.sources.l_records import LRecordsSource

    source = LRecordsSource(pool)
    concepts = await source.list_concepts()

    drafts = []
    failures: "list[tuple[str, str]]" = []
    for key in concepts:
        try:
            drafts.append(await enrich_concept(key, source))
        except Exception as exc:  # noqa: BLE001 — per-concept containment
            # Mirrors flow.py's bound_ingest_file posture: one concept's
            # Pass-1 fault must not abort the whole chained run.
            failures.append((key.rel_path, str(exc)))
            _logger.warning(
                "producer trigger: Pass-1 drafting failed for concept "
                "%s — %s",
                key.rel_path,
                exc,
            )

    summary = write_bundle(resolved_bundle_dir, drafts)
    if failures:
        _logger.warning(
            "producer trigger: %d/%d concepts failed Pass-1 drafting this "
            "chained run: %s",
            len(failures),
            len(concepts),
            failures,
        )
    return summary


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
