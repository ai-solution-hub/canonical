"""The FULL producer flow, composed as ONE entry point — ID-132 {132.23}
G-FLOWDEF, the Task's own defining "2-pass producer" deliverable, extended by
{132.27} G-FLOW-STAGING-WIRE with the STAGING + BI-28 provenance composition.

This module is the single place the already-landed producer pieces are
composed into one runnable chain (the `producer` command entry point):

    LRecordsSource.list_concepts()                 # {132.4} G-SOURCE
      -> enrich_concept(key, source)               # {132.8} G-PASS1  (mount_each grain)
      -> [run_web_pass(...) if gated_corpus]       # {132.9} G-PASS2  (optional)
      -> write_bundle(bundle_dir, drafts, ...)     # {132.10} G-BUNDLE
      -> declare_concept_embedding(re_target)      # {132.11} G-EMBED
      -> git_sync.reapply_overrides(...)           # {132.24}/{132.27} BI-27 fold-in
      -> git_sync.sync_bundle(..., stage_only=True) # {132.24}/{132.27} G-GITSYNC STAGING

Until {132.23} nothing in the codebase actually ran this chain end-to-end —
`bundle_writer.py`'s docstring named {132.13} as the owner, {132.13}
(`publish.py`) disclaimed it to the parent Task, and `trigger.py`'s
`default_producer_entry_point` was a Pass-1-only stand-in ({132.16}). {132.23}
closed that gap; `default_producer_entry_point` now delegates here.

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
guard); no `repo_path` -> no git staging; no `gated_corpus` -> Pass-2 skipped.

**Owner ruling (S456, {132.23}): a log.md-only diff is a no-op — no repo
mutation at all.** `bundle_writer.append_log_entry` stamps a freshly-
timestamped `* **Run <ISO-ts> — …**` record into `log.md` on EVERY run
(BI-11's unconditional log stamp; SPEC §7 date-grouped, newest first), so
a run where every concept file is byte-identical
to the last publish would still present a changed `log.md` to
`git_sync.sync_bundle`. This module encodes the owner ruling at the
COMPOSITION layer — the only layer inside this Subtask's file-ownership
boundary (`git_sync.py`/`publish.py` are out of scope): when `write_bundle`'s
`RunSummary.is_no_op` is True (no concept-level add/change/remove/move/
finding), the ONLY diff is the new `log.md` stamp, so the staging step is
SKIPPED entirely. The BI-11 stamp still lands in the bundle working tree and
is carried into the NEXT real run; it just never stages a spurious diff of
its own.

**STAGING, not a per-run commit (S436 amendment BI-27/DR-016; {132.27}
G-FLOW-STAGING-WIRE).** Per PRODUCT.md's S436 amendment, "runs land in a
STAGING state; the one-commit-per-run publish happens after the review/
publish gate." This module calls `git_sync.sync_bundle(..., stage_only=True)`
DIRECTLY for the per-run reconcile (apply + `git add`, no commit) —
superseding the {132.23}-era `publish.publish_bundle` call (BI-21 hard gate +
immediate commit). The BI-21 HARD GATE and the actual one-time commit now
live SOLELY in `producer/publish.py`'s own `publish_bundle`/`producer
publish` CLI — a SEPARATE, human-triggered action run after the accept/edit/
reject review, never chained automatically from this per-run flow.
`status_source`/`_default_status_source` (the {132.13}-era BI-21 injection
seam) are accordingly REMOVED from this module — BI-21 gating is entirely
`publish.py`'s concern now.

Two more pieces wire in at this same seam:

- **`overrides` (BI-27, DR-016).** Approved `git_sync.ProducerOverride`s,
  folded onto this run's bundle output via `git_sync.reapply_overrides`
  BEFORE it is staged into the client-owned repo — an approved human edit is
  never dropped by a fresh regeneration. Defaults to `()`; PERSISTING which
  overrides are "approved" across runs is a separate, not-yet-built concern
  (the follow-on accept/edit/reject review surface, DR-013 shape) — this
  seam accepts whatever the caller supplies, exactly like every other
  injection seam in this module.
- **BI-28 provenance map ({132.21}/{132.22}).** `git_sync.sync_bundle`'s
  `source_workspace_ids` — a `concept_path -> workspace_id` map — is built
  HERE from every won-bid `case_study` `ConceptKey.workspace_id` this run's
  `list_concepts()` enumerated, so a won-bid entry in the emitted
  `proposed_change_set` carries its `source_workspace_id` (BI-28: "never an
  automatic bundle write ... gated by human accept/edit/reject review").

**Physical-vs-identity key reconciliation (ID-132 {132.29} fix-forward).**
`write_bundle`'s `RunSummary.added`/`.changed` report the PHYSICAL bundle
write path (`bundle_writer.bundle_write_path`) — which redirects a won-bid
`case_study` draft into a `case-studies/won-bid/<slug>.md` sibling
directory, distinct from its identity `rel_path` (`ConceptKey.rel_path`,
BI-2/DR-016). Both the G-EMBED lookup below and the BI-28 provenance map
key on that SAME physical path (via `bundle_write_path`/`bundle_write_
path_for_key`) — never the identity `rel_path` — so a won-bid entry
resolves correctly instead of silently missing (the {132.29} checker-FAIL
this fixes): identity-keyed lookups against a physical-path-keyed summary
always miss for a redirected concept, and in the cross-grain same-slug
collision case (a named-client and a won-bid `case_study` sharing one
identity `rel_path`) an identity-keyed embed lookup can additionally
resolve to the WRONG draft's body.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Sequence

_logger = logging.getLogger(__name__)

# An embedder takes a concept's text and returns its 1024-d vector — the
# `flow.embed_content_text` shape. Injected in tests to avoid a real OpenAI
# call; defaults to `flow.embed_content_text` (lazy) for a live run.
Embedder = Callable[[str], Awaitable[Sequence[float]]]


@dataclass(frozen=True)
class ProducerRunReport:
    """One full-producer run's outcome — the composition's own report, distinct
    from any single stage's result. `summary` is the `bundle_writer.RunSummary`;
    `sync_result` is the `git_sync.SyncResult` (or `None` when the staging step
    was skipped: no `repo_path`, or a log.md-only no-op run).
    `proposed_change_set` is `git_sync.proposed_change_set(sync_result)`'s
    JSON-serialisable DR-013-shaped payload (BI-27/DR-016; `None` alongside
    `sync_result is None`)."""

    ran: bool = True
    summary: Any = None
    embedded: "tuple[str, ...]" = ()
    reference_paths: "tuple[str, ...]" = ()
    pass2_ran: bool = False
    sync_result: Any = None
    committed: bool = False
    """Always `False` since {132.27} — STAGING never commits; the real
    one-time commit happens at the separate `publish.py` publish gate. Kept
    (rather than removed) so the report's shape stays stable for callers."""
    proposed_change_set: "dict[str, object] | None" = None


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
    to avoid importing `publish` at module scope for one helper).

    **`.git`-safe (ID-132 {132.35} G-DEPLOY-PROOF Defect B).** `bundle_dir` is
    ALWAYS a git clone in deployment (DR-016) — its working tree carries
    `.git/` (config, HEAD, index, `objects/**` loose/packed blobs). RUN 1 of
    the {132.35} deploy-proof crashed here (`UnicodeDecodeError: 'utf-8'
    codec can't decode byte 0xe2`) reading those binary git-internal files as
    UTF-8 text — the git-less `tmp_path` fixtures this helper's tests used
    before never exercised that (the same fixture-blind-spot the {132.32}
    explorer hit, commit 6c54f26a). Mirrors that fix's dotdir convention:
    any path component starting with `.` is skipped entirely (`.git/` and
    any other hidden file/dir), not just a hardcoded `.git` special-case.
    A file that survives the dotdir filter but still isn't valid UTF-8 is
    skipped with a loud warning rather than crashing the whole read — fails
    open, mirrors the {132.32} frontmatter-parse posture."""
    output: "dict[str, str]" = {}
    for path in sorted(bundle_dir.rglob("*")):
        if not path.is_file():
            continue
        rel_path = path.relative_to(bundle_dir)
        if any(part.startswith(".") for part in rel_path.parts):
            continue
        rel_path_str = rel_path.as_posix()
        try:
            output[rel_path_str] = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            _logger.warning(
                "producer flow: skipping non-UTF-8 file under bundle_dir "
                "(not a valid bundle artefact): %s",
                rel_path_str,
            )
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


def _resolve_client_id() -> "str | None":
    """{132.44} bl-457 G-IRI-PROJECTION IRI-6/IRI-10: resolve the client-id
    source — `OKF_CLIENT_ID` from the environment (mirrors `_resolve_
    bundle_dir`'s `OKF_BUNDLE_DIR` read). Unset or empty resolves to
    `None` — `write_bundle`'s `context.jsonld` then ships base-only, with
    every overlay term recorded as an advisory un-projected diagnostic
    (IRI-6's non-gating fallback) rather than guessing/deriving a client
    identity a later real `OKF_CLIENT_ID` would permanently contradict."""
    return os.environ.get("OKF_CLIENT_ID", "") or None


def _resolve_bundle_class() -> "str | None":
    """OV-10 (ID-132 {132.37} G-OVERLAY-PLATFORM-REJECT, DR-054/DR-079):
    resolve the run's bundle-CLASS signal — `OKF_BUNDLE_CLASS` from the
    environment (mirrors `_resolve_bundle_dir`'s `OKF_BUNDLE_DIR` read and
    `_resolve_client_id`'s `OKF_CLIENT_ID` read). Unset or empty resolves to
    `None`.

    Deliberately NOT derived from `_resolve_client_id()`'s presence/absence
    — a `client_business` run can legitimately exist BEFORE its
    `OKF_CLIENT_ID` is configured (IRI-6's own non-gating fallback), so
    "no client_id yet" is not a safe proxy for "not a client-business
    bundle". This is instead an explicit, independent signal an operator
    sets per bundle-repo deployment, one of DR-079's four ratified values —
    `"client_business"`, `"system_baseline"`, `"showcase"`,
    `"internal_dev"`.

    `None` is deliberately NOT treated as `"client_business"` by
    `bundle_writer.write_bundle`'s OV-10 gate: an unresolved/ambiguous
    signal defaults to the SAFE (reject-on-discovered-overlay) posture,
    never the permissive one — see `bundle_writer.
    OntologyOverlayClassError`."""
    return os.environ.get("OKF_BUNDLE_CLASS", "") or None


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
    drafts_by_write_path: "dict[str, Any]",
    changed_write_paths: "Sequence[str]",
    *,
    embedder: Embedder,
) -> "tuple[str, ...]":
    """G-EMBED (BI-25/BI-26): declare ONE `record_embeddings(owner_kind=
    'concept')` row per concept whose content this run added or changed
    (delta-only — an unchanged concept keeps its existing UPSERTed row from a
    prior run; a no-op run embeds nothing). Embeds the distilled `body` (stable
    across runs when the backing records are unchanged — the frontmatter's
    per-run timestamp is deliberately excluded).

    `drafts_by_write_path`/`changed_write_paths` are keyed by the PHYSICAL
    bundle write path (`bundle_writer.bundle_write_path`) — `RunSummary.
    added`/`.changed` report physical paths (ID-132 {132.29}: a won-bid
    `case_study` draft's physical path is redirected away from its identity
    `rel_path`), so the lookup here MUST match on that same key, and
    `declare_concept_embedding`'s own `rel_path` argument is ALSO the
    physical path here — not the draft's identity `rel_path`. This matters
    for the {132.29} cross-grain same-slug collision case: a named-client
    and a won-bid `case_study` concept can share one identity `rel_path`
    while resolving to two DISTINCT physical write paths (bundle_writer's
    own pre-write collision guard enforces this); embedding by the shared
    identity would collide both concepts onto the SAME `record_embeddings`
    natural key (BI-26's `concept_owner_id` is a pure hash of whatever
    string it is given) and let the second `declare_row` silently clobber
    the first. Embedding by the (already collision-free) physical path
    keeps them distinct, mirroring how they are already kept distinct
    on-disk.

    A `changed_write_paths` entry with no matching draft is an internal
    invariant violation — every physical path `write_bundle` reports as
    added/changed was, by construction, resolved from a draft in THIS same
    run — so this raises loudly rather than silently skipping the concept
    (BI-25/26 requires an embedding row for every added/changed concept;
    the {132.29} checker-FAIL this fixes was exactly a silent `continue`
    here)."""
    from scripts.cocoindex_pipeline.producer.embed import (  # noqa: PLC0415
        declare_concept_embedding,
    )

    embedded: "list[str]" = []
    for write_path in changed_write_paths:
        draft = drafts_by_write_path.get(write_path)
        if draft is None:
            raise RuntimeError(
                "producer flow G-EMBED: no draft found for bundle write "
                f"path {write_path!r} reported as added/changed — BI-25/26 "
                "requires an embedding row for every added/changed concept; "
                "a lookup miss here is a bundle-write/embed key mismatch, "
                "never a silently-skippable condition (ID-132 {132.29})."
            )
        embedding = await embedder(draft.body)
        declare_concept_embedding(re_target, rel_path=write_path, embedding=embedding)
        embedded.append(write_path)
    return tuple(embedded)


def _default_embedder() -> Embedder:
    """The live embedder — `flow.embed_content_text` (lazy: `flow.py` eagerly
    imports cocoindex/asyncpg/aiohttp/httpx at module scope, so importing it at
    THIS module's scope would break collection safety)."""
    from scripts.cocoindex_pipeline.flow import embed_content_text  # noqa: PLC0415

    return embed_content_text


async def run_producer_flow(
    *,
    pool: Any = None,
    bundle_dir: "str | Path | None" = None,
    re_target: Any = None,
    repo_path: "str | Path | None" = None,
    overrides: "Sequence[Any]" = (),
    embedder: "Embedder | None" = None,
    gated_corpus: Any = None,
    http_client: Any = None,
    theme_config: "Sequence[tuple[str, Sequence[str]]]" = (),
    timestamp: "str | None" = None,
) -> "ProducerRunReport | None":
    """Compose + run the FULL producer flow as ONE entry point (G-FLOWDEF +
    {132.27} G-FLOW-STAGING-WIRE).

    Idle no-op (returns `None`) unless `bundle_dir`/`OKF_BUNDLE_DIR` resolves
    to an existing directory AND a `pool` is supplied. Otherwise:

      1. `LRecordsSource(pool).list_concepts()` — the concept catalogue.
      2. Per concept: `enrich_concept` (Pass-1); `run_web_pass` (Pass-2) when
         a `gated_corpus` is configured. One concept's fault is contained.
      3. `write_bundle(...)` — validator-gate + `declare_file` every concept,
         regenerate `index.md`, append the `log.md` run block, ship the DR-027
         ontology artefact plus the {132.44} bl-457 `context.jsonld` IRI
         projection (`client_id=_resolve_client_id()` — the resolved
         `OKF_CLIENT_ID`, or `None` for a base-only projection, IRI-6).
         `bundle_class=_resolve_bundle_class()` (OV-10, ID-132 {132.37}) is
         threaded the same way — the resolved `OKF_BUNDLE_CLASS`, or `None`
         when unset — so `write_bundle` hard-rejects a discovered overlay
         file for any bundle_class other than exactly `"client_business"`.
      4. `declare_concept_embedding(...)` for each added/changed concept when a
         `re_target` is supplied (skipped otherwise — BI-25/26).
      5. `git_sync.reapply_overrides(...)` folds any injected `overrides` onto
         this run's bundle output, then `git_sync.sync_bundle(...,
         stage_only=True, source_workspace_ids=...)` — STAGING (apply +
         `git add`, no commit; BI-28 provenance stamped from every won-bid
         `ConceptKey.workspace_id`) — when a `repo_path` is supplied AND the
         run is not a log.md-only no-op (owner ruling S456). Skipped
         otherwise. The ONE gated commit is a SEPARATE, later action
         (`publish.publish_bundle`/`producer publish`), never made here.
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
        bundle_write_path,
        bundle_write_path_for_key,
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
        bundle_class=_resolve_bundle_class(),
        client_id=_resolve_client_id(),
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
        drafts_by_write_path = {
            bundle_write_path(d): d for d in (*drafts, *reference_drafts)
        }
        resolved_embedder = embedder or _default_embedder()
        embedded = await _embed_written_concepts(
            re_target,
            drafts_by_write_path,
            (*summary.added, *summary.changed),
            embedder=resolved_embedder,
        )

    report = ProducerRunReport(
        summary=summary,
        embedded=embedded,
        reference_paths=tuple(_rel_path_of(d) for d in reference_drafts),
        pass2_ran=pass2_ran,
    )

    # {132.27} G-GITSYNC STAGING — apply + `git add`, no commit. Owner ruling
    # S456: a log.md-only no-op run (RunSummary.is_no_op) must NOT stage
    # anything; the BI-11 stamp rides into the next real run instead.
    if repo_path is None:
        return report
    if summary.is_no_op:
        _logger.info(
            "producer flow: no-op run (log.md-only diff) — nothing staged (S456)."
        )
        return report

    from scripts.cocoindex_pipeline.producer.git_sync import (  # noqa: PLC0415
        proposed_change_set as _proposed_change_set,
        reapply_overrides,
        sync_bundle,
    )

    new_output = _read_bundle_dir(resolved_bundle_dir)
    if overrides:
        # BI-27/DR-016: fold approved human-edit overrides onto this run's
        # fresh output BEFORE it is staged — an approved edit is never
        # dropped by a fresh regeneration.
        new_output = reapply_overrides(new_output, overrides)

    # BI-28 provenance ({132.21}/{132.22}): concept_path -> workspace_id, from
    # every won-bid case_study ConceptKey this run enumerated. Keyed by the
    # PHYSICAL bundle write path (bundle_write_path_for_key) — NOT the
    # identity key.rel_path — because `sync_bundle`'s `proposed_changes` are
    # built from `new_output` (this run's on-disk bundle contents, i.e.
    # physical paths); an identity-keyed map here would never match a
    # redirected won-bid entry (ID-132 {132.29} checker-FAIL remediation). A
    # path absent from the map keeps ProposedChange.source_workspace_id at
    # its None default (the ordinary Pass-1/Pass-2 producer flow).
    source_workspace_ids = {
        bundle_write_path_for_key(key): key.workspace_id
        for key in concepts
        if key.workspace_id is not None
    }

    sync_result = sync_bundle(
        Path(repo_path),
        new_output,
        removed_paths=summary.removed,
        timestamp=timestamp,
        stage_only=True,
        source_workspace_ids=source_workspace_ids or None,
    )
    return ProducerRunReport(
        summary=summary,
        embedded=embedded,
        reference_paths=report.reference_paths,
        pass2_ran=pass2_ran,
        sync_result=sync_result,
        committed=False,
        proposed_change_set=_proposed_change_set(sync_result, run_timestamp=timestamp),
    )
