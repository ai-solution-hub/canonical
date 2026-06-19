"""ID-112.5 — shared Trafilatura cleaner (``extract.py``).

Behaviour-first tests for the single shared cleaner that BOTH the worker
(in-process import, {112.7}) and the ``POST /extract`` endpoint ({112.6})
resolve from. Satisfies PI-4 (cleaner config defined once) and PI-5 (quality
gate defined once), Task ID-112 PRODUCT.md §B.

The cleaner contract is asserted against OBSERVABLE cleaned output (chrome
stripped, body retained) on a realistically-sized fixture — never against
Trafilatura internals. The fixture is deliberately a full article with
navigation/aside/footer chrome: Trafilatura degrades toward near-full-text on
tiny inputs (RESEARCH §Empirical-verification caveat), so a sub-paragraph
fragment would be invalid acceptance evidence (PI-6).
"""

import os

from scripts.cocoindex_pipeline.extract import (
    GateVerdict,
    TRAFILATURA_CONFIG,
    apply_quality_gate,
    clean_html,
)

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "extraction")


def _load_fixture(name: str) -> str:
    with open(os.path.join(FIXTURE_DIR, name), encoding="utf-8") as handle:
        return handle.read()


# Chrome the cleaner MUST strip from the realistic article fixture: site nav,
# cookie banner, breadcrumb, sponsored advert, related-links aside, footer.
_CHROME_STRINGS = [
    "Accept all cookies",
    "Sign in",
    "Pricing plans",
    "Sponsored",
    "All rights reserved",
    "Subscribe to our newsletter",
    "Related articles",
    "Privacy policy",
    "Home > Guides",
]

# Body content the cleaner MUST retain — including table-cell substance, since
# include_tables=True keeps tables that often ARE the article (procurement
# scoring weights here).
_BODY_STRINGS = [
    "Procurement Act 2023",
    "three pillars",
    "standstill period",
    "compounding result",
    "Construction",
    "Facilities management",
]


def test_clean_html_strips_chrome_keeps_body() -> None:
    """clean_html returns boilerplate-stripped article body text.

    Asserts the observable cleaned output: every chrome string is gone and
    every body paragraph (incl. table cells) survives.
    """
    html = _load_fixture("procurement_guide.html")

    cleaned = clean_html(html, url="https://example.com/guides/procurement")

    assert isinstance(cleaned, str)
    for chrome in _CHROME_STRINGS:
        assert chrome not in cleaned, f"chrome leaked into cleaned output: {chrome!r}"
    for body in _BODY_STRINGS:
        assert body in cleaned, f"body content dropped from cleaned output: {body!r}"


def test_clean_html_returns_empty_string_when_no_content() -> None:
    """When Trafilatura extracts nothing, clean_html returns ''.

    The empty-string contract lets the quality gate downstream catch a
    no-content page as REJECT (PI-5) rather than the caller having to handle
    a None.
    """
    cleaned = clean_html("<html><head></head><body></body></html>", url=None)

    assert cleaned == ""


def test_clean_html_accepts_none_url() -> None:
    """url is keyword-only and may be None (worker call sites without a URL)."""
    html = _load_fixture("procurement_guide.html")

    cleaned = clean_html(html, url=None)

    assert "Procurement Act 2023" in cleaned


def test_config_is_single_txt_definition() -> None:
    """The one shared config selects clean text (not markdown) and recall.

    PI-1: output_format='txt' (Markdown not load-bearing on the URL path).
    PI-4: a single config literal both call sites resolve from.
    """
    assert TRAFILATURA_CONFIG["output_format"] == "txt"
    assert TRAFILATURA_CONFIG["favor_recall"] is True
    assert TRAFILATURA_CONFIG["include_tables"] is True
    assert TRAFILATURA_CONFIG["include_comments"] is False


def test_quality_gate_reject_below_100() -> None:
    """<100 chars => REJECT (ported verbatim from route.ts:113)."""
    assert apply_quality_gate("x" * 99).verdict is GateVerdict.REJECT
    assert apply_quality_gate("").verdict is GateVerdict.REJECT


def test_quality_gate_warn_between_100_and_499() -> None:
    """100 <= len < 500 => WARN (ported verbatim from route.ts:122)."""
    assert apply_quality_gate("x" * 100).verdict is GateVerdict.WARN
    assert apply_quality_gate("x" * 499).verdict is GateVerdict.WARN


def test_quality_gate_ok_at_500_and_above() -> None:
    """>=500 chars => OK."""
    assert apply_quality_gate("x" * 500).verdict is GateVerdict.OK
    assert apply_quality_gate("x" * 5000).verdict is GateVerdict.OK


def test_quality_gate_reject_carries_no_warning() -> None:
    """A REJECT verdict has no warning string (it becomes a 422, not a warn)."""
    result = apply_quality_gate("x" * 50)

    assert result.verdict is GateVerdict.REJECT
    assert result.warning is None


def test_quality_gate_warn_carries_warning_string() -> None:
    """A WARN verdict carries the user-facing warning the route surfaces."""
    result = apply_quality_gate("x" * 200)

    assert result.verdict is GateVerdict.WARN
    assert result.warning is not None
    assert len(result.warning) > 0


def test_quality_gate_ok_carries_no_warning() -> None:
    """An OK verdict has no warning."""
    result = apply_quality_gate("x" * 1000)

    assert result.verdict is GateVerdict.OK
    assert result.warning is None
