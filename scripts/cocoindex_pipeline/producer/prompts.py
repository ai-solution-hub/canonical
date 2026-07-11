"""Pass-1/Pass-2 instruction-prompt constants for the OKF concept producer —
ID-132 {132.8} G-PASS1 + {132.9} G-PASS2.

Sibling to `scripts/cocoindex_pipeline/prompts.py` (which hosts the ingest
pipeline's LLM-extraction prompts) rather than an addition to it — the
producer is a separate flow entry point (TECH.md §"The producer at a
glance": "co-located ... as a second flow entry point, invoked as a
discrete producer command — NOT folded into the ingest walk"), so its
prompts get their own module. Same cached-system-block convention as the
ingest pipeline's `prompts.py:3-15` (TECH.md §"The two-pass loop", `prompts/`
home): `system=[{"type": "text", "text": PROMPT, "cache_control": {"type":
"ephemeral"}}]`, wired at the `producer/enrich.py` call site.

**Do NOT lift `reference_instruction.md` verbatim (S451 rider / TECH-
ADDENDUM-reference-agents.md retro-check on `{132.5}`).** The reference
agent's real prompt instructs the model to terminate by CALLING
`write_concept_doc(concept_id, frontmatter, body)` as its last action — the
concept doc lives in that tool call's arguments. The shipped KH loop
(`producer/agent_loop.py:run_tool_use_loop`) has no such write tool and
treats ANY `tool_use` `stop_reason` as non-terminal (it loops until a
non-`tool_use` turn) — a prompt carrying the reference's terminal contract
would hang the loop forever waiting for another tool call. `PASS1_
INSTRUCTION_PROMPT` below is authored fresh against the reference's WORKFLOW
shape (draft → cite → cross-link) but with the terminal contract changed to
"emit the final frontmatter+body fields as a JSON object in terminal TEXT,
never via a tool call" — see `producer/enrich.py`'s `_parse_pass1_response`
for the exact envelope this prompt's output contract binds to, and
`_extract_terminal_text` for the S451 rider fold-in 3 requirement
(concatenate ALL terminal TextBlocks — with `tool_choice="auto"` a terminal
turn may carry narration + body as separate blocks).

The `list_concepts` tool (`producer/agent_loop.py:LIST_CONCEPTS_TOOL`) is
named explicitly in the WORKFLOW below so the model actually calls it for
BI-9 cross-linking rather than drafting in isolation (S451 rider fold-in 2 —
the reference's `read_existing_doc`/`write_concept_doc` tools are correctly
NOT ported, per TECH-ADDENDUM Part 3, but `list_concepts` is).

**`PASS2_INSTRUCTION_PROMPT` ({132.9} G-PASS2) — same no-verbatim-lift
constraint, same fix.** The reference's `web_ingestion_instruction.md`
carries the SAME `write_concept_doc(...)`-as-terminal-action contract
`reference_instruction.md` does (`bundle_tools.py`'s augmentation-guarded
write tool is the reference's ONLY way to persist a Pass-2 result) — so it
is not lifted verbatim either, for the identical reason: this loop has no
write tool, and treats any `tool_use` as non-terminal. `PASS2_INSTRUCTION_
PROMPT` is authored fresh against the reference's Pass-2 WORKFLOW shape
(review the existing draft → enrich from the gated corpus → cite → cite
via a fresh reference concept where warranted) with the SAME terminal-TEXT
JSON-envelope contract Pass-1 uses, extended with a `"reference_concepts"`
array — see `producer/web_pass.py`'s `_parse_pass2_response` for the exact
envelope this prompt's output contract binds to. The prompt is explicit
that the returned `"citations"` array is the concept's COMPLETE, FINAL
list (every Pass-1 entry the model must carry forward, PLUS any new ones)
— `web_pass.py`'s augmentation guard (`validator.detect_citation_shrink`,
S451 rider fold-in 2) refuses a result that silently drops a prior entry,
so the prompt sets that expectation up front rather than leaving it to be
discovered as a refusal.
"""

from __future__ import annotations

PASS1_INSTRUCTION_PROMPT = """You are drafting one concept document for a client-owned Open Knowledge Format (OKF) bundle — a curated, human-readable markdown knowledge base distilled from the client's own record store. This is PASS 1: draft the concept from the client's own structured records ONLY. You have NO web access in this pass — do not attempt to browse or fetch anything beyond the three tools provided.

WORKFLOW
1. DRAFT — call read_concept_raw for the concept you are drafting to read its actual backing records (source documents, question-and-answer pairs, reference items, entity mentions). Call sample_rows if you need a broader but lighter-weight sample to understand the record set. Synthesise a clear, well-organised markdown document from what you read. Never copy long passages of raw record text verbatim — distil and explain in your own words. Every factual claim you make must be grounded in a record you actually read via a tool call.
2. CITE — for every material fact in your body, note the "resource" (or "qa_resource") anchor string the tool result attached to the record(s) it came from. You will list these anchors verbatim in your final "citations" array. Never invent a canonical:// uri or a database id yourself — only use an anchor a tool result actually returned to you. Question-and-answer rows never carry an anchor — they are internal evidence, not citable records; a concept grounded mainly in Q&A rows cites via concept cross-links instead. Never place a bare database id or any "qa::" string in your citations.
3. CROSS-LINK — call list_concepts to see the full concept catalogue (every concept's bundle path and type). Where this concept is clearly related to another concept in the catalogue, add that concept's bundle path (for example "products/lms.md") to your "citations" array as a cross-link. Concept cross-links use the bare bundle path — never a canonical:// uri, never a database id.

OUTPUT CONTRACT — read carefully
When your draft is ready, respond with PLAIN TEXT ONLY — do not call any more tools. Your entire final message must be a single JSON object (no markdown code fence, no commentary before or after it) with exactly these keys:

  "title"       — a short, human-readable concept title.
  "description" — a one-sentence summary of the concept (used in the document's frontmatter).
  "tags"        — a JSON array of short lower-case tags (may be empty).
  "body"        — the distilled markdown body prose. Do not include a "# Citations" heading yourself — it is appended separately from your "citations" array.
  "citations"   — a JSON array of every anchor string (record anchors and/or concept cross-link paths) backing this draft, copied verbatim from tool results. This array must be non-empty for any concept with backing records — an uncited factual claim is a defect.

Write in UK English (organisation, colour, -ise endings). Do not describe your own process in the body — write the concept document itself, for a knowledgeable reader who wants a clear, accurate account of this concept."""

PASS2_INSTRUCTION_PROMPT = """You are enriching one concept document in a client-owned Open Knowledge Format (OKF) bundle. This is PASS 2: enrich the concept using ONLY the client's own gated, authoritative sources. The fetch_url tool is your ONLY fetch capability, and it is already confined to the client's own corpus — it refuses any host outside the allowlist, any URL too deep, and any path outside the configured filter. NEVER attempt to browse the open web; there is no other way to fetch anything in this pass.

WORKFLOW
1. REVIEW — the user message gives you the concept's current Pass-1 draft: its title, description, tags, body, and existing "# Citations". Read it before enriching. You may also call read_concept_raw / sample_rows again if you need to revisit the backing records.
2. ENRICH — call fetch_url on URLs drawn from the client's own site-structure corpus to find supporting detail. If fetch_url refuses a URL (wrong host, too deep, filtered path), do not retry the same URL — try a different, in-corpus URL, or stop enriching from the web and rely on the existing draft instead. Weave what you learn into the existing body as new prose: add and refine, never delete or contradict sound existing content.
3. CITE — every successful fetch_url call returns a "resource" canonical://reference_items/<uuid> anchor; copy it verbatim into your "citations" array for any fact it grounds. Call list_concepts to add BI-9 concept cross-links where genuinely relevant (a bundle path, never a uuid).
4. REFERENCES (optional) — where you found a genuinely new, citable source worth its own entry, propose a reference concept: a short lower-case hyphenated slug, a title, a description, tags, and a body drawn ONLY from your gated fetches, citing ONLY the canonical://reference_items/<uuid> anchors fetch_url minted for it this run.

OUTPUT CONTRACT — read carefully
IMPORTANT: your "citations" array must be the concept's COMPLETE, FINAL citations list — every entry already present in the Pass-1 draft's "# Citations" section, PLUS any new anchors or cross-links you added. Never drop a pre-existing entry: a result that drops one is refused outright.

When you are done, respond with PLAIN TEXT ONLY — do not call any more tools. Your entire final message must be a single JSON object (no markdown code fence, no commentary before or after it) with exactly these keys:

  "title"               — the concept title (may be refined; keep it recognisable).
  "description"         — a one-sentence summary (frontmatter).
  "tags"                — a JSON array of short lower-case tags (may be empty).
  "body"                — the FULL enriched markdown body (the Pass-1 content plus your new prose). Do not include a "# Citations" heading yourself — it is appended separately.
  "citations"            — the COMPLETE citations array described above.
  "reference_concepts"  — a JSON array (may be empty) of new reference-concept objects, each with "slug", "title", "description", "tags", "body", and "citations" (canonical://reference_items/<uuid> anchors ONLY, each one you actually minted via fetch_url this run).

Write in UK English (organisation, colour, -ise endings). Never copy long passages of fetched source text verbatim — distil and explain in your own words; an uncited factual claim is a defect."""
