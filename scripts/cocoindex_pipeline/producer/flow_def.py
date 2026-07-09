"""The FULL producer flow, composed as ONE entry point — ID-132 {132.23}
G-FLOWDEF, the Task's own defining "2-pass producer" deliverable.

This module is the single place the already-landed producer pieces are
composed into one runnable chain (the `producer` command entry point):

    LRecordsSource.list_concepts()              # {132.4} G-SOURCE
      -> enrich_concept(key, source)            # {132.8} G-PASS1  (mount_each grain)
      -> [run_web_pass(...) if gated_corpus]    # {132.9} G-PASS2  (optional)
      -> write_bundle(bundle_dir, drafts, ...)  # {132.10} G-BUNDLE
      -> declare_concept_embedding(re_target)   # {132.11} G-EMBED
      -> publish_bundle(repo_path, ...)         # {132.13} G-PUBLISH-GATE
           -> git_sync.sync_bundle(...)         # {132.12} G-GITSYNC

Until {132.23} nothing in the codebase actually ran this chain end-to-end —
`bundle_writer.py`'s docstring named {132.13} as the owner, {132.13}
(`publish.py`) disclaimed it to the parent Task, and `trigger.py`'s
`default_producer_entry_point` was a Pass-1-only stand-in ({132.16}). This
module closes that gap; `default_producer_entry_point` now delegates here.

**Collection safety (mirrors `trigger.py`).** This module must NOT import
`cocoindex` — nor any producer module that transitively does
(`producer/enrich.py`, `producer/web_pass.py`, `producer/bundle_writer.py`,
`producer/embed.py`, `scripts/cocoindex_pipeline/flow.py`) — at MODULE
scope, so `trigger.py` can import it and the dispatch-logic unit tests stay
importable with no cocoindex stub. Every such symbol is imported LAZILY,
inside `run_producer_flow`'s own body, only when a configured run actually
reaches that stage. The composed `enrich_concept` is `@coco.fn`-decorated —
it is invoked DIRECTLY as a plain awaitable (never re-wrapped / re-decorated),
exactly as {132.16}'s stand-in already did.

**Idle-mode safety (preserved from {132.16}).** `run_producer_flow` no-ops
(returns `None`) whenever `bundle_dir`/`OKF_BUNDLE_DIR` is unset or missing,
or no `pool` is supplied — true in every environment today, so wiring this
into `app_main` spends no Anthropic/OpenAI tokens and touches no filesystem
or git repo until an operator deliberately configures the bundle location.
Each downstream stage degrades independently through its own injection seam:
no `re_target` -> no embedding write (mirrors `flow._declare_record_embedding`'s
guard); no `repo_path` -> no git commit; no `gated_corpus` -> Pass-2 skipped.

**Owner ruling (S456, {132.23}): a log.md-only diff is a no-op — no commit.**
`bundle_writer.append_log_entry` stamps a freshly-timestamped `## <ISO-8601>`
block into `log.md` on EVERY run (BI-11's unconditional log stamp), so a run
where every concept file is byte-identical to the last publish would still
present a changed `log.md` to `git_sync.sync_bundle` and force a spurious
commit (the tension `publish.py`'s docstring surfaces). This module encodes
the owner ruling at the COMPOSITION layer — the only layer inside this
Subtask's file-ownership boundary (`git_sync.py`/`publish.py` are out of
scope): when `write_bundle`'s `RunSummary.is_no_op` is True (no concept-level
add/change/remove/move/finding), the ONLY diff is the new `log.md` stamp, so
the publish/commit step is SKIPPED. The BI-11 stamp still lands in the bundle
working tree and is carried into the NEXT real commit; it just never mints a
commit of its own.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Sequence

_logger = logging.getLogger(__name__)

# The default status-file env var the BI-21 publish gate reads when no
# explicit `status_source` is injected — fail-closed (an unset var or a
# missing/unparseable file reads as RED, per `publish.read_status_file`).
OKF_SEED_CONTRACT_STATUS_FILE_ENV = "OKF_SEED_CONTRACT_STATUS_FILE"

# An embedder takes a concept's text and returns its 1024-d vector — the
# `flow.embed_content_text` shape. Injected in tests to avoid a real OpenAI
# call; defaults to `flow.embed_content_text` (lazy) for a live run.
Embedder = Callable[[str], Awaitable[Sequence[float]]]

# A BI-21 status source — the zero-arg callable `publish.publish_bundle`
# gates on (`() -> SeedContractCheckResult`). Injected green/red in tests.
StatusSource = Callable[[], Any]


@dataclass(frozen=True)
class ProducerRunReport:
    """One full-producer run's outcome — the composition's own report, distinct
    from any single stage's result. `summary` is the `bundle_writer.RunSummary`;
    `sync_result` is the `git_sync.SyncResult` (or `None` when the publish step
    was skipped: no `repo_path`, or a log.md-only no-op run)."""

    ran: bool = True
    summary: Any = None
    embedded: "tuple[str, ...]" = ()
    reference_paths: "tuple[str, ...]" = ()
    pass2_ran: bool = False
    sync_result: Any = None
    committed: bool = False


def _rel_path_of(draft: Any) -> str:
    """Normalise the two draft shapes to one rel_path lookup — mirrors
    `bundle_writer._rel_path_of` (`ConceptDraft` carries `.key.rel_path`;
    `ReferenceConceptDraft` carries `.rel_path` directly)."""
    rel_path = getattr(draft, "rel_path", None)
    if isinstance(rel_path, str):
        return rel_path
    return draft.key.rel_path


def _rel_path_of_key(key: Any) -> str:
    """A ConceptKey's rel_path for failure logging — tolerant of a bare test
    double lacking `.rel_path`."""
    return getattr(key, "rel_path", repr(key))


def _read_bundle_dir(bundle_dir: Path) -> "dict[str, str]":
    """Read an already-written bundle working directory into the
    `{rel_path: content}` mapping `publish_bundle`/`sync_bundle` expect —
    every regular file under `bundle_dir`, keyed by its POSIX path relative
    to `bundle_dir` (mirrors `publish._read_bundle_dir`, re-implemented here
    to avoid importing `publish` at module scope for one helper)."""
    output: "dict[str, str]" = {}
    for path in sorted(bundle_dir.rglob("*")):
        if not path.is_file():
            continue
        rel_path = path.relative_to(bundle_dir).as_posix()
        output[rel_path] = path.read_text(encoding="utf-8")
    return output


def _resolve_bundle_dir(bundle_dir: "str | Path | None") -> "Path | None":
    """Idle-mode gate (preserved from {132.16}'s `default_producer_entry_point`):
    resolve `bundle_dir` (explicit override or `OKF_BUNDLE_DIR`) to an existing
    directory, or `None` when unset/missing (idle no-op)."""
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
    resolved = Path(bundle_dir_str)
    if not resolved.is_dir():
        _logger.info(
            "OKF_BUNDLE_DIR folder missing — concept producer running in idle "
            "mode. path=%s",
            resolved,
        )
        return None
    return resolved


async def _draft_concepts(
    concepts: "Sequence[Any]",
    source: Any,
    *,
    enrich_concept: Any,
    gated_corpus: Any,
    run_web_pass: Any,
    http_client: Any,
) -> "tuple[list[Any], list[Any], list[tuple[str, str]], bool]":
    """Pass-1 (and optional Pass-2) drafting, with per-concept containment —
    one concept's fault must never abort the whole chained run (mirrors
    `flow.bound_ingest_file`'s posture, matching {132.16}'s stand-in). Returns
    `(drafts, reference_drafts, failures, pass2_ran)`."""
    drafts: "list[Any]" = []
    reference_drafts: "list[Any]" = []
    failures: "list[tuple[str, str]]" = []
    pass2_ran = False
    for key in concepts:
        try:
            draft = await enrich_concept(key, source)
            if gated_corpus is not None:
                result = await run_web_pass(
                    draft, key, source, gated_corpus, http_client=http_client
                )
                draft = result.concept
                reference_drafts.extend(result.reference_concepts)
                pass2_ran = True
            drafts.append(draft)
        except Exception as exc:  # noqa: BLE001 — per-concept containment
            failures.append((_rel_path_of_key(key), str(exc)))
            _logger.warning(
                "producer flow: drafting failed for concept %s — %s",
                _rel_path_of_key(key),
                exc,
            )
    return drafts, reference_drafts, failures, pass2_ran


async def _embed_written_concepts(
    re_target: Any,
    drafts_by_rel_path: "dict[str, Any]",
    changed_rel_paths: "Sequence[str]",
    *,
    embedder: Embedder,
) -> "tuple[str, ...]":
    """G-EMBED (BI-25/BI-26): declare ONE `record_embeddings(owner_kind=
    'concept')` row per concept whose content this run added or changed
    (delta-only — an unchanged concept keeps its existing UPSERTed row from a
    prior run; a no-op run embeds nothing). Embeds the distilled `body` (stable
    across runs when the backing records are unchanged — the frontmatter's
    per-run timestamp is deliberately excluded)."""
    from scripts.cocoindex_pipeline.producer.embed import (  # noqa: PLC0415
        declare_concept_embedding,
    )

    embedded: "list[str]" = []
    for rel_path in changed_rel_paths:
        draft = drafts_by_rel_path.get(rel_path)
        if draft is None:
            continue
        embedding = await embedder(draft.body)
        declare_concept_embedding(re_target, rel_path=rel_path, embedding=embedding)
        embedded.append(rel_path)
    return tuple(embedded)


def _default_status_source() -> StatusSource:
    """The fail-closed BI-21 status source used when no `status_source` is
    injected: reads the JSON status artefact at `OKF_SEED_CONTRACT_STATUS_FILE`
    via `publish.read_status_file` (an unset var / missing / unparseable file
    reads as RED — the gate never opens on an indeterminate status)."""
    from scripts.cocoindex_pipeline.producer.publish import (  # noqa: PLC0415
        read_status_file,
    )

    status_path_str = os.environ.get(OKF_SEED_CONTRACT_STATUS_FILE_ENV, "")
    status_path = Path(status_path_str) if status_path_str else None
    return lambda: read_status_file(status_path)


def _default_embedder() -> Embedder:
    """The live embedder — `flow.embed_content_text` (lazy: `flow.py` eagerly
    imports cocoindex/asyncpg/aiohttp/httpx at module scope, so importing it at
    THIS module's scope would break collection safety)."""
    from scripts.cocoindex_pipeline.flow import embed_content_text  # noqa: PLC0415

    return embed_content_text


async def run_producer_flow(
    deltas: "Sequence[Any]" = (),
    *,
    pool: Any = None,
    bundle_dir: "str | Path | None" = None,
    re_target: Any = None,
    repo_path: "str | Path | None" = None,
    status_source: "StatusSource | None" = None,
    embedder: "Embedder | None" = None,
    gated_corpus: Any = None,
    http_client: Any = None,
    theme_config: "Sequence[tuple[str, Sequence[str]]]" = (),
    timestamp: "str | None" = None,
) -> "ProducerRunReport | None":
    """Compose + run the FULL producer flow as ONE entry point (G-FLOWDEF).

    Idle no-op (returns `None`) unless `bundle_dir`/`OKF_BUNDLE_DIR` resolves
    to an existing directory AND a `pool` is supplied. Otherwise:

      1. `LRecordsSource(pool).list_concepts()` — the concept catalogue.
      2. Per concept: `enrich_concept` (Pass-1); `run_web_pass` (Pass-2) when
         a `gated_corpus` is configured. One concept's fault is contained.
      3. `write_bundle(...)` — validator-gate + `declare_file` every concept,
         regenerate `index.md`, append the `log.md` run block, ship the DR-027
         ontology artefact.
      4. `declare_concept_embedding(...)` for each added/changed concept when a
         `re_target` is supplied (skipped otherwise — BI-25/26).
      5. `publish_bundle(repo_path, ...)` — BI-21 hard gate then the ONE gated
         `git_sync.sync_bundle` commit — when a `repo_path` is supplied AND the
         run is not a log.md-only no-op (owner ruling S456). Skipped otherwise.
    """
    resolved_bundle_dir = _resolve_bundle_dir(bundle_dir)
    if resolved_bundle_dir is None:
        return None
    if pool is None:
        _logger.warning(
            "producer flow: a configured OKF_BUNDLE_DIR but no `pool` — cannot "
            "run the Source adapter, skipping this chained run."
        )
        return None

    # Lazy imports — see the module docstring's Collection-safety note.
    from scripts.cocoindex_pipeline.producer.bundle_writer import (  # noqa: PLC0415
        write_bundle,
    )
    from scripts.cocoindex_pipeline.producer.enrich import (  # noqa: PLC0415
        enrich_concept,
    )
    from scripts.cocoindex_pipeline.producer.web_pass import (  # noqa: PLC0415
        run_web_pass,
    )
    from scripts.cocoindex_pipeline.sources.l_records import (  # noqa: PLC0415
        LRecordsSource,
    )

    source = LRecordsSource(pool)
    concepts = await source.list_concepts()

    drafts, reference_drafts, failures, pass2_ran = await _draft_concepts(
        concepts,
        source,
        enrich_concept=enrich_concept,
        gated_corpus=gated_corpus,
        run_web_pass=run_web_pass,
        http_client=http_client,
    )

    summary = write_bundle(
        resolved_bundle_dir,
        drafts,
        reference_drafts,
        theme_config=theme_config,
        timestamp=timestamp,
    )
    if failures:
        _logger.warning(
            "producer flow: %d/%d concepts failed drafting this run: %s",
            len(failures),
            len(concepts),
            failures,
        )

    # G-EMBED — one record_embeddings row per added/changed concept (delta-only).
    embedded: "tuple[str, ...]" = ()
    if re_target is not None:
        drafts_by_rel_path = {_rel_path_of(d): d for d in (*drafts, *reference_drafts)}
        resolved_embedder = embedder or _default_embedder()
        embedded = await _embed_written_concepts(
            re_target,
            drafts_by_rel_path,
            (*summary.added, *summary.changed),
            embedder=resolved_embedder,
        )

    report = ProducerRunReport(
        summary=summary,
        embedded=embedded,
        reference_paths=tuple(_rel_path_of(d) for d in reference_drafts),
        pass2_ran=pass2_ran,
    )

    # G-PUBLISH-GATE + G-GITSYNC — the ONE gated commit. Owner ruling S456: a
    # log.md-only no-op run (RunSummary.is_no_op) must NOT commit; the BI-11
    # stamp rides into the next real commit instead.
    if repo_path is None:
        return report
    if summary.is_no_op:
        _logger.info(
            "producer flow: no-op run (log.md-only diff) — no commit (S456)."
        )
        return report

    from scripts.cocoindex_pipeline.producer.publish import (  # noqa: PLC0415
        publish_bundle,
    )

    new_output = _read_bundle_dir(resolved_bundle_dir)
    sync_result = publish_bundle(
        Path(repo_path),
        new_output,
        status_source=status_source or _default_status_source(),
        removed_paths=summary.removed,
        timestamp=timestamp,
    )
    return ProducerRunReport(
        summary=summary,
        embedded=embedded,
        reference_paths=report.reference_paths,
        pass2_ran=pass2_ran,
        sync_result=sync_result,
        committed=bool(sync_result.applied or sync_result.removed),
    )
