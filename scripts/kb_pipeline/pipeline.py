"""Main pipeline orchestrator — URL/content → Extract → Dedup → Classify → Embed → Store."""

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, List

from .classify import classify, estimate_cost as classify_cost, store_entities, store_relationships, load_entity_aliases
from .config import SHORT_CONTENT_THRESHOLD, LOW_CONFIDENCE_THRESHOLD
from .dedup import is_duplicate
from .embed import build_embedding_text, generate_embedding, estimate_cost as embed_cost
from .extract import ExtractedContent, extract_url, extract_pdf
from .store import (
    insert_content_item,
    insert_content_history_entry,
    update_content_item,
    log_quality_issue,
)
from .summarise import generate_summary


@dataclass
class PipelineResult:
    """Result of processing a single item through the pipeline."""
    success: bool = False
    item_id: str = ""
    title: str = ""
    source_url: str = ""
    skipped: bool = False
    skip_reason: str = ""
    error: str = ""
    # Classification
    primary_domain: str = ""
    primary_subtopic: str = ""
    confidence: float = 0.0
    # Costs
    classify_input_tokens: int = 0
    classify_output_tokens: int = 0
    classify_cache_creation: int = 0
    classify_cache_read: int = 0
    embed_tokens: int = 0
    summary_cost: float = 0.0
    # Quality flags
    quality_flags: List[str] = field(default_factory=list)
    # Timing
    elapsed_seconds: float = 0.0


def process_url(
    url: str,
    batch_name: str = "",
    skip_dedup: bool = False,
    skip_classify: bool = False,
    skip_embed: bool = False,
    override_content_type: str = "",
    override_platform: str = "",
    override_author: str = "",
    override_title: str = "",
    extra_metadata: dict = None,
    dry_run: bool = False,
    generate_summary_flag: bool = True,
) -> PipelineResult:
    """Process a single URL through the full pipeline.

    Steps: Extract → Dedup → Classify → Embed → Summarise → Store → Quality Log
    """
    result = PipelineResult(source_url=url)
    start = time.time()

    # ── Step 1: Extract ──────────────────────────────────────────────
    print(f"\n  [Extract] {url}")
    extracted = extract_url(url)

    if not extracted:
        result.error = "Extraction failed — no content returned"
        result.elapsed_seconds = time.time() - start
        return result

    # Apply overrides
    if override_title:
        extracted.title = override_title
    if override_content_type:
        extracted.content_type = override_content_type
    if override_platform:
        extracted.platform = override_platform
    if override_author:
        extracted.author_name = override_author
    if extra_metadata:
        extracted.metadata.update(extra_metadata)

    result.title = extracted.title
    print(f"           Title: {extracted.title[:80]}")
    print(f"           Content: {len(extracted.content)} chars, type={extracted.content_type}, platform={extracted.platform}")

    # ── Step 2: Dedup ────────────────────────────────────────────────
    if not skip_dedup:
        dup, existing_id, method = is_duplicate(source_url=url)
        if dup:
            result.skipped = True
            result.skip_reason = f"Duplicate ({method}): existing ID {existing_id}"
            result.elapsed_seconds = time.time() - start
            print(f"  [Dedup]   DUPLICATE via {method} — skipping")
            return result

    # ── Step 3: Classify ─────────────────────────────────────────────
    if not skip_classify:
        print(f"  [Classify] Running Opus 4.6...")
        try:
            cls = classify(
                title=extracted.title,
                content=extracted.content,
                content_type=extracted.content_type,
                platform=extracted.platform,
                author_name=extracted.author_name,
            )
            result.primary_domain = cls.primary_domain
            result.primary_subtopic = cls.primary_subtopic
            result.confidence = cls.confidence
            result.classify_input_tokens = cls.input_tokens
            result.classify_output_tokens = cls.output_tokens
            result.classify_cache_creation = cls.cache_creation_tokens
            result.classify_cache_read = cls.cache_read_tokens

            print(f"             → {cls.primary_domain} / {cls.primary_subtopic} ({cls.confidence:.2f})")
            print(f"             Summary: {cls.summary[:100]}")
        except Exception as e:
            result.error = f"Classification failed: {e}"
            print(f"  [Classify] ERROR: {e}")
            # Continue without classification — we can still store
            cls = None
    else:
        cls = None

    # ── Step 4: Embed ────────────────────────────────────────────────
    embedding = None
    if not skip_embed:
        print(f"  [Embed]   Generating embedding...")
        try:
            embed_text = build_embedding_text(
                title=cls.suggested_title if cls else extracted.title,
                summary=cls.summary if cls else "",
                content=extracted.content,
                content_type=extracted.content_type,
            )
            embedding, tokens = generate_embedding(embed_text)
            result.embed_tokens = tokens
            print(f"             {tokens} tokens")
        except Exception as e:
            print(f"  [Embed]   ERROR: {e}")

    # ── Step 5: Dedup (post-embed) ───────────────────────────────────
    if not skip_dedup and embedding:
        dup, existing_id, method = is_duplicate(embedding=embedding)
        if dup:
            result.skipped = True
            result.skip_reason = f"Duplicate (embedding similarity): existing ID {existing_id}"
            result.elapsed_seconds = time.time() - start
            print(f"  [Dedup]   DUPLICATE via embedding similarity — skipping")
            return result

    # ── Step 5b: Summarise (optional) ────────────────────────────────
    summary_result = None
    if generate_summary_flag and cls and embedding:
        print(f"  [Summary] Generating AI summary...")
        summary_result = generate_summary(
            title=cls.suggested_title or extracted.title,
            content=extracted.content,
            content_type=extracted.content_type,
            primary_domain=cls.primary_domain or "unknown",
        )
        if summary_result:
            result.summary_cost = summary_result.get("cost", 0.0)
            print(f"             Executive: {summary_result['executive'][:100]}")
            print(f"             Takeaways: {len(summary_result['takeaways'])} items")
            print(f"             Cost: ${summary_result['cost']:.4f}")
        else:
            print(f"  [Summary] Skipped — generation failed (non-blocking)")
    elif generate_summary_flag and not cls:
        print(f"  [Summary] Skipped — no classification available")
    elif generate_summary_flag and not embedding:
        print(f"  [Summary] Skipped — no embedding available")

    # ── Step 6: Store ────────────────────────────────────────────────
    if dry_run:
        result.success = True
        result.skipped = True
        result.skip_reason = "Dry run — not stored"
        result.elapsed_seconds = time.time() - start
        print(f"  [Store]   DRY RUN — would insert")
        return result

    print(f"  [Store]   Inserting into Supabase...")

    record = {
        "title": extracted.title,
        "content": extracted.content,
        "source_url": extracted.source_url,
        "source_domain": extracted.source_domain,
        "thumbnail_url": extracted.thumbnail_url or None,
        "content_type": extracted.content_type,
        "platform": extracted.platform,
        "author_name": extracted.author_name or None,
        "captured_date": extracted.captured_date or None,
        "metadata": extracted.metadata or {},
    }

    # Add classification fields
    if cls:
        record.update({
            "primary_domain": cls.primary_domain,
            "primary_subtopic": cls.primary_subtopic,
            "secondary_domain": cls.secondary_domain,
            "secondary_subtopic": cls.secondary_subtopic,
            "classification_confidence": cls.confidence,
            "suggested_title": cls.suggested_title,
            "summary": cls.summary,
            "ai_keywords": cls.ai_keywords,
            "classification_reasoning": cls.reasoning,
            "classified_at": datetime.now(timezone.utc).isoformat(),
        })

    # Add summary data
    if summary_result:
        record["summary_data"] = {
            "executive": summary_result["executive"],
            "detailed": summary_result["detailed"],
            "takeaways": summary_result["takeaways"],
            "generated_at": summary_result["generated_at"],
            "model": summary_result["model"],
            "tokens_used": summary_result["tokens_used"],
        }
        record["summary"] = summary_result["executive"]

    # Add embedding
    if embedding:
        record["embedding"] = embedding

    success, id_or_error = insert_content_item(record)

    if success:
        result.success = True
        result.item_id = id_or_error
        print(f"             ID: {id_or_error}")

        # ── Step 6a: Content history v1 (S153 — Python/TS parity) ─────
        # Matches TS ingest path (app/api/ingest/url/route.ts) which writes
        # a version-1 content_history row on initial ingest. Best-effort.
        try:
            insert_content_history_entry(
                content_item_id=id_or_error,
                title=record.get("title") or extracted.title,
                content=extracted.content,
                change_summary=f"Imported from {extracted.source_url or record.get('source_url', '')}",
                change_reason="initial_ingest",
            )
        except Exception as e:
            print(f"  [History] ERROR (non-blocking): {e}")

        # ── Step 6b: Content chunking (heading-based) ────────────────
        # Mirrors TS chunking pipeline in app/api/upload + app/api/ingest/url.
        try:
            from .chunk import store_chunks
            chunk_stored, chunk_errors = store_chunks(id_or_error, extracted.content)
            print(f"  [Chunks]  {chunk_stored} chunks stored")
            if chunk_errors:
                for err in chunk_errors:
                    print(f"  [Chunks]  WARNING: {err}")
        except Exception as e:
            print(f"  [Chunks]  ERROR (non-blocking): {e}")

        # ── Step 7: Load entity aliases (needed for both entities and relationships)
        if cls and (cls.entities or cls.relationships):
            try:
                load_entity_aliases()
            except Exception as e:
                print(f"  [Aliases] WARNING: Failed to load aliases: {e}")

        # ── Step 7a: Entity storage ──────────────────────────────────
        if cls and cls.entities:
            try:
                stored, skipped = store_entities(id_or_error, cls.entities)
                print(f"  [Entities] Stored {stored}, skipped {skipped}")
            except Exception as e:
                print(f"  [Entities] ERROR (non-blocking): {e}")

        # ── Step 7b: Relationship storage (non-blocking) ────────────
        if cls and cls.relationships:
            try:
                rel_stored, rel_skipped = store_relationships(id_or_error, cls.relationships)
                print(f"  [Relationships] Stored {rel_stored}, skipped {rel_skipped}")
            except Exception as e:
                print(f"  [Relationships] ERROR (non-blocking): {e}")

        # ── Step 7c: Temporal reference storage (non-blocking) ──────
        if cls and cls.temporal_references:
            try:
                from .store import merge_item_metadata
                meta_ok = merge_item_metadata(id_or_error, {
                    "ai_temporal_references": cls.temporal_references,
                })
                if meta_ok:
                    print(f"  [Temporal] {len(cls.temporal_references)} references stored")
                else:
                    print(f"  [Temporal] Storage failed")
            except Exception as e:
                print(f"  [Temporal] ERROR (non-blocking): {e}")

        # ── Step 7d: Temporal-to-entity bridge (non-blocking) ─────
        try:
            from .temporal_bridge import bridge_temporal_to_entities
            bridged = bridge_temporal_to_entities(id_or_error)
            if bridged:
                print(f"  [Bridge]  {bridged} entity mentions updated")
        except Exception as e:
            print(f"  [Bridge]  ERROR (non-blocking): {e}")

        # ── Step 7e: Layer inference (non-blocking) ────────────────
        try:
            from .layer_inference import infer_layer
            suggestion = infer_layer(
                content_type=extracted.content_type,
                content_length=len(extracted.content),
                ingestion_source="url_import",
                title=extracted.title,
            )
            update_content_item(id_or_error, {"layer": suggestion.suggested_layer})
            print(f"  [Layer]   {suggestion.suggested_layer} ({suggestion.confidence})")
        except Exception as e:
            print(f"  [Layer]   ERROR (non-blocking): {e}")

        # ── Step 8: Quality logging ──────────────────────────────────
        _log_quality_flags(id_or_error, extracted, cls, batch_name, result)

    else:
        result.error = f"Insert failed: {id_or_error}"
        print(f"  [Store]   ERROR: {id_or_error}")

    result.elapsed_seconds = time.time() - start
    return result


def _log_quality_flags(
    item_id: str,
    extracted: ExtractedContent,
    cls,
    batch_name: str,
    result: PipelineResult,
):
    """Check for and log quality issues."""
    url = extracted.source_url

    # Missing thumbnail
    if not extracted.thumbnail_url:
        log_quality_issue(item_id, "missing_thumbnail", "warning",
                         {"url": url}, url, batch_name)
        result.quality_flags.append("missing_thumbnail")

    # Short content
    if len(extracted.content) < SHORT_CONTENT_THRESHOLD:
        log_quality_issue(item_id, "short_content", "warning",
                         {"length": len(extracted.content)}, url, batch_name)
        result.quality_flags.append("short_content")

    # Low classification confidence
    if cls and cls.confidence < LOW_CONFIDENCE_THRESHOLD:
        log_quality_issue(item_id, "classification_low", "warning",
                         {"confidence": cls.confidence, "reasoning": cls.reasoning},
                         url, batch_name)
        result.quality_flags.append("classification_low")

    # Classification flags
    if cls and cls.requires_review:
        log_quality_issue(item_id, "manual_review", "warning",
                         {"reason": cls.reason_if_flagged}, url, batch_name)
        result.quality_flags.append("requires_review")


def process_urls(
    urls: List[str],
    batch_name: str = "",
    dry_run: bool = False,
    rate_limit: float = 1.5,
    **kwargs,
) -> List[PipelineResult]:
    """Process multiple URLs through the pipeline.

    Args:
        urls: List of URLs to process
        batch_name: Name for this batch (used in quality log)
        dry_run: If True, extract and classify but don't store
        rate_limit: Seconds between API calls
        **kwargs: Passed to process_url()
    """
    if not batch_name:
        batch_name = f"batch-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"

    results = []
    total = len(urls)
    total_classify_cost = 0.0
    total_embed_cost = 0.0
    total_summary_cost = 0.0

    print(f"\n{'='*60}")
    print(f"Knowledge Hub Pipeline — Processing {total} URLs")
    print(f"Batch: {batch_name}")
    print(f"Dry run: {dry_run}")
    print(f"{'='*60}")

    start = time.time()

    for idx, url in enumerate(urls):
        print(f"\n[{idx+1}/{total}] {url}")

        result = process_url(url, batch_name=batch_name, dry_run=dry_run, **kwargs)
        results.append(result)

        # Track costs
        if result.classify_input_tokens:
            total_classify_cost += classify_cost(
                result.classify_input_tokens,
                result.classify_output_tokens,
                result.classify_cache_creation,
                result.classify_cache_read,
            )
        if result.embed_tokens:
            total_embed_cost += embed_cost(result.embed_tokens)
        total_summary_cost += result.summary_cost

        total_cost = total_classify_cost + total_embed_cost + total_summary_cost
        status = "OK" if result.success else ("SKIP" if result.skipped else "FAIL")
        print(f"  [{status}] {result.title[:60]} | ${total_cost:.3f}")

        # Rate limit between items
        if idx < total - 1:
            time.sleep(rate_limit)

    elapsed = time.time() - start

    # ── Summary ──────────────────────────────────────────────────────
    successes = sum(1 for r in results if r.success and not r.skipped)
    skipped = sum(1 for r in results if r.skipped)
    errors = sum(1 for r in results if r.error and not r.skipped)
    summary_count = sum(1 for r in results if r.summary_cost > 0)
    total_cost = total_classify_cost + total_embed_cost + total_summary_cost

    print(f"\n{'='*60}")
    print(f"PIPELINE COMPLETE")
    print(f"{'='*60}")
    print(f"  Processed: {total}")
    print(f"  Stored:    {successes}")
    print(f"  Skipped:   {skipped}")
    if summary_count:
        print(f"  Summarised: {summary_count}")
    print(f"  Errors:    {errors}")
    print(f"  Cost:      ${total_cost:.3f} "
          f"(classify: ${total_classify_cost:.3f}, "
          f"embed: ${total_embed_cost:.3f}, "
          f"summary: ${total_summary_cost:.3f})")
    print(f"  Time:      {elapsed:.0f}s ({elapsed/60:.1f}m)")

    if errors:
        print(f"\n  Errors:")
        for r in results:
            if r.error and not r.skipped:
                print(f"    {r.source_url}: {r.error}")

    return results
