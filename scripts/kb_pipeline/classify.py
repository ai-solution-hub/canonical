"""Classification via Opus 4.6 with structured outputs."""

import json
import logging
from dataclasses import dataclass
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
