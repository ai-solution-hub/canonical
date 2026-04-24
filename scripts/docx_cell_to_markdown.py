"""Convert HTML cell content to GFM markdown via pandoc.

Wraps pandoc subprocess for HTML-to-markdown cell conversion. Pandoc is already
a runtime dependency of the importer (used by docx_utils.py for Track Changes
resolution).

Usage:
    from docx_cell_to_markdown import html_cell_to_markdown, plain_text_to_markdown

Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss6.3.
"""

import logging
import re
import shutil
import subprocess

logger = logging.getLogger(__name__)

# Pre-check pandoc availability at module load
_PANDOC_AVAILABLE = shutil.which("pandoc") is not None


def html_cell_to_markdown(html: str) -> str:
    """Convert an HTML string to GFM markdown via pandoc.

    Args:
        html: HTML content to convert (e.g. from a DOCX cell).

    Returns:
        GFM markdown string. Returns the input stripped of tags on pandoc failure.
    """
    if not html or not html.strip():
        return ""

    if not _PANDOC_AVAILABLE:
        logger.warning("pandoc not available — falling back to tag stripping")
        return _strip_html_tags(html)

    try:
        result = subprocess.run(
            [
                "pandoc",
                "--from=html",
                "--to=gfm",
                "--wrap=none",
            ],
            input=html,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        logger.warning("pandoc HTML->markdown failed: %s", result.stderr)
        return _strip_html_tags(html)
    except subprocess.TimeoutExpired:
        logger.warning("pandoc timed out converting HTML to markdown")
        return _strip_html_tags(html)
    except Exception as e:
        logger.warning("pandoc conversion error: %s", e)
        return _strip_html_tags(html)


def plain_text_to_markdown(text: str) -> str:
    """Pass-through for plain text cells.

    Plain text is already valid (trivial) markdown. This function exists for
    API consistency with html_cell_to_markdown — the caller can always call
    the markdown converter regardless of whether the input is HTML or plain text.

    Leading/trailing whitespace is stripped. Multiple blank lines are collapsed
    to a single blank line (paragraph boundary in markdown).

    Args:
        text: Plain text content.

    Returns:
        The text, trimmed and with collapsed blank lines.
    """
    if not text:
        return ""
    # Collapse multiple blank lines to a single blank line
    result = re.sub(r'\n{3,}', '\n\n', text.strip())
    return result


def _strip_html_tags(html: str) -> str:
    """Fallback: strip HTML tags and return plain text."""
    text = re.sub(r'<[^>]+>', '', html)
    return text.strip()
