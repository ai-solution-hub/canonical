"""Deterministic key derivation for entity names.

DR-140: this produces what a stable primary key needs and nothing more. It is
NOT the mechanism that decides two names are one thing — `resolve_entities` is.
"""

from __future__ import annotations

import re
import unicodedata


def canonicalise_entity_name(name: str) -> str:
    """Return the deterministic key for an entity name.

    strip → NFKD → drop combining marks → lower. Deterministic + idempotent.
    """
    if not name:
        return ""
    result = unicodedata.normalize("NFKD", name.strip())
    result = "".join(c for c in result if not unicodedata.combining(c))
    return result.lower().strip()


# ──────────────────────────────────────────────────────────────────────────
# Cross-language relationship canonicaliser ({101.5}, PC-3 / PC-6 lane 1).
#
# This is a SEPARATE canonicaliser from canonicalise_entity_name() above.
# It reproduces the 12-step TS canonicalise() body
# (lib/entities/entity-dedup.ts:114), then a final .lower().
# ──────────────────────────────────────────────────────────────────────────

# Known abbreviations that should remain uppercase.
# Source of truth: ABBREVIATIONS in lib/entities/entity-dedup.ts:9.
_ABBREVIATIONS: dict[str, str] = {
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

# Step 1→2: slug detector — starts alphanumeric, contains a '-' or '_',
# and has no whitespace. Mirrors TS /^[a-z0-9].*[-_]/.test(s) && !/\s/.test(s).
_SLUG_LEAD_RE = re.compile(r"^[a-z0-9].*[-_]")
_WHITESPACE_RE = re.compile(r"\s")

# Step 3: ISO basic — "ISO27001" → "ISO 27001". TS /^iso\s*(\d)/i.
_REL_ISO_BASIC_RE = re.compile(r"^iso\s*(\d)", re.IGNORECASE)
# Step 4: ISO extended — "ISO/IEC 27001", "Iso Iec 27001", "ISO-27001".
# TS /^iso[/\-\s]*(?:iec[/\-\s]*)?(\d)/i.
_REL_ISO_EXT_RE = re.compile(r"^iso[/\-\s]*(?:iec[/\-\s]*)?(\d)", re.IGNORECASE)
# Step 5: strip ISO version suffix — "ISO 27001:2022" → "ISO 27001".
# TS /^(ISO \d+)[:\s]\d{4}$/ (NO ignorecase — case-sensitive in oracle).
_REL_ISO_VERSION_RE = re.compile(r"^(ISO \d+)[:\s]\d{4}$")
# Step 6: Cyber Essentials variants.
_REL_CE_RE = re.compile(r"^cyber\s*essentials\b", re.IGNORECASE)
_REL_CE_PLUS_RE = re.compile(r"^(Cyber Essentials)\s+plus$", re.IGNORECASE)
# Step 7: WCAG version — "Wcag 2 1 Aa" → "WCAG 2.1 AA".
_REL_WCAG_VER_RE = re.compile(r"^wcag\s+(\d)\s+(\d)\s*(aa|a)$", re.IGNORECASE)
_REL_WCAG_WORD_RE = re.compile(r"\bwcag\b", re.IGNORECASE)
# Step 8: company suffix normalisation.
_REL_LTD_RE = re.compile(r"\bLtd\.?$", re.IGNORECASE)
_REL_PLC_RE = re.compile(r"\bPLC$", re.IGNORECASE)
_REL_INC_RE = re.compile(r"\bInc\.?$", re.IGNORECASE)
# Step 10: all-lowercase-leading detector. TS /^[a-z]/.
_LEADS_LOWER_RE = re.compile(r"^[a-z]")
# Step 12: trailing period.
_TRAILING_PERIOD_RE = re.compile(r"\.$")


def _rel_slug_to_proper_case(slug: str) -> str:
    """Slug → Title Case, preserving abbreviations.

    Port of slugToProperCase() in entity-dedup.ts:69.
    """
    words = re.split(r"[-_]", slug)
    out: list[str] = []
    for word in words:
        lower = word.lower()
        if lower in _ABBREVIATIONS:
            out.append(_ABBREVIATIONS[lower])
        else:
            out.append(word[:1].upper() + word[1:].lower())
    return " ".join(out)


def _rel_title_case(text: str) -> str:
    """Title-case a multi-word string, preserving abbreviations.

    Port of titleCase() in entity-dedup.ts:83. TS splits on /\\s+/.
    """
    words = re.split(r"\s+", text)
    out: list[str] = []
    for word in words:
        lower = word.lower()
        if lower in _ABBREVIATIONS:
            out.append(_ABBREVIATIONS[lower])
        else:
            out.append(word[:1].upper() + word[1:].lower())
    return " ".join(out)


def _rel_canonicalise(name: str) -> str:
    """Port of the 12-step TS canonicalise() body (entity-dedup.ts:114).

    Called with NO entity-type argument, so the type-aware plural branch
    (step 11) stays inert — matching the legacy relationship-writer call
    shape at classify.ts:1785-1819.
    """
    result = name.strip()

    # 1 → 2. Slug-style → Title Case.
    if _SLUG_LEAD_RE.search(result) and not _WHITESPACE_RE.search(result):
        result = _rel_slug_to_proper_case(result)

    # 3. ISO basic: "ISO27001" → "ISO 27001". TS String.replace = first match.
    result = _REL_ISO_BASIC_RE.sub(lambda m: f"ISO {m.group(1)}", result, count=1)

    # 4. ISO extended: "ISO/IEC 27001" / "Iso Iec 27001" / "ISO-27001".
    result = _REL_ISO_EXT_RE.sub(lambda m: f"ISO {m.group(1)}", result, count=1)

    # 5. Strip ISO version suffix: "ISO 27001:2022" → "ISO 27001".
    result = _REL_ISO_VERSION_RE.sub(lambda m: m.group(1), result, count=1)

    # 6. Cyber Essentials variants.
    result = _REL_CE_RE.sub("Cyber Essentials", result, count=1)
    result = _REL_CE_PLUS_RE.sub(lambda m: f"{m.group(1)} Plus", result, count=1)

    # 7. WCAG normalisation.
    result = _REL_WCAG_VER_RE.sub(
        lambda m: f"WCAG {m.group(1)}.{m.group(2)} {m.group(3).upper()}",
        result,
        count=1,
    )
    result = _REL_WCAG_WORD_RE.sub("WCAG", result)  # /gi → replace all

    # 8. Company suffix normalisation.
    result = _REL_LTD_RE.sub("Limited", result, count=1)
    result = _REL_PLC_RE.sub("PLC", result, count=1)
    result = _REL_INC_RE.sub("Inc", result, count=1)

    # 9. Single-word abbreviation fix.
    lower = result.lower()
    if lower in _ABBREVIATIONS:
        result = _ABBREVIATIONS[lower]

    # 10. Multi-word title case for all-lowercase inputs.
    if _LEADS_LOWER_RE.search(result) and result.lower() not in _ABBREVIATIONS:
        result = _rel_title_case(result)

    # 11. Plural normalisation — type-aware. INERT here (no entity_type arg),
    #     mirroring the legacy relationship-writer call shape.

    # 12. Strip trailing periods.
    result = _TRAILING_PERIOD_RE.sub("", result, count=1)

    return result


def canonicalise_for_relationship(name: str) -> str:
    """Canonical endpoint for entity-relationship source/target names."""
    return _rel_canonicalise(name).lower()
