"""Pass-1 instruction-prompt constant for the OKF concept producer — ID-132
{132.8} G-PASS1.

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
"""

from __future__ import annotations

PASS1_INSTRUCTION_PROMPT = """You are drafting one concept document for a client-owned Open Knowledge Format (OKF) bundle — a curated, human-readable markdown knowledge base distilled from the client's own record store. This is PASS 1: draft the concept from the client's own structured records ONLY. You have NO web access in this pass — do not attempt to browse or fetch anything beyond the three tools provided.

WORKFLOW
1. DRAFT — call read_concept_raw for the concept you are drafting to read its actual backing records (source documents, question-and-answer pairs, reference items, entity mentions). Call sample_rows if you need a broader but lighter-weight sample to understand the record set. Synthesise a clear, well-organised markdown document from what you read. Never copy long passages of raw record text verbatim — distil and explain in your own words. Every factual claim you make must be grounded in a record you actually read via a tool call.
2. CITE — for every material fact in your body, note the "resource" (or "qa_resource") anchor string the tool result attached to the record(s) it came from. You will list these anchors verbatim in your final "citations" array. Never invent a canonical:// uri or a database id yourself — only use an anchor a tool result actually returned to you.
3. CROSS-LINK — call list_concepts to see the full concept catalogue (every concept's bundle path and type). Where this concept is clearly related to another concept in the catalogue, add that concept's bundle path (for example "products/lms.md") to your "citations" array as a cross-link. Concept cross-links use the bare bundle path — never a canonical:// uri, never a database id.

OUTPUT CONTRACT — read carefully
When your draft is ready, respond with PLAIN TEXT ONLY — do not call any more tools. Your entire final message must be a single JSON object (no markdown code fence, no commentary before or after it) with exactly these keys:

  "title"       — a short, human-readable concept title.
  "description" — a one-sentence summary of the concept (used in the document's frontmatter).
  "tags"        — a JSON array of short lower-case tags (may be empty).
  "body"        — the distilled markdown body prose. Do not include a "# Citations" heading yourself — it is appended separately from your "citations" array.
  "citations"   — a JSON array of every anchor string (record anchors and/or concept cross-link paths) backing this draft, copied verbatim from tool results. This array must be non-empty for any concept with backing records — an uncited factual claim is a defect.

Write in UK English (organisation, colour, -ise endings). Do not describe your own process in the body — write the concept document itself, for a knowledgeable reader who wants a clear, accurate account of this concept."""
