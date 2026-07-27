"""Mock Anthropic /v1/messages server — the id-389 tier-1 LLM substrate.

Serves deterministic, schema-valid extraction payloads so a staging or CI
corpus walk exercises the FULL wiring path (rows land, statuses flow,
webhooks fire, fence held) at $0 and with NO live Anthropic key. Runs from
the SAME pipeline image as the sidecar (`python3 -m
scripts.cocoindex_pipeline.mock_llm`) — no separate artefact, no
pip-at-boot — and is version-locked to the extraction code it mocks.

Tier model (id-389):
  1. DEFAULT — this mock, reached by pointing `ANTHROPIC_BASE_URL` at it
     (the pinned anthropic SDK honours that env var natively; verified on
     0.79.0). Wiring iteration only — canned output cannot adjudicate
     extraction QUALITY.
  2. OPT-IN — OpenRouter cheap-model tier for extraction-quality runs
     (`ANTHROPIC_BASE_URL` + key flip; explicit, never default).
  3. FINAL PARITY — real Anthropic key, one run before promoting a fix.

Why not StacklokLabs mockllm (the candidate id-389 named): adjudicated
unfit 2026-07-27 against mockllm 0.0.8 — (a) its response lookup is an
exact match on the LAST USER MESSAGE only, but all four extractors send
the same per-document `content_text` as the user message and differ only
in their SYSTEM prompt, so one mockllm instance cannot return the four
different shapes the extractors validate against (two objects, two JSON
arrays); (b) the pipeline calls `client.messages.stream(...)` (bl-222),
so the mock must speak the Anthropic SSE event grammar the SDK stream
accumulator parses — mockllm's canned-string streaming does not.

Contract with `extraction.py` (the load-bearing invariants):
  - Discrimination is an EXACT string match of the request's system-block
    text against the four `prompts.py` constants — the same objects the
    extractors send via `_cached_system_block`. A prompt edit therefore
    breaks the match loudly (400 naming the mock) instead of silently
    serving the wrong shape.
  - Canned payloads are CONSTRUCTED from the real pydantic classes and
    revalidated through `extraction.py`'s own TypeAdapters at import time,
    so the mock fails at boot — not mid-walk — if the schemas drift.
  - Streamed responses end with `stop_reason: "end_turn"`, so
    `_guard_not_truncated` passes.
  - A request with NO system prompt gets a plain "pong" message — the
    id-389 credential-preflight ping — while an UNRECOGNISED system prompt
    is a loud 400 (a real caller whose prompt this mock does not know).

NEVER expose this server publicly: compose-internal / runner-local only.
"""

from __future__ import annotations

import json
import logging
import os

from aiohttp import web

from scripts.cocoindex_pipeline import extraction, prompts

_logger = logging.getLogger(__name__)

# ── Canned payloads — built from the REAL shapes, valid by construction ──────
#
# Taxonomy-validated fields (`content_type`, `form_type`, `primary_domain`)
# take the first sorted member of the SAME frozensets `extraction.py`
# validates against, so taxonomy regeneration can never strand the mock on
# a retired value. All free-text fields carry an unambiguous MOCK marker so
# mock-tier rows are instantly recognisable in the DB.


def _first(values: frozenset[str]) -> str:
    if not values:
        raise RuntimeError("taxonomy value set is empty")
    return sorted(values)[0]


_CLASSIFICATION_PAYLOAD = extraction.ClassificationExtraction(
    content_type=_first(extraction._VALID_CONTENT_TYPES),
    primary_domain=_first(extraction._VALID_DOMAINS),
    suggested_title="MOCK classified document (id-389 tier-1)",
    classification_confidence=0.95,
    rationale="MOCK canned response — id-389 tier-1 wiring substrate",
).model_dump_json()

_QA_FORM_PAYLOAD = extraction.QAFormExtraction(
    form_metadata=extraction.FormMetadata(
        form_type=_first(extraction._VALID_FORM_TYPES),
        form_format="md",
        form_title="MOCK form (id-389 tier-1)",
    ),
    qa_pairs=[
        # One ANSWERED pair so promotion-funnel wiring sees an eligible row
        # (an unanswered pair is Class A — permanently unpromotable, id-370).
        extraction.QAPair(
            question_text="MOCK: what is your quality assurance policy?",
            answer_text="MOCK: we operate an ISO 9001-aligned QA policy.",
            expected_response_kind="mandatory",
        )
    ],
).model_dump_json()

_ENTITY_MENTIONS_PAYLOAD = json.dumps(
    [
        extraction.EntityMentionExtraction(
            entity_type="organisation",
            entity_name="MOCK Organisation Ltd",
            source_span_start=0,
            source_span_end=21,
            mention_confidence=0.9,
        ).model_dump(mode="json")
    ]
)

_RELATIONSHIPS_PAYLOAD = json.dumps(
    [
        extraction.RelationshipExtraction(
            source="MOCK Organisation Ltd",
            relationship="holds",
            target="MOCK ISO 9001 certification",
        ).model_dump(mode="json")
    ]
)

# Boot-time self-check: every canned payload must round-trip the EXACT
# validation path the extractors run (`validate_json` on extraction.py's own
# adapters). Schema drift kills the mock at boot, not mid-walk.
extraction._classification_adapter.validate_json(_CLASSIFICATION_PAYLOAD)
extraction._qa_form_adapter.validate_json(_QA_FORM_PAYLOAD)
extraction._entity_mentions_adapter.validate_json(_ENTITY_MENTIONS_PAYLOAD)
extraction._relationships_adapter.validate_json(_RELATIONSHIPS_PAYLOAD)

# system-prompt text → (extractor name, canned response text)
_ROUTES: dict[str, tuple[str, str]] = {
    prompts.CLASSIFICATION_PROMPT: (
        "extract_classification",
        _CLASSIFICATION_PAYLOAD,
    ),
    prompts.Q_A_FORM_PROMPT: ("extract_qa_form", _QA_FORM_PAYLOAD),
    prompts.ENTITY_MENTION_PROMPT: (
        "extract_entity_mentions",
        _ENTITY_MENTIONS_PAYLOAD,
    ),
    prompts.RELATIONSHIP_PROMPT: (
        "extract_relationships",
        _RELATIONSHIPS_PAYLOAD,
    ),
}


# ── Anthropic response shaping ───────────────────────────────────────────────


def _system_text(system: object) -> str:
    """Extract the system-prompt text from either wire shape the SDK sends:
    a plain string, or a list of text blocks (`_cached_system_block`)."""
    if isinstance(system, str):
        return system
    if isinstance(system, list) and system:
        first = system[0]
        if isinstance(first, dict):
            return str(first.get("text", ""))
    return ""


def _message_dict(model: str, text: str, extractor: str) -> dict[str, object]:
    """A complete non-streaming Anthropic Message body (SDK-parseable)."""
    return {
        "id": f"msg_mock_llm_{extractor}",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }


def _sse_event(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _sse_body(model: str, text: str, extractor: str) -> str:
    """The full Anthropic streaming event sequence, terminal
    `stop_reason: "end_turn"` included, as one text/event-stream body.
    This is what `client.messages.stream(...).get_final_message()`
    accumulates back into a `Message` (bl-222 path)."""
    start_snapshot = dict(
        _message_dict(model, "", extractor), content=[], stop_reason=None
    )
    return "".join(
        (
            _sse_event("message_start", {"type": "message_start", "message": start_snapshot}),
            _sse_event(
                "content_block_start",
                {
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {"type": "text", "text": ""},
                },
            ),
            _sse_event(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": text},
                },
            ),
            _sse_event(
                "content_block_stop", {"type": "content_block_stop", "index": 0}
            ),
            _sse_event(
                "message_delta",
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                    "usage": {"output_tokens": 1},
                },
            ),
            _sse_event("message_stop", {"type": "message_stop"}),
        )
    )


# ── Handlers ─────────────────────────────────────────────────────────────────


async def _handle_messages(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response(
            {"error": {"type": "invalid_request_error", "message": "mock_llm: body is not JSON"}},
            status=400,
        )

    model = str(body.get("model", "mock"))
    system_text = _system_text(body.get("system"))

    if not system_text:
        # No system prompt = the id-389 credential-preflight ping.
        extractor, text = "preflight", "pong (mock_llm id-389 tier-1)"
    elif system_text in _ROUTES:
        extractor, text = _ROUTES[system_text][0], _ROUTES[system_text][1]
    else:
        # Loud refusal, never a silent wrong-shape response: an unknown
        # system prompt means a caller this mock does not model (or a
        # prompts.py edit that has not been re-matched here).
        _logger.error(
            "mock_llm: UNRECOGNISED system prompt (first 120 chars): %r",
            system_text[:120],
        )
        return web.json_response(
            {
                "error": {
                    "type": "invalid_request_error",
                    "message": (
                        "mock_llm (id-389 tier-1) does not recognise this "
                        "system prompt. Known callers: "
                        + ", ".join(name for name, _ in _ROUTES.values())
                        + ". If a prompts.py constant changed, this exact-"
                        "match table updates itself on redeploy of the same "
                        "image; a mismatch here means mixed versions."
                    ),
                }
            },
            status=400,
        )

    _logger.info("mock_llm: %s -> canned response (stream=%s)", extractor, bool(body.get("stream")))

    if body.get("stream"):
        return web.Response(
            text=_sse_body(model, text, extractor),
            content_type="text/event-stream",
        )
    return web.json_response(_message_dict(model, text, extractor))


async def _handle_health(request: web.Request) -> web.Response:
    del request
    return web.json_response({"status": "ok", "service": "mock_llm"})


def build_app() -> web.Application:
    app = web.Application()
    app.router.add_post("/v1/messages", _handle_messages)
    app.router.add_get("/health", _handle_health)
    return app


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    port = int(os.environ.get("PORT", "8080"))
    web.run_app(build_app(), host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
