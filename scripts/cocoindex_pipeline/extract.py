"""ID-112.5 — the single shared Trafilatura cleaner.

One in-house cleaner, two call sites (Task ID-112 PRODUCT.md §B):

* the cocoindex worker imports ``clean_html`` in-process to handle its
  URL HTML branch ({112.7}), and
* the ``POST /extract`` worker endpoint ({112.6}) calls ``clean_html`` +
  ``apply_quality_gate`` so the synchronous TS manual route reaches the
  identical cleaning behaviour over HTTP.

Defined-once guarantees:

* **PI-4** — the Trafilatura extraction configuration lives in exactly one
  literal (``TRAFILATURA_CONFIG``); both call sites consume it. There is no
  second HTML-cleaning implementation and no duplicated config literal.
* **PI-5** — the content-length quality gate (``< 100`` ⇒ REJECT, ``< 500`` ⇒
  WARN, else OK) is defined once in ``apply_quality_gate`` and applied at both
  call sites. Thresholds are ported verbatim from the manual route's existing
  gate (``app/api/ingest/url/route.ts:113`` ⇒ 422; ``:122`` ⇒ warning) and are
  NOT weakened.

``output_format="txt"`` (PI-1): the load-bearing requirement on the HTML/URL
path is boilerplate-stripped clean *text*, not a particular serialisation.
Embedding, classification, and storage to ``reference_items.body`` never parse
Markdown structure, and there is no reference reader UI yet, so Markdown is
incidental here (it stays load-bearing only on the binary→Docling path, out of
ID-112 scope). ``txt`` also avoids Trafilatura's Markdown-serialisation
degradation on borderline inputs.

This module is a PURE cleaner: HTML in → clean text out. It performs NO fetch
and owns NO SSRF gate — each caller fetches upstream behind its own SSRF
surface (the Vercel route's ``validateUrl``; the worker's ``validate_url``).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from types import MappingProxyType
from typing import Mapping, Optional

import trafilatura

# ---------------------------------------------------------------------------
# PI-4 — the single shared Trafilatura configuration.
#
# Defined exactly ONCE here and consumed by clean_html below; both call sites
# (worker in-process, POST /extract over HTTP) resolve their cleaning behaviour
# from this literal. Exposed read-only (MappingProxyType) so a consumer cannot
# mutate the shared config and silently diverge the two seams.
# ---------------------------------------------------------------------------
TRAFILATURA_CONFIG: Mapping[str, object] = MappingProxyType(
    {
        # clean TEXT, not markdown — Markdown is NOT load-bearing on the URL
        # path (PI-1). No Turndown.
        "output_format": "txt",
        # prefer capturing the full article body over aggressive precision
        # pruning — better corpus for embedding/classification.
        "favor_recall": True,
        # boilerplate comment blocks are chrome, not article body.
        "include_comments": False,
        # tables often ARE the article substance (procurement / spec pages).
        "include_tables": True,
        # inline formatting markup is irrelevant to a plain-text body.
        "include_formatting": False,
        # we extract body only; metadata is sourced elsewhere.
        "with_metadata": False,
    }
)


def clean_html(html: str, *, url: Optional[str]) -> str:
    """Strip boilerplate chrome from ``html``, returning clean article text.

    Wraps ``trafilatura.extract`` with the shared :data:`TRAFILATURA_CONFIG`
    verbatim. ``url`` is keyword-only and may be ``None`` (worker call sites
    that clean an already-fetched body without a canonical URL).

    Trafilatura returns ``None`` when it finds no extractable content; this
    function maps that to the empty string so the downstream quality gate
    (:func:`apply_quality_gate`) catches a no-content page as ``REJECT`` (PI-5)
    rather than pushing ``None`` onto callers.
    """
    extracted = trafilatura.extract(html, url=url, **TRAFILATURA_CONFIG)
    return extracted if extracted is not None else ""


class GateVerdict(Enum):
    """Outcome of the content-length quality gate (PI-5).

    * ``REJECT`` — content too short to be meaningful (``< 100`` chars). The
      manual route maps this to HTTP 422; the worker maps it to a structured
      per-item failure (BI-19 containment, no partial rows).
    * ``WARN`` — limited content (``100 <= len < 500`` chars). Retained, with a
      warning surfaced to the caller.
    * ``OK`` — sufficient content (``>= 500`` chars).
    """

    REJECT = "reject"
    WARN = "warn"
    OK = "ok"


@dataclass(frozen=True)
class GateResult:
    """A quality-gate verdict plus any user-facing warning.

    Carries enough for callers to act without re-deriving anything: a
    ``REJECT`` becomes a 422 / per-item failure, a ``WARN`` surfaces
    :attr:`warning` (an OK / REJECT verdict has no warning). The shape is
    JSON-serialisable so the ``POST /extract`` endpoint ({112.6}) can return it
    in its response body (e.g. ``{ text, verdict, warning }``).
    """

    verdict: GateVerdict
    warning: Optional[str] = None


# Ported verbatim from app/api/ingest/url/route.ts:113 / :122 — the existing
# manual-route thresholds, preserved (PI-5).
_REJECT_BELOW = 100
_WARN_BELOW = 500

# Warning string surfaced on the WARN path. Mirrors the manual route's existing
# warning copy (route.ts:122-126).
_WARN_MESSAGE = "Limited text extracted from this page. The content may be incomplete."


def apply_quality_gate(text: str) -> GateResult:
    """Classify ``text`` by length into a :class:`GateResult` (PI-5).

    * ``len(text) < 100`` ⇒ ``REJECT`` (no warning — it becomes a 422).
    * ``100 <= len(text) < 500`` ⇒ ``WARN`` (carries :data:`_WARN_MESSAGE`).
    * ``len(text) >= 500`` ⇒ ``OK``.
    """
    length = len(text)
    if length < _REJECT_BELOW:
        return GateResult(verdict=GateVerdict.REJECT)
    if length < _WARN_BELOW:
        return GateResult(verdict=GateVerdict.WARN, warning=_WARN_MESSAGE)
    return GateResult(verdict=GateVerdict.OK)
