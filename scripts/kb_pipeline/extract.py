"""Content extraction — trafilatura primary, Jina Reader fallback, PDF."""

import json
import logging
import os
import re
import subprocess
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

import trafilatura
import extruct
import requests

logger = logging.getLogger(__name__)


@dataclass
class ExtractedContent:
    """Result of content extraction."""
    title: str = ""
    content: str = ""
    author_name: str = ""
    source_url: str = ""
    source_domain: str = ""
    thumbnail_url: str = ""
    content_type: str = "article"
    platform: str = "web"
    captured_date: Optional[str] = None
    metadata: dict = field(default_factory=dict)
    extraction_method: str = ""
    raw_html: str = ""


def detect_platform(url: str) -> str:
    """Detect platform from URL."""
    return "web"


def is_pdf_url(url: str) -> bool:
    """Check if a URL points to a PDF, even without .pdf extension.

    First checks the URL extension, then performs a HEAD request to inspect
    the Content-Type header for URLs that don't end in .pdf.
    """
    if url.lower().endswith(".pdf"):
        return True
    try:
        resp = requests.head(url, timeout=10, allow_redirects=True)
        content_type = resp.headers.get("Content-Type", "").lower()
        return "application/pdf" in content_type
    except (requests.RequestException, OSError) as e:
        logger.debug("PDF HEAD check failed for %s: %s", url, e)
        return False


def detect_content_type(url: str, content: str, metadata: dict) -> str:
    """Auto-detect content_type from URL and content signals."""
    url_lower = url.lower()
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    path = parsed.path.rstrip("/")

    if url_lower.endswith(".pdf"):
        return "pdf"
    # Note: is_pdf_url() with HEAD request is only used in extract_url(),
    # not here, to avoid a network call during classification.
    if "youtube.com" in domain or "youtu.be" in domain:
        return "other"

    if any(x in url_lower for x in ["/podcast", "/episode", "/listen"]):
        return "other"
    if any(x in domain for x in ["substack.com", "newsletter", "mailchimp"]):
        return "article"
    if any(x in url_lower for x in ["/blog/", "/posts/", "/article/"]):
        return "blog"

    # ── Product description detection ─────────────────────────────────
    # Check og:type from metadata if available
    og_type = metadata.get("og_type", "").lower() if metadata else ""
    if og_type in ("product", "product.item"):
        return "product_description"

    # Root domain URLs (no meaningful path — likely a product/company homepage)
    if not path or path == "/":
        return "product_description"

    # Product-related paths
    product_path_segments = ("/pricing", "/features", "/product", "/platform", "/solutions", "/enterprise")
    if any(path.lower() == seg or path.lower().startswith(seg + "/") or path.lower().startswith(seg + "?")
           for seg in product_path_segments):
        return "product_description"

    # Default based on content length
    if content and len(content) > 2000:
        return "article"
    return "article"


def extract_og_metadata(html: str) -> dict:
    """Extract Open Graph and structured data from HTML."""
    result = {
        "og_title": "",
        "og_description": "",
        "og_image": "",
        "og_author": "",
        "og_date": "",
        "og_type": "",
    }

    if not html:
        return result

    try:
        data = extruct.extract(html, syntaxes=["opengraph", "json-ld", "microdata"])

        # Open Graph
        og = data.get("opengraph", [])
        if og:
            og_props = og[0].get("properties", []) if isinstance(og[0], dict) else []
            for key, val in og_props:
                if key == "og:title":
                    result["og_title"] = val
                elif key == "og:description":
                    result["og_description"] = val
                elif key == "og:image":
                    result["og_image"] = val
                elif key == "og:type":
                    result["og_type"] = val

        # JSON-LD for author/date
        jsonld = data.get("json-ld", [])
        for item in jsonld:
            if isinstance(item, dict):
                if "author" in item:
                    author = item["author"]
                    if isinstance(author, dict):
                        result["og_author"] = author.get("name", "")
                    elif isinstance(author, list) and author:
                        result["og_author"] = author[0].get("name", "") if isinstance(author[0], dict) else str(author[0])
                    elif isinstance(author, str):
                        result["og_author"] = author
                if "datePublished" in item:
                    result["og_date"] = item["datePublished"]
                elif "dateCreated" in item:
                    result["og_date"] = item["dateCreated"]

    except (ValueError, KeyError, TypeError, IndexError) as e:
        logger.debug("OG metadata extraction error: %s", e)

    return result


def extract_fallback_thumbnail(html: str, base_url: str) -> str:
    """Extract a fallback thumbnail from HTML when og:image is missing.

    Tries (in order):
    1. apple-touch-icon link
    2. favicon (rel="icon" or rel="shortcut icon")

    Resolves relative URLs against base_url. Returns empty string if nothing found.
    """
    if not html:
        return ""

    from urllib.parse import urljoin

    # 1. apple-touch-icon
    match = re.search(
        r'<link[^>]+rel=["\']apple-touch-icon["\'][^>]+href=["\']([^"\']+)["\']',
        html, re.IGNORECASE,
    )
    if not match:
        # Also check reversed attribute order (href before rel)
        match = re.search(
            r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']apple-touch-icon["\']',
            html, re.IGNORECASE,
        )
    if match:
        href = match.group(1).strip()
        if href:
            return urljoin(base_url, href)

    # 2. favicon — rel="icon" or rel="shortcut icon"
    match = re.search(
        r'<link[^>]+rel=["\'](?:shortcut )?icon["\'][^>]+href=["\']([^"\']+)["\']',
        html, re.IGNORECASE,
    )
    if not match:
        match = re.search(
            r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\'](?:shortcut )?icon["\']',
            html, re.IGNORECASE,
        )
    if match:
        href = match.group(1).strip()
        if href:
            return urljoin(base_url, href)

    return ""


def extract_with_trafilatura(url: str) -> Optional[ExtractedContent]:
    """Primary extraction using trafilatura."""
    try:
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return None

        # Extract main content
        content = trafilatura.extract(
            downloaded,
            include_comments=False,
            include_tables=True,
            include_links=True,
            favor_recall=True,
            output_format='markdown',
        )

        if not content:
            return None

        # Extract metadata via dedicated extractor
        from trafilatura.metadata import extract_metadata
        meta_obj = extract_metadata(downloaded)
        meta = {}
        if meta_obj:
            meta["title"] = meta_obj.title or ""
            meta["author"] = meta_obj.author or ""
            meta["date"] = meta_obj.date or ""

        # OG metadata from raw HTML
        og = extract_og_metadata(downloaded)

        domain = urlparse(url).netloc.replace("www.", "")

        # Thumbnail: og:image primary, fallback to apple-touch-icon / favicon
        thumbnail = og.get("og_image", "")
        if not thumbnail:
            thumbnail = extract_fallback_thumbnail(downloaded, url)

        og_metadata = {
            "og_description": og.get("og_description", ""),
            "og_type": og.get("og_type", ""),
            "extraction_source": "trafilatura",
        }

        result = ExtractedContent(
            title=meta.get("title", "") or og.get("og_title", ""),
            content=content,
            author_name=meta.get("author", "") or og.get("og_author", ""),
            source_url=url,
            source_domain=domain,
            thumbnail_url=thumbnail,
            platform=detect_platform(url),
            captured_date=meta.get("date", "") or og.get("og_date", ""),
            metadata=og_metadata,
            extraction_method="trafilatura",
            raw_html=downloaded,
        )
        result.content_type = detect_content_type(url, content, og_metadata)

        # Try to generate reader HTML via Readability (non-critical)
        try:
            reader_script = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "extract-reader-html.ts",
            )
            proc = subprocess.run(
                ["bun", "run", reader_script, url],
                input=downloaded.encode("utf-8"),
                capture_output=True,
                timeout=15,
            )
            if proc.returncode == 0 and proc.stdout:
                reader_html = proc.stdout.decode("utf-8").strip()
                if len(reader_html) > 100:
                    result.metadata["reader_html"] = reader_html
        except (subprocess.SubprocessError, OSError, UnicodeDecodeError) as e:
            logger.debug("Reader HTML generation failed for %s: %s", url, e)

        return result

    except (requests.RequestException, OSError, ValueError, AttributeError) as e:
        logger.warning("Trafilatura failed for %s: %s", url, e)
        return None


def extract_with_jina(url: str) -> Optional[ExtractedContent]:
    """Fallback extraction using Jina Reader (handles JS-rendered pages)."""
    try:
        jina_url = f"https://r.jina.ai/{url}"
        resp = requests.get(jina_url, timeout=30, headers={"Accept": "text/plain"})
        resp.raise_for_status()

        text = resp.text
        if not text or len(text) < 50:
            return None

        # Jina returns markdown — extract title from heading or Title: header
        title = ""
        lines = text.split("\n")
        for line in lines:
            if line.startswith("# "):
                title = line[2:].strip()
                break
            if line.startswith("Title:"):
                title = line[6:].strip()
                break

        domain = urlparse(url).netloc.replace("www.", "")

        result = ExtractedContent(
            title=title,
            content=text,
            source_url=url,
            source_domain=domain,
            platform=detect_platform(url),
            metadata={"extraction_source": "jina_reader"},
            extraction_method="jina_reader",
        )
        result.content_type = detect_content_type(url, text, {})
        return result

    except (requests.RequestException, OSError, ValueError) as e:
        logger.warning("Jina Reader failed for %s: %s", url, e)
        return None


def extract_pdf(filepath: str) -> Optional[ExtractedContent]:
    """Extract content and tables from a local PDF file."""
    import pdfplumber

    try:
        pages = []
        tables = []
        with pdfplumber.open(filepath) as pdf:
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text:
                    pages.append(text)

                # Extract tables from this page
                page_tables = page.extract_tables()
                for j, table in enumerate(page_tables):
                    if table and len(table) > 1:  # At least header + 1 row
                        headers = [str(cell or "").strip() for cell in table[0]]
                        rows = [[str(cell or "").strip() for cell in row] for row in table[1:]]
                        tables.append({
                            "page": i + 1,
                            "table_index": j,
                            "headers": headers,
                            "rows": rows,
                            "row_count": len(rows),
                        })

        if not pages:
            return None

        content = "\n\n---\n\n".join(pages)
        title = pages[0].split("\n")[0][:200] if pages else ""

        metadata: dict = {
            "page_count": len(pages),
            "extraction_source": "pdfplumber",
        }
        if tables:
            metadata["tables"] = tables
            metadata["table_count"] = len(tables)

        return ExtractedContent(
            title=title,
            content=content,
            content_type="pdf",
            platform="manual",
            metadata=metadata,
            extraction_method="pdfplumber",
        )

    except (OSError, ValueError, KeyError) as e:
        logger.warning("PDF extraction failed for %s: %s", filepath, e)
        return None


def extract_url(url: str) -> Optional[ExtractedContent]:
    """Main extraction entry point — tries best method for URL."""
    # PDF — check extension first, then Content-Type header for extensionless URLs
    if is_pdf_url(url):
        # Download then extract
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
                f.write(resp.content)
                tmp_path = f.name
            result = extract_pdf(tmp_path)
            if result:
                result.source_url = url
                result.source_domain = urlparse(url).netloc.replace("www.", "")
            import os
            os.unlink(tmp_path)
            return result
        except (requests.RequestException, OSError, ValueError) as e:
            logger.warning("PDF download failed for %s: %s", url, e)
            return None

    # Web: trafilatura primary, Jina fallback
    result = extract_with_trafilatura(url)
    if result and len(result.content) > 50:
        return result

    logger.info("Trafilatura insufficient for %s, trying Jina Reader...", url)
    return extract_with_jina(url)
