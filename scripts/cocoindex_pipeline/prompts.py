"""Instruction-prompt constants for the cocoindex LLM-extraction stage.

This module hosts the three static instruction-prompt templates that direct
the Anthropic model to emit JSON matching the Q-EX2 typed extraction shapes
defined in `scripts/cocoindex_pipeline/extraction.py`. Each prompt is a
self-contained instruction block sent as a CACHED system block (ID-61.1 —
prompt-cache passthrough, closing GAP-Q-EX2-002), with only the per-document
content in the uncached user-message suffix:

    system=[{"type": "text", "text": PROMPT,
             "cache_control": {"type": "ephemeral"}}],
    messages=[{"role": "user", "content": content_text}]

(see `extraction.py:_cached_system_block`; the pre-cache shape concatenated
`f"{PROMPT}\\n\\n{content_text}"` into a single user message).

The prompts are written to:

1. Force JSON-only output (no markdown fences, no commentary) so the
   downstream Pydantic `TypeAdapter.validate_json()` round-trip is direct.
2. Enumerate the valid field values verbatim — `extraction_kind`, the
   12-value `entity_type` Literal, the 8-value `form_type` set
   (snapshot-backed; see `extraction.py:_VALID_FORM_TYPES`), the
   2-value `expected_response_kind` Literal — so prompt drift is rare.
3. Omit the flow-stamp fields (`op_id`, `content_items_id`,
   `extracted_at`). Those are NOT on the memo-returned core shapes at all
   (bl-220 / ID-74); the flow wrapper stamps the full `*Stamped` type
   POST-memo via `stamp_extraction_base()` — asking the model to emit them
   would cause it to hallucinate UUIDs.

UK English throughout (extract, organise, behaviour). All prompts default
to ~200-400 words; they are stable instruction templates rather than dense
prose. Byte-stability matters: the prompt text is the prompt-cache key, so
any edit to a constant invalidates the server-side cache for that extractor
(GAP-Q-EX2-002 closed by ID-61.1 — cache_control wiring lives in
`extraction.py`, not here).

References:
- `docs/specs/id-36-cocoindex-extraction-contract/TECH.md` §3.1 (LLM-extraction
  contract; the three extractor calls reference these constants).
- `docs/specs/id-36-cocoindex-extraction-contract/TECH.md` §6 row 4 (split into
  three SEPARATE extractor calls — no bundled "extract everything" prompt).
"""

from __future__ import annotations


CLASSIFICATION_PROMPT = """You are extracting structured classification metadata from a document for an enterprise knowledge base. Read the document content carefully and produce a single JSON object describing how the document should be classified.

OUTPUT FORMAT
Return ONLY a single JSON object — no markdown fences, no commentary, no preamble. The JSON object MUST have exactly these fields:

  {
    "extraction_kind": "classification",
    "content_type": <one of the canonical values listed below>,
    "primary_domain": <short snake_case domain name>,
    "primary_subtopic": <short snake_case subtopic name, OR null>,
    "suggested_title": <concise human-readable document title in Title Case, OR null>,
    "classification_confidence": <float between 0.0 and 1.0>,
    "secondary_classifications": [<list of secondary domain names>],
    "rationale": <one-paragraph explanation of the classification decision, OR null>
  }

FIELD CONSTRAINTS

- extraction_kind: MUST be the exact string "classification".
- content_type: MUST be ONE of the following canonical values:
  article, blog, pdf, note, research, other, q_a_pair, case_study, policy, certification, compliance, methodology, capability, product_description, document.
- primary_domain: a short snake_case identifier of the document's primary domain (e.g. security, compliance, implementation, support, corporate, product_feature, methodology).
- primary_subtopic: a short snake_case identifier of the document's primary subtopic WITHIN that domain (e.g. data_protection, access_control, incident_response, supplier_onboarding, tender_evaluation). Use null when no single subtopic is clearly primary.
- suggested_title: a concise, human-readable title for the document in Title Case (e.g. "G-Cloud 13 Framework Agreement", "Information Security Policy"). Prefer the document's own title or main heading when present; otherwise synthesise a faithful short title (max ~80 characters) from the content. Use null only when no meaningful title can be derived.
- classification_confidence: a float between 0.0 and 1.0 representing your confidence in the primary classification. Use 0.9+ when the document is unambiguous; 0.6-0.85 when the document spans multiple domains but one is clearly primary; 0.3-0.6 when classification is uncertain.
- secondary_classifications: a list of zero or more secondary domain names. Use snake_case identifiers. Empty list is acceptable when the document is single-domain.
- rationale: a one-paragraph (up to ~3 sentences) explanation of why this classification was chosen. Use null when the classification is self-evident from content_type alone.

GUIDANCE

- Choose `q_a_pair` only when the document is structured as discrete question-and-answer pairs (e.g. an interview transcript, an FAQ).
- Choose `case_study` for narrative engagement write-ups; `methodology` for process descriptions; `policy` for governance documents; `capability` for skill or service descriptions.
- Choose `other` only when none of the canonical values fit. Do NOT invent new values.
- Use UK English (organise, behaviour, colour) in the rationale.

Now classify the following document:
"""


Q_A_FORM_PROMPT = """You are extracting question-and-answer pairs from a procurement form, questionnaire, or sales-proposal template for an enterprise knowledge base. Read the document content carefully and produce a single JSON object describing the form's metadata and every Q&A pair it contains.

OUTPUT FORMAT
Return ONLY a single JSON object — no markdown fences, no commentary, no preamble. The JSON object MUST have exactly these fields:

  {
    "extraction_kind": "q_a_form",
    "form_metadata": {
      "form_type": <one of the canonical form_type values listed below>,
      "form_format": <one of: docx, xlsx, pdf, html, md>,
      "form_title": <string title, OR null>,
      "issuing_organisation": <string organisation name, OR null>,
      "deadline": <ISO 8601 UTC datetime string, OR null>,
      "evaluation_methodology": <short description of how responses are scored, OR null>
    },
    "qa_pairs": [
      {
        "question_text": <verbatim question text>,
        "answer_text": <verbatim answer text if present in the document, OR null>,
        "expected_response_kind": <one of: mandatory, optional>,
        "evaluation_criteria": <description of how the response is evaluated, OR null>,
        "evidence_requirements": [<list of required evidence types>],
        "scope_tags": [<list of scope identifiers>],
        "question_phrasings": [<3-5 alternate ways the SAME question could be asked>]
      },
      ...
    ]
  }

FIELD CONSTRAINTS

- extraction_kind: MUST be the exact string "q_a_form".
- form_metadata.form_type: MUST be ONE of: bid, rfp, psq, itt, tender, checklist, questionnaire, sales_proposal_template.
- form_metadata.form_format: MUST be ONE of: docx, xlsx, pdf, html, md.
- form_metadata.deadline: if present, MUST be a valid ISO 8601 UTC datetime string (e.g. "2026-06-30T17:00:00Z").
- qa_pairs[*].question_text: non-empty string verbatim from the document.
- qa_pairs[*].expected_response_kind: MUST be EXACTLY ONE of "mandatory" or "optional". NEVER use "info_only" or any other value.
- qa_pairs[*].evidence_requirements: list of zero or more required-evidence identifiers (e.g. ["iso27001_certificate", "case_study"]). Empty list is acceptable.
- qa_pairs[*].scope_tags: list of zero or more scope identifiers. Empty list is acceptable.
- qa_pairs[*].question_phrasings: 3 to 5 alternate phrasings of the SAME question — different wordings a person might use to ask for the same information (e.g. for "Do you hold ISO 27001:2022 certification?": ["Are you ISO 27001:2022 certified?", "Do you have ISO 27001 accreditation?", "Can you evidence ISO 27001:2022 compliance?"]). Preserve the question's meaning exactly — do NOT broaden, narrow, or invent new requirements. Return an empty list ONLY when no faithful rephrasing is possible. List of strings; empty list is acceptable.

GUIDANCE

- Choose `bid` / `rfp` / `psq` / `itt` / `tender` for procurement forms; `checklist` / `questionnaire` for non-procurement structured forms; `sales_proposal_template` for outbound sales templates.
- Mark a question `mandatory` when the form indicates a required response (e.g. "must", "required", marked with asterisks); otherwise `optional`.
- If the document is NOT a form (e.g. a policy or methodology), still return a valid JSON object with `qa_pairs: []` — do NOT invent Q&A pairs from non-form content.
- Use UK English (organise, behaviour, colour) in any descriptive fields.

Now extract Q&A pairs from the following document:
"""


ENTITY_MENTION_PROMPT = """You are extracting named entity mentions from a document for an enterprise knowledge base. Read the document content carefully and produce a JSON list, where each item describes one entity mention with its exact source-text span.

OUTPUT FORMAT
Return ONLY a single JSON array — no markdown fences, no commentary, no preamble. The array MAY be empty if the document contains no extractable entities. Each item in the array MUST have exactly these fields:

  {
    "extraction_kind": "entity_mention",
    "entity_type": <one of the canonical entity_type values listed below>,
    "entity_name": <verbatim entity-name string as it appears in the document>,
    "canonical_name": <normalised canonical form of the entity, OR null>,
    "source_span_start": <integer character offset where the mention starts>,
    "source_span_end": <integer character offset where the mention ends (exclusive)>,
    "mention_confidence": <float between 0.0 and 1.0>
  }

FIELD CONSTRAINTS

- extraction_kind: MUST be the exact string "entity_mention".
- entity_type: MUST be ONE of: organisation, certification, regulation, framework, capability, person, technology, project, sector, product, standard, methodology.
- entity_name: non-empty string, verbatim from the document.
- canonical_name: the normalised form of the entity (e.g. entity_name "ISO 27001:2022" -> canonical_name "iso_27001"). Use null when no canonicalisation is appropriate.
- source_span_start / source_span_end: zero-based character offsets into the document text. source_span_end is exclusive (Python slice convention). The substring `content_text[source_span_start:source_span_end]` MUST equal entity_name.
- mention_confidence: a float between 0.0 and 1.0. Use 0.9+ when the entity is unambiguous; 0.6-0.85 when the surface form is ambiguous but context disambiguates; below 0.5 when classification is uncertain.

GUIDANCE

- entity_type meanings:
  - organisation: a named company, government body, charity, or other legal entity (e.g. "British Telecom", "NHS Digital").
  - certification: a named certification or accreditation (e.g. "ISO 27001:2022", "Cyber Essentials Plus").
  - regulation: a named law, statute, or regulatory regime (e.g. "GDPR", "UK Data Protection Act 2018").
  - framework: a named delivery framework or procurement vehicle (e.g. "G-Cloud 13", "TS&S DPS").
  - capability: a named service or skill area (e.g. "penetration testing", "user research").
  - person: a named individual (e.g. "Alice Brown", "Dr. John Smith").
  - technology: a named software, hardware, or platform (e.g. "Snowflake", "Azure", "Kubernetes").
  - project: a named project or programme (e.g. "Project Phoenix", "MoD Skynet 6").
  - sector: a named industry sector (e.g. "Financial Services", "Healthcare").
  - product: a named commercial product (e.g. "Microsoft Office 365", "Apple iPhone").
  - standard: a named technical standard (e.g. "OAuth 2.0", "TLS 1.3").
  - methodology: a named methodology or framework of practice (e.g. "Agile Scrum", "PRINCE2").
- Do NOT extract these as entities:
  - Internal departments: IT Department, HR Team, the project team, senior management — these are internal functions, not organisations. (Their relationship to a certification is carried by the relationship `source_scope` tag, not by promoting them to an `organisation` mention.)
- If the document contains no entities of the above types, return an empty list `[]` — do NOT invent entities.
- Use UK English (organise, behaviour, colour) — but do NOT alter the verbatim entity_name string, even if it uses American spelling.

TABULAR AND INDEX EXTRACTION RECALL

Markdown tables and source-index lists are systematically under-extracted by patterns optimised for prose. When the content contains either structure, apply these rules IN ADDITION to the entity_type meanings above. Each candidate they surface is still an `entity_mention` with exact `source_span_start` / `source_span_end` offsets — the spans MUST point at the cell text inside the table, and `content_text[source_span_start:source_span_end]` MUST equal entity_name as for any other mention.

- Trigger 1 — entity-bearing markdown tables. Inspect EVERY row of any table where at least one column header contains an entity-context signal: Source, Reference, Document, Vendor, Client, Organisation, Product, Tool, Technology, Partnership, Provider, Framework, Standard, Certification. For these tables, each cell that names an organisation, product, technology, certification, regulation, framework, or standard is a candidate mention. A single cell may hold several entities — e.g. a source cell "Council-A SCP, Borough-B, District-C SCP" yields THREE distinct organisation mentions, each with its own span. Tables whose columns hold only activities, durations, role names, or other non-entity content (process maps, RACI matrices, KPI metric definitions) are NOT subject to Trigger 1 — extract from them only where a cell explicitly names an entity per the meanings above.
- Trigger 2 — source index lists. When a table's column header matches Source / Reference / Document / Used in section(s), treat each first-column entry as a candidate even when it appears inside a longer document description — e.g. from "Council-A SCP LMS Pre-Board Paper" extract "Council-A SCP" (organisation); from "Borough-B SCP & Acme" extract "Borough-B SCP" (organisation). Source indexes typically sit at the end of research documents and case-study collections.
- Trigger 3 — bullet-list em-dash attribution (organisation only). Bullet lines ending with `— <Source Org>` attribute the bullet to that organisation; extract the post-em-dash text as `organisation` ONLY when it names a real organisation AND there is no preceding person attribution. First-name-only attributions ("— Alex", "— Sam") are NOT entities. For person+org compounds like "— Alex, Council-A SCP" or "— Sam, Borough-B SAB" extract ONLY the organisation portion (Council-A SCP, Borough-B SAB). Sales-meeting first-name-only attributions like "— Jordan sales meeting" extract NEITHER a person nor an organisation.
- Boundary — table cells that look like sectors. A cell with a single-word noun like "education", "healthcare", "safeguarding" with no specific named partnership/organisation context is a `sector`, not an `organisation`.

Now extract entity mentions from the following document:
"""


RELATIONSHIP_PROMPT = """You are extracting relationships between named entities from a document for an enterprise knowledge base. When entities are identified, also extract relationships between them where clearly stated or strongly implied. Read the document content carefully and produce a JSON list, where each item describes one relationship between a source entity and a target entity.

OUTPUT FORMAT
Return ONLY a single JSON array — no markdown fences, no commentary, no preamble. The array MAY be empty if the document contains no extractable relationships. Each item in the array MUST have exactly these fields:

  {
    "source": <verbatim or canonicalised source-entity name>,
    "relationship": <one of the canonical relationship-type values listed below>,
    "target": <verbatim or canonicalised target-entity name>
  }

FIELD CONSTRAINTS

- source: non-empty string naming the source entity of the relationship.
- target: non-empty string naming the target entity of the relationship.
- relationship: MUST be ONE of the following canonical relationship-type values. Use these relationship types:

| Relationship      | Meaning                                    | Example                                                 |
| ----------------- | ------------------------------------------ | ------------------------------------------------------- |
| `holds`           | Organisation holds a certification         | Acme Ltd holds ISO 27001                                |
| `complies_with`   | Entity complies with a regulation/standard | Acme Ltd complies_with GDPR                             |
| `delivers_to`     | Organisation delivers to a sector          | Acme Ltd delivers_to Public Sector                      |
| `uses`            | Entity uses a technology/product           | Acme Ltd uses Microsoft Azure                           |
| `demonstrated_by` | Capability demonstrated by a project       | Penetration Testing demonstrated_by NHS Trust Programme |
| `requires`        | Entity requires another entity             | ISO 27001 requires risk assessment                      |
| `part_of`         | Entity is part of another                  | Data Protection part_of GDPR                            |
| `supersedes`      | Entity supersedes another                  | ISO 27001:2022 supersedes ISO 27001:2013                |
| `references`      | Entity references another                  | Data Protection Policy references GDPR                  |
| `evidences`       | Entity provides evidence for another       | Audit Report evidences ISO 27001                        |

Only include relationships that are clearly stated or strongly implied in the content. If none are found, return an empty list `[]`.

HOLDER DISAMBIGUATION FOR `holds` RELATIONSHIPS

When extracting `holds` relationships for certifications, you MUST check whether the content attributes the certification to the document's author organisation or to a third party (supplier, partner, landlord, data centre operator).

Trigger phrases (sentence-level): If the certification mention appears in the same sentence or immediately adjacent paragraph as any of these phrases, attribute the `holds` relationship to the named third party, not the author organisation:

- "held by [party]"
- "managed by [party]"
- "maintained by [party]"
- "via supplier [party]" / "via [party]"
- "delivered through [party]"
- "outsourced to [party]"
- "provided by [party]" (when [party] is not the document author)
- "operated by [party]"

Disclaimer paragraphs (content-level): If the content contains an explicit disclaimer such as:

- "Note: Certifications ... are held by [party], not [author]"
- "The following certifications are held by [party]"
- "Certifications listed ... belong to [party]"
- "These accreditations are maintained by [party]"

then ALL certification `holds` relationships following the disclaimer (or within its stated scope) must use [party] as the `source` entity, not the author organisation.

When a supplier/third-party holder is detected:

1. Set `source` to the third-party organisation name (canonicalised).
2. Set `target` to the certification name.
3. Set `relationship` to `holds`.

The downstream system will infer holder attribution from `source_entity` vs the configured client organisation name. Do NOT fabricate a `holds` relationship with the author organisation as source when the content explicitly attributes the certification to another party.

When no supplier signal is present and the author organisation is clearly described as holding the certification ("We hold ISO 27001", "{CLIENT_ORGANISATION_NAME} is certified to ISO 9001"), extract the relationship normally with the author organisation as `source`.

Example (supplier attribution):

Content: "Note: Certifications and security measures below are held by Example Datacentre, not {CLIENT_ORGANISATION_NAME}. ISO 27001, ISO 14001, Cyber Essentials Plus."

Correct extraction:

- source: "Example Datacentre", relationship: "holds", target: "ISO 27001"
- source: "Example Datacentre", relationship: "holds", target: "ISO 14001"
- source: "Example Datacentre", relationship: "holds", target: "Cyber Essentials Plus"

Incorrect extraction (what happens without this rule):

- source: "{CLIENT_ORGANISATION_NAME}", relationship: "holds", target: "ISO 27001"

Internal-function holder attribution (the `source_scope` tag):

Some certifications are held by the document author organisation's OWN internal function (its in-house IT, security, or quality team) rather than by a named external supplier. To attribute these correctly, set the optional `source_scope` field on the certification's `holds`/`complies_with`/`evidences` relationship:

- Set `source_scope: "internal"` ONLY when ALL of the following hold: (a) the certification is held by the document author's own internal function; (b) it is declared with an explicit first-person possessive — `"our"`, `"we"`, or `"our own"` (e.g. "our internal IT team", "we maintain ISO 27001 through our internal IT"); AND (c) there is NO supplier/third-party disclaimer in scope for that certification. Keep the internal function out of the `organisation` entities — it is NOT an organisation mention; the signal rides on the relationship only.
- A supplier/third-party disclaimer ALWAYS wins. When a disclaimer (the trigger phrases / disclaimer paragraphs above) scopes the certification to a named third party, set `source_scope: "external"` (or simply name the third party as `source`) — the internal-function tag MUST NOT fire even if the same sentence uses "internal" phrasing.
- A named third party's internal function ("Example Datacentre's internal security team is compliant to ISO 27001") is EXTERNAL, not the author: set `source_scope: "external"` (or name the third party as `source`).
- Bare or non-possessive internal-department phrasing ("Internal IT is compliant to ISO 27001", "the IT team holds ISO 27001") and bare "in-house" without "our" do NOT qualify: OMIT `source_scope` entirely (abstain). Never guess.

Worked examples:

- Fires (self). "Our internal IT team is compliant to ISO 27001." -> source: "Internal IT", relationship: "complies_with", target: "ISO 27001", source_scope: "internal".
- Disclaimer wins (external). "Note: the certifications below are held by Example Datacentre, not {CLIENT_ORGANISATION_NAME}. ISO 27001 is maintained by our internal team." -> source: "Example Datacentre", relationship: "holds", target: "ISO 27001", source_scope: "external".
- Bare internal department (abstain). "Internal IT is compliant to ISO 27001." -> emit the relationship if relevant but OMIT source_scope (no explicit possessive).

GUIDANCE

- Only include relationships that are clearly stated or strongly implied in the content. If none are found, return an empty list `[]` — do NOT invent relationships.
- Use UK English (organise, behaviour, colour) — but do NOT alter the verbatim entity names in source / target where they appear in the document.

Now extract relationships from the following document:
"""
