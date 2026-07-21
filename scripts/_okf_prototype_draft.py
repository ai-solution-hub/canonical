"""ID-163 {163.10} first-authoring-wave PROTOTYPE draft harness (throwaway).

Drafts the 5 KA3-prototype concepts (4 tool + 1 navigation) on GLM-5.2 via the
proven producer primitives WITHOUT the L-records-coupled enrich_concept loop
(which does not consume RepoConceptRaw — see the task note finding). Reuses:
  - RepoDocsSource.read_concept        -> backing text + minted public git-blob citation
  - producer_async_client + provider routing + retry + truncation guard  -> GLM-5.2 call
  - enrich._parse_pass1_response / _validate_citation  -> the KA2/S3 citation gate
  - frontmatter emitter + validator.validate_concept   -> per-class BI-13 validation

Run: PYTHONUNBUFFERED=1 PYTHONPATH=<repo> python3 scripts/_okf_prototype_draft.py
Not committed to the producer package; a prototype driver, not shared surgery.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(os.getcwd())
load_dotenv(ROOT / ".env.local")

from scripts.cocoindex_pipeline.sources.repo_docs import (  # noqa: E402
    RepoDocsSource, RepoConceptKey, _DEFINE_TOOL_CALL_RE, _match_closing_paren,
    _span_content_hash, _git_blob_sha,
)
from scripts.cocoindex_pipeline.producer.agent_loop import (  # noqa: E402
    producer_async_client, PRODUCER_MODEL, _provider_routing_extra_body,
)
from scripts.cocoindex_pipeline.extraction import (  # noqa: E402
    _anthropic_retry, _guard_not_truncated,
)
from scripts.cocoindex_pipeline.producer.enrich import _parse_pass1_response  # noqa: E402
from scripts.cocoindex_pipeline.producer.frontmatter import (  # noqa: E402
    build_concept_frontmatter, render_concept_frontmatter,
)
from scripts.cocoindex_pipeline.producer.validator import (  # noqa: E402
    validate_concept, EffectiveOntology,
)
from scripts.cocoindex_pipeline.producer.resource_uri import is_git_blob_citation  # noqa: E402

BUNDLE_DIR = Path(os.environ["OKF_PROTOTYPE_BUNDLE_DIR"])
SYSTEM_ONT = EffectiveOntology.base_for_class("system_baseline")
PRIVATE_DOCS_MARKERS = ("docs-site", "kh-private", "private")  # S3: never a citation host


def _tool_span(rel_file: str, tool_name: str) -> tuple[int, int]:
    text = (ROOT / rel_file).read_text(encoding="utf-8")
    for m in _DEFINE_TOOL_CALL_RE.finditer(text):
        if m.group("name") != tool_name:
            continue
        open_idx = m.start() + len("defineTool")
        close_idx = _match_closing_paren(text, open_idx)
        return text.count("\n", 0, m.start()) + 1, text.count("\n", 0, close_idx) + 1
    raise SystemExit(f"tool {tool_name} not found in {rel_file}")


def _tool_key(rel_path: str, rel_file: str, name: str) -> RepoConceptKey:
    ls, le = _tool_span(rel_file, name)
    span = "".join((ROOT / rel_file).read_text(encoding="utf-8").splitlines(keepends=True)[ls - 1:le])
    return RepoConceptKey(rel_path=rel_path, concept_type="tool",
                          source_ref=f"{rel_file}#L{ls}-L{le}", span_content_hash=_span_content_hash(span))


# ── the 5 targets (prep-verified) ────────────────────────────────────────
TOOL_KEYS = [
    _tool_key("tool/classify_content.md", "lib/mcp/tools/ai.ts", "classify_content"),
    _tool_key("tool/find.md", "lib/mcp/tools/search.ts", "find"),
    _tool_key("tool/get.md", "lib/mcp/tools/content.ts", "get"),
    _tool_key("tool/get_procurement_detail.md", "lib/mcp/tools/procurement.ts", "get_procurement_detail"),
]
_nav_sha = _git_blob_sha(ROOT, "docs/extend-registry-provenance.md")
NAV_KEY = RepoConceptKey(rel_path="navigation/extend-registry-provenance.md",
                         concept_type="navigation", source_ref="docs/extend-registry-provenance.md",
                         git_blob_sha=_nav_sha)
ALL_KEYS = TOOL_KEYS + [NAV_KEY]
ALL_PATHS = {k.rel_path for k in ALL_KEYS}

# ── expected_behaviour contracts (deterministically extracted from source) ─
CONTRACTS = {
    "tool/classify_content.md": dict(
        tool="classify_content", source_ref="lib/mcp/tools/ai.ts#L27-L95",
        input=["item_id", "force"], output=[], check="input-contract-only",
        claim="Trigger AI classification of a content item — assigns domain, subtopic, keywords, summary and a suggested title; requires editor or admin role."),
    "tool/find.md": dict(
        tool="find", source_ref="lib/mcp/tools/search.ts#L581-L737",
        input=["query", "granularity", "type", "scope", "similar_to", "threshold", "limit",
               "offset", "workspace_id", "content_item_id", "overdue_review",
               "review_due_within_days", "visibility_filter"],
        output=[], check="input-contract-only",
        claim="The single entry point for search, Q&A lookup, section-level retrieval and similar-item discovery; returns ranked list/preview metadata to feed a follow-up get."),
    "tool/get.md": dict(
        tool="get", source_ref="lib/mcp/tools/content.ts#L162-L391",
        input=["id", "ids"], output=["mode", "item", "count", "items", "not_found"],
        check="contract-match",
        claim="Given a content-item id returns that item verbatim with its chunks; given ids (max 50) returns a truncated batch list/preview; exactly one of id or ids must be supplied."),
    "tool/get_procurement_detail.md": dict(
        tool="get_procurement_detail", source_ref="lib/mcp/tools/procurement.ts#L204-L378",
        input=["id"], output=[], check="input-contract-only",
        claim="Get detailed information about a specific procurement including buyer, deadline, status and question-completion progress; used after listing procurements to drill into one."),
}

SYSTEM_PROMPT = (
    "You are drafting one concept document for the canonical-okf-system BASELINE knowledge "
    "bundle — an Open Knowledge Format (OKF) markdown knowledge base that describes the "
    "Canonical platform's OWN system surface (its MCP tools and orientation docs) for both "
    "humans and AI agents. This is a system-baseline concept, distilled from a single "
    "backing source artefact in the public `canonical` repository.\n\n"
    "You are given the concept's identity, its backing source text, and the EXACT public "
    "git-blob citation URL for that source. Draft a clear, well-organised markdown concept "
    "from the backing text.\n\n"
    "RULES\n"
    "- Distil and explain in your own words. Never copy long verbatim passages of the "
    "source; summarise its behaviour, inputs, outputs and intended use.\n"
    "- Ground every factual claim in the backing source text you were given.\n"
    "- UK English spelling throughout. Any calendar date in prose uses DD/MM/YYYY.\n"
    "- Do NOT put any literal UUID (8-4-4-4-12 hex) or any `canonical://` URI anywhere in "
    "your body prose — describe identifiers in words instead.\n"
    "- Cite ONLY the exact git-blob URL you are given, copied verbatim, in your `citations` "
    "array. Never invent a URL. Do not add a `# Citations` heading yourself — it is appended "
    "for you from the `citations` array.\n\n"
    "OUTPUT CONTRACT — respond with PLAIN TEXT that is a SINGLE JSON object (no code fence, "
    "no commentary before or after), with these REQUIRED keys:\n"
    '  "title"       — a short human-readable concept title.\n'
    '  "description" — a one-sentence summary (frontmatter description).\n'
    '  "tags"        — JSON array of short lower-case tags (may be empty).\n'
    '  "body"        — the distilled markdown body (no `# Citations` heading).\n'
    '  "citations"   — JSON array containing the one git-blob URL you were given, verbatim.\n'
)


def _user_message(key: RepoConceptKey, backing_text: str, citation: str) -> str:
    kind = ("MCP tool (a `defineTool(server, '<name>', ...)` registration in a TypeScript "
            "source file — describe what the tool does, its inputs, its outputs/response shape, "
            "and when an agent should call it)") if key.concept_type == "tool" else (
        "orientation / navigation document (a markdown page — distil what it teaches and how a "
        "reader should use it to navigate the system)")
    return (
        f"Concept identity (bundle path): {key.rel_path}\n"
        f"Concept type: {key.concept_type} — this is an {kind}.\n"
        f"Backing source locator: {key.source_ref}\n"
        f"EXACT citation URL to use (copy verbatim into citations): {citation}\n\n"
        f"--- BACKING SOURCE TEXT (distil, do not copy verbatim) ---\n{backing_text}\n"
        f"--- END BACKING SOURCE TEXT ---\n"
    )


def _render_git_blob_trailer(citations) -> str:
    """PROTOTYPE-local trailer renderer for the PC-5 git-blob citation scheme.

    FINDING ({163.6}): the shared `validator.render_citations_trailer` has no
    `is_git_blob_citation` branch — a git-blob URL falls into its concept-
    cross-link `else` branch and gets a bundle-absolute '/' prepended,
    emitting `](/https://github.com/...)` (a malformed link target that does
    NOT resolve on the public host; only `citation_target`'s leading-'/'
    strip lets validation still pass). Rendered correctly here so the
    prototype's emitted citations resolve; the one-line shared-renderer fix
    is escalated for {163.13}."""
    lines = ["# Citations", ""]
    for i, c in enumerate(citations, start=1):
        lines.append(f"[{i}] [{c}]({c})")
    return "\n".join(lines) + "\n"


def _render_expected_behaviour(c: dict) -> str:
    lines = ["expected_behaviour:", f"  tool: {c['tool']}", f"  source_ref: {c['source_ref']}"]
    if c["input"]:
        lines.append("  input:")
        lines += [f"    - {x}" for x in c["input"]]
    else:
        lines.append("  input: []")
    if c["output"]:
        lines.append("  output:")
        lines += [f"    - {x}" for x in c["output"]]
    else:
        lines.append("  output: []")
    claim = c["claim"].replace("\\", "\\\\").replace('"', '\\"')
    lines.append(f'  claim: "{claim}"')
    lines.append(f"  check: {c['check']}")
    return "\n".join(lines) + "\n"


async def _draft_one(client, source, key, citation, backing_text):
    create_kwargs: "dict[str, Any]" = dict(
        model=PRODUCER_MODEL, max_tokens=8192, system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _user_message(key, backing_text, citation)}],
    )
    extra_body = _provider_routing_extra_body()
    if extra_body is not None:
        create_kwargs["extra_body"] = extra_body
    resp = await _anthropic_retry(lambda: client.messages.create(**create_kwargs))
    assert resp is not None
    _guard_not_truncated(resp, "okf_prototype", 8192)
    envelope = _parse_pass1_response(resp, seen_anchors=source.seen_anchors, catalogue_paths=ALL_PATHS)
    return envelope


async def main():
    BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
    source = RepoDocsSource(ROOT, navigation_docs_dir="docs")
    # Pre-read all 5 -> populate seen_anchors + hold backing text/citation.
    reads = {}
    for k in ALL_KEYS:
        raw = await source.read_concept(k)
        reads[k.rel_path] = (raw.text, raw.resource)
        print(f"[read] {k.rel_path}: text={len(raw.text)}B citation_public={is_git_blob_citation(raw.resource)}", flush=True)

    client = producer_async_client()
    results = []
    for k in ALL_KEYS:
        backing_text, citation = reads[k.rel_path]
        print(f"[draft] {k.rel_path} on {PRODUCER_MODEL} ...", flush=True)
        envelope = await _draft_one(client, source, k, citation, backing_text)

        fm = build_concept_frontmatter(
            type=k.concept_type, title=envelope.title, description=envelope.description,
            timestamp=datetime.now(timezone.utc), tags=envelope.tags, resource=None)
        # per-class BI-13 validation ({163.3}) — raises on any violation (strict).
        body = f"{envelope.body.rstrip()}\n\n{_render_git_blob_trailer(envelope.citations)}"
        validate_concept(fm, body=body, effective_ontology=SYSTEM_ONT)

        fm_text = render_concept_frontmatter(fm)
        if k.rel_path in CONTRACTS:
            assert fm_text.endswith("---\n")
            fm_text = fm_text[:-4] + _render_expected_behaviour(CONTRACTS[k.rel_path]) + "---\n"
        rendered = fm_text + body + "\n"

        out = BUNDLE_DIR / k.rel_path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(rendered, encoding="utf-8")
        print(f"[ok]  {k.rel_path}: citations={list(envelope.citations)}", flush=True)
        results.append((k.rel_path, envelope.citations))

    # ── KA2/S3 post-hoc gate assertions ──────────────────────────────────
    print("\n=== KA2/S3 CITATION GATE ===", flush=True)
    all_ok = True
    for rel_path, citations in results:
        for c in citations:
            in_seen = c in source.seen_anchors
            public = is_git_blob_citation(c)
            not_private = not any(m in c for m in PRIVATE_DOCS_MARKERS)
            ok = in_seen and public and not_private
            all_ok = all_ok and ok
            print(f"  {'PASS' if ok else 'FAIL'} {rel_path}: seen={in_seen} public={public} not_private={not_private}", flush=True)
    print(f"[GATE] {'ALL PASS' if all_ok else 'FAIL'}  (seen_anchors n={len(source.seen_anchors)})", flush=True)
    sys.exit(0 if all_ok else 3)


asyncio.run(main())
