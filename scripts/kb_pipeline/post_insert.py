"""Shared post-insert helper for Knowledge Hub ingestion scripts.

Every ingest path does the same ~8 operations after `insert_content_item`
succeeds:

    1. content_history v1      (S153 Python/TS parity)
    2. content_chunks           (store_chunks — required for MCP retrieval)
    3. load_entity_aliases      (prep for entities+relationships)
    4. entity_mentions           (store_entities)
    5. entity_relationships      (store_relationships)
    6. metadata.ai_temporal_refs (merge_item_metadata)
    7. temporal→entity bridge    (bridge_temporal_to_entities)
    8. layer inference           (infer_layer + update_content_item.layer)

Before this helper existed each script had its own copy. The S181 Stage 2
chunk-backfill bug (scripts/ingest_stage2_markdown.py had NO store_chunks
call) was the direct result: the script had forked before S177's chunk-
at-ingest wave and silently drifted. Centralising here prevents that
failure class.

Call pattern:

    >>> from kb_pipeline.post_insert import run_post_insert
    >>> success, id_or_error = insert_content_item(record)
    >>> if success:
    ...     run_post_insert(
    ...         item_id=id_or_error,
    ...         title=record['title'],
    ...         content=record['content'],
    ...         content_type=record['content_type'],
    ...         ingestion_source='markdown_import',
    ...         classification=cls,
    ...         history_change_summary=f'Imported from {filename}',
    ...     )

All steps are best-effort (non-blocking on the overall ingest flow) —
errors get recorded on the result object and printed, but do not raise.
This matches the behaviour of every inline copy in the pre-S185 scripts.

Canonical sub-step order (per S185 WP-D spec):
    insert → embed → chunk → classify → entity extraction

Note that classify + embed happen BEFORE insert in every current script
(the classifier output is stored on the content_items row itself). This
helper covers the POST-insert slice: history, chunks, entities, temporal,
bridge, layer. Do not call it before insert.

TS parity: MCP `create_content_item` (lib/mcp/tools/content.ts) does NOT
use this helper. The TS equivalent is the S183 WP1 G2 publish-path
classify wave (app/api/items + governance update_governance_status).
Any TS-side changes happen there, not here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PostInsertResult:
    """Outcome of run_post_insert. Fields are 0/False/empty on skip or error."""

    history_ok: bool = False
    chunks_stored: int = 0
    chunk_errors: list[str] = field(default_factory=list)
    entities_stored: int = 0
    entities_skipped: int = 0
    relationships_stored: int = 0
    relationships_skipped: int = 0
    temporal_refs_stored: int = 0
    bridged: int = 0
    layer_set: str | None = None
    errors: list[str] = field(default_factory=list)


def run_post_insert(
    item_id: str,
    title: str,
    content: str,
    content_type: str,
    ingestion_source: str,
    *,
    classification: Any = None,
    history_change_summary: str | None = None,
    write_history: bool = True,
    write_chunks: bool = True,
    store_entities_flag: bool = True,
    write_temporal: bool = True,
    bridge_temporal: bool = True,
    infer_layer_flag: bool = True,
    log_prefix: str = "  ",
    logger=None,
) -> PostInsertResult:
    """Run every post-insert side-effect against an already-inserted row.

    Parameters
    ----------
    item_id : str
        UUID of the newly-inserted content_items row.
    title, content, content_type : str
        Fields of the record — used for history, chunks, and layer inference.
    ingestion_source : str
        Free-form string describing the caller (e.g. 'url_import',
        'markdown_import', 'bid_library_import', 'stage2_markdown'). Passed
        to layer inference.
    classification : optional
        Object with attributes .entities, .relationships, .temporal_references,
        .suggested_title. Typically a kb_pipeline.classify.ClassificationResult.
        May be None for scripts that don't run AI classification.
    history_change_summary : str, optional
        Override the content_history.change_summary field. Default is built
        from ingestion_source.
    write_history, write_chunks, store_entities_flag,
    write_temporal, bridge_temporal, infer_layer_flag : bool
        Per-step opt-outs. All default True — disable only when a specific
        script can't run a given step (e.g. a dry-run partial mode).
    log_prefix : str
        Prefix applied to every log line. Scripts passing `"  "` get a
        two-space indent to match their existing output.
    logger : optional
        Callable accepting (str) — e.g. `print` or a logging.Logger method.
        Defaults to `print`.

    Returns
    -------
    PostInsertResult
        Struct summarising what ran and what errored.

    Notes
    -----
    This function does NOT raise. Any error inside a step is caught, logged
    via the logger callable, and appended to `result.errors` as
    `"<step>: <message>"`. Scripts can inspect `result.errors` to decide
    whether to surface warnings at the end of a batch run.
    """
    log = logger or print
    result = PostInsertResult()

    # Lazy imports — avoids circular deps with callers + lets optional
    # components (e.g. temporal_bridge) fail cleanly if missing.
    # ------------------------------------------------------------------
    # Step 1: content_history v1
    # ------------------------------------------------------------------
    if write_history:
        try:
            from .store import insert_content_history_entry

            summary = history_change_summary or (
                f"Imported via {ingestion_source}"
            )
            insert_content_history_entry(
                content_item_id=item_id,
                title=title,
                content=content,
                change_summary=summary,
                change_reason="initial_ingest",
            )
            result.history_ok = True
        except Exception as e:
            msg = f"history: {e}"
            result.errors.append(msg)
            log(f"{log_prefix}[History] ERROR (non-blocking): {e}")

    # ------------------------------------------------------------------
    # Step 2: chunks (REQUIRED for MCP retrieval — S181 regression root cause
    # was this step missing from stage2 ingest)
    # ------------------------------------------------------------------
    if write_chunks:
        try:
            from .chunk import store_chunks

            chunk_stored, chunk_errors = store_chunks(item_id, content)
            result.chunks_stored = chunk_stored
            result.chunk_errors = list(chunk_errors or [])
            log(f"{log_prefix}[Chunks]  {chunk_stored} chunks stored")
            for err in result.chunk_errors:
                log(f"{log_prefix}[Chunks]  WARNING: {err}")
        except Exception as e:
            msg = f"chunks: {e}"
            result.errors.append(msg)
            log(f"{log_prefix}[Chunks]  ERROR (non-blocking): {e}")

    # ------------------------------------------------------------------
    # Step 3+4+5: entity aliases + entity_mentions + entity_relationships
    # ------------------------------------------------------------------
    has_entity_payload = classification is not None and (
        getattr(classification, "entities", None)
        or getattr(classification, "relationships", None)
    )
    if store_entities_flag and has_entity_payload:
        try:
            from .classify import load_entity_aliases

            load_entity_aliases()
        except Exception as e:
            msg = f"aliases: {e}"
            result.errors.append(msg)
            log(f"{log_prefix}[Aliases] WARNING: {e}")

    if store_entities_flag and classification is not None:
        entities = getattr(classification, "entities", None) or []
        if entities:
            try:
                from .classify import store_entities

                stored, skipped = store_entities(item_id, entities)
                result.entities_stored = stored
                result.entities_skipped = skipped
                log(
                    f"{log_prefix}[Entities] Stored {stored}, skipped {skipped}"
                )
            except Exception as e:
                msg = f"entities: {e}"
                result.errors.append(msg)
                log(f"{log_prefix}[Entities] ERROR (non-blocking): {e}")

        relationships = getattr(classification, "relationships", None) or []
        if relationships:
            try:
                from .classify import store_relationships

                rel_stored, rel_skipped = store_relationships(
                    item_id, relationships
                )
                result.relationships_stored = rel_stored
                result.relationships_skipped = rel_skipped
                log(
                    f"{log_prefix}[Relationships] "
                    f"Stored {rel_stored}, skipped {rel_skipped}"
                )
            except Exception as e:
                msg = f"relationships: {e}"
                result.errors.append(msg)
                log(
                    f"{log_prefix}[Relationships] ERROR (non-blocking): {e}"
                )

    # ------------------------------------------------------------------
    # Step 6: temporal references (merged into metadata)
    # ------------------------------------------------------------------
    if write_temporal and classification is not None:
        temporal_refs = getattr(classification, "temporal_references", None) or []
        if temporal_refs:
            try:
                from .store import merge_item_metadata

                meta_ok = merge_item_metadata(
                    item_id, {"ai_temporal_references": temporal_refs}
                )
                if meta_ok:
                    result.temporal_refs_stored = len(temporal_refs)
                    log(
                        f"{log_prefix}[Temporal] "
                        f"{len(temporal_refs)} references stored"
                    )
                else:
                    msg = "temporal: storage returned False"
                    result.errors.append(msg)
                    log(f"{log_prefix}[Temporal] Storage failed")
            except Exception as e:
                msg = f"temporal: {e}"
                result.errors.append(msg)
                log(f"{log_prefix}[Temporal] ERROR (non-blocking): {e}")

    # ------------------------------------------------------------------
    # Step 7: temporal-to-entity bridge (links temporal refs to entity_mentions)
    # ------------------------------------------------------------------
    if bridge_temporal:
        try:
            from .temporal_bridge import bridge_temporal_to_entities

            bridged = bridge_temporal_to_entities(item_id)
            result.bridged = bridged or 0
            if bridged:
                log(f"{log_prefix}[Bridge]  {bridged} entity mentions updated")
        except Exception as e:
            msg = f"bridge: {e}"
            result.errors.append(msg)
            log(f"{log_prefix}[Bridge]  ERROR (non-blocking): {e}")

    # ------------------------------------------------------------------
    # Step 8: layer inference
    # ------------------------------------------------------------------
    if infer_layer_flag:
        try:
            from .layer_inference import infer_layer
            from .store import update_content_item

            suggestion = infer_layer(
                content_type=content_type,
                content_length=len(content or ""),
                ingestion_source=ingestion_source,
                title=title,
            )
            update_content_item(item_id, {"layer": suggestion.suggested_layer})
            result.layer_set = suggestion.suggested_layer
            log(
                f"{log_prefix}[Layer]   "
                f"{suggestion.suggested_layer} ({suggestion.confidence})"
            )
        except Exception as e:
            msg = f"layer: {e}"
            result.errors.append(msg)
            log(f"{log_prefix}[Layer]   ERROR (non-blocking): {e}")

    return result
