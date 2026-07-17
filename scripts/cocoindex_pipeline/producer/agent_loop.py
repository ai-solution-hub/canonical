"""Anthropic tool-use agent loop + Pass-1 tool definitions for the OKF
concept producer — ID-132 {132.5} G-LOOP.

Ports the reference_agent's ADK+Gemini agent loop onto the Anthropic
tool-use surface `extraction.py` already runs, per
`docs/specs/id-132-okf-concept-producer/TECH.md` §'The agent-loop port —
ADK+Gemini → Anthropic'. This is NET-NEW external API usage in the
pipeline: the existing 4 extractors in `extraction.py` call plain
`messages.create` / `messages.stream` with NO `tools=` — the tool-use
surface (`tools=`, `tool_choice=`, `ToolUseBlock`/`ToolResultBlockParam`
turns) was empirically import-and-call verified against the pinned
`anthropic==0.79.0` before this port (TECH §Empirical verification).

Reuses 3 `extraction.py` anchors verified at head rather than
reimplementing them:

  - `ANTHROPIC_MODEL` (extraction.py:71) — the fallback `PRODUCER_MODEL`
    (below) resolves to when no override is set.
  - `_anthropic_retry` (extraction.py:916) — the tenacity 503/rate-limit/
    connection retry wrapper around each `messages.create` call.
  - `_guard_not_truncated` (extraction.py:862) — raises
    `TruncatedExtractionError` (also extraction.py) when a turn hits the
    `max_tokens` ceiling, so a truncated tool-use turn or final body
    surfaces loudly instead of as a downstream parse error.

**`PRODUCER_MODEL` (ID-132 {132.35} slice B, S481 owner ratification, DR-079:
non-client bundles run GLM-5.2).** The deployed producer agent-loop had no
env indirection for the model slug — `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`
are already SDK-env-readable (`anthropic==0.79.0`, verified), but the model
string was hardcoded via `ANTHROPIC_MODEL`. `PRODUCER_MODEL` is a NEW,
producer-package-scoped env override — `extraction.py`'s own `ANTHROPIC_MODEL`
constant and its 4 extractor call sites are deliberately UNCHANGED (the
isolation is the point of adding a new var rather than making
`ANTHROPIC_MODEL` itself env-read). Read ONCE at import time — mirrors
`ANTHROPIC_MODEL`'s own plain-constant posture; the deploy environment (a
Coolify secret) is set before the process boots, so there is no
live-reconfiguration need. Unset/empty falls back unchanged to
`ANTHROPIC_MODEL`. This is `run_tool_use_loop`'s own default `model` below,
and both producer passes (`enrich.py:enrich_concept`, `web_pass.py:
run_web_pass`) default their own `model` parameter to it too. **DR-060**: a
deploy-time `PRODUCER_MODEL` value change is drafting-config exactly like a
literal `ANTHROPIC_MODEL` edit — see `producer/enrich.py`'s module docstring
"Config-surface invalidation" section for the manual `@coco.fn(...,
version=N)` bump contract this falls under.

**`PRODUCER_BASE_URL`/`PRODUCER_AUTH_TOKEN` + `producer_async_client()`
(ID-132 {132.35} slice C, S481 deploy-rider 3 — the endpoint/auth sibling of
the `PRODUCER_MODEL` slice B above).** `extraction.py`'s 4 bare
`anthropic.AsyncAnthropic()` call sites and this package's own 2
(`enrich.py:enrich_concept`, `web_pass.py:run_web_pass`) share ONE process
(`server.py`'s `/walk`/`/extract`/`/producer-run`) — the SDK's own
`AsyncAnthropic.__init__` (`anthropic==0.79.0`, empirically verified) falls
back to reading the process-wide `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`
env whenever its `base_url`/`auth_token` constructor params are left `None`,
so setting those globally to route the producer to an Anthropic-compatible
endpoint (e.g. OpenRouter's "Anthropic Skin", `z-ai/glm-5.2` — the docubot
precedent, `docs-site harness/scripts/docubot/run-agent.ts:52-54`) would
ALSO redirect `extraction.py` — DR-079 requires extraction stay on
Anthropic. `PRODUCER_BASE_URL`/`PRODUCER_AUTH_TOKEN` are NEW,
producer-package-scoped vars `extraction.py` never reads;
`producer_async_client()` (below) is the shared factory both producer call
sites now use in place of a bare `AsyncAnthropic()` — see its own docstring
for the isolation mechanics. Read ONCE at import time — same posture as
`PRODUCER_MODEL`. **DR-060**: a deploy-time value change here is
drafting-config exactly like a `PRODUCER_MODEL`/`ANTHROPIC_MODEL` edit — see
`producer/enrich.py`'s module docstring "Config-surface invalidation"
section for the manual `version=` bump contract this falls under too. No
`version=` bump lands in this commit.

**`PRODUCER_PROVIDER_ORDER` (ID-132 {132.35} slice D, DR-079 — OpenRouter
provider routing for the GLM-5.2 Run-1 BI-18 deploy-proof).** Run-1 failed
18/18 on staging: OpenRouter's Anthropic-skin `/v1/messages` endpoint
silently defaults `requested_providers=['anthropic']` when a request
carries no explicit provider directive, and `anthropic` doesn't serve
`z-ai/glm-5.2` — a 404 "No allowed providers are available for the
selected model" (`base_url`/`auth_token` routing itself was confirmed
working; zero Anthropic spend on that run). `PRODUCER_PROVIDER_ORDER` is a
NEW, producer-package-scoped, comma-separated list of OpenRouter provider
slugs (e.g. `z-ai`), read ONCE at import — same posture as `PRODUCER_MODEL`/
`PRODUCER_BASE_URL`/`PRODUCER_AUTH_TOKEN` above. When set/non-empty,
`run_tool_use_loop`'s `client.messages.create(...)` call — the SINGLE
producer `messages.create` call site (grep-confirmed: both Pass-1
`enrich_concept` and Pass-2 `run_web_pass` route through this loop, neither
has a call site of its own) — carries an `extra_body={'provider': {'order':
[<slugs>], 'allow_fallbacks': True}}` kwarg. Probe-proven directly against
OpenRouter on staging (raw HTTP, 200 with a correct Anthropic-shaped GLM
reply) and empirically verified against the installed `anthropic==0.79.0`
SDK: `Messages.create`'s `extra_body` param flows through
`make_request_options` into `RequestOptions['extra_json']`, which
`_base_client.py`'s request builder merges directly into the outgoing JSON
POST body (`_merge_mappings(json_data, options.extra_json)`) — a genuine
top-level `provider` key reaches OpenRouter, not a client-only no-op.
Unset/empty `PRODUCER_PROVIDER_ORDER` means the `extra_body` kwarg is
OMITTED ENTIRELY (never passed as `extra_body=None`) — the request stays
byte-identical to today, same both-unset posture as slices B/C.
`allow_fallbacks: True` is FIXED (probe-proven), not exposed as a config
knob — see `_provider_routing_extra_body`'s own docstring. **DR-060**: a
deploy-time `PRODUCER_PROVIDER_ORDER` value change is drafting-config
exactly like `PRODUCER_MODEL`/`PRODUCER_BASE_URL`/`PRODUCER_AUTH_TOKEN` —
see `producer/enrich.py`'s module docstring "Config-surface invalidation"
section for the manual `version=` bump contract this falls under too. No
`version=` bump lands in this commit (`version=1` remains unconsumed by any
deployed run).

**api_key suppression on the producer client (ID-132 {132.35} slice E,
DR-079 - the credential-hygiene sibling of the slice D provider-routing
fix above).** Slice D's `PRODUCER_PROVIDER_ORDER` routing reached
OpenRouter correctly, but staging Run-1 still 404'd 18/18:
`producer_async_client()` passes `base_url=`/`auth_token=` in override
mode but did not pass `api_key=`, so the anthropic SDK fell back to the
process-wide `ANTHROPIC_API_KEY` env var (set in-container for the
extraction lane) and sent it as an `X-Api-Key` header alongside the
OpenRouter `Bearer` token. OpenRouter treats a request carrying an
Anthropic-shaped `X-Api-Key` as pinned to `requested_providers=
['anthropic']` regardless of the slice D `extra_body` provider directive -
`anthropic` does not serve `z-ai/glm-5.2`, hence the 404. This is exactly
the guard the docubot precedent (`docs-site harness/scripts/docubot/
run-agent.ts:52-55`, `ANTHROPIC_API_KEY=''`) applies and this factory had
omitted. `producer_async_client()` now passes `api_key=""` whenever it is
in override mode (`PRODUCER_BASE_URL` and/or `PRODUCER_AUTH_TOKEN` set) -
see its own docstring's "Slice E addendum" for the SDK-level mechanics.
Two rationales, both load-bearing: (a) provider-pinning defeat - an
Anthropic-shaped `X-Api-Key` silently overrides body-level provider
routing on OpenRouter's Anthropic-skin endpoint; (b) credential hygiene -
without this, the producer transmits the real Anthropic key to a
third-party endpoint on every call, override mode or not. Process-local
only: the env var `ANTHROPIC_API_KEY` itself is untouched, and
`extraction.py`'s 4 bare `AsyncAnthropic()` call sites are unaffected (same
isolation posture as slices B/C/D). **DR-060**: this is explicitly NOT
config-surface under the drafting-config contract - it changes which auth
HEADERS a request carries, not the inference OUTPUT (model, prompt,
tools), so it carries no `version=` bump obligation (contrast
`PRODUCER_MODEL`/`PRODUCER_BASE_URL`/`PRODUCER_AUTH_TOKEN`/
`PRODUCER_PROVIDER_ORDER` above, which DO gate on a manual `version=` bump
because they can change what the model receives or which model answers).

Scope (per the {132.5} brief): the GENERIC loop + the Pass-1 tool SCHEMAS
only (`READ_CONCEPT_RAW_TOOL`, `SAMPLE_ROWS_TOOL` — the Source-adapter
tools). Tool executors are taken as INJECTABLE callables (`ToolExecutor`) —
wiring this loop's tool names to the real L-records Source-adapter methods
(`read_concept_raw` → `LRecordsSource.read_concept`, `sample_rows` →
`LRecordsSource.sample_rows`) happens in `enrich_concept` ({132.8}), not
in this module.

**`WEB_FETCH_TOOL` ({132.9} G-PASS2).** The net-new Pass-2 gated-fetch tool
SCHEMA lives here (alongside the Pass-1 schemas, same `ToolParam`
empirical-verification posture) — kept OUT of `PASS1_TOOLS` (BI-15: Pass-1
makes zero web calls) exactly as `LIST_CONCEPTS_TOOL` is; `producer/
web_pass.py` composes its own Pass-2 tool list `[READ_CONCEPT_RAW_TOOL,
SAMPLE_ROWS_TOOL, LIST_CONCEPTS_TOOL, WEB_FETCH_TOOL]` at its `run_web_pass`
call site, mirroring `{132.8}`'s `_PASS1_TOOLS_WITH_CATALOGUE` composition
pattern. The host-allowlist/depth-limit/path-filter GATE itself is
`web_pass.py`'s concern, not this module's — this schema only describes the
tool's shape to the model.

**Soft-error `is_error` propagation (S451 rider, {132.9}).** A tool
executor's soft-error convention (a `Mapping` result carrying an `'error'`
key — `producer/enrich.py`'s `_read_concept_raw`/`_sample_rows` unknown-ref
recovery, and `web_pass.py`'s `fetch_url` host/depth/path-filter refusal)
now sets Anthropic's `is_error: true` on the constructed `tool_result`
block, so the model treats it as retryable rather than as an ordinary
result (TECH-ADDENDUM-reference-agents.md `{132.5}` retro-check,
agent_loop.py:188-229 — the loop already surfaced the dict as JSON text via
`_stringify_tool_result` but never set `is_error`, the one gap that finding
named). A genuine executor EXCEPTION still propagates unchanged (kills the
loop, per this module's "escalate, don't paper over" posture below) — only
a `Mapping`-with-`'error'`-key RETURN VALUE is treated as a soft, model-
recoverable failure.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import anthropic
from anthropic.types import MessageParam, ToolParam, ToolResultBlockParam

from scripts.cocoindex_pipeline.extraction import (
    ANTHROPIC_MODEL,
    _anthropic_retry,
    _guard_not_truncated,
)

_logger = logging.getLogger(__name__)

# Producer-scoped model override (ID-132 {132.35} slice B) — see the module
# docstring's "PRODUCER_MODEL" section above. Read ONCE at import time;
# unset/empty falls back unchanged to ANTHROPIC_MODEL.
PRODUCER_MODEL = os.environ.get("PRODUCER_MODEL") or ANTHROPIC_MODEL

# Producer-scoped endpoint/auth override (ID-132 {132.35} slice C) — see the
# module docstring's "PRODUCER_BASE_URL/PRODUCER_AUTH_TOKEN" section above.
# Read ONCE at import time; empty string means "no override" for that field
# (mirrors PRODUCER_MODEL's `or` posture rather than `is None`, so an
# explicitly-empty Coolify secret behaves exactly like an unset one).
PRODUCER_BASE_URL = os.environ.get("PRODUCER_BASE_URL") or ""
PRODUCER_AUTH_TOKEN = os.environ.get("PRODUCER_AUTH_TOKEN") or ""

# Producer-scoped OpenRouter provider-order override (ID-132 {132.35} slice
# D, DR-079) — see the module docstring's "PRODUCER_PROVIDER_ORDER" section
# above. Read ONCE at import time; comma-separated OpenRouter provider
# slugs (e.g. "z-ai"), each entry stripped of surrounding whitespace and
# empty entries dropped — an unset/empty var (or a whitespace-only/
# comma-only value) resolves to an empty tuple, meaning "no provider
# routing" (byte-identical to today's request).
PRODUCER_PROVIDER_ORDER: tuple[str, ...] = tuple(
    slug.strip()
    for slug in (os.environ.get("PRODUCER_PROVIDER_ORDER") or "").split(",")
    if slug.strip()
)


def producer_async_client() -> anthropic.AsyncAnthropic:
    """Construct the Anthropic async client both producer Anthropic call
    sites (`enrich.py:enrich_concept`, `web_pass.py:run_web_pass`) use, in
    place of a bare `anthropic.AsyncAnthropic()` — see the module
    docstring's `PRODUCER_BASE_URL`/`PRODUCER_AUTH_TOKEN` section above.

    When BOTH `PRODUCER_BASE_URL` and `PRODUCER_AUTH_TOKEN` are unset/empty
    this returns a bare `AsyncAnthropic()` — byte-for-byte today's
    behaviour (it still itself reads the process-wide `ANTHROPIC_BASE_URL`/
    `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`, exactly like
    `extraction.py`'s 4 call sites, so a deploy that sets neither new var is
    completely unaffected — no new REQUIRED config).

    When either is set, this passes it as an EXPLICIT `base_url=`/
    `auth_token=` constructor kwarg rather than leaving the param `None`.
    Empirically (`anthropic==0.79.0`), `AsyncAnthropic.__init__` treats an
    explicit `None` identically to an omitted param and STILL falls back to
    reading the global env var (`if base_url is None: base_url = os.environ
    .get("ANTHROPIC_BASE_URL")` — verified against the installed SDK
    source), so only passing an actual non-`None` value suppresses that
    fallback. Passing the field that IS set explicitly is exactly what
    closes the isolation gap: the process-wide `ANTHROPIC_BASE_URL`/
    `ANTHROPIC_AUTH_TOKEN` can no longer surprise the producer once its own
    `PRODUCER_*` var is set for that field. (Only the field that is set is
    passed — the other still resolves via the SDK's own normal env/default
    behaviour; the real deploy plan sets both together, mirroring the
    OpenRouter "Anthropic Skin" precedent, so this asymmetric case does not
    arise in practice.)

    Slice E addendum (ID-132 {132.35} slice E, DR-079) - api_key=""
    suppression in override mode. Whenever this factory is in override
    mode (kwargs non-empty - PRODUCER_BASE_URL and/or PRODUCER_AUTH_TOKEN
    set), it ALSO passes api_key="". Both-unset is UNCHANGED - a bare
    AsyncAnthropic(), same as slices B/C/D. See the module docstring's
    "api_key suppression" section for the full rationale; summary: left
    unset, the SDK falls back to the process-wide ANTHROPIC_API_KEY (set
    in-container for the extraction lane) and sends it as an X-Api-Key
    header alongside the OpenRouter Bearer token, and OpenRouter pins
    requested_providers=['anthropic'] on any request carrying an
    Anthropic-shaped X-Api-Key - silently defeating slice D's
    provider-order routing with a 404 regardless of body content
    (probe-proven: Bearer+X-Api-Key -> 404; same request with api_key=""
    -> 200, model z-ai/glm-5.2). Empirically (anthropic==0.79.0),
    AsyncAnthropic.__init__ only skips the ANTHROPIC_API_KEY env fallback
    for a non-None api_key, and _api_key_auth only omits the X-Api-Key
    header when self.api_key is None - an empty string is non-None, so it
    still emits X-Api-Key: "", which OpenRouter treats as absent.
    Construction does not raise (verified against the installed SDK). A
    default_headers={"X-Api-Key": None} alternative was considered and
    rejected: the SDK's header-merge path raises TypeError on an explicit
    None header value - not a viable substitute.
    """
    kwargs: dict[str, str] = {}
    if PRODUCER_BASE_URL:
        kwargs["base_url"] = PRODUCER_BASE_URL
    if PRODUCER_AUTH_TOKEN:
        kwargs["auth_token"] = PRODUCER_AUTH_TOKEN
    if kwargs:
        # Override mode (ID-132 {132.35} slice E, DR-079) — suppress the
        # SDK's env-var X-Api-Key fallback so the real Anthropic key never
        # reaches a third-party endpoint. See this docstring's "Slice E
        # addendum" above.
        kwargs["api_key"] = ""
    return anthropic.AsyncAnthropic(**kwargs)


# ---------------------------------------------------------------------------
# Pass-1 tool definitions — the Source-adapter tools only (BI-15: Pass-1
# drafts from L-records ONLY, no web access). Anthropic `ToolParam` shape
# empirically verified against anthropic==0.79.0 (TECH §Empirical
# verification).
# ---------------------------------------------------------------------------

READ_CONCEPT_RAW_TOOL: ToolParam = {
    "name": "read_concept_raw",
    "description": (
        "Read the raw backing L-record data for a single concept — the "
        "joined source_documents / q_a_pairs / reference_items / "
        "entity_mentions rows the Source adapter's read_concept(ref) "
        "resolves for this concept. Use this to ground the drafted concept "
        "body in the concept's actual backing records before synthesising "
        "prose — never copy the raw text verbatim into the concept body."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ref": {
                "type": "string",
                "description": (
                    "The concept identity — its bundle rel_path (e.g. "
                    "'products/lms.md') — identifying which concept's raw "
                    "record data to read."
                ),
            },
        },
        "required": ["ref"],
    },
}

SAMPLE_ROWS_TOOL: ToolParam = {
    "name": "sample_rows",
    "description": (
        "Return a bounded sample of a concept's backing rows, for grounding "
        "the Pass-1 prompt context window without pulling the full record "
        "set (which can blow max_tokens for a large answer-cluster)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "concept": {
                "type": "string",
                "description": (
                    "The concept identity (bundle rel_path) to sample "
                    "backing rows for."
                ),
            },
            "n": {
                "type": "integer",
                "description": "Maximum number of backing rows to return.",
                "minimum": 1,
            },
        },
        "required": ["concept", "n"],
    },
}

# Pass-1 tool set (TECH: `tools: list[ToolParam] = [READ_CONCEPT_RAW_TOOL,
# SAMPLE_ROWS_TOOL, ...]   # Pass-2 adds WEB_FETCH_TOOL`).
PASS1_TOOLS: list[ToolParam] = [READ_CONCEPT_RAW_TOOL, SAMPLE_ROWS_TOOL]

# S451 rider fold-in 2 (TECH-ADDENDUM-reference-agents.md, `{132.5}` retro-
# check finding at agent_loop.py:116) — the reference's `build_bq_agent`
# registers a THIRD tool, `list_concepts`, used for cross-linking
# (`reference_instruction.md` workflow step 4, "weave cross-links" = BI-9
# concept→concept citation by path). Kept OUT of `PASS1_TOOLS` itself
# (a load-bearing constant a sibling test pins exactly to the two
# Source-adapter tools) — `{132.8}` `producer/enrich.py` composes its own
# tool list `[*PASS1_TOOLS, LIST_CONCEPTS_TOOL]` at the `enrich_concept`
# call site instead.
LIST_CONCEPTS_TOOL: ToolParam = {
    "name": "list_concepts",
    "description": (
        "List every concept in the bundle's catalogue — its bundle rel_path "
        "and concept type. Use this to find concepts to cross-link: where "
        "this concept is clearly related to another one in the catalogue, "
        "cite the target concept's bundle rel_path (e.g. 'products/lms.md') "
        "as a BI-9 concept-to-concept citation — never a canonical:// uri "
        "and never a bare database id for a concept cross-link."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

# {132.9} G-PASS2 — the net-new gated-fetch tool (BI-16). Kept OUT of
# `PASS1_TOOLS` for the same reason as `LIST_CONCEPTS_TOOL`: Pass-1 makes
# ZERO web calls (BI-15). `producer/web_pass.py`'s `_check_gate` (host-
# allowlist + depth-limit + path-filter) refuses any URL outside the
# client's own gated corpus BEFORE any fetch — the description below tells
# the model that refusal is a normal, retryable outcome (an `is_error`
# `tool_result` per the module docstring's soft-error section), not a
# reason to give up on Pass-2 entirely.
WEB_FETCH_TOOL: ToolParam = {
    "name": "fetch_url",
    "description": (
        "Fetch a page from the client's OWN gated authoritative-source "
        "corpus — Pass-2 ONLY, never the open web. The URL's host must be "
        "on the Pass-2 host-allowlist and its path within the configured "
        "depth-limit and path-filter; a URL outside the gate is REFUSED "
        "(retry with a different, in-corpus URL rather than guessing). A "
        "successful fetch returns the page's distilled text content plus a "
        "'resource' canonical://reference_items/<uuid> anchor — copy it "
        "verbatim into your 'citations' array for any fact you draw from "
        "it; never invent this anchor yourself."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": (
                    "The absolute http(s) URL to fetch, drawn from the "
                    "client's own authoritative site-structure corpus."
                ),
            },
        },
        "required": ["url"],
    },
}


# ---------------------------------------------------------------------------
# Injectable tool-executor contract
# ---------------------------------------------------------------------------

# One async callable per tool name, taking the `ToolUseBlock.input` mapping
# and returning a JSON-serialisable (or already-string) result. Wiring the
# real Source-adapter methods to these names is {132.8}'s job.
ToolExecutor = Callable[[Mapping[str, Any]], Awaitable[Any]]


class AgentLoopError(RuntimeError):
    """Raised when the agent loop cannot execute a `tool_use` block — no
    executor is registered for the requested tool name. Fails loudly
    (mirrors `TruncatedExtractionError`'s posture in extraction.py) rather
    than silently dropping the tool call or sending a malformed empty
    `tool_result`."""


def _stringify_tool_result(result: Any) -> str:
    """Coerce a tool executor's return value into the string content
    `ToolResultBlockParam.content` expects.

    Executors may return an already-formatted string, or a JSON-serialisable
    structure (dict/list — the shape `sample_rows`/`read_concept_raw`'s real
    adapter methods return, per TECH §Source adapter). The latter is
    rendered via `json.dumps` so the model receives valid JSON text rather
    than a Python `repr()`.
    """
    if isinstance(result, str):
        return result
    return json.dumps(result, default=str)


def _tool_result_is_error(result: Any) -> bool:
    """S451 rider — True iff `result` is the soft-error shape a tool
    executor returns for a MODEL-RECOVERABLE failure: a `Mapping` carrying
    an `'error'` key. `producer/enrich.py`'s `_read_concept_raw`/
    `_sample_rows` (unknown ref) and `producer/web_pass.py`'s `fetch_url`
    (host/depth/path-filter refusal) both already return this shape.
    Detected on the RAW pre-`_stringify_tool_result` value (a `Mapping`
    check), not the stringified content — a plain string result (even one
    that happens to contain the substring "error") never sets `is_error`."""
    return isinstance(result, Mapping) and "error" in result


def _provider_routing_extra_body() -> dict[str, Any] | None:
    """Build the `extra_body` payload `run_tool_use_loop` passes to
    `client.messages.create` for OpenRouter provider routing (ID-132
    {132.35} slice D, DR-079) — `None` when `PRODUCER_PROVIDER_ORDER` is
    unset/empty, so the caller OMITS the `extra_body` kwarg entirely rather
    than passing `extra_body=None` (see the module docstring's
    "PRODUCER_PROVIDER_ORDER" section for the probe-proof + SDK-passthrough
    verification).

    `allow_fallbacks: True` is FIXED, not derived from any env var — the
    staging probe proved `{"order": [...], "allow_fallbacks": true}` works;
    `False` was never probed and is not exposed as a config knob here.
    """
    if not PRODUCER_PROVIDER_ORDER:
        return None
    return {
        "provider": {
            "order": list(PRODUCER_PROVIDER_ORDER),
            "allow_fallbacks": True,
        }
    }


async def run_tool_use_loop(
    *,
    client: anthropic.AsyncAnthropic,
    messages: list[MessageParam],
    tools: list[ToolParam],
    tool_executors: Mapping[str, ToolExecutor],
    system: list[Mapping[str, Any]],
    extractor_name: str,
    max_tokens: int,
    model: str = PRODUCER_MODEL,
) -> anthropic.types.Message:
    """The Anthropic tool-use agent loop (TECH §'The agent-loop port').

    Grows `messages` IN PLACE, turn by turn — an assistant `tool_use` turn
    followed by a user `tool_result` turn — until the model responds with a
    non-`tool_use` `stop_reason` (the final concept body), then returns
    that terminal `Message`. The seed `messages` list (the initial user
    prompt) is supplied by the caller and is the SAME list mutated across
    iterations, matching the TECH pseudocode's `messages: list[
    MessageParam] = [...]` declared once, outside the loop.

    Each iteration:
      1. `_anthropic_retry(lambda: client.messages.create(...))` — reuses
         extraction.py's tenacity retry wrapper (503 / rate-limit /
         connection errors retry; auth/bad-request propagate immediately).
         When `PRODUCER_PROVIDER_ORDER` is set, this call also carries an
         `extra_body={'provider': {...}}` kwarg (ID-132 {132.35} slice D,
         DR-079 OpenRouter provider routing) — omitted entirely when unset
         (see `_provider_routing_extra_body`).
      2. `_guard_not_truncated(resp, extractor_name, max_tokens)` — reuses
         extraction.py's `max_tokens`-ceiling guard.
      3. If `resp.stop_reason != "tool_use"`, RETURN `resp` immediately —
         the final turn is NOT appended to `messages` (the loop's job is
         producing this terminal response, not managing conversation
         history beyond it).
      4. Otherwise append the assistant `tool_use` turn, execute every
         `tool_use` content block via its registered `tool_executors`
         callable, and append a user turn carrying one `tool_result` block
         per executed tool call (`is_error: true` set when the executor
         returned a soft-error `Mapping` — see `_tool_result_is_error`) —
         then repeat.

    Raises `AgentLoopError` if a `tool_use` block names a tool with no
    registered executor. Tool-executor EXCEPTIONS still propagate (matches
    the KH "escalate, don't paper over" posture; a raised exception here
    means the caller's Source adapter / gated fetch genuinely failed in an
    unrecoverable way and should not retry as if it were a normal
    tool_result) — only a `Mapping`-with-`'error'`-key RETURN VALUE is
    treated as a soft, model-recoverable failure and gets `is_error: true`
    on its `tool_result` block (S451 rider).
    """
    while True:
        create_kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
            "tools": tools,
            "tool_choice": {"type": "auto"},
        }
        extra_body = _provider_routing_extra_body()
        if extra_body is not None:
            create_kwargs["extra_body"] = extra_body
        resp = await _anthropic_retry(
            lambda: client.messages.create(**create_kwargs)
        )
        _guard_not_truncated(resp, extractor_name, max_tokens)
        if resp.stop_reason != "tool_use":
            return resp  # final concept body — loop terminates

        messages.append({"role": "assistant", "content": resp.content})

        tool_results: list[ToolResultBlockParam] = []
        for block in resp.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            executor = tool_executors.get(block.name)
            if executor is None:
                raise AgentLoopError(
                    f"{extractor_name}: no tool executor registered for "
                    f"tool_use block name={block.name!r} (id={block.id})"
                )
            result = await executor(block.input)
            tool_result: ToolResultBlockParam = {
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": _stringify_tool_result(result),
            }
            if _tool_result_is_error(result):
                tool_result["is_error"] = True
            tool_results.append(tool_result)

        messages.append({"role": "user", "content": tool_results})
