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
  - A request with NO system prompt is EITHER the Stage-5 pair-resolution
    call (`pair_resolver.KhPairResolver._invoke_llm` sends its prompt as a
    bare user message, no system block — recognised via the imported
    `_PAIR_RESOLUTION_PROMPT_TEMPLATE` and answered "same"/"different"
    deterministically, see `_pair_decision`) OR the id-389
    credential-preflight ping (answered "pong"). An UNRECOGNISED system
    prompt is a loud 400 (a real caller whose prompt this mock does not
    know).

Content echo (id-389 follow-up — Stage-5 near-match testability): entity
payloads ECHO certification-shaped surface forms found verbatim in the
request's `content_text` (see `_echo_entity_tokens`), so a fixture that
inlines e.g. 'ISO 27001' and 'ISO27001' produces mentions whose
entity_names are those EXACT surface forms with spans at the real match
offsets. Combined with the pair-resolution route above, mock-tier walks
exercise real Stage-5 near-match semantics (two distinct per-doc
canonicals that resolve to one cross-document value) instead of
hash-names that can never near-match.

NEVER expose this server publicly: compose-internal / runner-local only.
"""

from __future__ import annotations

from collections.abc import Callable

import hashlib
import json
import logging
import os
import re

from aiohttp import web

from scripts.cocoindex_pipeline import extraction, pair_resolver, prompts

_logger = logging.getLogger(__name__)

# ── Canned payloads — built from the REAL shapes, valid by construction ──────
#
# `content_type` takes the first sorted member of the SAME frozenset
# `extraction.py` validates against, so a stay-set change can never strand
# the mock on a retired value. `primary_domain` / `form_type` are plain
# literals: DR-130 deleted their snapshot-backed gates (the domain soft-warn
# and the form_type validator), so any string validates — the values below
# are stable, recognisable picks. All free-text fields carry an unambiguous
# MOCK marker so mock-tier rows are instantly recognisable in the DB.


def _first(values: frozenset[str]) -> str:
    if not values:
        raise RuntimeError("taxonomy value set is empty")
    return sorted(values)[0]


_CLASSIFICATION_PAYLOAD = extraction.ClassificationExtraction(
    content_type=_first(extraction._VALID_CONTENT_TYPES),
    primary_domain="security",
    suggested_title="MOCK classified document (id-389 tier-1)",
    classification_confidence=0.95,
    rationale="MOCK canned response — id-389 tier-1 wiring substrate",
).model_dump_json()

# The Q&A payload is built PER CONTENT — see `_qa_form_payload` below for why
# the former module-level constant could not stay.

# Entity mentions and relationships are NOT static: their DB write targets
# carry uniqueness constraints keyed on the extracted NAME
# (entity_mentions_canonical_name_entity_type_source_document_id_key,
# entity_relationships_unique_tuple). The extractors call the LLM ONCE per
# DOCUMENT (flow.py `_ingest_content_branch` / `ingest_once` — content_text
# is the full converted markdown; PR #140's "two chunks of one document"
# framing was wrong about granularity), so a static "MOCK Organisation Ltd"
# made every document's rows share the SAME names. That collided the
# constraints wherever two write-path invocations share a natural key but
# not a PK id — proven in the first mock-tier adjudication run
# (30310909744: 277 + 238 UniqueViolationErrors → 519 failed item writes →
# 27 poll timeouts). The two concrete shapes:
#   (a) entity_relationships FK is ON DELETE SET NULL and the unique tuple
#       is NULLS NOT DISTINCT — identical static tuples from DIFFERENT
#       documents collide as soon as a full-replace walk orphans a second
#       one to source_document_id NULL;
#   (b) byte-identical files at DIFFERENT rel_paths resolve to ONE
#       source_document_id (content_hash-first identity, id-138) while the
#       engine-path em:/er: PKs are still rel_path-seeded (flow.py
#       declare-rows block) — same natural key, different PK → collision.
# Making each payload a DETERMINISTIC function of the request's
# `content_text` — the same key the extractors memoise on — kills (a)
# outright and confines (b) to byte-identical duplicates (a latent,
# name-scheme-independent flow.py PK-seeding gap; ingest_once already
# seeds on source_document_id). Content-echoed names below keep that
# property: they derive from content_text and the always-present rows keep
# a per-content tag on the constraint-keyed fields.


def _content_tag(content_text: str) -> str:
    return hashlib.sha256(content_text.encode("utf-8")).hexdigest()[:12]


# ── Content echo (id-389 follow-up: Stage-5 near-match testability) ──────────
#
# Certification-shaped tokens (uppercase acronym + 3-6 digits, optional single
# space: 'ISO 27001', 'ISO27001', 'ISO 9001', ...) are echoed VERBATIM as
# entity mentions, spans at the real match offsets. entity_type is 'standard'
# DELIBERATELY, not 'certification': canonicalise_entity_name's
# certification-only ISO normaliser (canonicalisation.py `_ISO_TIGHT_RE`)
# rewrites 'iso27001' → 'iso 27001', which would pre-unify the surface
# variants at the per-doc phase — flow.py's `_em_dedup` would then collapse
# them to ONE row and Stage-5 would never see a near-match pair. Under
# 'standard' the per-doc canonicals stay distinct ('iso 27001' vs 'iso27001'),
# both rows land, and resolution is exercised for real. 'standard' is also
# what keeps the Inv-20 test contract honest (canonical_name == lowercase+trim
# of the surface form) and the Inv-21 cross-run canonicals distinct.

_CERT_TOKEN_RE = re.compile(r"\b[A-Z]{2,6} ?\d{3,6}\b")

# First-occurrence-ordered, deduped on exact surface form, capped so a
# token-dense document cannot balloon the payload.
_ECHO_MENTION_CAP = 5


def _echo_entity_tokens(content_text: str) -> list[tuple[str, int, int]]:
    """Certification-shaped surface forms found in `content_text`.

    Returns up to `_ECHO_MENTION_CAP` distinct `(surface, start, end)`
    triples in first-occurrence order; a repeated surface form keeps its
    FIRST match offsets. Deterministic in `content_text` (memo-compatible).
    """
    seen: set[str] = set()
    out: list[tuple[str, int, int]] = []
    for match in _CERT_TOKEN_RE.finditer(content_text):
        surface = match.group(0)
        if surface in seen:
            continue
        seen.add(surface)
        out.append((surface, match.start(), match.end()))
        if len(out) >= _ECHO_MENTION_CAP:
            break
    return out


# ── The per-document canary must be ANCHORED (S543) ─────────────────────────
#
# The canary used to be a synthesised name, `MOCK Org <sha12>`, carrying the
# span (0, len(name)). That span is in-bounds and points at the document's
# opening characters, which have nothing to do with the entity — so
# `entity_context.span_brackets_entity` rejects it, the name itself occurs
# nowhere in the text, and the snippet resolves to `''`.
#
# Under the S543 owner ruling an unanchored mention is refused at the declare
# site, because a row with no snippet cannot evidence that its parent document
# was read and so cannot be citable provenance. A synthesised canary would
# therefore produce NO row at all — and Inv-17 could never have passed on the
# mock tier under any fixture, which is what the invariant's "the pipeline
# satisfies the clause, the test asserts the prose" standoff was really made of.
#
# The canary's JOB is unaffected by this: it exists to keep the always-present
# row's constraint-keyed fields a function of `content_text`, so two documents
# can never collide on a natural key. A slice of the document satisfies that
# just as well as a hash of it, and is anchored by construction — no document
# can fail to contain its own first line.


_ANCHOR_MAX_CHARS = 90
_ANCHOR_MIN_CHARS = 3
# A line has to say something. `<!--` clears any length bar and is not a name —
# it made every fixture in a tree whose files open with an HTML comment share
# one canary, which is the exact per-document-uniqueness property the canary
# exists to provide. Measured in nightly run 31283783895.
_ANCHOR_HAS_WORDS = re.compile(r"[A-Za-z]{3,}")
_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(\S.*)$")


def _document_anchor(content_text: str) -> tuple[str, int, int] | None:
    """A short, real substring of `content_text` with its true offsets.

    Prefers the first markdown HEADING, then the first line with words in it,
    and takes a word-boundary prefix of either when it runs past
    `_ANCHOR_MAX_CHARS`. The prefix matters: a first draft skipped any line over
    the cap, which silently produced no canary for a single-paragraph document.

    The heading preference is not cosmetic. A converted document's heading is
    the line most likely to differ between two documents — a fixture tree whose
    files share a boilerplate preamble will collide on everything else, and a
    colliding canary is a canary that has stopped doing its job.

    Returns None when the document has no line with words in it, in which case
    the payload carries just its echoed tokens.
    """

    def _usable(line: str) -> tuple[str, int, int] | None:
        if len(line) < _ANCHOR_MIN_CHARS or not _ANCHOR_HAS_WORDS.search(line):
            return None
        surface = line
        if len(surface) > _ANCHOR_MAX_CHARS:
            head = surface[:_ANCHOR_MAX_CHARS]
            cut = head.rfind(" ")
            surface = (head[:cut] if cut >= _ANCHOR_MIN_CHARS else head).rstrip()
        start = content_text.find(surface)
        if start == -1 or len(surface) < _ANCHOR_MIN_CHARS:
            return None
        return surface, start, start + len(surface)

    lines = content_text.splitlines()
    for raw in lines:
        heading = _HEADING_RE.match(raw)
        if heading:
            found = _usable(heading.group(1).strip())
            if found:
                return found
    for raw in lines:
        found = _usable(raw.strip().lstrip("#").strip())
        if found:
            return found
    return None


def _entity_mentions_payload(content_text: str) -> str:
    # The per-document canary is KEPT and stays FIRST: it is the row that never
    # near-matches anything (the Inv-20 'unresolved mention retains canonical'
    # substrate) and the uniqueness canary the PR #140 win rests on. It is now a
    # real slice of the document rather than a synthesised name — see above.
    # Echoed mentions follow in first-occurrence order.
    mentions = []
    anchor = _document_anchor(content_text)
    if anchor is not None:
        surface, start, end = anchor
        mentions.append(
            extraction.EntityMentionExtraction(
                entity_type="organisation",
                entity_name=surface,
                source_span_start=start,
                source_span_end=end,
                mention_confidence=0.9,
            )
        )
    for surface, start, end in _echo_entity_tokens(content_text):
        mentions.append(
            extraction.EntityMentionExtraction(
                entity_type="standard",
                entity_name=surface,
                source_span_start=start,
                source_span_end=end,
                mention_confidence=0.85,
            )
        )
    return json.dumps([m.model_dump(mode="json") for m in mentions])


def _relationships_payload(content_text: str) -> str:
    # Tuple-safety: the TARGET always carries the per-content tag, so the
    # canonicalised (source, predicate, target) triple remains a function of
    # content_text — two DIFFERENT documents can never produce an identical
    # tuple (the NULLS-NOT-DISTINCT orphan-collision class stays dead). The
    # SOURCE echoes the first content surface form when one exists, so
    # relationship rows carry a realistic endpoint for md-fixture corpora.
    #
    # S543: the no-echo fallback source is the document anchor rather than the
    # synthesised `MOCK Org <tag>`. Relationship rows are not subject to the
    # Inv-17 anchoring rule — that governs entity_mentions — but a source
    # endpoint naming a string the document never contains was only ever an
    # artefact of the old canary, and the anchor is a function of content_text
    # in exactly the same way the tag was.
    tag = _content_tag(content_text)
    echoes = _echo_entity_tokens(content_text)
    anchor = _document_anchor(content_text)
    source = (
        echoes[0][0]
        if echoes
        else (anchor[0] if anchor is not None else f"MOCK Org {tag}")
    )
    return json.dumps(
        [
            extraction.RelationshipExtraction(
                source=source,
                relationship="holds",
                target=f"MOCK Cert {tag}",
            ).model_dump(mode="json")
        ]
    )


def _classification_payload(content_text: str) -> str:
    del content_text  # no uniqueness constraint on the classified fields
    return _CLASSIFICATION_PAYLOAD


def _qa_form_payload(content_text: str) -> str:
    # This payload was a single module-level constant, on the stated ground:
    # "No observed uniqueness constraint on q_a_extractions question text
    # (run 30310909744: zero violations from this class) — keep static until
    # the DB proves otherwise."
    #
    # The DB has now proved otherwise, and not via a uniqueness violation.
    # Every mock-tier document minted the SAME question/answer text, and the
    # promotion funnel publishes AND EMBEDS what it promotes — so staging
    # accumulated 88 published pairs whose embeddings are identical to six
    # decimal places. Measured consequences (S538):
    #   * a complete pairwise dedup clique — C(88,2) = 3828 candidate pairs at
    #     cosine 1.0000, re-proposed on every walk, costing ~300s per walk and
    #     writing nothing on 14 of 15 walks;
    #   * q_a_search polluted on EVERY real query (median 10 of 20 results,
    #     worst 17 of 20);
    #   * the MCP `kb://qa/` resource list returning 10 identical rows of 10.
    # The genuine corpus produces ZERO candidates at the 0.92 threshold
    # (max observed similarity 0.8175), so the clique is entirely mock-made.
    #
    # The requirement was DETERMINISM, never sameness. Deriving from
    # `content_text` — the same key the extractors memoise on, and the idiom
    # the entity/relationship payloads above already use — keeps every
    # assertion reproducible while giving each document a distinct vector.
    tag = _content_tag(content_text)
    return extraction.QAFormExtraction(
        form_metadata=extraction.FormMetadata(
            form_type="questionnaire",
            form_format="md",
            form_title=f"MOCK form {tag} (id-389 tier-1)",
        ),
        qa_pairs=[
            # One ANSWERED pair so promotion-funnel wiring sees an eligible row
            # (an unanswered pair is Class A — permanently unpromotable, id-370).
            extraction.QAPair(
                question_text=(
                    f"MOCK {tag}: what is your quality assurance policy?"
                ),
                answer_text=(
                    f"MOCK {tag}: we operate an ISO 9001-aligned QA policy."
                ),
                expected_response_kind="mandatory",
            )
        ],
    ).model_dump_json()


# Boot-time self-check: every canned payload must round-trip the EXACT
# validation path the extractors run (`validate_json` on extraction.py's own
# adapters). Schema drift kills the mock at boot, not mid-walk. Both echo
# regimes are exercised: token-free content (tag mention only) AND
# token-bearing content (tag mention + echoed surface forms).
_ECHO_BOOT_SAMPLE = "boot check: holds ISO 27001 and ISO27001 (id-389 echo)"
extraction._classification_adapter.validate_json(_classification_payload("x"))
extraction._qa_form_adapter.validate_json(_qa_form_payload("x"))
extraction._entity_mentions_adapter.validate_json(_entity_mentions_payload("x"))
extraction._entity_mentions_adapter.validate_json(
    _entity_mentions_payload(_ECHO_BOOT_SAMPLE)
)
extraction._relationships_adapter.validate_json(_relationships_payload("x"))
extraction._relationships_adapter.validate_json(
    _relationships_payload(_ECHO_BOOT_SAMPLE)
)

# ── Stage-5 pair-resolution route (system-less caller) ───────────────────────
#
# `pair_resolver.KhPairResolver._invoke_llm` sends its prompt as a bare user
# message with NO system block, so it lands in the mock's no-system branch.
# Before this route existed the branch answered the preflight "pong", which
# the resolver's thin parser fail-safed to "different" — Stage-5 could
# therefore NEVER merge a near-match pair in mock-tier runs. The route is
# recognised via the IMPORTED `_PAIR_RESOLUTION_PROMPT_TEMPLATE` (same
# version-locking philosophy as the prompts.py exact match: a template edit
# redeploys with this image, a mismatch means mixed versions) and answered
# deterministically: "same" iff the two names are equal after casefold +
# stripping non-alphanumerics — 'iso 27001' vs 'iso27001' → "same",
# 'iso 27001' vs 'iso 9001' → "different". The credential-preflight ping
# (any other system-less request) still gets "pong".

_PAIR_PROMPT_HEAD = pair_resolver._PAIR_RESOLUTION_PROMPT_TEMPLATE.split(
    "{name_a}", 1
)[0]
_PAIR_NAME_B_SEP = "\nName B: "
_PAIR_NORM_STRIP_RE = re.compile(r"[^a-z0-9]+")


def _parse_pair_resolution_prompt(user_text: str) -> tuple[str, str] | None:
    """Parse a KhPairResolver prompt into `(name_a, name_b)`.

    Returns None when `user_text` is not pair-shaped (it is then the
    preflight ping). Raises ValueError when the text matches the template
    head but the two names cannot be recovered — a loud 400 in the handler,
    never a silently wrong adjudication.
    """
    if not user_text.startswith(_PAIR_PROMPT_HEAD):
        return None
    remainder = user_text[len(_PAIR_PROMPT_HEAD):]
    name_a, sep, name_b = remainder.partition(_PAIR_NAME_B_SEP)
    if not sep or not name_a or not name_b:
        raise ValueError(
            "mock_llm: pair-resolution prompt matched the template head but "
            "the Name A / Name B lines could not be parsed"
        )
    return name_a, name_b


def _pair_decision(name_a: str, name_b: str) -> str:
    """Deterministic same/different adjudication for a name pair.

    "same" iff the names are equal after casefold + stripping every
    non-alphanumeric character (space/punctuation-insensitive equality —
    exactly the near-match class Stage-5's ISO surface variants exercise).
    A name that normalises to nothing never matches (fail-safe).
    """
    norm_a = _PAIR_NORM_STRIP_RE.sub("", name_a.casefold())
    norm_b = _PAIR_NORM_STRIP_RE.sub("", name_b.casefold())
    if not norm_a or not norm_b:
        return "different"
    return "same" if norm_a == norm_b else "different"


# Boot-time self-check: the pair route must recover the exact names from the
# CURRENT template — template drift kills the mock at boot, not mid-Stage-5.
if _parse_pair_resolution_prompt(
    pair_resolver._PAIR_RESOLUTION_PROMPT_TEMPLATE.format(
        name_a="Probe A", name_b="Probe B"
    )
) != ("Probe A", "Probe B"):
    raise RuntimeError(
        "mock_llm: pair_resolver._PAIR_RESOLUTION_PROMPT_TEMPLATE drifted — "
        "the pair-resolution route can no longer parse its own template"
    )


# system-prompt text → (extractor name, content_text → canned response text)
_ROUTES: dict[str, tuple[str, Callable[[str], str]]] = {
    prompts.CLASSIFICATION_PROMPT: (
        "extract_classification",
        _classification_payload,
    ),
    prompts.Q_A_FORM_PROMPT: ("extract_qa_form", _qa_form_payload),
    prompts.ENTITY_MENTION_PROMPT: (
        "extract_entity_mentions",
        _entity_mentions_payload,
    ),
    prompts.RELATIONSHIP_PROMPT: (
        "extract_relationships",
        _relationships_payload,
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


def _last_user_text(messages: object) -> str:
    """The last user message's text — the extractors' `content_text`, which
    seeds the per-request deterministic payloads above. Handles both wire
    shapes (plain-string content and content-block lists)."""
    if not isinstance(messages, list):
        return ""
    for msg in reversed(messages):
        if isinstance(msg, dict) and msg.get("role") == "user":
            content = msg.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return "".join(
                    str(block.get("text", ""))
                    for block in content
                    if isinstance(block, dict)
                )
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
    content_text = _last_user_text(body.get("messages"))

    if not system_text:
        # No system prompt = EITHER the Stage-5 pair-resolution call
        # (KhPairResolver._invoke_llm sends a bare user message) OR the
        # id-389 credential-preflight ping. Discriminated on the imported
        # pair-resolution template; a head-matched-but-unparsable prompt is
        # a loud 400, never a silently wrong adjudication.
        try:
            pair = _parse_pair_resolution_prompt(content_text)
        except ValueError as exc:
            _logger.error("mock_llm: %s", exc)
            return web.json_response(
                {"error": {"type": "invalid_request_error", "message": str(exc)}},
                status=400,
            )
        if pair is not None:
            extractor, text = "pair_resolution", _pair_decision(*pair)
        else:
            extractor, text = "preflight", "pong (mock_llm id-389 tier-1)"
    elif system_text in _ROUTES:
        extractor, builder = _ROUTES[system_text]
        text = builder(content_text)
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
