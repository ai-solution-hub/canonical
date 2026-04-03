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
# Identifier exclusion patterns
# ──────────────────────────────────────────

# Patterns matching non-entity identifiers that should be excluded from extraction.
# Ported from lib/ai/classify.ts EXCLUDED_PATTERNS.
_EXCLUDED_PATTERNS = [
    re.compile(r"^SIC\s*Code", re.IGNORECASE),            # SIC classification codes
    re.compile(r"^VAT\s*(Registration|Reg)", re.IGNORECASE),  # VAT registration numbers
    re.compile(r"^DUNS\s*Number", re.IGNORECASE),          # D-U-N-S identifiers
    re.compile(r"^\d{4,}$"),                               # Pure numeric identifiers
    re.compile(r"^[A-Z]{2}\s*\d{3}\s*\d{4}\s*\d{2}$", re.IGNORECASE),  # VAT number format
]


def is_excluded_entity(name: str) -> bool:
    """Check whether an entity name matches an excluded identifier pattern."""
    return any(p.search(name) for p in _EXCLUDED_PATTERNS)


def _filter_entities(entities: List[dict]) -> List[dict]:
    """Filter out non-entity identifiers and false positives from extracted entities.

    Removes SIC codes, VAT registration numbers, DUNS numbers, internal policies,
    generic concepts, role titles, protocols/formats, and other non-entities.
    """
    filtered = []
    for ent in entities:
        name = ent.get("entity_name", "")
        canonical = ent.get("canonical_name", "")
        entity_type = ent.get("entity_type", "")
        if is_excluded_entity(name) or is_excluded_entity(canonical):
            logger.debug("Excluding identifier entity: %s", name or canonical)
            continue
        if _is_internal_document(canonical):
            logger.debug("Excluding internal document entity: %s", canonical)
            continue
        if _is_generic_concept(canonical):
            logger.debug("Excluding generic concept entity: %s", canonical)
            continue
        if entity_type == "person" and _is_role_title(name):
            logger.debug("Excluding role title entity: %s", name)
            continue
        if _is_protocol_or_format(canonical):
            logger.debug("Excluding protocol/format entity: %s", canonical)
            continue
        if _is_insurance_or_contract(canonical):
            logger.debug("Excluding insurance/contract entity: %s", canonical)
            continue
        if _is_management_system_acronym(canonical):
            logger.debug("Excluding management system acronym: %s", canonical)
            continue
        if _is_gdpr_artefact(canonical):
            logger.debug("Excluding GDPR artefact entity: %s", canonical)
            continue
        filtered.append(ent)
    return filtered


# ──────────────────────────────────────────
# Entity quality filters (post-extraction)
# ──────────────────────────────────────────

# Suffix patterns matching internal company documents
_INTERNAL_DOCUMENT_SUFFIXES = [
    re.compile(r"policy$", re.IGNORECASE),
    re.compile(r"procedure$", re.IGNORECASE),
    re.compile(r"plan$", re.IGNORECASE),
    re.compile(r"register$", re.IGNORECASE),
    re.compile(r"schedule$", re.IGNORECASE),
    re.compile(r"agreement$", re.IGNORECASE),
    re.compile(r"statement$", re.IGNORECASE),
    re.compile(r"process$", re.IGNORECASE),
]

# Abstract concepts and generic terms that should not be extracted as entities
_GENERIC_CONCEPTS = frozenset([
    "information security", "information governance", "business continuity",
    "data protection", "regulatory compliance", "security best practice",
    "disaster recovery", "penetration testing", "encryption", "firewalls",
    "access control", "two-factor authentication", "multi-factor authentication",
    "social value", "data retention", "incident response", "risk management",
    "vulnerability management", "patch management", "change management",
    "physical security", "network security", "endpoint security",
    "security governance", "security awareness", "data wiping",
    "physical destruction", "staff vetting", "data handling",
    "continuous improvement", "service delivery", "information management",
    "security monitoring", "threat detection", "security best practices",
    # Security principles (not methodologies or frameworks)
    "principle of least privilege", "least privilege",
    "defence in depth", "defense in depth", "zero trust",
    "segregation of duty", "separation of duties",
    # Generic technology categories (not specific products)
    "cloud computing", "artificial intelligence", "machine learning", "blockchain",
    # Service tiers and generic descriptors
    "standard support", "premium support", "set-up fee", "setup fee",
    # Generic software categories
    "content management system", "learning management system",
    # Generic activities (not named projects)
    "cloud migration", "security improvement",
    # Product features (not products themselves)
    "single sign-on",
    # Internal departments and informal groupings
    "it department", "hr team", "the project team", "senior management",
    # Generic capability activities
    "online training", "staff training",
    # Geographic regions (not sectors)
    "england", "wales", "scotland", "northern ireland",
    "european economic area", "eea",
    # Demographic descriptions (not sectors)
    "vulnerable adults", "children and young people",
])

# Patterns matching job titles and role descriptions (not person names)
_ROLE_TITLE_PATTERNS = [
    re.compile(
        r"^(managing|account|project|customer|technical|operations|quality|it|security|senior|chief|lead)\s+"
        r"(director|manager|officer|lead|executive|administrator|coordinator|consultant|engineer|developer|analyst|architect)",
        re.IGNORECASE,
    ),
    re.compile(r"^chief\s+\w+(\s+\w+)?\s+(officer|director)", re.IGNORECASE),
    re.compile(r"^(ceo|cto|cfo|cio|ciso|dpo|md)$", re.IGNORECASE),
    re.compile(r"^director$", re.IGNORECASE),
    re.compile(r"^manager$", re.IGNORECASE),
    re.compile(r"^officer$", re.IGNORECASE),
    re.compile(r"^data protection officer$", re.IGNORECASE),
    re.compile(r"^client project lead$", re.IGNORECASE),
    re.compile(r"^information security officer$", re.IGNORECASE),
]

# Protocols, file formats, and cryptographic algorithms
_PROTOCOL_FORMATS = frozenset([
    "https", "http", "ssh", "ssl", "tls", "ftp", "sftp", "smtp", "dns",
    "tcp", "udp", "ldap", "oauth",
    "pdf", "csv", "html", "xml", "json", "javascript", "python", "java", "sql", "css",
    "aes-256", "aes", "sha-256", "rsa", "pbkdf2", "hmac", "sha256",
    "pbkdf2-hmac-sha256", "hmac-sha256", "aes-128", "sha-512",
])

# Insurance products and contract types
_INSURANCE_AND_CONTRACTS = frozenset([
    "professional indemnity insurance", "public liability insurance",
    "cyber liability insurance", "employer liability insurance",
    "employers liability insurance", "product liability insurance",
    "non-disclosure agreement", "service level agreement",
    "data processing agreement", "master services agreement",
])

# Management system acronyms — prefer the certification instead
_MANAGEMENT_SYSTEM_ACRONYMS = frozenset([
    "isms", "qms", "ems", "ims",
    "information security management system",
    "quality management system",
    "environmental management system",
    "integrated management system",
])

# GDPR artefacts that are legal concepts, not standalone entities
_GDPR_ARTEFACTS = frozenset([
    "records of processing activity", "record of processing activities",
    "data processing agreement", "data protection impact assessment",
    "data protection by design and default",
    "technical and organisational measures",
    "consent", "contractual necessity", "legal obligation",
    "legitimate interest", "vital interest", "public interest",
    "lawful basis", "lawful bases",
    "data subject access request", "right to erasure",
    "right to rectification", "right to portability",
    "data subject right", "data subject rights",
])


def _is_internal_document(name: str) -> bool:
    """Check whether an entity name matches an internal document suffix pattern."""
    return any(p.search(name.strip()) for p in _INTERNAL_DOCUMENT_SUFFIXES)


def _is_generic_concept(name: str) -> bool:
    """Check whether an entity name is a generic concept."""
    return name.lower().strip() in _GENERIC_CONCEPTS


def _is_role_title(name: str) -> bool:
    """Check whether an entity name is a role title rather than a person name."""
    return any(p.search(name.strip()) for p in _ROLE_TITLE_PATTERNS)


def _is_protocol_or_format(name: str) -> bool:
    """Check whether an entity name is a protocol, file format, or algorithm."""
    return name.lower().strip() in _PROTOCOL_FORMATS


def _is_insurance_or_contract(name: str) -> bool:
    """Check whether an entity name is an insurance product or contract type."""
    return name.lower().strip() in _INSURANCE_AND_CONTRACTS


def _is_management_system_acronym(name: str) -> bool:
    """Check whether an entity name is a management system acronym."""
    return name.lower().strip() in _MANAGEMENT_SYSTEM_ACRONYMS


def _is_gdpr_artefact(name: str) -> bool:
    """Check whether an entity name is a GDPR artefact."""
    return name.lower().strip() in _GDPR_ARTEFACTS


# ──────────────────────────────────────────
# Entity name canonicalisation
# ──────────────────────────────────────────

# Known abbreviations that should remain uppercase.
# Ported from lib/entities/entity-dedup.ts ABBREVIATIONS.
_ABBREVIATIONS = {
    "gdpr": "GDPR",
    "ico": "ICO",
    "owasp": "OWASP",
    "crest": "CREST",
    "csv": "CSV",
    "pdf": "PDF",
    "sla": "SLA",
    "ims": "IMS",
    "isms": "ISMS",
    "uk": "UK",
    "dpo": "DPO",
    "tls": "TLS",
    "ssl": "SSL",
    "https": "HTTPS",
    "http": "HTTP",
    "html": "HTML",
    "css": "CSS",
    "mysql": "MySQL",
    "api": "API",
    "sql": "SQL",
    "hmrc": "HMRC",
    "sme": "SME",
    "saml": "SAML",
    "sso": "SSO",
    "aws": "AWS",
    "mfa": "MFA",
    "nhs": "NHS",
    "ncsc": "NCSC",
    "plc": "PLC",
    "lms": "LMS",
    "pdms": "PDMS",
    "wcag": "WCAG",
    "vpn": "VPN",
    "ssh": "SSH",
    "sftp": "SFTP",
    "saas": "SaaS",
    "cctv": "CCTV",
    "dpia": "DPIA",
    "ppon": "PPON",
    "hl7": "HL7",
}

# Entity types where trailing plural 's' should be stripped
_DEPLURAL_TYPES = frozenset([
    "capability", "framework", "regulation", "certification",
    "technology", "standard", "methodology", "product",
])


def _slug_to_proper_case(slug: str) -> str:
    """Convert a slug-style name to Title Case, preserving known abbreviations.

    "penetration-testing" -> "Penetration Testing"
    "uk-gdpr" -> "UK GDPR"
    """
    parts = re.split(r"[-_]", slug)
    return " ".join(
        _ABBREVIATIONS.get(w.lower(), w[0].upper() + w[1:].lower() if w else "")
        for w in parts
    )


def _title_case(text: str) -> str:
    """Title-case a multi-word string, preserving known abbreviations."""
    return " ".join(
        _ABBREVIATIONS.get(w.lower(), w[0].upper() + w[1:].lower() if w else "")
        for w in text.split()
    )


def canonicalise(name: str, entity_type: Optional[str] = None) -> str:
    """Normalise an entity name for consistent storage and deduplication.

    Ported from lib/entities/entity-dedup.ts canonicalise().

    Rules applied (in order):
     1. Trim whitespace
     2. Convert slug-style names to proper case
     3. Normalise ISO standards (basic): "ISO27001" -> "ISO 27001"
     4. Normalise ISO extended formats: "ISO/IEC 27001" -> "ISO 27001"
     5. Strip ISO version suffixes: "ISO 27001:2022" -> "ISO 27001"
     6. Normalise Cyber Essentials variants
     7. WCAG normalisation: "Wcag 2 1 Aa" -> "WCAG 2.1 AA"
     8. Company suffix normalisation: "Ltd" -> "Limited"
     9. Fix single-word abbreviations: "gdpr" -> "GDPR"
    10. Multi-word title case for all-lowercase inputs
    11. Plural normalisation (type-aware)
    12. Strip trailing periods
    """
    result = name.strip()

    # 1-2. Convert slug-style names: "penetration-testing" -> "Penetration Testing"
    if re.match(r"^[a-z0-9].*[-_]", result) and " " not in result:
        result = _slug_to_proper_case(result)

    # 3. Normalise ISO standards (basic): "ISO27001" -> "ISO 27001"
    result = re.sub(r"^iso\s*(\d)", r"ISO \1", result, flags=re.IGNORECASE)

    # 4. Normalise ISO extended formats
    result = re.sub(r"^iso[/\-\s]*(?:iec[/\-\s]*)?(\d)", r"ISO \1", result, flags=re.IGNORECASE)

    # 5. Strip ISO version suffixes: "ISO 27001:2022" -> "ISO 27001"
    result = re.sub(r"^(ISO \d+)[:\s]\d{4}$", r"\1", result)

    # 6. Normalise Cyber Essentials variants
    result = re.sub(r"^cyber\s*essentials\b", "Cyber Essentials", result, flags=re.IGNORECASE)
    result = re.sub(r"^(Cyber Essentials)\s+plus$", r"\1 Plus", result, flags=re.IGNORECASE)

    # 7. WCAG normalisation: "Wcag 2 1 Aa" -> "WCAG 2.1 AA"
    def _wcag_replace(m):
        return f"WCAG {m.group(1)}.{m.group(2)} {m.group(3).upper()}"
    result = re.sub(r"^wcag\s+(\d)\s+(\d)\s*(aa|a)$", _wcag_replace, result, flags=re.IGNORECASE)
    result = re.sub(r"\bwcag\b", "WCAG", result, flags=re.IGNORECASE)

    # 8. Company suffix normalisation
    result = re.sub(r"\bLtd\.?$", "Limited", result, flags=re.IGNORECASE)
    result = re.sub(r"\bPLC$", "PLC", result, flags=re.IGNORECASE)
    result = re.sub(r"\bInc\.?$", "Inc", result, flags=re.IGNORECASE)

    # 9. Fix single-word abbreviations: "gdpr" -> "GDPR"
    lower = result.lower()
    if lower in _ABBREVIATIONS:
        result = _ABBREVIATIONS[lower]

    # 10. Multi-word title case for all-lowercase inputs
    if result and result[0].islower() and lower not in _ABBREVIATIONS:
        result = _title_case(result)

    # 11. Plural normalisation -- strip trailing 's' for applicable entity types
    if (
        entity_type
        and entity_type in _DEPLURAL_TYPES
        and " " in result
        and len(result) > 4
    ):
        last_word = result.rsplit(None, 1)[-1] if result else ""
        last_word_is_abbrev = last_word.lower() in _ABBREVIATIONS
        is_proper_name = result.startswith("Cyber Essentials")

        if not last_word_is_abbrev and not is_proper_name:
            if result.endswith("ies"):
                result = result[:-3] + "y"
            elif (
                result.endswith("s")
                and not result.endswith("ss")
                and not result.endswith("us")
                and not result.endswith("is")
            ):
                result = result[:-1]

    # 12. Strip trailing periods
    result = result.rstrip(".")

    return result


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
    relationships: List[dict] = field(default_factory=list)
    temporal_references: List[dict] = field(default_factory=list)
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

    # Truncate content at 5000 chars for classification
    if len(content) > 5000:
        content = content[:5000] + "..."

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
        max_tokens=2000,
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
            raw_canonical = ent.get("canonical_name", ent.get("name", ""))
            ai_entities.append({
                "entity_name": ent.get("name", ""),
                "entity_type": ent_type,
                "canonical_name": canonicalise(raw_canonical, ent_type),
                "confidence": ent.get("confidence", 1.0),
            })

    # Filter out non-entity identifiers (SIC codes, VAT numbers, etc.)
    ai_entities = _filter_entities(ai_entities)

    # Supplement with keyword-based entity extraction from the content
    combined_text = f"{title} {content}"
    keyword_entities = extract_entities_by_keyword(combined_text)

    # Merge: AI entities take precedence, keyword entities fill gaps
    entities = _merge_entities(ai_entities, keyword_entities)

    # Parse relationships from response (if the AI returned them)
    raw_relationships = parsed.get("relationships", [])
    relationships = []
    valid_relationship_types = frozenset([
        "holds", "complies_with", "delivers_to", "uses",
        "demonstrated_by", "requires", "part_of", "supersedes",
        "references", "evidences",
    ])
    for rel in raw_relationships:
        rel_type = rel.get("relationship", "")
        source = rel.get("source", "")
        target = rel.get("target", "")
        if rel_type in valid_relationship_types and source and target:
            relationships.append({
                "source": canonicalise(source),
                "relationship_type": rel_type,
                "target": canonicalise(target),
            })

    # Parse temporal references from response (if the AI returned them)
    raw_temporal = parsed.get("temporal_references", [])
    temporal_references = []
    valid_context_types = frozenset(["expiry", "effective", "historical", "unknown"])
    for ref in raw_temporal:
        date_str = ref.get("date", "")
        context = ref.get("context", "")
        context_type = ref.get("context_type", "unknown")
        if date_str and context:
            if context_type not in valid_context_types:
                context_type = "unknown"
            temporal_ref = {
                "date": date_str,
                "context": context,
                "context_type": context_type,
            }
            # Carry through related_entity if provided by the AI
            related_entity = ref.get("related_entity")
            if related_entity:
                temporal_ref["related_entity"] = related_entity
            temporal_references.append(temporal_ref)

    cls_result = ClassificationResult(
        primary_domain=parsed["primary_domain"],
        primary_subtopic=parsed["primary_subtopic"],
        confidence=parsed["confidence"],
        secondary_domain=parsed.get("secondary_domain"),
        secondary_subtopic=parsed.get("secondary_subtopic"),
        suggested_title=parsed.get("suggested_title", ""),
        ai_summary=parsed.get("ai_summary", ""),
        ai_keywords=list(dict.fromkeys(normalise_keyword(kw) for kw in parsed.get("ai_keywords", []) if normalise_keyword(kw))),
        reasoning=parsed.get("reasoning", ""),
        is_fragment=flags.get("is_fragment", False),
        uncertain=flags.get("uncertain", False),
        requires_review=flags.get("requires_review", False),
        reason_if_flagged=flags.get("reason_if_flagged", ""),
        entities=entities,
        relationships=relationships,
        temporal_references=temporal_references,
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
    "product", "standard", "methodology",
])

# Known entities for keyword-based extraction.
# Each entry: (pattern, entity_name, entity_type, canonical_name)
# Patterns are compiled as case-insensitive regex.
KNOWN_ENTITIES = [
    # Organisations
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
    (r"\bNIST\b", "NIST", "framework", "NIST"),
    (r"\bOWASP\b", "OWASP", "framework", "OWASP"),
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
    # Standards
    (r"\bWCAG\b", "WCAG", "standard", "WCAG"),
    (r"\bHL7\b", "HL7", "standard", "HL7"),
    (r"\bIEEE\b", "IEEE", "standard", "IEEE"),
    (r"\bBS\s*5839\b", "BS 5839", "standard", "BS 5839"),
    (r"\bBS\s*5306\b", "BS 5306", "standard", "BS 5306"),
    (r"\bBS\s*5445\b", "BS 5445", "standard", "BS 5445"),
    (r"\bBS\s*5588\b", "BS 5588", "standard", "BS 5588"),
    (r"\bBS\s*6266\b", "BS 6266", "standard", "BS 6266"),
    (r"\bBS\s*3115\b", "BS 3115", "standard", "BS 3115"),
    # Methodologies
    (r"\bAgile\b", "Agile", "methodology", "Agile"),
    (r"\bSCRUM\b", "SCRUM", "methodology", "Scrum"),
    (r"\bScrum\b", "Scrum", "methodology", "Scrum"),
    (r"\bPRINCE2\b", "PRINCE2", "methodology", "PRINCE2"),
    (r"\bLean\b(?!\s+(?:Cuisine|meat))", "Lean", "methodology", "Lean"),
    (r"\bSix Sigma\b", "Six Sigma", "methodology", "Six Sigma"),
    (r"\bKanban\b", "Kanban", "methodology", "Kanban"),
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

        # Skip excluded identifier patterns
        if is_excluded_entity(canonical) or is_excluded_entity(ent.get("entity_name", "")):
            skipped += 1
            continue

        # Apply canonicalisation and alias resolution, then lowercase for index compatibility
        canonical = canonicalise(canonical, ent_type)
        canonical = resolve_entity_alias(canonical)
        canonical = canonical.lower()

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


def store_relationships(
    content_item_id: str,
    relationships: List[dict],
) -> tuple:
    """Store extracted relationships in entity_relationships table.

    Uses Supabase REST API to insert relationship rows.

    Args:
        content_item_id: UUID of the content item.
        relationships: List of dicts with source, relationship_type, target.

    Returns:
        Tuple of (stored_count, skipped_count).
    """
    from .store import _request

    if not relationships:
        return (0, 0)

    stored = 0
    skipped = 0

    for rel in relationships:
        source = rel.get("source", "")
        target = rel.get("target", "")
        rel_type = rel.get("relationship_type", "")

        if not source or not target or not rel_type:
            skipped += 1
            continue

        # Apply alias resolution and lowercase for index compatibility
        # (canonicalisation already applied during parsing in classify())
        source = resolve_entity_alias(source).lower()
        target = resolve_entity_alias(target).lower()

        record = {
            "source_entity": source,
            "relationship_type": rel_type,
            "target_entity": target,
            "source_item_id": content_item_id,
            "confidence": 1.0,
        }

        status, response = _request("POST", "entity_relationships", record)

        if status in (200, 201):
            stored += 1
        elif status == 409:
            skipped += 1
        else:
            logger.warning(
                "Failed to store relationship (status %s): %s %s %s — %s",
                status, source, rel_type, target, response,
            )
            skipped += 1

    return (stored, skipped)
