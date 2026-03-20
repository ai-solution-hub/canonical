"""Classification via Opus 4.6 with structured outputs."""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Optional, List

import anthropic

from .config import (
    get_env,
    get_system_prompt,
    CLASSIFICATION_MODEL,
    OPUS_INPUT_PRICE,
    OPUS_OUTPUT_PRICE,
    OPUS_CACHE_WRITE_PRICE,
    OPUS_CACHE_READ_PRICE,
)

logger = logging.getLogger(__name__)

# Module-level cache for valid taxonomy values (populated when DB taxonomy is fetched)
_valid_domains: Optional[List[str]] = None
_valid_subtopics: Optional[List[str]] = None

# ──────────────────────────────────────────
# Keyword normalisation
# ──────────────────────────────────────────

# Proper nouns, acronyms, and named standards that must preserve their casing.
# Checked via case-insensitive exact match against the full keyword string.
PROPER_NOUN_ALLOWLIST = frozenset([
    "ISO 27001",
    "ISO 9001",
    "ISO 14001",
    "ISO 22301",
    "GDPR",
    "ITIL",
    "PRINCE2",
    "Cyber Essentials",
    "Cyber Essentials Plus",
    "Companies House",
    "NHS",
    "NCSC",
    "ICO",
    "FCA",
    "HMRC",
    "PCI DSS",
    "SOC 2",
    "NIST",
    "OWASP",
])

# Build a lookup from lowered form → canonical form for O(1) matching
_PROPER_NOUN_LOOKUP = {pn.lower(): pn for pn in PROPER_NOUN_ALLOWLIST}


def _to_singular(kw: str) -> str:
    """Convert simple English plurals to singular form.

    Handles trailing 's' only — does not attempt irregular plurals
    (e.g. 'policies' → 'policy'). Short words (<=3 chars) are left unchanged
    to avoid mangling words like 'bus', 'gas', 'SaaS'.
    """
    # Don't singularise very short words or words ending in 'ss' (e.g. 'access')
    if len(kw) <= 3 or kw.endswith("ss"):
        return kw
    if kw.endswith("s") and not kw.endswith("us"):
        return kw[:-1]
    return kw


def normalise_keyword(kw: str) -> str:
    """Normalise an AI keyword for consistent storage.

    - Strips whitespace
    - Preserves known proper nouns/acronyms (hardcoded allowlist)
    - Lowercases everything else
    - Converts to singular form for simple English plurals (trailing 's')
    """
    kw = kw.strip()
    if not kw:
        return kw

    # Check if the entire keyword is a known proper noun (case-insensitive)
    canonical = _PROPER_NOUN_LOOKUP.get(kw.lower())
    if canonical is not None:
        return canonical

    # Lowercase and singularise
    kw = kw.lower()
    kw = _to_singular(kw)
    return kw


@dataclass
class ClassificationResult:
    primary_domain: str
    primary_subtopic: str
    confidence: float
    secondary_domain: Optional[str]
    secondary_subtopic: Optional[str]
    suggested_title: str
    ai_summary: str
    ai_keywords: List[str]
    reasoning: str
    is_fragment: bool
    uncertain: bool
    requires_review: bool
    reason_if_flagged: str
    entities: List[dict] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0


# Module-level client (lazy init)
_client = None


def _get_client():
    global _client
    if _client is None:
        env = get_env()
        _client = anthropic.Anthropic(api_key=env["ANTHROPIC_API_KEY"])
    return _client


def build_user_prompt(
    title: str,
    content: str,
    content_type: str = "article",
    platform: str = "web",
    author_name: str = "",
) -> str:
    """Build user prompt for classification."""
    title = title or "(no title)"
    content = content or "(no content)"
    author_name = author_name or "(unknown)"

    # Truncate content at 2000 chars for classification
    if len(content) > 2000:
        content = content[:2000] + "..."

    return f"""Classify this content item:

Title: {title}
Content: {content}
Content Type: {content_type}
Platform: {platform}
Author: {author_name}"""


def classify(
    title: str,
    content: str,
    content_type: str = "article",
    platform: str = "web",
    author_name: str = "",
) -> ClassificationResult:
    """Classify content using Opus 4.6.

    Returns ClassificationResult with all fields populated.
    Raises on API or parsing errors.
    """
    client = _get_client()
    system_prompt = get_system_prompt()
    user_prompt = build_user_prompt(title, content, content_type, platform, author_name)

    response = client.messages.create(
        model=CLASSIFICATION_MODEL,
        max_tokens=1024,
        temperature=0.0,
        system=[{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": user_prompt}],
    )

    # Token tracking
    usage = response.usage
    input_tok = usage.input_tokens
    output_tok = usage.output_tokens
    cache_creation = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0

    # Parse JSON response
    result_text = response.content[0].text.strip()
    if result_text.startswith("```json"):
        result_text = result_text[7:]
    if result_text.startswith("```"):
        result_text = result_text[3:]
    if result_text.endswith("```"):
        result_text = result_text[:-3]
    result_text = result_text.strip()

    parsed = json.loads(result_text)
    flags = parsed.get("flags", {})

    # Parse entities from response (if the AI returned them)
    raw_entities = parsed.get("entities", [])
    ai_entities = []
    for ent in raw_entities:
        ent_type = ent.get("type", "")
        if ent_type in VALID_ENTITY_TYPES:
            ai_entities.append({
                "entity_name": ent.get("name", ""),
                "entity_type": ent_type,
                "canonical_name": ent.get("canonical_name", ent.get("name", "")),
                "confidence": ent.get("confidence", 0.8),
            })

    # Supplement with keyword-based entity extraction from the content
    combined_text = f"{title} {content}"
    keyword_entities = extract_entities_by_keyword(combined_text)

    # Merge: AI entities take precedence, keyword entities fill gaps
    entities = _merge_entities(ai_entities, keyword_entities)

    cls_result = ClassificationResult(
        primary_domain=parsed["primary_domain"],
        primary_subtopic=parsed["primary_subtopic"],
        confidence=parsed["confidence"],
        secondary_domain=parsed.get("secondary_domain"),
        secondary_subtopic=parsed.get("secondary_subtopic"),
        suggested_title=parsed.get("suggested_title", ""),
        ai_summary=parsed.get("ai_summary", ""),
        ai_keywords=[normalise_keyword(kw) for kw in parsed.get("ai_keywords", [])],
        reasoning=parsed.get("reasoning", ""),
        is_fragment=flags.get("is_fragment", False),
        uncertain=flags.get("uncertain", False),
        requires_review=flags.get("requires_review", False),
        reason_if_flagged=flags.get("reason_if_flagged", ""),
        entities=entities,
        input_tokens=input_tok,
        output_tokens=output_tok,
        cache_creation_tokens=cache_creation,
        cache_read_tokens=cache_read,
    )

    # Post-classification validation (only when DB taxonomy was fetched)
    if _valid_domains is not None and _valid_subtopics is not None:
        _validate_classification(cls_result, _valid_domains, _valid_subtopics)

    return cls_result


def estimate_cost(input_tokens: int, output_tokens: int,
                  cache_creation: int = 0, cache_read: int = 0) -> float:
    """Estimate cost in USD from token counts."""
    uncached_input = input_tokens - cache_creation - cache_read
    return (
        uncached_input * OPUS_INPUT_PRICE +
        output_tokens * OPUS_OUTPUT_PRICE +
        cache_creation * OPUS_CACHE_WRITE_PRICE +
        cache_read * OPUS_CACHE_READ_PRICE
    )


def set_valid_taxonomy(domains: List[str], subtopics: List[str]):
    """Cache valid domain/subtopic names for post-classification validation."""
    global _valid_domains, _valid_subtopics
    _valid_domains = domains
    _valid_subtopics = subtopics


def build_taxonomy_section(domains, subtopics):
    """Build markdown taxonomy section from DB data, matching prompt format."""
    lines = [
        "## TAXONOMY REFERENCE\n",
        "### Level 1 Domains (Choose exactly ONE primary)\n",
    ]

    for i, domain in enumerate(domains, 1):
        lines.append(f"#### {i}. {domain['name']}\n")
        if domain.get('description'):
            lines.append(f"{domain['description']}\n")

        domain_subtopics = [
            s for s in subtopics if s['domain_id'] == domain['id']
        ]

        if domain_subtopics:
            lines.append("**Subtopics:**\n")
            for st in domain_subtopics:
                desc = f": {st['description']}" if st.get('description') else ""
                lines.append(f"- `{st['name']}`{desc}")
            lines.append("")

        lines.append("---\n")

    return "\n".join(lines)


def _validate_classification(result, valid_domains, valid_subtopics):
    """Validate classification against DB taxonomy. Warns but doesn't reject."""
    warnings = []
    if result.primary_domain not in valid_domains:
        warnings.append(f"Unknown domain: {result.primary_domain}")
    if result.primary_subtopic not in valid_subtopics:
        warnings.append(f"Unknown subtopic: {result.primary_subtopic}")
    for w in warnings:
        logger.warning(f"Classification validation: {w}")
    return warnings


# ──────────────────────────────────────────
# Entity extraction constants
# ──────────────────────────────────────────

VALID_ENTITY_TYPES = frozenset([
    "organisation", "certification", "regulation", "framework",
    "capability", "person", "technology", "project", "sector",
])

# Known entities for keyword-based extraction.
# Each entry: (pattern, entity_name, entity_type, canonical_name)
# Patterns are compiled as case-insensitive regex.
KNOWN_ENTITIES = [
    # Organisations
    (r"\bexample-client\b", "example-client", "organisation", "example-client"),
    (r"\bICO\b", "ICO", "organisation", "ICO"),
    (r"\bInformation Commissioner(?:'s)? Office\b", "Information Commissioner's Office", "organisation", "ICO"),
    (r"\bNCSC\b", "NCSC", "organisation", "NCSC"),
    (r"\bNational Cyber Security Centre\b", "National Cyber Security Centre", "organisation", "NCSC"),
    (r"\bCompanies House\b", "Companies House", "organisation", "Companies House"),
    (r"\bNHS\b", "NHS", "organisation", "NHS"),
    (r"\bHMRC\b", "HMRC", "organisation", "HMRC"),
    (r"\bFCA\b", "FCA", "organisation", "FCA"),
    (r"\bBSI\b", "BSI", "organisation", "BSI"),
    (r"\bOFSTED\b", "OFSTED", "organisation", "OFSTED"),
    (r"\bCrown Commercial Service\b", "Crown Commercial Service", "organisation", "Crown Commercial Service"),
    # Certifications
    (r"\bISO[\s/]*27001\b", "ISO 27001", "certification", "ISO 27001"),
    (r"\bISO[\s/]*9001\b", "ISO 9001", "certification", "ISO 9001"),
    (r"\bISO[\s/]*14001\b", "ISO 14001", "certification", "ISO 14001"),
    (r"\bISO[\s/]*22301\b", "ISO 22301", "certification", "ISO 22301"),
    (r"\bCyber Essentials Plus\b", "Cyber Essentials Plus", "certification", "Cyber Essentials Plus"),
    (r"\bCyber Essentials\b(?!\s+Plus)", "Cyber Essentials", "certification", "Cyber Essentials"),
    (r"\bPCI[\s-]*DSS\b", "PCI DSS", "certification", "PCI DSS"),
    (r"\bSOC\s*2\b", "SOC 2", "certification", "SOC 2"),
    # Regulations
    (r"\bGDPR\b", "GDPR", "regulation", "GDPR"),
    (r"\bGeneral Data Protection Regulation\b", "General Data Protection Regulation", "regulation", "GDPR"),
    (r"\bData Protection Act 2018\b", "Data Protection Act 2018", "regulation", "Data Protection Act 2018"),
    (r"\bData Protection Act\b(?!\s+2018)", "Data Protection Act", "regulation", "Data Protection Act 2018"),
    (r"\bPECR\b", "PECR", "regulation", "PECR"),
    (r"\bFOI\b", "FOI", "regulation", "FOI"),
    (r"\bFreedom of Information\b", "Freedom of Information", "regulation", "FOI"),
    (r"\bRIDDOR\b", "RIDDOR", "regulation", "RIDDOR"),
    (r"\bCDM\b", "CDM", "regulation", "CDM Regulations"),
    (r"\bPPN\s*06/20\b", "PPN 06/20", "regulation", "PPN 06/20"),
    (r"\bPPN\s*02/23\b", "PPN 02/23", "regulation", "PPN 02/23"),
    # Frameworks
    (r"\bITIL\b", "ITIL", "framework", "ITIL"),
    (r"\bPRINCE2\b", "PRINCE2", "framework", "PRINCE2"),
    (r"\bNIST\b", "NIST", "framework", "NIST"),
    (r"\bOWASP\b", "OWASP", "framework", "OWASP"),
    (r"\bWCAG\b", "WCAG", "framework", "WCAG"),
    (r"\bSCRUM\b", "SCRUM", "framework", "Scrum"),
    (r"\bAgile\b", "Agile", "framework", "Agile"),
    # Technologies
    (r"\bActive Directory\b", "Active Directory", "technology", "Active Directory"),
    (r"\bAzure\b", "Azure", "technology", "Microsoft Azure"),
    (r"\bMicrosoft Azure\b", "Microsoft Azure", "technology", "Microsoft Azure"),
    (r"\bAWS\b", "AWS", "technology", "AWS"),
    (r"\bAmazon Web Services\b", "Amazon Web Services", "technology", "AWS"),
    (r"\bOffice 365\b", "Office 365", "technology", "Microsoft 365"),
    (r"\bMicrosoft 365\b", "Microsoft 365", "technology", "Microsoft 365"),
    (r"\bSharePoint\b", "SharePoint", "technology", "SharePoint"),
    (r"\bSalesforce\b", "Salesforce", "technology", "Salesforce"),
    (r"\bServiceNow\b", "ServiceNow", "technology", "ServiceNow"),
    (r"\bJira\b", "Jira", "technology", "Jira"),
    (r"\bSIEM\b", "SIEM", "technology", "SIEM"),
    # Sectors
    (r"\bpublic sector\b", "public sector", "sector", "Public Sector"),
    (r"\bprivate sector\b", "private sector", "sector", "Private Sector"),
    (r"\bhealthcare\b", "healthcare", "sector", "Healthcare"),
    (r"\beducation\b", "education", "sector", "Education"),
    (r"\bfinancial services\b", "financial services", "sector", "Financial Services"),
    (r"\blocal government\b", "local government", "sector", "Local Government"),
    (r"\bcentral government\b", "central government", "sector", "Central Government"),
    (r"\bdefence\b", "defence", "sector", "Defence"),
]

# Compile regex patterns once at module level
_COMPILED_ENTITY_PATTERNS = [
    (re.compile(pattern, re.IGNORECASE), name, etype, canonical)
    for pattern, name, etype, canonical in KNOWN_ENTITIES
]

# Module-level cache for entity aliases from DB
_entity_aliases: Optional[dict] = None


def load_entity_aliases() -> dict:
    """Load entity aliases from the entity_aliases DB table.

    Returns a dict mapping alias (lowercased) -> canonical name.
    Caches the result for the lifetime of the process.
    """
    global _entity_aliases
    if _entity_aliases is not None:
        return _entity_aliases

    try:
        from .store import _request
        status, data = _request(
            "GET",
            "entity_aliases?is_active=eq.true&select=alias,canonical",
        )
        if status in (200, 206) and isinstance(data, list):
            _entity_aliases = {
                row["alias"].lower(): row["canonical"]
                for row in data
                if row.get("alias") and row.get("canonical")
            }
            logger.info("Loaded %d entity aliases from DB", len(_entity_aliases))
        else:
            logger.warning("Failed to load entity aliases (status %s), using empty map", status)
            _entity_aliases = {}
    except Exception as e:
        logger.warning("Entity alias loading failed: %s", e)
        _entity_aliases = {}

    return _entity_aliases


def resolve_entity_alias(name: str) -> str:
    """Resolve an entity name through the alias map.

    Checks the cached alias map (loaded from entity_aliases table).
    Returns the canonical name if a mapping exists, otherwise the original name.
    """
    aliases = _entity_aliases if _entity_aliases is not None else {}
    return aliases.get(name.lower(), name)


def reset_entity_aliases():
    """Reset the entity aliases cache. Useful for testing."""
    global _entity_aliases
    _entity_aliases = None


def extract_entities_by_keyword(text: str) -> List[dict]:
    """Extract known entities from text using keyword matching.

    Scans the text for known organisations, certifications, regulations,
    frameworks, technologies, and sectors using pre-compiled regex patterns.

    Args:
        text: The text to scan for entities.

    Returns:
        List of entity dicts with keys: entity_name, entity_type,
        canonical_name, confidence.
    """
    if not text or not text.strip():
        return []

    found = {}  # key: (canonical_name, entity_type) -> entity dict
    for pattern, name, etype, canonical in _COMPILED_ENTITY_PATTERNS:
        if pattern.search(text):
            # Apply alias resolution
            resolved = resolve_entity_alias(canonical)
            key = (resolved.lower(), etype)
            if key not in found:
                found[key] = {
                    "entity_name": name,
                    "entity_type": etype,
                    "canonical_name": resolved,
                    "confidence": 0.9,  # keyword matches are high confidence
                }

    return list(found.values())


def _merge_entities(
    ai_entities: List[dict],
    keyword_entities: List[dict],
) -> List[dict]:
    """Merge AI-extracted and keyword-extracted entities.

    AI entities take precedence. Keyword entities are added only if they
    don't overlap (same canonical_name + entity_type).
    """
    seen = set()
    merged = []

    for ent in ai_entities:
        key = (ent["canonical_name"].lower(), ent["entity_type"])
        if key not in seen:
            seen.add(key)
            merged.append(ent)

    for ent in keyword_entities:
        key = (ent["canonical_name"].lower(), ent["entity_type"])
        if key not in seen:
            seen.add(key)
            merged.append(ent)

    return merged


# ──────────────────────────────────────────
# Entity storage
# ──────────────────────────────────────────

def store_entities(
    content_item_id: str,
    entities: List[dict],
) -> tuple:
    """Store extracted entities in entity_mentions table.

    Uses Supabase REST API to insert entity mentions, skipping duplicates
    (UNIQUE constraint on canonical_name + entity_type + content_item_id).

    Args:
        content_item_id: UUID of the content item.
        entities: List of dicts with entity_name, entity_type,
                  canonical_name, confidence.

    Returns:
        Tuple of (stored_count, skipped_count).
    """
    from .store import _request

    if not entities:
        return (0, 0)

    stored = 0
    skipped = 0

    for ent in entities:
        ent_type = ent.get("entity_type", "")
        if ent_type not in VALID_ENTITY_TYPES:
            logger.warning("Skipping entity with invalid type: %s", ent_type)
            skipped += 1
            continue

        canonical = ent.get("canonical_name", ent.get("entity_name", ""))
        if not canonical:
            skipped += 1
            continue

        # Apply alias resolution before storing
        canonical = resolve_entity_alias(canonical)

        record = {
            "content_item_id": content_item_id,
            "entity_type": ent_type,
            "entity_name": ent.get("entity_name", canonical),
            "canonical_name": canonical,
            "confidence": ent.get("confidence", 0.9),
        }

        status, response = _request("POST", "entity_mentions", record)

        if status in (200, 201):
            stored += 1
        elif status == 409:
            # Duplicate — UNIQUE constraint violation, skip gracefully
            skipped += 1
        else:
            logger.warning(
                "Failed to store entity mention (status %s): %s — %s",
                status, canonical, response,
            )
            skipped += 1

    return (stored, skipped)
