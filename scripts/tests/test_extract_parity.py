"""Golden-fixture cleaner-parity tests (ID-112.12, PRODUCT PI-6 / TECH Hand-off #3).

The whole point of Task ID-112 is that there is ONE in-house Trafilatura cleaner,
reached two ways:

  * the cocoindex worker imports `clean_html` IN-PROCESS ({112.7}), and
  * the synchronous TypeScript manual route reaches the same cleaner OVER HTTP via
    `POST /extract` ({112.6} endpoint, {112.10} `cleanViaWorker` seam).

If those two seams ever diverged, the manual-import path and the worker path would
quietly clean the same page differently — exactly the "two divergent stacks" problem
the cutover exists to kill (TECH §59 (c)). This module PROVES they do not diverge: for
each golden fixture it asserts the in-process clean and the over-HTTP clean are
BYTE-IDENTICAL, and that both equal a checked-in golden reference so any drift in the
shared cleaner is caught on every run.

PI-6 acceptance discipline (PRODUCT §179, RESEARCH §Empirical-verification BEHAVIOUR
caveat): fixtures MUST be realistically-sized article HTML (8+ substantial paragraphs +
nav/aside/footer chrome) — Trafilatura degrades toward near-full-text on tiny inputs, so
a sub-paragraph synthetic fragment is NOT valid acceptance evidence. Both fixtures here
clean to ~3 KB of text (an OK verdict, well above the 500-char gate).

The parity assertion is SAME-CONFIG → SAME-OUTPUT in the *configured* format
(`output_format="txt"` clean text, PI-1) — it is deliberately NOT hard-coded to expect
Markdown. The golden `.expected.txt` files are the single source of truth that this
Python over-HTTP test and the TS mirror test (`__tests__/lib/extraction/
clean-via-worker-parity.test.ts`) both assert against.

The over-HTTP seam is exercised IN-PROCESS via `aiohttp.test_utils.make_mocked_request`
(route resolve + direct handler await, NO TCP socket) — the identical harness the
sibling {112.6} endpoint tests use (test_cocoindex_extract_endpoint.py).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from aiohttp import web  # noqa: E402
from aiohttp.streams import StreamReader  # noqa: E402
from aiohttp.test_utils import make_mocked_request  # noqa: E402

from scripts.cocoindex_pipeline.extract import GateVerdict, apply_quality_gate, clean_html

_EXTRACT_TOKEN = "test-extract-token-id112"
_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "extraction"

# Each golden fixture: the HTML file, the canonical document URL passed to BOTH seams
# (in-process `clean_html(url=...)` and the over-HTTP `?url=` query param), and the
# checked-in golden reference both the Python over-HTTP test and the TS mirror test
# assert against. The url MUST be identical across the two seams or the byte-parity
# assertion would not be a fair comparison (Trafilatura uses it for link/metadata
# resolution).
_GOLDEN_CASES = [
    pytest.param(
        "procurement_guide.html",
        "https://example.com/guides/procurement",
        "procurement_guide.expected.txt",
        id="procurement_guide",
    ),
    pytest.param(
        "news_article.html",
        "https://example.com/local-government/shared-platforms",
        "news_article.expected.txt",
        id="news_article",
    ),
]


@pytest.fixture
def aiohttp_app() -> web.Application:
    """Build the aiohttp Application via `build_app()` (no listening socket)."""
    from scripts.cocoindex_pipeline.server import build_app

    return build_app()


async def _extract_over_http(
    aiohttp_app: web.Application, *, body: bytes, url: str
) -> dict:
    """Drive `POST /extract?url=<url>` in-process and return the parsed JSON body.

    Mirrors `_exercise_extract` in test_cocoindex_extract_endpoint.py: feeds `body`
    through a real `StreamReader` so `await request.read()` drives the genuine payload
    path — no TCP socket. The `?url=` query param is what the handler hands Trafilatura,
    so it must match the `url` passed to the in-process `clean_html` for a fair
    byte-parity comparison.
    """
    headers = {
        "Content-Type": "text/html",
        "Authorization": f"Bearer {_EXTRACT_TOKEN}",
        "Content-Length": str(len(body)),
    }
    loop = asyncio.get_running_loop()
    stream = StreamReader(Mock(), limit=2**16, loop=loop)
    stream.feed_data(body)
    stream.feed_eof()
    request = make_mocked_request(
        "POST",
        f"/extract?url={url}",
        headers=headers,
        payload=stream,
        app=aiohttp_app,
    )
    match_info = await aiohttp_app.router.resolve(request)
    resp = await match_info.handler(request)
    assert resp.status == 200, f"expected 200 from /extract, got {resp.status}"
    return json.loads(resp.body)


class TestCleanerParity:
    """PI-6 — the shared cleaner produces equivalent output across both call sites."""

    @pytest.mark.parametrize("fixture_name, url, golden_name", _GOLDEN_CASES)
    def test_in_process_equals_over_http_byte_identical(
        self,
        aiohttp_app: web.Application,
        monkeypatch: pytest.MonkeyPatch,
        fixture_name: str,
        url: str,
        golden_name: str,
    ) -> None:
        """The core proof: `clean_html` IN-PROCESS == `POST /extract` body OVER-HTTP,
        byte-identical, on the SAME realistically-sized fixture and SAME url.

        This is what makes the seam SHARED, not duplicated: the endpoint is a thin
        wrapper over `clean_html`, so the cleaned text must be identical to within a
        byte. If they ever diverge, STOP — it means the manual route ({112.10}) and the
        worker ({112.7}) are no longer running one cleaner (PRODUCT PI-6, TECH §59 (c)).
        """
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        html_bytes = (_FIXTURE_DIR / fixture_name).read_bytes()

        # Seam A — in-process (the worker path, {112.7}).
        in_process = clean_html(html_bytes.decode("utf-8"), url=url)

        # Seam B — over HTTP (the manual-route path via {112.6} endpoint).
        http_body = asyncio.run(
            _extract_over_http(aiohttp_app, body=html_bytes, url=url)
        )

        # Byte-identical: the endpoint is a thin wrapper over clean_html.
        assert http_body["text"] == in_process, (
            f"{fixture_name}: in-process clean_html differs from over-HTTP /extract — "
            "the two seams are NOT sharing one cleaner"
        )

    @pytest.mark.parametrize("fixture_name, url, golden_name", _GOLDEN_CASES)
    def test_both_seams_match_golden_reference(
        self,
        aiohttp_app: web.Application,
        monkeypatch: pytest.MonkeyPatch,
        fixture_name: str,
        url: str,
        golden_name: str,
    ) -> None:
        """Both seams equal the checked-in golden `.expected.txt` — the drift catcher.

        The golden file is the single source of truth shared with the TS mirror test.
        Asserting both the in-process and over-HTTP outputs against it means a change in
        the shared cleaner's behaviour (a config tweak, a Trafilatura bump) is caught
        here rather than silently shipping a different clean.
        """
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        html_bytes = (_FIXTURE_DIR / fixture_name).read_bytes()
        golden = (_FIXTURE_DIR / golden_name).read_text(encoding="utf-8")

        in_process = clean_html(html_bytes.decode("utf-8"), url=url)
        http_body = asyncio.run(
            _extract_over_http(aiohttp_app, body=html_bytes, url=url)
        )

        assert in_process == golden, (
            f"{fixture_name}: in-process clean drifted from the golden reference"
        )
        assert http_body["text"] == golden, (
            f"{fixture_name}: over-HTTP clean drifted from the golden reference"
        )

    @pytest.mark.parametrize("fixture_name, url, golden_name", _GOLDEN_CASES)
    def test_golden_is_realistically_sized_clean_text(
        self,
        fixture_name: str,
        url: str,
        golden_name: str,
    ) -> None:
        """Acceptance-evidence guard: the golden output is the configured clean TEXT
        (PI-1, not hard-coded Markdown) and is realistically sized — an OK verdict well
        above the 500-char gate, NOT a sub-paragraph synthetic fragment (PI-6 / RESEARCH
        §Empirical-verification BEHAVIOUR caveat).
        """
        golden = (_FIXTURE_DIR / golden_name).read_text(encoding="utf-8")

        # Realistically sized → OK verdict (>= 500 chars), not a tiny fragment.
        assert apply_quality_gate(golden).verdict is GateVerdict.OK, (
            f"{golden_name} is not realistically sized — tiny fixtures are invalid "
            "PI-6 acceptance evidence"
        )
        # Configured txt format: plain article text, not Markdown serialisation. The
        # cleaner strips chrome, so the golden carries the article body but none of the
        # nav/aside/footer boilerplate, and no Markdown heading/emphasis markers.
        assert "Accept all cookies" not in golden, "chrome leaked into the clean text"
        assert "All rights reserved" not in golden, "footer leaked into the clean text"
        assert "# " not in golden and "**" not in golden, (
            "output looks like Markdown — the configured format is txt (PI-1)"
        )
