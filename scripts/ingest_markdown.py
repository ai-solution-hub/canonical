#!/usr/bin/env python3
"""Ingest local markdown files into Knowledge Hub.

Reads .md files from a directory or single file path, classifies them via
Claude Opus 4.6, generates embeddings via OpenAI, and stores them in Supabase.

Supports special title extraction for "Article N" format files and MDX tag
cleanup for documentation files.

Usage:
    python3 scripts/ingest_markdown.py markdown-temp/
    python3 scripts/ingest_markdown.py markdown-temp/ --dry-run
    python3 scripts/ingest_markdown.py markdown-temp/ --limit 5
    python3 scripts/ingest_markdown.py markdown-temp/ --skip-existing
    python3 scripts/ingest_markdown.py markdown-temp/practical-ai-implementation-articles/
    python3 scripts/ingest_markdown.py markdown-temp/file.md
    python3 scripts/ingest_markdown.py markdown-temp/ --author "Liam" --tag "batch-feb"
"""

import argparse
import json
import logging
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# Add parent dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kb_pipeline.classify import classify, estimate_cost as classify_cost
from kb_pipeline.config import (
    get_env,
    SUPABASE_URL,
    SHORT_CONTENT_THRESHOLD,
    LOW_CONFIDENCE_THRESHOLD,
)
from kb_pipeline.dedup import is_duplicate
from kb_pipeline.embed import (
    build_embedding_text,
    generate_embedding,
    estimate_cost as embed_cost,
)
from kb_pipeline.store import insert_content_item, update_content_item, log_quality_issue
from kb_pipeline.summarise import generate_summary

# ── Configuration ────────────────────────────────────────────────────────────

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_DIR = os.path.join(PROJECT_ROOT, "logs")
LOG_FILE = os.path.join(LOG_DIR, "markdown-ingest.log")

BATCH_NAME = "markdown-ingest"

# Folder name → keyword tag mapping
FOLDER_TAG_MAP = {
    "practical-ai-implementation-articles": "ai-implementation",
    "market-research": "market-research",
    "claude-capabilities-knowledge-base": "claude-docs",
}

# Rate limit between pipeline API calls (seconds)
PIPELINE_RATE_LIMIT = 1.5


# ── Logging ──────────────────────────────────────────────────────────────────

def setup_logging():
    """Configure logging to both stdout and file."""
    os.makedirs(LOG_DIR, exist_ok=True)

    logger = logging.getLogger("markdown_ingest")
    logger.setLevel(logging.INFO)

    # Prevent duplicate handlers on re-import
    if logger.handlers:
        return logger

    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Stdout handler
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(logging.INFO)
    stdout_handler.setFormatter(formatter)
    logger.addHandler(stdout_handler)

    # File handler
    file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


log = setup_logging()


# ── Title Extraction ─────────────────────────────────────────────────────────

def extract_title(content: str, filename: str) -> str:
    """Extract title from markdown content.

    Priority:
      1. Files starting with '# Article N' followed by '**Bold Title**': extract bold title
      2. First '# heading' content
      3. Filename without extension, titlecased
    """
    lines = content.strip().split("\n")

    # Check for "# Article N" pattern followed by bold title
    if lines and re.match(r"^#\s+Article\s+\d+", lines[0]):
        for line in lines[1:6]:  # Check next few lines
            bold_match = re.match(r"^\*\*(.+?)\*\*", line.strip())
            if bold_match:
                return bold_match.group(1).strip()

    # Standard: first H1 heading
    for line in lines[:20]:  # Only check first 20 lines
        h1_match = re.match(r"^#\s+(.+)", line.strip())
        if h1_match:
            title = h1_match.group(1).strip()
            # Skip generic headings like "Article 1"
            if not re.match(r"^Article\s+\d+$", title):
                return title

    # Fallback: filename without extension, titlecased
    basename = os.path.splitext(filename)[0]
    return basename.replace("-", " ").replace("_", " ").title()


# ── MDX Cleanup ──────────────────────────────────────────────────────────────

def clean_mdx_tags(content: str) -> str:
    """Strip MDX component tags and documentation index blocks.

    Removes tags like <Note>, <CodeGroup>, <Tab>, <Card>, <Steps>, <Tip>,
    <Tabs>, <CardGroup>, <Warning>, and their closing counterparts.
    Also strips the documentation index block (lines starting with
    '> ## Documentation Index').
    """
    # Remove documentation index block (blockquote lines at the top)
    lines = content.split("\n")
    cleaned_lines = []
    in_doc_index = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("> ## Documentation Index"):
            in_doc_index = True
            continue
        if in_doc_index and stripped.startswith(">"):
            continue
        if in_doc_index and not stripped.startswith(">"):
            in_doc_index = False
            # Keep this non-blockquote line
            if stripped:
                cleaned_lines.append(line)
            continue
        cleaned_lines.append(line)

    content = "\n".join(cleaned_lines)

    # Strip MDX tags: <Note>, </Note>, <CodeGroup>, <Card title="...">, etc.
    content = re.sub(r"</?[A-Z][A-Za-z]*[^>]*>", "", content)

    # Collapse excessive blank lines left behind
    content = re.sub(r"\n{4,}", "\n\n\n", content)

    return content.strip()


# ── File Discovery ───────────────────────────────────────────────────────────

def discover_markdown_files(path: str) -> list[str]:
    """Find all .md files in the given path (file or directory).

    Returns sorted list of absolute file paths.
    """
    path = os.path.abspath(path)

    if os.path.isfile(path):
        if path.endswith(".md"):
            return [path]
        log.warning("File %s is not a .md file — skipping", path)
        return []

    if not os.path.isdir(path):
        log.error("Path does not exist: %s", path)
        return []

    files = []
    for root, _, filenames in os.walk(path):
        for fname in filenames:
            if fname.endswith(".md") and not fname.startswith("."):
                files.append(os.path.join(root, fname))

    files.sort()
    return files


# ── Skip-existing Check ─────────────────────────────────────────────────────

def check_source_file_exists(relative_path: str) -> bool:
    """Check if a file with this source_file metadata already exists in Supabase."""
    env = get_env()
    key = env["SUPABASE_ANON_KEY"]

    # Use PostgREST JSON column filter: metadata->>source_file
    encoded_path = urllib.parse.quote(relative_path, safe="")
    url = (
        f"{SUPABASE_URL}/rest/v1/content_items"
        f"?metadata->>source_file=eq.{encoded_path}"
        f"&select=id"
        f"&limit=1"
    )

    req = urllib.request.Request(url)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return len(data) > 0
    except Exception as e:
        log.warning("  Failed to check existing file: %s", e)
        return False


# ── Folder Tag ───────────────────────────────────────────────────────────────

def get_folder_tag(relative_path: str) -> str | None:
    """Derive a keyword tag from the folder name."""
    parts = relative_path.split(os.sep)
    if len(parts) >= 2:
        folder = parts[0]
        return FOLDER_TAG_MAP.get(folder)
    return None


# ── Per-file Processing ─────────────────────────────────────────────────────

def process_markdown_file(
    file_path: str,
    base_dir: str,
    author_name: str | None = None,
    extra_tag: str | None = None,
    skip_existing: bool = False,
    dry_run: bool = False,
    generate_summary_flag: bool = True,
) -> dict:
    """Process a single markdown file through the Knowledge Hub pipeline.

    Flow: read → extract title → clean MDX → dedup check → classify → embed → summarise → store

    Returns a result dict with status information.
    """
    relative_path = os.path.relpath(file_path, base_dir)
    folder_name = os.path.dirname(relative_path) or os.path.basename(base_dir)
    filename = os.path.basename(file_path)

    result = {
        "file": relative_path,
        "title": "",
        "status": "pending",
        "item_id": None,
        "error": None,
        "classify_cost": 0.0,
        "embed_cost": 0.0,
        "summary_cost": 0.0,
    }

    # ── Read file ────────────────────────────────────────────────────────
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"Read failed: {e}"
        log.error("  [Read]    ERROR: %s", e)
        return result

    if not raw_content.strip():
        result["status"] = "skipped"
        result["error"] = "Empty file"
        log.info("  [Skip]    Empty file")
        return result

    # ── Extract title (before MDX cleanup, in case title uses special formatting) ──
    title = extract_title(raw_content, filename)
    result["title"] = title
    log.info("  [Title]   %s", title)

    # ── Clean MDX tags ───────────────────────────────────────────────────
    cleaned_content = clean_mdx_tags(raw_content)
    log.info("  [Content] %d chars (raw: %d)", len(cleaned_content), len(raw_content))

    # ── Skip-existing check ──────────────────────────────────────────────
    if skip_existing:
        if check_source_file_exists(relative_path):
            result["status"] = "skipped"
            result["error"] = "Already exists (source_file match)"
            log.info("  [Skip]    Already in DB (source_file: %s)", relative_path)
            return result

    # ── File modification time ───────────────────────────────────────────
    try:
        mtime = os.path.getmtime(file_path)
        captured_date = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
    except Exception:
        captured_date = datetime.now(timezone.utc).isoformat()

    # ── Classify ─────────────────────────────────────────────────────────
    log.info("  [Classify] Running Opus 4.6...")
    cls = None
    try:
        cls = classify(
            title=title,
            content=cleaned_content,
            content_type="article",
            platform="manual",
            author_name=author_name or "",
        )
        cost = classify_cost(
            cls.input_tokens,
            cls.output_tokens,
            cls.cache_creation_tokens,
            cls.cache_read_tokens,
        )
        result["classify_cost"] = cost
        log.info(
            "             -> %s / %s (%.2f)",
            cls.primary_domain,
            cls.primary_subtopic,
            cls.confidence,
        )
        log.info("             Summary: %s", cls.ai_summary[:100])
    except Exception as e:
        log.error("  [Classify] ERROR: %s", e)
        result["status"] = "error"
        result["error"] = f"Classification failed: {e}"
        return result

    # ── Embed ────────────────────────────────────────────────────────────
    log.info("  [Embed]   Generating embedding...")
    embedding = None
    try:
        embed_text = build_embedding_text(
            title=cls.suggested_title if cls else title,
            ai_summary=cls.ai_summary if cls else "",
            content=cleaned_content,
            content_type="article",
        )
        embedding, tokens = generate_embedding(embed_text)
        result["embed_cost"] = embed_cost(tokens)
        log.info("             %d tokens", tokens)
    except Exception as e:
        log.error("  [Embed]   ERROR: %s", e)
        result["status"] = "error"
        result["error"] = f"Embedding failed: {e}"
        return result

    # ── Dedup (embedding similarity) ─────────────────────────────────────
    if embedding:
        dup, existing_id, method = is_duplicate(embedding=embedding)
        if dup:
            result["status"] = "duplicate"
            result["error"] = f"Duplicate (embedding similarity): existing ID {existing_id}"
            log.info("  [Dedup]   DUPLICATE via embedding similarity — skipping")
            return result

    # ── Build keywords ───────────────────────────────────────────────────
    keywords = list(cls.ai_keywords) if cls else []

    # Add folder tag
    folder_tag = get_folder_tag(relative_path)
    if folder_tag and folder_tag not in keywords:
        keywords.append(folder_tag)

    # Add extra user-supplied tag
    if extra_tag and extra_tag not in keywords:
        keywords.append(extra_tag)

    # ── Store ────────────────────────────────────────────────────────────
    if dry_run:
        result["status"] = "dry_run"
        log.info("  [Store]   DRY RUN — would insert")
        log.info(
            "             Domain: %s, Subtopic: %s",
            cls.primary_domain if cls else "N/A",
            cls.primary_subtopic if cls else "N/A",
        )
        log.info("             Keywords: %s", ", ".join(keywords))
        return result

    log.info("  [Store]   Inserting into Supabase...")

    record = {
        "title": title,
        "content": cleaned_content,
        "source_url": None,
        "source_domain": None,
        "content_type": "article",
        "platform": "manual",
        "author_name": author_name or None,
        "captured_date": captured_date,
        "metadata": {
            "ingestion_source": "markdown_file",
            "source_file": relative_path,
            "source_folder": folder_name,
            "original_format": "markdown",
        },
    }

    # Add classification fields
    if cls:
        record.update(
            {
                "primary_domain": cls.primary_domain,
                "primary_subtopic": cls.primary_subtopic,
                "secondary_domain": cls.secondary_domain,
                "secondary_subtopic": cls.secondary_subtopic,
                "classification_confidence": cls.confidence,
                "suggested_title": cls.suggested_title,
                "ai_summary": cls.ai_summary,
                "ai_keywords": keywords,
                "classification_reasoning": cls.reasoning,
                "classified_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    # Add embedding
    if embedding:
        record["embedding"] = embedding

    success, id_or_error = insert_content_item(record)

    if success:
        result["status"] = "ok"
        result["item_id"] = id_or_error
        log.info("             ID: %s", id_or_error)

        # ── Summarise (optional) ─────────────────────────────────────
        if generate_summary_flag and cls and embedding:
            log.info("  [Summary] Generating AI summary...")
            summary_result = generate_summary(
                title=cls.suggested_title or title,
                content=cleaned_content,
                content_type="article",
                primary_domain=cls.primary_domain or "unknown",
            )
            if summary_result:
                result["summary_cost"] = summary_result.get("cost", 0.0)
                update_content_item(id_or_error, {
                    "summary_data": {
                        "executive": summary_result["executive"],
                        "detailed": summary_result["detailed"],
                        "takeaways": summary_result["takeaways"],
                        "generated_at": summary_result["generated_at"],
                        "model": summary_result["model"],
                        "tokens_used": summary_result["tokens_used"],
                    },
                    "ai_summary": summary_result["executive"],
                })
                log.info("             Executive: %s", summary_result["executive"][:100])
                log.info("             Takeaways: %d items", len(summary_result["takeaways"]))
                log.info("             Cost: $%.4f", summary_result["cost"])
            else:
                log.info("  [Summary] Skipped — generation failed (non-blocking)")
        elif generate_summary_flag and not cls:
            log.info("  [Summary] Skipped — no classification available")
        elif generate_summary_flag and not embedding:
            log.info("  [Summary] Skipped — no embedding available")

        # Quality logging
        if len(cleaned_content) < SHORT_CONTENT_THRESHOLD:
            log_quality_issue(
                id_or_error,
                "short_content",
                "warning",
                {"length": len(cleaned_content)},
                "",
                BATCH_NAME,
            )
        if cls and cls.confidence < LOW_CONFIDENCE_THRESHOLD:
            log_quality_issue(
                id_or_error,
                "classification_low",
                "warning",
                {"confidence": cls.confidence},
                "",
                BATCH_NAME,
            )
        if cls and cls.requires_review:
            log_quality_issue(
                id_or_error,
                "manual_review",
                "warning",
                {"reason": cls.reason_if_flagged},
                "",
                BATCH_NAME,
            )
    else:
        result["status"] = "error"
        result["error"] = f"Insert failed: {id_or_error}"
        log.error("  [Store]   ERROR: %s", id_or_error)

    return result


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Ingest local markdown files into Knowledge Hub"
    )
    parser.add_argument(
        "path",
        help="File or directory path containing .md files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview classification without storing",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of files to process (0 = unlimited)",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip files already in DB (checks metadata.source_file)",
    )
    parser.add_argument(
        "--author",
        help="Set author_name for all files",
    )
    parser.add_argument(
        "--tag",
        help="Additional keyword tag to add to all files",
    )
    parser.add_argument(
        "--rate-limit",
        type=float,
        default=PIPELINE_RATE_LIMIT,
        help="Seconds between pipeline API calls (default: 1.5)",
    )
    parser.add_argument(
        "--generate-summary",
        action="store_true",
        default=True,
        dest="generate_summary",
        help="Generate AI summary for each item (default: enabled)",
    )
    parser.add_argument(
        "--no-summary",
        action="store_false",
        dest="generate_summary",
        help="Skip AI summary generation",
    )
    args = parser.parse_args()

    # ── Discover files ───────────────────────────────────────────────────
    input_path = os.path.abspath(args.path)
    files = discover_markdown_files(input_path)

    if not files:
        log.error("No .md files found at %s", input_path)
        sys.exit(1)

    if args.limit > 0:
        files = files[: args.limit]

    # Determine base directory for relative paths
    if os.path.isfile(input_path):
        base_dir = os.path.dirname(os.path.dirname(input_path))
    elif os.path.basename(input_path) in FOLDER_TAG_MAP:
        # Pointing at a subfolder like practical-ai-implementation-articles/
        base_dir = os.path.dirname(input_path)
    else:
        base_dir = input_path

    log.info("")
    log.info("=" * 60)
    log.info("Knowledge Hub Markdown File Ingestion")
    log.info("=" * 60)
    log.info("  Path:       %s", input_path)
    log.info("  Files:      %d", len(files))
    log.info("  Dry run:    %s", args.dry_run)
    log.info("  Skip existing: %s", args.skip_existing)
    if args.author:
        log.info("  Author:     %s", args.author)
    if args.tag:
        log.info("  Extra tag:  %s", args.tag)
    log.info("  Summaries:  %s", "enabled" if args.generate_summary else "disabled")
    log.info("  Rate limit: %.1fs", args.rate_limit)

    # ── Process files ────────────────────────────────────────────────────
    start = time.time()
    results = []
    total_classify_cost = 0.0
    total_embed_cost = 0.0

    for idx, file_path in enumerate(files):
        relative = os.path.relpath(file_path, base_dir)
        log.info("")
        log.info("[%d/%d] %s", idx + 1, len(files), relative)

        result = process_markdown_file(
            file_path=file_path,
            base_dir=base_dir,
            author_name=args.author,
            extra_tag=args.tag,
            skip_existing=args.skip_existing,
            dry_run=args.dry_run,
            generate_summary_flag=args.generate_summary,
        )
        results.append(result)

        total_classify_cost += result.get("classify_cost", 0.0)
        total_embed_cost += result.get("embed_cost", 0.0)
        total_summary_cost = sum(r.get("summary_cost", 0.0) for r in results)
        total_cost = total_classify_cost + total_embed_cost + total_summary_cost

        status_label = result["status"].upper()
        title_display = result.get("title", relative)[:60]
        log.info(
            "  [%s] %s | running cost: $%.3f",
            status_label,
            title_display,
            total_cost,
        )

        # Rate limit between files (skip after last file)
        if idx < len(files) - 1:
            time.sleep(args.rate_limit)

    elapsed = time.time() - start

    # ── Summary ──────────────────────────────────────────────────────────
    ok_count = sum(1 for r in results if r["status"] == "ok")
    dry_count = sum(1 for r in results if r["status"] == "dry_run")
    dup_count = sum(1 for r in results if r["status"] == "duplicate")
    skip_count = sum(1 for r in results if r["status"] == "skipped")
    error_count = sum(1 for r in results if r["status"] == "error")

    total_summary_cost = sum(r.get("summary_cost", 0.0) for r in results)
    summary_count = sum(1 for r in results if r.get("summary_cost", 0) > 0)
    total_cost = total_classify_cost + total_embed_cost + total_summary_cost

    log.info("")
    log.info("=" * 60)
    log.info("MARKDOWN INGESTION COMPLETE")
    log.info("=" * 60)
    log.info("  Total:      %d", len(results))
    log.info("  Processed:  %d", ok_count)
    if dry_count:
        log.info("  Dry run:    %d", dry_count)
    if summary_count:
        log.info("  Summarised: %d", summary_count)
    log.info("  Duplicates: %d", dup_count)
    log.info("  Skipped:    %d", skip_count)
    log.info("  Errors:     %d", error_count)
    log.info(
        "  Cost:       $%.3f (classify: $%.3f, embed: $%.3f, summary: $%.3f)",
        total_cost,
        total_classify_cost,
        total_embed_cost,
        total_summary_cost,
    )
    log.info("  Time:       %.0fs (%.1fm)", elapsed, elapsed / 60)

    if error_count:
        log.info("")
        log.info("  Errors:")
        for r in results:
            if r["status"] == "error":
                log.info(
                    "    %s: %s",
                    r.get("file", "?")[:50],
                    r.get("error", "?"),
                )

    # Exit with error code if any failures
    if error_count:
        sys.exit(1)


if __name__ == "__main__":
    main()
