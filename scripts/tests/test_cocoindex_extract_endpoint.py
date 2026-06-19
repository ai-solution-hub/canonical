"""Unit tests for the `POST /extract` pure-cleaner endpoint (ID-112.6).

`POST /extract` is the HTTP seam that lets the synchronous TypeScript manual
route reach the SAME in-house Trafilatura cleaner the cocoindex worker uses
in-process (Task ID-112 PRODUCT.md §B / TECH Hand-off #2). The endpoint owns
FOUR ratified properties — every test below asserts one of them as real
behaviour (test-philosophy.md: behaviour, not implementation):

  1. PURE CLEANER — the handler reads the POSTed HTML from the request body,
     calls `clean_html` + `apply_quality_gate`, and returns
     `{text, verdict, warnings}`. It performs NO fetch and owns NO SSRF gate
     (the CALLER fetched the HTML). A REJECT verdict (content too short) is a
     200 success response carrying the REJECT verdict — NOT a 503, NOT a 4xx
     at this layer (the manual route in {112.10} maps REJECT→422).
  2. DEDICATED BEARER — `Authorization: Bearer ${EXTRACT_API_TOKEN}`. A
     missing/wrong bearer → 401. The route FAILS CLOSED with 401 when
     EXTRACT_API_TOKEN is unset. A `CRON_SECRET`-valued bearer is NOT accepted
     (different blast radius from /walk).
  3. HARDENED BODY CAP — a per-route 20 MB cap (aligned to the manual route's
     `MAX_CONTENT_SIZE`, lib/extraction/url.ts:30), tighter than the app-wide
     50 MB. An over-cap body is rejected 413.
  4. MALFORMED INPUT — a non-text/empty body is a NAMED 4xx, distinct from a
     clean REJECT (200 + verdict).

The handler is exercised IN-PROCESS via `aiohttp.test_utils.make_mocked_request`
(route resolve + direct handler await, NO TCP socket) — the identical harness
the sibling /stage + /walk tests use (test_cocoindex_server.py). The real HTML
fixture (`fixtures/extraction/procurement_guide.html`, landed by {112.5}) cleans
to ~2.9 KB of text — an OK verdict, well above the 500-char WARN threshold.
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

_EXTRACT_TOKEN = "test-extract-token-id112"
_FIXTURE = (
    Path(__file__).parent / "fixtures" / "extraction" / "procurement_guide.html"
)


@pytest.fixture
def aiohttp_app() -> web.Application:
    """Build the aiohttp Application via `build_app()` (no listening socket)."""
    from scripts.cocoindex_pipeline.server import build_app

    return build_app()


async def _exercise_extract(
    aiohttp_app: web.Application,
    *,
    body: bytes,
    bearer: str | None = _EXTRACT_TOKEN,
    content_type: str = "text/html",
    content_length: int | None = None,
) -> tuple[int, dict]:
    """Invoke the /extract handler in-process (route resolve + direct await).

    Mirrors `_exercise_stage` / `_exercise_walk`: feeds `body` through a real
    `StreamReader` so `await request.read()` drives the genuine payload path —
    no TCP socket. Omit the bearer header entirely with `bearer=None`. A
    `content_length` override lets a test assert the cheap header-based cap
    rejection WITHOUT actually streaming an over-cap body. Returns
    `(status, parsed_json_body)`.
    """
    headers: dict[str, str] = {"Content-Type": content_type}
    if bearer is not None:
        headers["Authorization"] = f"Bearer {bearer}"
    if content_length is not None:
        headers["Content-Length"] = str(content_length)
    else:
        headers["Content-Length"] = str(len(body))
    loop = asyncio.get_running_loop()
    stream = StreamReader(Mock(), limit=2**16, loop=loop)
    stream.feed_data(body)
    stream.feed_eof()
    request = make_mocked_request(
        "POST", "/extract", headers=headers, payload=stream, app=aiohttp_app
    )
    match_info = await aiohttp_app.router.resolve(request)
    resp = await match_info.handler(request)
    return resp.status, json.loads(resp.body)


# ──────────────────────────────────────────────────────────────────────────
# Route registration — /extract on the same build_app() app, /stage UNCHANGED
# ──────────────────────────────────────────────────────────────────────────


class TestExtractRouteTable:
    """`POST /extract` is registered and does not displace existing routes."""

    def test_extract_route_registered(self, aiohttp_app: web.Application) -> None:
        routes = {
            (route.method, route.resource.canonical)
            for route in aiohttp_app.router.routes()
            if route.resource is not None
        }
        assert ("POST", "/extract") in routes

    def test_extract_does_not_displace_existing_routes(
        self, aiohttp_app: web.Application
    ) -> None:
        routes = {
            (route.method, route.resource.canonical)
            for route in aiohttp_app.router.routes()
            if route.resource is not None
        }
        assert ("GET", "/health") in routes
        assert ("POST", "/stage") in routes
        assert ("POST", "/walk") in routes


# ──────────────────────────────────────────────────────────────────────────
# Property 2 — dedicated EXTRACT_API_TOKEN bearer (fail-closed; CRON_SECRET
# is NOT accepted)
# ──────────────────────────────────────────────────────────────────────────


class TestExtractAuth:
    """Property 2 — bearer gate on EXTRACT_API_TOKEN, NOT CRON_SECRET."""

    def test_extract_401_when_no_bearer(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        status, body = asyncio.run(
            _exercise_extract(
                aiohttp_app, body=_FIXTURE.read_bytes(), bearer=None
            )
        )
        assert status == 401
        assert "error" in body

    def test_extract_401_when_wrong_bearer(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        status, _ = asyncio.run(
            _exercise_extract(
                aiohttp_app, body=_FIXTURE.read_bytes(), bearer="wrong-token"
            )
        )
        assert status == 401

    def test_extract_401_when_cron_secret_value_presented(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A bearer carrying the CRON_SECRET value must NOT be accepted by
        /extract — the dedicated EXTRACT_API_TOKEN has a different blast radius
        and CRON_SECRET must not unlock the cleaner endpoint (Property 2)."""
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        monkeypatch.setenv("CRON_SECRET", "the-cron-secret-value")
        status, _ = asyncio.run(
            _exercise_extract(
                aiohttp_app,
                body=_FIXTURE.read_bytes(),
                bearer="the-cron-secret-value",
            )
        )
        assert status == 401

    def test_extract_401_when_token_unset_fails_closed(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Fail closed: when EXTRACT_API_TOKEN is unset the route returns 401,
        never allowing an unauthenticated extract (Property 2)."""
        monkeypatch.delenv("EXTRACT_API_TOKEN", raising=False)
        status, _ = asyncio.run(
            _exercise_extract(
                aiohttp_app, body=_FIXTURE.read_bytes(), bearer=_EXTRACT_TOKEN
            )
        )
        assert status == 401


# ──────────────────────────────────────────────────────────────────────────
# Property 1 — pure cleaner: 200 + {text, verdict} on a valid body;
# REJECT (too-short) is a 200 carrying the verdict, NOT a 4xx
# ──────────────────────────────────────────────────────────────────────────


class TestExtractPureCleaner:
    """Property 1 — clean HTML in → clean text + verdict out, no fetch."""

    def test_extract_200_returns_text_and_verdict(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        status, body = asyncio.run(
            _exercise_extract(aiohttp_app, body=_FIXTURE.read_bytes())
        )
        assert status == 200
        # The cleaner stripped boilerplate and returned article text …
        assert isinstance(body["text"], str) and len(body["text"]) > 500
        # … with the OK verdict (the fixture cleans well above the 500 gate).
        assert body["verdict"] == "ok"
        # warnings is always present (empty list on an OK verdict).
        assert body["warnings"] == []

    def test_extract_200_reject_verdict_on_short_body(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A too-short HTML body is a clean REJECT: 200 carrying the REJECT
        verdict, NOT a 4xx at this layer. The manual route ({112.10}) maps
        REJECT→422; the endpoint only reports the verdict (Property 1)."""
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        # Valid HTML but with near-zero extractable body → clean text < 100 chars.
        tiny = b"<html><body><p>Hi.</p></body></html>"
        status, body = asyncio.run(_exercise_extract(aiohttp_app, body=tiny))
        assert status == 200, (
            "a too-short page is a clean REJECT (200 + verdict), never a 4xx"
        )
        assert body["verdict"] == "reject"

    def test_extract_200_warn_carries_warning(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A page whose clean text lands in [100, 500) returns a WARN verdict
        and surfaces the warning string in `warnings` (Property 1)."""
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        # ~200 chars of body text → WARN band (>=100, <500).
        para = "Procurement framework guidance for suppliers. " * 5
        body_html = f"<html><body><article><p>{para}</p></article></body></html>"
        status, body = asyncio.run(
            _exercise_extract(aiohttp_app, body=body_html.encode())
        )
        assert status == 200
        assert body["verdict"] == "warn"
        assert len(body["warnings"]) == 1
        assert "incomplete" in body["warnings"][0].lower()


# ──────────────────────────────────────────────────────────────────────────
# Property 3 — hardened per-route 20 MB body cap (tighter than app-wide 50 MB)
# ──────────────────────────────────────────────────────────────────────────


class TestExtractBodyCap:
    """Property 3 — per-route 20 MB cap, aligned to the manual route's
    MAX_CONTENT_SIZE (lib/extraction/url.ts:30). Over-cap → 413."""

    def test_extract_413_when_content_length_over_cap(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A Content-Length declaring an over-cap body is rejected 413 up front
        — the cheap header guard, before reading 20 MB off the wire."""
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        over = 20 * 1024 * 1024 + 1
        status, body = asyncio.run(
            _exercise_extract(
                aiohttp_app,
                body=b"<html><body>small</body></html>",
                content_length=over,
            )
        )
        assert status == 413
        assert "error" in body

    def test_extract_413_when_streamed_body_over_cap(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A body that EXCEEDS the cap on the wire (regardless of a possibly
        understated/absent Content-Length) is rejected 413 — the cap is
        enforced on the actual bytes, not trusted from the header alone."""
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        # Build a body just over 20 MB; declare a small Content-Length so the
        # header guard cannot be what rejects it — the read-side cap must.
        big = b"<html><body>" + (b"a" * (20 * 1024 * 1024 + 16)) + b"</body></html>"
        status, body = asyncio.run(
            _exercise_extract(aiohttp_app, body=big, content_length=10)
        )
        assert status == 413
        assert "error" in body

    def test_extract_200_when_body_within_cap(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A normal (well-under-cap) body is accepted — the cap does not reject
        legitimate pages."""
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        status, _ = asyncio.run(
            _exercise_extract(aiohttp_app, body=_FIXTURE.read_bytes())
        )
        assert status == 200


# ──────────────────────────────────────────────────────────────────────────
# Property 4 — malformed input is a NAMED 4xx, distinct from a clean REJECT
# ──────────────────────────────────────────────────────────────────────────


class TestExtractMalformedInput:
    """Property 4 — an empty body is a client-correctable 400, distinguishable
    from a too-short-but-present body (which is a 200 REJECT)."""

    def test_extract_400_on_empty_body(
        self, aiohttp_app: web.Application, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("EXTRACT_API_TOKEN", _EXTRACT_TOKEN)
        status, body = asyncio.run(_exercise_extract(aiohttp_app, body=b""))
        assert status == 400
        assert "error" in body
