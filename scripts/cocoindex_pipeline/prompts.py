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
   12-value `entity_type` Literal, the `form_type` value list (advisory
   since DR-130 deleted the snapshot-backed runtime gate — the walk
   discards `form_metadata`; enforcement is the DB FK on the app upload
   path), the 2-value `expected_response_kind` Literal — so prompt drift
   is rare.
3. Omit the flow-stamp fields (`op_id`, `source_document_id`,
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


# ID-133 BI-3 (UNRATIFIED — see extraction.py): content_type FIELD CONSTRAINTS
# below trimmed from 15 to the 7-value set — kept in exact bidirectional
# parity with the inline `_VALID_CONTENT_TYPES` constant (DR-130;
# scripts/cocoindex_pipeline/extraction.py) by
# `TestPromptsEnumeratesEnums.test_classification_enumerates_content_types`
# in scripts/tests/test_cocoindex_prompts.py. q_a_pair migrated out to its
# own Layer-5 class; case_study/policy/certification/compliance/methodology/
# capability/product_description moved to the L-concept type discriminators
# (37-concept-type.md) — routing raw classification output into those
# concept types is NOT built by this change (carried forward, not encoded
# here).
CLASSIFICATION_PROMPT = """You are extracting structured classification metadata from a document for an enterprise knowledge base. Read the document content carefully and produce a single JSON object describing how the document should be classified.

OUTPUT FORMAT
Return ONLY a single JSON object — no markdown fences, no commentary, no preamble. The JSON object MUST have exactly these fields:

  {
    "extraction_kind": "classification",
    "content_type": <one of the canonical values listed below>,
    "primary_domain": <short kebab-case domain name>,
    "primary_subtopic": <short kebab-case subtopic name, OR null>,
    "suggested_title": <concise human-readable document title in Title Case, OR null>,
    "classification_confidence": <float between 0.0 and 1.0>,
    "secondary_classifications": [<list of secondary domain names>],
    "rationale": <one-paragraph explanation of the classification decision, OR null>
  }

FIELD CONSTRAINTS

- extraction_kind: MUST be the exact string "classification".
- content_type: MUST be ONE of the following canonical values:
  article, blog, pdf, note, research, document, other.
- primary_domain: a short kebab-case identifier of the document's primary domain (e.g. security, compliance, implementation, support, corporate, product-feature, methodology).
- primary_subtopic: a short kebab-case identifier of the document's primary subtopic WITHIN that domain (e.g. data-protection, access-control, incident-response, supplier-onboarding, tender-evaluation). Use null when no single subtopic is clearly primary.
- suggested_title: a concise, human-readable title for the document in Title Case (e.g. "G-Cloud 13 Framework Agreement", "Information Security Policy"). Prefer the document's own title or main heading when present; otherwise synthesise a faithful short title (max ~80 characters) from the content. Use null only when no meaningful title can be derived.
- classification_confidence: a float between 0.0 and 1.0 representing your confidence in the primary classification. Use 0.9+ when the document is unambiguous; 0.6-0.85 when the document spans multiple domains but one is clearly primary; 0.3-0.6 when classification is uncertain.
- secondary_classifications: a list of zero or more secondary domain names. Use kebab-case identifiers. Empty list is acceptable when the document is single-domain.
- rationale: a one-paragraph (up to ~3 sentences) explanation of why this classification was chosen. Use null when the classification is self-evident from content_type alone.

GUIDANCE

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
- form_metadata.form_type: MUST be ONE of: rfp, psq, itt, tender, checklist, questionnaire, sales_proposal_template.
- form_metadata.form_format: MUST be ONE of: docx, xlsx, pdf, html, md.
- form_metadata.deadline: if present, MUST be a valid ISO 8601 UTC datetime string (e.g. "2026-06-30T17:00:00Z").
- qa_pairs[*].question_text: non-empty string verbatim from the document.
- qa_pairs[*].expected_response_kind: MUST be EXACTLY ONE of "mandatory" or "optional". NEVER use "info_only" or any other value.
- qa_pairs[*].evidence_requirements: list of zero or more required-evidence identifiers (e.g. ["iso27001_certificate", "case_study"]). Empty list is acceptable.
- qa_pairs[*].scope_tags: list of zero or more scope identifiers. Empty list is acceptable.
- qa_pairs[*].question_phrasings: 3 to 5 alternate phrasings of the SAME question — different wordings a person might use to ask for the same information (e.g. for "Do you hold ISO 27001:2022 certification?": ["Are you ISO 27001:2022 certified?", "Do you have ISO 27001 accreditation?", "Can you evidence ISO 27001:2022 compliance?"]). Preserve the question's meaning exactly — do NOT broaden, narrow, or invent new requirements. Return an empty list ONLY when no faithful rephrasing is possible. List of strings; empty list is acceptable.

GUIDANCE

- Choose `rfp` / `psq` / `itt` / `tender` for procurement forms; `checklist` / `questionnaire` for non-procurement structured forms; `sales_proposal_template` for outbound sales templates.
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
    "source_span_start": <integer character offset where the mention starts>,
    "source_span_end": <integer character offset where the mention ends (exclusive)>,
    "mention_confidence": <float between 0.0 and 1.0>
  }

FIELD CONSTRAINTS

- extraction_kind: MUST be the exact string "entity_mention".
- entity_type: MUST be ONE of: organisation, certification, regulation, framework, capability, person, technology, project, sector, product, standard, methodology.
- entity_name: non-empty string, verbatim from the document.
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
  - Internal departments: IT Department, HR Team, the project team, senior management — these are internal functions, not organisations.
- If the document contains no entities of the above types, return an empty list `[]` — do NOT invent entities.
- Use UK English (organise, behaviour, colour) — but do NOT alter the verbatim entity_name string, even if it uses American spelling.
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

Attribute each relationship to the entity the content itself names — for example, a certification described as held or maintained by a named third party (a supplier, landlord, or data centre operator) is `holds` from that third party, never from the document's author organisation.

GUIDANCE

- Only include relationships that are clearly stated or strongly implied in the content. If none are found, return an empty list `[]` — do NOT invent relationships.
- Use UK English (organise, behaviour, colour) — but do NOT alter the verbatim entity names in source / target where they appear in the document.

Now extract relationships from the following document:
"""
